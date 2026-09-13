/**
 * `BrushCursor`（issue #69 / V2 T3-5）——撒 Pin 工具的筆刷圓圈游標：一個跟著
 * 指標走、半徑等於目前撒點範圍的圓圈，讓使用者按下去之前就知道「這一下會撒
 * 在多大一圈裡」。比照 `PinMarkers`／`FanOverlay`／`FormationOverlay` 的純 DOM
 * overlay 模式，`pointer-events: none`——不擋手勢。
 *
 * 跟另外三層不同的是它**自己**監聽指標移動：那三層畫的是模擬狀態（Pin／風扇／
 * 編隊），資料每幀由 `JellySandbox.frame` 投影後餵進來；這一層畫的是「指標現在
 * 在哪」，跟模擬無關，每幀去問一次沒有意義（而且 `PointerInput` 只追按下之後
 * 的移動，滑鼠單純懸停時它不會有事件）。監聽掛在 `root` 而非 canvas 上——重新
 * 匯入圖片會換掉整個 canvas 元素（見 `JellySandbox.replaceJelly`），掛在 root
 * 才不用跟著重綁；canvas 上的指標事件本來就會冒泡到 root。
 *
 * 顯示條件：`setActive(true)`（目前工具是撒 Pin）＋ 指標確實在 `root` 範圍內。
 * 兩者任一不成立就整個藏起來——工具切走後不該留一圈鬼影，指標移出畫面（去點
 * 控制面板、或離開視窗）時圓圈也不該黏在最後一個位置。半徑由呼叫端每幀換算
 * 成螢幕像素後餵進來（`setRadiusPx`），縮放改變時圓圈大小跟著對。
 */

const ACTIVE_CLASS = 'is-active';

export class BrushCursor {
  readonly element: HTMLDivElement;
  private readonly root: HTMLElement;
  private readonly circle: HTMLDivElement;
  private active = false;
  /** 指標目前是否在 `root` 範圍內——跟 `active` 一起決定圓圈要不要顯示。 */
  private inside = false;
  /** 目前套用的螢幕半徑，`setRadiusPx` 值沒變就不寫 DOM。 */
  private radiusPx = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.element = document.createElement('div');
    this.element.className = 'jelly-brush-cursor';

    this.circle = document.createElement('div');
    this.circle.className = 'jelly-brush-cursor-circle';
    this.element.appendChild(this.circle);

    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerleave', this.onPointerLeave);
  }

  /** 「目前工具」切到／切離撒 Pin 時呼叫。 */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.inside = false; // 切走時忘掉上一次的位置，下次進場重新由 pointermove 決定
    this.applyVisibility();
  }

  /** 撒點半徑（世界座標）換算成目前縮放下的螢幕像素——`JellySandbox.frame` 每幀餵。 */
  setRadiusPx(radiusPx: number): void {
    if (this.radiusPx === radiusPx) return;
    this.radiusPx = radiusPx;
    this.circle.style.width = `${radiusPx * 2}px`;
    this.circle.style.height = `${radiusPx * 2}px`;
  }

  destroy(): void {
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.remove();
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.active) return;
    const rect = this.root.getBoundingClientRect();
    this.circle.style.transform = `translate(${ev.clientX - rect.left}px, ${ev.clientY - rect.top}px) translate(-50%, -50%)`;
    if (this.inside) return;
    this.inside = true;
    this.applyVisibility();
  };

  private onPointerLeave = (): void => {
    if (!this.inside) return;
    this.inside = false;
    this.applyVisibility();
  };

  private applyVisibility(): void {
    this.element.classList.toggle(ACTIVE_CLASS, this.active && this.inside);
  }
}
