/**
 * `FanOverlay`（issue #66 / V2 T3-2；issue #67 / V2 T3-3 加旋轉圖示）——電風扇的
 * 視覺提示，比照 `PinMarkers` 的純 DOM overlay 模式：不知道 `SimCore`／相機的
 * 存在，呼叫端（`JellySandbox`）每幀把投影好的螢幕座標與圖示的錨點／角度餵
 * 進來（`update`）。
 *
 * `pointer-events: none`——不擋手勢。矩形範圍仍用 SVG `<polygon>` 畫外框（純線框、
 * 無填色，issue #66 沿用），疊在上面的是依 `dirX`/`dirY` 旋轉的側視圖圖示
 * （issue #67）——一個 `<g transform="translate(...) rotate(...)">`，本地座標系
 * 畫成「面向 +x（螢幕水平向右）＝吹風方向」的簡單向量圖佔位（馬達＋護罩側影＋
 * 幾道風線），非正式美術資產。世界座標與螢幕座標同向、同比例縮放（`worldToScreen`
 * 只有平移＋等比縮放、沒有旋轉，見 `camera/project.ts`），所以角度可以直接沿用
 * `Math.atan2(dirY, dirX)`、不需要另外經相機轉換。沒有風扇時整層藏起來
 * （`update(null)`）。
 */

export interface FanOverlayCorner {
  /** 畫布局部座標（左上為原點），即 `worldToScreen` 的輸出。 */
  x: number;
  y: number;
}

/** 圖示的錨點與朝向（issue #67）——`JellySandbox.frame()` 每幀算出並餵進來。 */
export interface FanOverlayIcon {
  /** 圖示中心的畫布局部座標——目前放在風扇原點（`fan.originX/originY` 投影後）。 */
  x: number;
  y: number;
  /** 吹風方向角度，弧度，`Math.atan2(dirY, dirX)`；0 = 面向 +x（螢幕水平向右）。 */
  angleRad: number;
}

export interface FanOverlayState {
  /** 風扇矩形四個角的螢幕座標（依序繞一圈）。 */
  corners: readonly FanOverlayCorner[];
  icon: FanOverlayIcon;
}

export class FanOverlay {
  readonly element: HTMLDivElement;
  private readonly polygon: SVGPolygonElement;
  private readonly iconGroup: SVGGElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-fan-overlay';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'jelly-fan-overlay-svg');
    this.polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    this.polygon.setAttribute('class', 'jelly-fan-overlay-rect');
    svg.appendChild(this.polygon);
    this.iconGroup = buildFanIcon();
    svg.appendChild(this.iconGroup);
    this.element.appendChild(svg);
  }

  /**
   * 每幀呼叫：`state` 帶矩形四角螢幕座標 + 圖示錨點／角度，沒有風扇時傳 `null`
   * 把外框跟圖示一起藏起來。
   */
  update(state: FanOverlayState | null): void {
    if (!state) {
      this.element.classList.remove('is-present');
      return;
    }
    this.element.classList.add('is-present');
    this.polygon.setAttribute('points', state.corners.map((c) => `${c.x},${c.y}`).join(' '));
    const { x, y, angleRad } = state.icon;
    const deg = (angleRad * 180) / Math.PI;
    this.iconGroup.setAttribute('transform', `translate(${x} ${y}) rotate(${deg})`);
  }

  /** 「顯示風扇提示」開關——整層藏起來，比照 `PinMarkers.setVisible`。 */
  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  destroy(): void {
    this.element.remove();
  }
}

/**
 * 側視圖圖示的固定形狀（issue #67）：本地座標系以圖示中心為原點、面向 +x 吹風。
 * 馬達（圓）＋支架（直杆＋底座）在後方（−x），護罩（細長橢圓，側視時圓形護罩
 * 收扁成一條）＋交叉扇葉線在中間，三道風線在前方（+x）表示吹出的風。純向量圖
 * 佔位，非正式美術資產（見 issue #64 Out of Scope）。
 */
function buildFanIcon(): SVGGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'jelly-fan-overlay-icon');

  const stand = document.createElementNS(ns, 'path');
  stand.setAttribute('class', 'jelly-fan-overlay-icon-stand');
  stand.setAttribute('d', 'M -1 -9 L 1 -9 L 1 5 L 5 7 L -5 7 L -1 5 Z');
  g.appendChild(stand);

  const motor = document.createElementNS(ns, 'circle');
  motor.setAttribute('class', 'jelly-fan-overlay-icon-motor');
  motor.setAttribute('cx', '-4');
  motor.setAttribute('cy', '0');
  motor.setAttribute('r', '5');
  g.appendChild(motor);

  const guard = document.createElementNS(ns, 'ellipse');
  guard.setAttribute('class', 'jelly-fan-overlay-icon-guard');
  guard.setAttribute('cx', '6');
  guard.setAttribute('cy', '0');
  guard.setAttribute('rx', '2.2');
  guard.setAttribute('ry', '7.5');
  g.appendChild(guard);

  const blades = document.createElementNS(ns, 'path');
  blades.setAttribute('class', 'jelly-fan-overlay-icon-blades');
  blades.setAttribute('d', 'M 4 -6 L 8 4 M 4 4 L 8 -6');
  g.appendChild(blades);

  const wind = document.createElementNS(ns, 'path');
  wind.setAttribute('class', 'jelly-fan-overlay-icon-wind');
  wind.setAttribute(
    'd',
    'M 10 -4 L 14 0 L 10 4 M 14 -3 L 18 0 L 14 3 M 18 -2 L 22 0 L 18 2',
  );
  g.appendChild(wind);

  return g;
}
