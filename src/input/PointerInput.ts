/**
 * `PointerInput`（issue #11 / T10）——把 DOM 指標事件接到 `GestureTracker`。
 *
 * 薄的接線層：`pointerdown/move/up/cancel` → 換算成畫布局部座標 + 時間戳 →
 * 呼叫 `GestureTracker`。所有影響模擬的輸入都經由 tracker 的 `emit`（接
 * `sim.applyInput`），輸入層不直接碰求解器內部（ADR-0005）。
 */

import type { InputEvent, Point } from '../sim';
import { type GestureConfig, GestureTracker } from './GestureTracker';

export interface PointerInputOptions {
  screenToWorld: (screenX: number, screenY: number) => Point;
  applyInput: (event: InputEvent) => void;
  config?: Partial<GestureConfig>;
  /** 時鐘來源（測試可注入）。預設 `performance.now`。 */
  now?: () => number;
}

export class PointerInput {
  private readonly target: HTMLElement;
  private readonly tracker: GestureTracker;
  private readonly now: () => number;

  constructor(target: HTMLElement, opts: PointerInputOptions) {
    this.target = target;
    this.now = opts.now ?? (() => performance.now());
    this.tracker = new GestureTracker({
      screenToWorld: opts.screenToWorld,
      emit: opts.applyInput,
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
    const [x, y] = this.localXY(ev);
    this.tracker.down(ev.pointerId, x, y, this.now());
  };

  private onMove = (ev: PointerEvent): void => {
    const [x, y] = this.localXY(ev);
    this.tracker.move(ev.pointerId, x, y);
  };

  private onUp = (ev: PointerEvent): void => {
    const [x, y] = this.localXY(ev);
    this.tracker.up(ev.pointerId, x, y, this.now());
    this.releaseCapture(ev.pointerId);
  };

  private onCancel = (ev: PointerEvent): void => {
    this.tracker.cancel(ev.pointerId);
    this.releaseCapture(ev.pointerId);
  };

  private releaseCapture(pointerId: number): void {
    if (this.target.hasPointerCapture(pointerId)) this.target.releasePointerCapture(pointerId);
  }
}
