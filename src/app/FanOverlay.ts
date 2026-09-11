/**
 * `FanOverlay`（issue #66 / V2 T3-2）——電風扇矩形的基本外框視覺提示，比照
 * `PinMarkers` 的純 DOM overlay 模式：不知道 `SimCore`／相機的存在，呼叫端
 * （`JellySandbox`）每幀把投影好的螢幕座標四個角餵進來（`update`）。
 *
 * `pointer-events: none`——不擋手勢。用 SVG `<polygon>` 畫外框（純線框、無填色），
 * 沒有風扇時整層藏起來（`update(null)`）。正式美術圖／側視圖圖示是 issue #64 的
 * Out of Scope，v1 先用這個佔位。
 */

export interface FanOverlayCorner {
  /** 畫布局部座標（左上為原點），即 `worldToScreen` 的輸出。 */
  x: number;
  y: number;
}

export class FanOverlay {
  readonly element: HTMLDivElement;
  private readonly polygon: SVGPolygonElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-fan-overlay';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'jelly-fan-overlay-svg');
    this.polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    this.polygon.setAttribute('class', 'jelly-fan-overlay-rect');
    svg.appendChild(this.polygon);
    this.element.appendChild(svg);
  }

  /**
   * 每幀呼叫：`corners` 是風扇矩形四個角的螢幕座標（依序繞一圈），沒有風扇時傳
   * `null` 把外框藏起來。
   */
  update(corners: readonly FanOverlayCorner[] | null): void {
    if (!corners) {
      this.element.classList.remove('is-present');
      return;
    }
    this.element.classList.add('is-present');
    this.polygon.setAttribute('points', corners.map((c) => `${c.x},${c.y}`).join(' '));
  }

  /** 「顯示風扇提示」開關——整層藏起來，比照 `PinMarkers.setVisible`。 */
  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  destroy(): void {
    this.element.remove();
  }
}
