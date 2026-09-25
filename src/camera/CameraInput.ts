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
 * **中鍵單擊 vs. 中鍵拖曳**（issue #122；ADR-0016）：中鍵按下到放開之間位移不超過
 * `clickMaxDist`（＝ Tap 的位移門檻）＝中鍵單擊 → `onMiddleClick`（輪替目前工具的模式），
 * 相機完全不動；超過門檻才開始平移，第一筆平移就補上從按下點起算的整段位移，拖曳手感
 * 不變。左鍵拖曳中再按中鍵（chorded：瀏覽器只送 `pointermove`，`button === 1`）只做
 * 單擊判定、不平移——那個指標正在抓果凍，同一串移動不該同時拖相機（spec #121 US8：
 * 拖曳到一半按中鍵只切模式，進行中的手勢不受影響）。
 *
 * **按住右鍵＋滾輪**（issue #114；issue #122 從「調工具半徑」推廣成「調目前模式的數值」）：
 * 右鍵按住（`buttons & 2`）時的滾輪先問 `adjustModeValue`——目前模式有數值就由它調、這
 * 一格不縮放；回報「不處理」（或沒接這個選項）才照舊縮放。右鍵本身不是任何手勢（指標層只認左鍵、這裡只認中鍵），
 * 「右鍵按住」同時看滾輪事件自己的 `buttons` 與指標事件最近一次回報的 `buttons`
 * ——不是每個瀏覽器都會替 `WheelEvent` 填 `buttons`，而指標事件一定有（左鍵按住中
 * 再按右鍵只會來 `pointermove`，一樣帶著新的 `buttons`）。
 * 畫布上的瀏覽器右鍵選單一律擋掉，不然放開右鍵就跳選單。只掛在畫布上，面板不受影響。
 * 判定結果是 `CameraCommand`，交給呼叫端每幀餵進 `updateCamera`——不直接改相機狀態。
 */

import { DEFAULT_GESTURE_CONFIG } from '../input/GestureTracker';
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
   * 按住右鍵時的滾輪（issue #114；issue #122 推廣）：`steps` 格（往上滾 = +1、往下滾 =
   * −1）。回傳 `true` = 已經拿去調目前模式的數值，這一格不縮放相機；`false` = 目前模式
   * 沒有數值，照舊縮放。一個滾輪事件＝一格（只看方向不看 `deltaY` 大小）：目標裝置是滑鼠
   * （spec #112「只用一隻滑鼠就能操作」），每個刻度一個事件；觸控板連發小 delta 會
   * 走得比較快，但拿觸控板按住右鍵本來就不是這個手勢的用法。
   */
  adjustModeValue?: (steps: number) => boolean;
  /**
   * 滑鼠中鍵單擊（issue #122）——按下到放開位移不超過 `clickMaxDist`，帶放開處的畫布
   * 局部座標。呼叫端拿它輪替目前工具的模式。
   */
  onMiddleClick?: (screenX: number, screenY: number) => void;
  /** 中鍵單擊允許的最大螢幕位移（CSS px），預設 = Tap 門檻 `DEFAULT_GESTURE_CONFIG.tapMaxDist`。 */
  clickMaxDist?: number;
}

/**
 * 進行中的一次滑鼠中鍵按壓（issue #122）。`moved` 一旦超過門檻就不再放下（拖出去又
 * 拖回原點不算單擊，同「點一下」工具的規則）；`panning` = 已經交給 `CameraGestures`
 * 平移；`chorded` = 是左鍵拖曳中再按下的中鍵，只判定單擊、不平移。
 */
interface MiddlePress {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  panning: boolean;
  chorded: boolean;
}

export class CameraInput {
  private readonly target: HTMLElement;
  private readonly gestures: CameraGestures;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly hitTest: (world: Point) => boolean;
  private readonly adjustModeValue: ((steps: number) => boolean) | undefined;
  private readonly onMiddleClick: ((screenX: number, screenY: number) => void) | undefined;
  private readonly clickMaxDist: number;
  /** 滑鼠指標事件最近一次回報的 `buttons`（issue #114）——判斷「右鍵按住」用。 */
  private mouseButtons = 0;
  /** 進行中的滑鼠中鍵按壓（issue #122）；沒有為 `null`。 */
  private middle: MiddlePress | null = null;

