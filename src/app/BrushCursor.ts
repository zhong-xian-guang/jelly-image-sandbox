/**
 * `BrushCursor`（issue #69 / V2 T3-5；issue #123 起是 Pin 工具的筆刷）——筆刷圓圈游標：一個跟著
 * 指標走、半徑等於目前撒點範圍的圓圈，讓使用者按下去之前就知道「這一下會撒
 * 在多大一圈裡」。issue #70 / V2 T3-6 的移除 Pin 共用同一顆圓圈（那邊同樣是
 * 「以指標為圓心、半徑為範圍」的操作，視覺需求一模一樣），只用 `setVariant`
 * 換個顏色區分：撒是琥珀色、擦是紅色——同一個位置同樣大的一圈，顏色是唯一
 * 分辨得出「這一下是要加還是要清」的線索。比照 `PinMarkers`／`FanOverlay`／
 * `FormationOverlay` 的純 DOM overlay 模式，`pointer-events: none`——不擋手勢。
 *
 * 跟另外三層一樣是被動的：位置由呼叫端餵進來（`setPosition`），這一層只管畫。
 * 差別在資料來源——那三層畫的是模擬狀態（Pin／風扇／編隊），每幀由
 * `JellySandbox.frame` 投影後餵；這一層畫的是「指標現在在哪」，來源是
 * `CanvasHover`（issue #79 從本檔抽出的共用懸停追蹤，見該檔說明：`PointerInput`
 * 只追按下之後的移動，單純懸停時輸入層是靜默的，所以得另外監聽）。
 *
 * 顯示條件：`setActive(true)`（目前工具是 Pin，放／拔兩種模式都算）＋ `setPosition`
 * 拿到非 `null` 的位置（指標確實落在畫布上，由 `CanvasHover` 判定）。兩個條件
 * 任一不成立就整個藏起來——工具切走後不該留一圈鬼影，指標離開畫布（移到面板
 * 上、或離開視窗）時圓圈也不該黏在最後一個位置。半徑由呼叫端每幀換算成螢幕
 * 像素後餵進來（`setRadiusPx`），縮放改變時圓圈大小跟著對。
 */

import type { HoverPoint } from './CanvasHover';

const ACTIVE_CLASS = 'is-active';

/**
 * 圓圈的用途（issue #70）——只影響顏色（CSS `.is-<variant>`），幾何完全共用。
 * `'spray'` = 撒 Pin（琥珀），`'erase'` = 移除 Pin（紅），`'handful'` = 大把抓取的
 * 範圍圈（issue #113，青綠；那顆是提示、由 `JellySandbox` 另建一個實例管）。
 */
export type BrushVariant = 'spray' | 'erase' | 'handful';

const VARIANTS: readonly BrushVariant[] = ['spray', 'erase', 'handful'];

export class BrushCursor {
  readonly element: HTMLDivElement;
  private readonly circle: HTMLDivElement;
  private active = false;
  /** 上一次 `setPosition` 有沒有拿到位置（＝指標在畫布上）——跟 `active` 一起決定圓圈要不要顯示。 */
  private inside = false;
  /** 目前套用的螢幕半徑，`setRadiusPx` 值沒變就不寫 DOM。 */
  private radiusPx = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-brush-cursor';

    this.circle = document.createElement('div');
    this.circle.className = 'jelly-brush-cursor-circle';
    this.element.appendChild(this.circle);
    this.setVariant('spray');
  }

  /**
   * 指標在畫布上的位置（`CanvasHover.point`，畫布局部座標），離開畫布時餵 `null`
   * ——圓圈跟著搬家或收起來。
   */
  setPosition(point: HoverPoint | null): void {
    if (point === null) {
      if (!this.inside) return;
      this.inside = false;
      this.applyVisibility();
      return;
    }
    this.circle.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
    if (this.inside) return;
    this.inside = true;
    this.applyVisibility();
  }

  /**
   * 圓圈的顏色用途（issue #70）——`JellySandbox` 在切到 Pin 工具或切換放／拔模式時設定。
   * 只加／移 CSS class，不碰顯示與否（那是 `setActive` 的事）。
   */
  setVariant(variant: BrushVariant): void {
    for (const v of VARIANTS) this.circle.classList.toggle(`is-${v}`, v === variant);
  }

  /** 「目前工具」切到／切離 Pin 工具時呼叫。 */
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
    this.element.remove();
  }

  private applyVisibility(): void {
    this.element.classList.toggle(ACTIVE_CLASS, this.active && this.inside);
  }
}
