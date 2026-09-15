/**
 * `CanvasHover`（issue #79 / V2 T3-8）——「指標現在在畫布上的哪裡」這一件事，
 * 從 `BrushCursor`（issue #69）抽出來的共用小模組。
 *
 * 為什麼需要它：`PointerInput.onMove` 只轉發**按下之後**的移動（沒有 session id
 * 就直接 return），所以單純懸停時輸入層是靜默的。任何「按下去之前就先讓使用者
 * 看到這一下會做什麼」的預覽——撒 Pin／移除 Pin 的筆刷圓圈（`BrushCursor`）、
 * 編隊抓取的形狀預覽（`FormationOverlay`）——都得自己知道指標在哪。原本只有
 * 筆刷圓圈這一個需求時它自己監聽就夠了；有第二個需求之後，兩邊各掛一組
 * `pointermove` 監聽是白白重複，所以收成一處。
 *
 * 監聽掛在 `root` 而非 canvas 上——重新匯入圖片會換掉整個 canvas 元素（見
 * `JellySandbox.replaceJelly`），掛在 root 才不用跟著重綁；canvas 上的指標事件
 * 本來就會冒泡到 root。但也因為會冒泡，控制面板（同樣是 root 的子元素）上的
 * 移動一樣收得到，所以要用注入的 `isCanvas(target)` 濾掉——否則跟著這個位置畫
 * 的東西會滑到面板上去（issue #69 檢視回饋）。`isCanvas` 收回呼而非 canvas
 * 元素本身，同樣是為了換 canvas 後不必重設。
 *
 * 位置是**相對 `root` 左上角**的局部座標，跟 `worldToScreen` 的輸出同一個座標
 * 系，可以直接餵給各 overlay 或反投影回世界座標。
 *
 * 對外只有一個 `point` 讀取點，沒有變動通知：呼叫端（`JellySandbox.frame`）本來
 * 就每幀重算一次疊加層，多一條推送路徑只是多一個介面面。
 */

export interface HoverPoint {
  x: number;
  y: number;
}

export interface CanvasHoverOptions {
  /** 這個指標事件的 `target` 是不是目前的畫布——見類別頂端說明。 */
  isCanvas: (target: EventTarget | null) => boolean;
}

export class CanvasHover {
  private readonly root: HTMLElement;
  private readonly isCanvas: (target: EventTarget | null) => boolean;
  private current: HoverPoint | null = null;

  constructor(root: HTMLElement, opts: CanvasHoverOptions) {
    this.root = root;
    this.isCanvas = opts.isCanvas;
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerleave', this.onPointerLeave);
  }

  /** 指標目前在畫布上的局部座標；不在畫布上（移到面板上、離開視窗、還沒進來過）為 `null`。 */
  get point(): HoverPoint | null {
    return this.current;
  }

  destroy(): void {
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.isCanvas(ev.target)) {
      this.onPointerLeave();
      return;
    }
    const rect = this.root.getBoundingClientRect();
    this.current = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  private onPointerLeave = (): void => {
    this.current = null;
  };
}
