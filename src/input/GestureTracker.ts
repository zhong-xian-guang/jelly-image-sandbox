/**
 * 手勢判定（issue #11 / T10）——純邏輯，不碰 DOM。
 *
 * 指標事件序列翻成 `SimCore.applyInput` 吃的 `InputEvent`（ADR-0005 的單一窄介面）：
 *  - `down` → `grab`（附著在該世界座標；grab 不動不會位移，見 T4）
 *  - `move` → `moveGrab`
 *  - `up`   → 若 down→up ≤ `tapMaxMs` 且螢幕位移 ≤ `tapMaxDist` → `tap`（在按下點），
 *             接著 `release`；否則只 `release`（Fling 由被抓 Particle 自身速度帶出）
 *  - `cancel` → `release`
 *
 * 多指各自獨立（`id` = 指標 id）。DOM 事件的接線在 `PointerInput`。
 */

import type { InputEvent, Point, PointerId } from '../sim';

export interface GestureConfig {
  /** down→up 在此毫秒內（且位移夠小）→ 判為 Tap。預設 250。 */
  tapMaxMs: number;
  /** Tap 允許的最大螢幕位移（CSS px）。預設 6。 */
  tapMaxDist: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = { tapMaxMs: 250, tapMaxDist: 6 };

export interface GestureTrackerOptions {
  /** 畫布局部座標（左上為原點）→ 世界座標。 */
  screenToWorld: (screenX: number, screenY: number) => Point;
  /** 判定結果往這裡送——接 `sim.applyInput`。 */
  emit: (event: InputEvent) => void;
  config?: Partial<GestureConfig>;
}

interface Track {
  startX: number;
  startY: number;
  startT: number;
  startWorld: Point;
}

export class GestureTracker {
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly emit: (event: InputEvent) => void;
  private readonly config: GestureConfig;
  private readonly tracks = new Map<PointerId, Track>();

  constructor(opts: GestureTrackerOptions) {
    this.screenToWorld = opts.screenToWorld;
    this.emit = opts.emit;
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...opts.config };
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const startWorld = this.screenToWorld(screenX, screenY);
    this.tracks.set(id, { startX: screenX, startY: screenY, startT: timeMs, startWorld });
    this.emit({ type: 'grab', id, x: startWorld.x, y: startWorld.y });
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    if (!this.tracks.has(id)) return;
    const w = this.screenToWorld(screenX, screenY);
    this.emit({ type: 'moveGrab', id, x: w.x, y: w.y });
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const t = this.tracks.get(id);
    if (!t) return;
    this.tracks.delete(id);
    const heldMs = timeMs - t.startT;
    const movedPx = Math.hypot(screenX - t.startX, screenY - t.startY);
    if (heldMs <= this.config.tapMaxMs && movedPx <= this.config.tapMaxDist) {
      this.emit({ type: 'tap', x: t.startWorld.x, y: t.startWorld.y });
    }
    this.emit({ type: 'release', id });
  }

  cancel(id: PointerId): void {
    if (this.tracks.delete(id)) this.emit({ type: 'release', id });
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數）。 */
  get activeCount(): number {
    return this.tracks.size;
  }
}
