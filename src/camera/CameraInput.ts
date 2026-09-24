/**
 * `CameraInput`（issue #13 / T12）——把 DOM 滾輪／指標事件接到 `CameraGestures`。
 *
 * 薄的接線層（對照輸入層的 `PointerInput`）：`wheel` → 縮放；指標拖曳觸發平移
 * ／雙指縮放的判定分兩種裝置：
 *  - **滑鼠**：只認中鍵（`button === 1`），不論落在 Jelly 上或背景都算——這樣
 *    縮到很近、畫面被 Jelly 佔滿找不到背景可拖時，仍能用中鍵平移相機。左鍵
 *    留給 `PointerInput` 當 Grab，這裡完全不碰。
 *  - **觸控／觸控筆**：沒有「鍵」的概念，維持原本的判定——`pointerdown` 落在
 *    Jelly 之外（picking 沒命中）才算背景拖曳；命中 Jelly 的留給 `PointerInput`
 *    當 Grab。
 *
 * 兩層共用同一個 canvas、各自 `addEventListener`，靠上述判斷互不重疊。
 *
 * **按住右鍵＋滾輪**（issue #114）：右鍵按住（`buttons & 2`）時的滾輪先問
 * `adjustRadius`——目前工具有半徑就由它調半徑、這一格不縮放；回報「不處理」（或沒
 * 接這個選項）才照舊縮放。右鍵本身不是任何手勢（指標層只認左鍵、這裡只認中鍵），
 * 「右鍵按住」同時看滾輪事件自己的 `buttons` 與指標事件最近一次回報的 `buttons`
 * ——不是每個瀏覽器都會替 `WheelEvent` 填 `buttons`，而指標事件一定有（左鍵按住中
 * 再按右鍵只會來 `pointermove`，一樣帶著新的 `buttons`）。
 * 畫布上的瀏覽器右鍵選單一律擋掉，不然放開右鍵就跳選單。只掛在畫布上，面板不受影響。
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
  /**
   * 按住右鍵時的滾輪（issue #114）：`steps` 格（往上滾 = +1、往下滾 = −1）。回傳
   * `true` = 已經拿去調工具半徑，這一格不縮放相機；`false` = 目前工具沒有半徑，
   * 照舊縮放。
   */
  adjustRadius?: (steps: number) => boolean;
}

export class CameraInput {
  private readonly target: HTMLElement;
  private readonly gestures: CameraGestures;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly hitTest: (world: Point) => boolean;
  private readonly adjustRadius: ((steps: number) => boolean) | undefined;
  /** 滑鼠指標事件最近一次回報的 `buttons`（issue #114）——判斷「右鍵按住」用。 */
  private mouseButtons = 0;

  constructor(target: HTMLElement, opts: CameraInputOptions) {
    this.target = target;
    this.screenToWorld = opts.screenToWorld;
    this.hitTest = opts.hitTest;
    this.adjustRadius = opts.adjustRadius;
    this.gestures = new CameraGestures({ emit: opts.emit, config: opts.config });

    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onCancel);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy(): void {
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onCancel);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
  }

  private localXY(ev: PointerEvent | WheelEvent): [number, number] {
    const r = this.target.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault(); // 擋掉頁面縮放 / 捲動
    const rightHeld = ((ev.buttons | this.mouseButtons) & 2) !== 0;
    if (rightHeld && ev.deltaY !== 0 && this.adjustRadius?.(-Math.sign(ev.deltaY))) return;
    const [x, y] = this.localXY(ev);
    this.gestures.wheel(ev.deltaY, x, y);
  };

  private onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault(); // 右鍵留給「按住右鍵＋滾輪調半徑」，放開時不跳瀏覽器選單
  };

  private trackMouseButtons(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') this.mouseButtons = ev.buttons;
  }

  private onDown = (ev: PointerEvent): void => {
    this.trackMouseButtons(ev);
    const [x, y] = this.localXY(ev);
    // 滑鼠：只有中鍵算相機（不論有沒有落在 Jelly 上）。觸控／觸控筆：維持
    // 原本的背景判定（命中 Jelly 的留給 PointerInput 當 Grab）。
    const trackForCamera =
      ev.pointerType === 'mouse' ? ev.button === 1 : !this.hitTest(this.screenToWorld(x, y));
    if (!trackForCamera) return;
    this.target.setPointerCapture(ev.pointerId);
    this.gestures.pointerDown(ev.pointerId, x, y, true);
  };

  private onMove = (ev: PointerEvent): void => {
    this.trackMouseButtons(ev);
    const [x, y] = this.localXY(ev);
    this.gestures.pointerMove(ev.pointerId, x, y);
  };

  private onUp = (ev: PointerEvent): void => {
    this.trackMouseButtons(ev);
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
