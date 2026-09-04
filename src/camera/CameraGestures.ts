/**
 * 相機手勢判定（issue #13 / T12）——純邏輯，不碰 DOM。
 *
 * 把「滾輪 + 背景指標拖曳」翻成 `CameraCommand`（`updateCamera` 吃的手動指令）：
 *  - `wheel`                → `zoomBy`（對準指標處）
 *  - 單一背景指標拖曳        → `panBy`（螢幕位移）
 *  - ≥ 2 個背景指標          → `panBy`（質心位移）+ `zoomBy`（間距比、對準質心）
 *
 * 「背景」＝ `pointerDown` 當下 picking 沒命中 Jelly（由 `CameraInput` 判定後傳入
 * `onBackground`）。命中 Jelly 的指標屬於 Grab／多重抓取，這裡完全不碰它——相機與
 * 求解器輸入是兩條獨立的流（見 ADR-0005）。DOM 事件接線在 `CameraInput`。
 */

import type { CameraCommand } from './types';

export interface CameraGesturesConfig {
  /** 滾輪縮放靈敏度：`factor = clamp(exp(−deltaY · wheelZoomPerPx), 0.2, 5)`。 */
  wheelZoomPerPx: number;
}

export const DEFAULT_CAMERA_GESTURES_CONFIG: CameraGesturesConfig = {
  wheelZoomPerPx: 0.0015,
};

export interface CameraGesturesOptions {
  /** 判定結果往這裡送——接 `updateCamera` 的 `commands`。 */
  emit: (cmd: CameraCommand) => void;
  config?: Partial<CameraGesturesConfig>;
}

/** 一次滾輪事件允許的單步縮放上下限（防單一巨大 delta 跳動）。 */
const WHEEL_FACTOR_MIN = 0.2;
const WHEEL_FACTOR_MAX = 5;
/** 位移／縮放小於此量視為沒動，不 emit。 */
const MOVE_EPS = 1e-6;
const ZOOM_EPS = 1e-4;

interface Aggregate {
  cx: number;
  cy: number;
  /** 各指標到質心的平均距離（單指為 0 → 不縮放）。 */
  r: number;
}

export class CameraGestures {
  private readonly emit: (cmd: CameraCommand) => void;
  private readonly config: CameraGesturesConfig;
  /** 目前追蹤中的背景指標（命中 Jelly 的不進來）。 */
  private readonly pointers = new Map<number | string, { x: number; y: number }>();
  /** 上一次的指標群聚合，move 時比對出增量。down / up 時只重設不 emit。 */
  private last: Aggregate | null = null;

  constructor(opts: CameraGesturesOptions) {
    this.emit = opts.emit;
    this.config = { ...DEFAULT_CAMERA_GESTURES_CONFIG, ...opts.config };
  }

  wheel(deltaY: number, screenX: number, screenY: number): void {
    const raw = Math.exp(-deltaY * this.config.wheelZoomPerPx);
    const factor = Math.min(Math.max(raw, WHEEL_FACTOR_MIN), WHEEL_FACTOR_MAX);
    this.emit({ type: 'zoomBy', factor, pivotScreen: { x: screenX, y: screenY } });
  }

  /** `onBackground` 為 false（命中 Jelly）時整個忽略——那是 Grab。 */
  pointerDown(id: number | string, screenX: number, screenY: number, onBackground: boolean): void {
    if (!onBackground) return;
    this.pointers.set(id, { x: screenX, y: screenY });
    this.last = this.aggregate();
  }

  pointerMove(id: number | string, screenX: number, screenY: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = screenX;
    p.y = screenY;

    const now = this.aggregate();
    const prev = this.last;
    if (prev) {
      const dx = now.cx - prev.cx;
      const dy = now.cy - prev.cy;
      if (Math.abs(dx) > MOVE_EPS || Math.abs(dy) > MOVE_EPS) {
        this.emit({ type: 'panBy', dxScreen: dx, dyScreen: dy });
      }
      if (this.pointers.size >= 2 && prev.r > MOVE_EPS && now.r > MOVE_EPS) {
        const factor = now.r / prev.r;
        if (Math.abs(factor - 1) > ZOOM_EPS) {
          this.emit({ type: 'zoomBy', factor, pivotScreen: { x: now.cx, y: now.cy } });
        }
      }
    }
    this.last = now;
  }

  pointerUp(id: number | string): void {
    if (this.pointers.delete(id)) {
      this.last = this.pointers.size ? this.aggregate() : null;
    }
  }

  pointerCancel(id: number | string): void {
    this.pointerUp(id);
  }

  /** 目前追蹤中的背景指標數。 */
  get activeCount(): number {
    return this.pointers.size;
  }

  private aggregate(): Aggregate {
    const pts = [...this.pointers.values()];
    const n = pts.length || 1;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= n;
    cy /= n;
    let r = 0;
    for (const p of pts) r += Math.hypot(p.x - cx, p.y - cy);
    return { cx, cy, r: r / n };
  }
}
