/**
 * `PointerInput`（issue #11 / T10）——把 DOM 指標事件接到 `GestureTracker`。
 *
 * 薄的接線層：`pointerdown/move/up/cancel` → 換算成畫布局部座標 + 時間戳 →
 * 呼叫 `GestureTracker`。所有影響模擬的輸入都經由 tracker 的 `emit`（接
 * `sim.applyInput`），輸入層不直接碰求解器內部（ADR-0005）。
 *
 * **不直接把瀏覽器的 `PointerEvent.pointerId` 當 `GestureTracker`／`SimCore` 的
 * `id` 用**——滑鼠裝置的 `pointerId` 依規範永遠是 `1`，如果照樣沿用，兩次分開
 * 的滑鼠手勢會共用同一個 id。這對一般 Grab 沒事（放開就清掉），但 Pin 會一直
 * 留在 `constraints` map 裡：後續任何一次不相干的滑鼠 Grab 只要撞上同一個 id，
 * `SimCore.doGrab` 會直接覆寫掉那個 Pin（見 issue #14 事後回報的 bug）。這裡改
 * 成每次 `pointerdown` 自己配一個遞增的合成 id（`sessionIds` 記錄瀏覽器 id →
 * 合成 id 的對應，`pointerup`/`pointercancel` 時清掉），讓每個獨立手勢的身分
 * 互不相干，Pin 才能真的長期存在、不被日後無關的操作誤刪。
 */

import type { InputEvent, Point } from '../sim';
import { type GestureConfig, GestureTracker } from './GestureTracker';

export interface PointerInputOptions {
  screenToWorld: (screenX: number, screenY: number) => Point;
  applyInput: (event: InputEvent) => void;
  /** 世界座標是否落在 Jelly 上；沒命中的 `pointerdown` 不當 Grab（交給相機層）。 */
  hitTest?: (world: Point) => boolean;
  config?: Partial<GestureConfig>;
  /** 時鐘來源（測試可注入）。預設 `performance.now`。 */
  now?: () => number;
}

export class PointerInput {
  private readonly target: HTMLElement;
  private readonly tracker: GestureTracker;
  private readonly now: () => number;
  /** 瀏覽器 `pointerId` → 這次手勢的合成 id；手勢結束（up/cancel）就刪掉。 */
  private readonly sessionIds = new Map<number, number>();
  private nextSessionId = 1;

  constructor(target: HTMLElement, opts: PointerInputOptions) {
    this.target = target;
    this.now = opts.now ?? (() => performance.now());
    this.tracker = new GestureTracker({
      screenToWorld: opts.screenToWorld,
      emit: opts.applyInput,
      hitTest: opts.hitTest,
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

  private localXY(ev: PointerEvent): [number, number] {
    const r = this.target.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onDown = (ev: PointerEvent): void => {
    ev.preventDefault();
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
