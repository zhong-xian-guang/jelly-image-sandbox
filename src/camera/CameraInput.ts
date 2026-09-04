/**
 * `CameraInput`（issue #13 / T12）——把 DOM 滾輪／指標事件接到 `CameraGestures`。
 *
 * 薄的接線層（對照輸入層的 `PointerInput`）：`wheel` → 縮放；`pointerdown` 落在
 * Jelly 之外（picking 沒命中）→ 背景拖曳 → 平移／雙指縮放。命中 Jelly 的指標留給
 * `PointerInput` 當 Grab，這裡不碰（兩層共用同一個 canvas，各自 addEventListener）。
 *
 * 判定結果是 `CameraCommand`，交給呼叫端每幀餵進 `updateCamera`——不直接改相機狀態。
 */

import type { Point } from '../sim';
import { CameraGestures, type CameraGesturesConfig } from './CameraGestures';
import type { CameraCommand } from './types';

export interface CameraInputOptions {
  /** 畫布局部座標（左上為原點）→ 世界座標。用當前相機變換換算。 */
  screenToWorld: (screenX: number, screenY: number) => Point;
  /** 世界座標是否命中 Jelly 表面（`sim.pick(...) != null`）。命中 → 不是背景拖曳。 */
  hitTest: (world: Point) => boolean;
  /** 判定出的相機指令往這裡送——呼叫端收集後每幀丟給 `updateCamera`。 */
  emit: (cmd: CameraCommand) => void;
  config?: Partial<CameraGesturesConfig>;
}

export class CameraInput {
  private readonly target: HTMLElement;
  private readonly gestures: CameraGestures;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly hitTest: (world: Point) => boolean;

  constructor(target: HTMLElement, opts: CameraInputOptions) {
    this.target = target;
    this.screenToWorld = opts.screenToWorld;
    this.hitTest = opts.hitTest;
    this.gestures = new CameraGestures({ emit: opts.emit, config: opts.config });

    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onCancel);
  }

  destroy(): void {
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onCancel);
  }

  private localXY(ev: PointerEvent | WheelEvent): [number, number] {
    const r = this.target.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault(); // 擋掉頁面縮放 / 捲動
    const [x, y] = this.localXY(ev);
    this.gestures.wheel(ev.deltaY, x, y);
  };

  private onDown = (ev: PointerEvent): void => {
    const [x, y] = this.localXY(ev);
    const onBackground = !this.hitTest(this.screenToWorld(x, y));
    if (onBackground) this.target.setPointerCapture(ev.pointerId);
    this.gestures.pointerDown(ev.pointerId, x, y, onBackground);
  };

  private onMove = (ev: PointerEvent): void => {
    const [x, y] = this.localXY(ev);
    this.gestures.pointerMove(ev.pointerId, x, y);
  };

  private onUp = (ev: PointerEvent): void => {
    this.gestures.pointerUp(ev.pointerId);
    if (this.target.hasPointerCapture(ev.pointerId)) {
      this.target.releasePointerCapture(ev.pointerId);
    }
  };

  private onCancel = (ev: PointerEvent): void => {
    this.gestures.pointerCancel(ev.pointerId);
    if (this.target.hasPointerCapture(ev.pointerId)) {
      this.target.releasePointerCapture(ev.pointerId);
    }
  };
}
