/**
 * `PointerInput`（issue #11 / T10）——把 DOM 指標事件接到 `ToolRouter`。
 *
 * 薄的接線層：`pointerdown/move/up/cancel` → 換算成畫布局部座標 + 時間戳 →
 * 呼叫 `ToolRouter`。所有影響模擬的輸入都經由 `ToolRouter` 的 `emit`（接
 * `sim.applyInput`），輸入層不直接碰求解器內部（ADR-0005）。
 *
 * issue #65 / V2 T3-1：內部持有的 tracker 從 `GestureTracker` 換成
 * `ToolRouter`（「一般操作」下原封不動委派給既有 `GestureTracker`，行為不變；
 * 見 ADR-0011）。
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
 *
 * issue #159（spec #158）：縮成純 DOM adapter——只做指標事件監聽、pointer capture、
 * session id，並呼叫 `ToolRouter` 的 `down`／`move`／`up`／`cancel`。`ToolRouter` 由沙盒
 * 自己建立並持有（工具、模式、參數、編隊查詢都直接對它），這裡不再轉發任何方法或選項；
 * 螢幕→世界投影也由 `ToolRouter` 自己持有，這裡只遞畫布局部座標。
 */

import type { ToolRouter } from './ToolRouter';

export interface PointerInputOptions {
  /** 時鐘來源（測試可注入）。預設 `performance.now`。 */
  now?: () => number;
}

export class PointerInput {
  private readonly target: HTMLElement;
  private readonly router: ToolRouter;
  private readonly now: () => number;
  /** 瀏覽器 `pointerId` → 這次手勢的合成 id；手勢結束（up/cancel）就刪掉。 */
  private readonly sessionIds = new Map<number, number>();
  private nextSessionId = 1;

  constructor(target: HTMLElement, router: ToolRouter, opts: PointerInputOptions = {}) {
    this.target = target;
    this.router = router;
    this.now = opts.now ?? (() => performance.now());

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
    this.router.down(id, x, y, this.now());
  };

  private onMove = (ev: PointerEvent): void => {
    const id = this.sessionIds.get(ev.pointerId);
    if (id === undefined) return;
    const [x, y] = this.localXY(ev);
    this.router.move(id, x, y);
  };

  private onUp = (ev: PointerEvent): void => {
    const id = this.sessionIds.get(ev.pointerId);
    this.sessionIds.delete(ev.pointerId);
    if (id !== undefined) {
      const [x, y] = this.localXY(ev);
      this.router.up(id, x, y, this.now());
    }
    this.releaseCapture(ev.pointerId);
  };

  private onCancel = (ev: PointerEvent): void => {
    const id = this.sessionIds.get(ev.pointerId);
    this.sessionIds.delete(ev.pointerId);
    if (id !== undefined) this.router.cancel(id);
    this.releaseCapture(ev.pointerId);
  };

  private releaseCapture(pointerId: number): void {
    if (this.target.hasPointerCapture(pointerId)) this.target.releasePointerCapture(pointerId);
  }
}
