/**
 * `PointerInput`（issue #11 / T10）——把 DOM 指標事件接到 `ToolRouter`。
 *
 * 薄的接線層：`pointerdown/move/up/cancel` → 換算成畫布局部座標 + 時間戳 →
 * 呼叫 `ToolRouter`。所有影響模擬的輸入都經由 tracker 的 `emit`（接
 * `sim.applyInput`），輸入層不直接碰求解器內部（ADR-0005）。
 *
 * issue #65 / V2 T3-1：內部持有的 tracker 從 `GestureTracker` 換成
 * `ToolRouter`（「一般操作」下原封不動委派給既有 `GestureTracker`，行為不變）
 * ——`setActiveTool` 轉發給 `ToolRouter`，供 `ControlPanel` 的「目前工具」
 * 選擇器呼叫（見 ADR-0011）。
 *
 * **不直接把瀏覽器的 `PointerEvent.pointerId` 當 `GestureTracker`／`SimCore` 的
 * `id` 用**——滑鼠裝置的 `pointerId` 依規範永遠是 `1`，如果照樣沿用，兩次分開
 * 的滑鼠手勢會共用同一個 id。這對一般 Grab 沒事（放開就清掉），但 Pin 會一直
 * 留在 `constraints` map 裡：後續任何一次不相干的滑鼠 Grab 只要撞上同一個 id，
 * `SimCore.doGrab` 會直接覆寫掉那個 Pin（見 issue #14 事後回報的 bug）。這裡改
 * 成每次 `pointerdown` 自己配一個遞增的合成 id（`sessionIds` 記錄瀏覽器 id →
 * 合成 id 的對應，`pointerup`/`pointercancel` 時清掉），讓每個獨立手勢的身分
 * 互不相干，Pin 才能真的長期存在、不被日後無關的操作誤刪。
 *
 * **只認滑鼠左鍵／觸控／觸控筆的主要接觸點**（`ev.button === 0`，這是
 * `PointerEvent` 對「主鍵／唯一接觸點」的統一表示法，觸控與觸控筆本來就只
 * 回報 0）。滑鼠中鍵（`button === 1`）整個忽略、不進 `ToolRouter`——
 * 中鍵留給 `CameraInput` 當相機平移，兩者才不會對同一次按下各自反應（見
 * `CameraInput` 對應的判斷）。
 */

import type { FanState, InputEvent, PinInfo, Point } from '../sim';
import type { GestureConfig } from './GestureTracker';
import {
  type EraseParams,
  type FanParams,
  type SprayParams,
  type ToolId,
  ToolRouter,
} from './ToolRouter';

export interface PointerInputOptions {
  screenToWorld: (screenX: number, screenY: number) => Point;
  applyInput: (event: InputEvent) => void;
  /** 世界座標是否落在 Jelly 上；沒命中的 `pointerdown` 不當 Grab（交給相機層）。 */
  hitTest?: (world: Point) => boolean;
  /** 轉發給 `ToolRouter`（issue #67）——場上目前的電風扇幾何，供拖曳既有風扇的判定用。 */
  getFan?: () => FanState | null;
  /** 轉發給 `ToolRouter`（issue #69）——場上目前的 Pin，供撒 Pin 的間距判定用。 */
  listPins?: () => readonly PinInfo[];
  config?: Partial<GestureConfig>;
  /** 時鐘來源（測試可注入）。預設 `performance.now`。 */
  now?: () => number;
}

export class PointerInput {
  private readonly target: HTMLElement;
  private readonly tracker: ToolRouter;
  private readonly now: () => number;
  /** 瀏覽器 `pointerId` → 這次手勢的合成 id；手勢結束（up/cancel）就刪掉。 */
  private readonly sessionIds = new Map<number, number>();
  private nextSessionId = 1;