  constructor(target: HTMLElement, opts: CameraInputOptions) {
    this.target = target;
    this.screenToWorld = opts.screenToWorld;
    this.hitTest = opts.hitTest;
    this.adjustModeValue = opts.adjustModeValue;
    this.onMiddleClick = opts.onMiddleClick;
    this.clickMaxDist = opts.clickMaxDist ?? DEFAULT_GESTURE_CONFIG.tapMaxDist;
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
    if (rightHeld && ev.deltaY !== 0 && this.adjustModeValue?.(-Math.sign(ev.deltaY))) return;
    const [x, y] = this.localXY(ev);
    this.gestures.wheel(ev.deltaY, x, y);
  };

  private onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault(); // 右鍵留給「按住右鍵＋滾輪調數值」，放開時不跳瀏覽器選單
  };

  private trackMouseButtons(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') this.mouseButtons = ev.buttons;
  }

  private onDown = (ev: PointerEvent): void => {
    this.trackMouseButtons(ev);
    const [x, y] = this.localXY(ev);
    if (ev.pointerType === 'mouse') {
      // 滑鼠：只有中鍵算相機（不論有沒有落在 Jelly 上）。先不平移——要等位移超過
      // 單擊門檻才知道是拖曳還是單擊（見 `onMove`／`endMiddle`）。
      if (ev.button !== 1) return;
      this.target.setPointerCapture(ev.pointerId);
      this.middle = {
        pointerId: ev.pointerId,
        startX: x,
        startY: y,
        moved: false,
        panning: false,
        chorded: false,
      };
      return;
    }
    // 觸控／觸控筆：維持原本的背景判定（命中 Jelly 的留給 PointerInput 當 Grab）。
    if (this.hitTest(this.screenToWorld(x, y))) return;
    this.target.setPointerCapture(ev.pointerId);
    this.gestures.pointerDown(ev.pointerId, x, y, true);
  };

  private onMove = (ev: PointerEvent): void => {
    this.trackMouseButtons(ev);
    const [x, y] = this.localXY(ev);
    // 其他鍵按住中再按下／放開中鍵（chorded）只會來 `pointermove`，`button` 指出是哪顆變了。
    if (ev.pointerType === 'mouse' && ev.button === 1) {
      if ((ev.buttons & 4) !== 0) {
        if (!this.middle) {
          this.middle = {
            pointerId: ev.pointerId,
            startX: x,
            startY: y,
            moved: false,
            panning: false,
            chorded: true,
          };
        }
      } else if (this.middle?.pointerId === ev.pointerId) {
        this.endMiddle(x, y);
      }
      return;
    }
    const middle = this.middle;
    if (middle?.pointerId === ev.pointerId && !middle.moved) {
      if (Math.hypot(x - middle.startX, y - middle.startY) > this.clickMaxDist) {
        middle.moved = true;
        if (!middle.chorded) {
          // 從按下點開始算：這一筆 move 就補上整段位移，拖曳不會少掉門檻內那幾 px。
          middle.panning = true;
          this.gestures.pointerDown(ev.pointerId, middle.startX, middle.startY, true);
        }
      }
    }
    this.gestures.pointerMove(ev.pointerId, x, y);
  };

  private onUp = (ev: PointerEvent): void => {
    this.trackMouseButtons(ev);
    if (this.middle?.pointerId === ev.pointerId) {
      const [x, y] = this.localXY(ev);
      this.endMiddle(x, y);
    } else {
      this.gestures.pointerUp(ev.pointerId);
    }
    if (this.target.hasPointerCapture(ev.pointerId)) {
      this.target.releasePointerCapture(ev.pointerId);
    }
  };

  private onCancel = (ev: PointerEvent): void => {
    if (this.middle?.pointerId === ev.pointerId) this.middle = null; // 中斷不算單擊
    this.gestures.pointerCancel(ev.pointerId);
    if (this.target.hasPointerCapture(ev.pointerId)) {
      this.target.releasePointerCapture(ev.pointerId);
    }
  };

  /** 中鍵放開（issue #122）：沒超過門檻＝單擊 → `onMiddleClick`；拖過就結束平移。 */
  private endMiddle(x: number, y: number): void {
    const middle = this.middle;
    if (!middle) return;
    this.middle = null;
    if (middle.panning) this.gestures.pointerUp(middle.pointerId);
    if (!middle.moved) this.onMiddleClick?.(x, y);
  }
}