  constructor(target: HTMLElement, opts: PointerInputOptions) {
    this.target = target;
    this.now = opts.now ?? (() => performance.now());
    this.tracker = new ToolRouter({
      screenToWorld: opts.screenToWorld,
      emit: opts.applyInput,
      hitTest: opts.hitTest,
      getFan: opts.getFan,
      listPins: opts.listPins,
      config: opts.config,
    });

    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onCancel);
  }

  destroy(): void {
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onCancel);
  }

  get activeCount(): number {
    return this.tracker.activeCount;
  }

  /** 轉發給 `ToolRouter`（issue #65）——`ControlPanel` 的「目前工具」選擇器變更時呼叫。 */
  setActiveTool(tool: ToolId): void {
    this.tracker.setActiveTool(tool);
  }

  /** 轉發給 `ToolRouter.setFanParams`（issue #67）——面板電風扇滑桿變更時呼叫。 */
  setFanParams(params: Partial<FanParams>): void {
    this.tracker.setFanParams(params);
  }

  /** 轉發給 `ToolRouter.setSprayParams`（issue #69）——面板撒 Pin 滑桿變更時呼叫。 */
  setSprayParams(params: Partial<SprayParams>): void {
    this.tracker.setSprayParams(params);
  }

  /** 轉發給 `ToolRouter.setEraseParams`（issue #70）——面板移除 Pin 滑桿變更時呼叫。 */
  setEraseParams(params: Partial<EraseParams>): void {
    this.tracker.setEraseParams(params);
  }

  /** 轉發給 `ToolRouter`（issue #68）——面板「開始設定形狀」／「完成設定」按鈕呼叫。 */
  beginFormationDefine(): void {
    this.tracker.beginFormationDefine();
  }

  endFormationDefine(): void {
    this.tracker.endFormationDefine();
  }

  /** 供 `FormationOverlay` 每幀讀（issue #68）——`JellySandbox.frame` 用來投影成螢幕座標。 */
  get isDefiningFormation(): boolean {
    return this.tracker.isDefiningFormation;
  }

  get formationDefinePreview(): readonly Point[] {
    return this.tracker.formationDefinePreview;
  }

  get formationActiveGroups(): ToolRouter['formationActiveGroups'] {
    return this.tracker.formationActiveGroups;
  }

  /** 轉發給 `ToolRouter.formationPreviewAt`（issue #79）——閒置時跟著游標的形狀預覽。 */
  formationPreviewAt(anchor: Point): readonly Point[] {
    return this.tracker.formationPreviewAt(anchor);
  }

  private localXY(ev: PointerEvent): [number, number] {
    const r = this.target.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onDown = (ev: PointerEvent): void => {
    ev.preventDefault();
    if (ev.button !== 0) return; // 中鍵／右鍵不算 Grab；中鍵留給 CameraInput 平移
    this.target.setPointerCapture(ev.pointerId);
    const id = this.nextSessionId++;
    this.sessionIds.set(ev.pointerId, id);
    const [x, y] = this.localXY(ev);
    this.tracker.down(id, x, y, this.now());
  };

  private onMove = (ev: PointerEvent): void => {
    const id = this.sessionIds.get(ev.pointerId);
    if (id === undefined) return;
    const [x, y] = this.localXY(ev);
    this.tracker.move(id, x, y);
  };

  private onUp = (ev: PointerEvent): void => {
    const id = this.sessionIds.get(ev.pointerId);
    this.sessionIds.delete(ev.pointerId);
    if (id !== undefined) {
      const [x, y] = this.localXY(ev);
      this.tracker.up(id, x, y, this.now());
    }
    this.releaseCapture(ev.pointerId);
  };

  private onCancel = (ev: PointerEvent): void => {
    const id = this.sessionIds.get(ev.pointerId);
    this.sessionIds.delete(ev.pointerId);
    if (id !== undefined) this.tracker.cancel(id);
    this.releaseCapture(ev.pointerId);
  };

  private releaseCapture(pointerId: number): void {
    if (this.target.hasPointerCapture(pointerId)) this.target.releasePointerCapture(pointerId);
  }
}
