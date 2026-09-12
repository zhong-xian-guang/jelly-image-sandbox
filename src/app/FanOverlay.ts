/**
 * `FanOverlay`（issue #66 / V2 T3-2；issue #67 / V2 T3-3 加旋轉圖示；事後檢視
 * 追加：圖示改成「正面圓形護罩＋扇葉」的經典風扇造型，且護罩半徑即時反映
 * `width` 參數，不再是側視剪影）——電風扇的視覺提示，比照 `PinMarkers` 的純
 * DOM overlay 模式：不知道 `SimCore`／相機的存在，呼叫端（`JellySandbox`）
 * 每幀把投影好的螢幕座標、圖示的錨點／角度／護罩半徑餵進來（`update`）。
 *
 * `pointer-events: none`——不擋手勢。矩形範圍仍用 SVG `<polygon>` 畫外框（純線框、
 * 無填色，issue #66 沿用），疊在上面的是依 `dirX`/`dirY` 旋轉的圖示——一個
 * `<g transform="translate(...) rotate(...)">`，本地座標系畫成「面向 +x（螢幕
 * 水平向右）＝吹風方向」的簡單向量圖佔位（馬達＋圓形護罩＋交叉扇葉＋風線），
 * 非正式美術資產（見 issue #64 Out of Scope）。護罩本身是正面視角（圓形，符合
 * 一般「風扇」圖示的直覺辨識度），扇葉／風線的存在讓旋轉後仍看得出朝向；馬達
 * 固定畫在護罩後方（−x），風線固定畫在護罩前方（+x）。護罩半徑＝世界座標
 * `width/2` 換算成目前相機縮放下的螢幕像素、再夾在 `[MIN_RADIUS_PX,
 * MAX_RADIUS_PX]` 之間（見 `JellySandbox.frame` 的 `radiusPx` 計算）——寬度滑桿
 * 變大護罩就跟著變大，寬度即使跟矩形外框的精確寬度有些微出入（夾了上下限），
 * 至少能一眼看出「變寬了／變窄了」的相對趨勢。世界座標與螢幕座標同向、同比例
 * 縮放（`worldToScreen` 只有平移＋等比縮放、沒有旋轉，見 `camera/project.ts`），
 * 所以角度可以直接沿用 `Math.atan2(dirY, dirX)`、不需要另外經相機轉換。沒有
 * 風扇時整層藏起來（`update(null)`）。
 */

/**
 * 護罩半徑（螢幕像素）的可視下限／上限——只防兩個極端：寬度滑桿拉到最小、或
 * 縮到很小的相機縮放時圖示整個消失（下限），或不合理的輸入（如手動改 clip
 * JSON 塞進超大 width）讓圖示大到蓋掉整個畫面（上限，遠高於面板 `FAN_WIDTH_RANGE`
 * 目前的上限 280，正常操作不會碰到）。介於中間的正常範圍完全不夾，圖示大小
 * 如實跟著 `width` 走——先前夾在 70px 曾經誤把整個上半段滑桿夾成同一個視覺
 * 大小，看起來像「寬度沒有反映在圖示上」，見事後檢視回饋。
 */
const MIN_RADIUS_PX = 6;
const MAX_RADIUS_PX = 400;

export interface FanOverlayCorner {
  /** 畫布局部座標（左上為原點），即 `worldToScreen` 的輸出。 */
  x: number;
  y: number;
}

/** 圖示的錨點／朝向／護罩半徑（issue #67）——`JellySandbox.frame()` 每幀算出並餵進來。 */
export interface FanOverlayIcon {
  /** 圖示中心的畫布局部座標——目前放在風扇原點（`fan.originX/originY` 投影後）。 */
  x: number;
  y: number;
  /** 吹風方向角度，弧度，`Math.atan2(dirY, dirX)`；0 = 面向 +x（螢幕水平向右）。 */
  angleRad: number;
  /** 護罩半徑，畫布像素——反映 `fan.width`，呼叫端已 clamp 過（見類別頂端說明）。 */
  radiusPx: number;
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
  private readonly grille: SVGCircleElement;
  private readonly blades: SVGPathElement;
  private readonly wind: SVGPathElement;
  private readonly motor: SVGCircleElement;
  /** 上一次畫的護罩半徑——值沒變就不重算 blade／wind 的 path 字串。 */
  private lastRadiusPx: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-fan-overlay';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'jelly-fan-overlay-svg');
    this.polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    this.polygon.setAttribute('class', 'jelly-fan-overlay-rect');
    svg.appendChild(this.polygon);

    const icon = buildFanIcon();
    this.iconGroup = icon.g;
    this.motor = icon.motor;
    this.grille = icon.grille;
    this.blades = icon.blades;
    this.wind = icon.wind;
    svg.appendChild(this.iconGroup);
    this.element.appendChild(svg);
  }

  /**
   * 每幀呼叫：`state` 帶矩形四角螢幕座標 + 圖示錨點／角度／護罩半徑，沒有風扇
   * 時傳 `null` 把外框跟圖示一起藏起來。
   */
  update(state: FanOverlayState | null): void {
    if (!state) {
      this.element.classList.remove('is-present');
      return;
    }
    this.element.classList.add('is-present');
    this.polygon.setAttribute('points', state.corners.map((c) => `${c.x},${c.y}`).join(' '));

    const { x, y, angleRad, radiusPx } = state.icon;
    const deg = (angleRad * 180) / Math.PI;
    this.iconGroup.setAttribute('transform', `translate(${x} ${y}) rotate(${deg})`);

    if (radiusPx !== this.lastRadiusPx) {
      this.lastRadiusPx = radiusPx;
      this.grille.setAttribute('r', String(radiusPx));
      this.blades.setAttribute('d', bladePath(radiusPx));
      this.wind.setAttribute('d', windPath(radiusPx));
      this.motor.setAttribute('cx', String(-(radiusPx + 5)));
    }
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
 * 三道扇葉：從圓心往外放射到 `0.85× 半徑`，120° 一道，畫成經典「風扇葉片」
 * 放射狀圖案——本地座標系「面向 +x 吹風」，扇葉本身旋轉對稱、不靠它表示方向
 * （方向由馬達在後、風線在前這兩個不對稱元素表示，見類別頂端說明）。
 */
function bladePath(radiusPx: number): string {
  const r = radiusPx * 0.85;
  const angles = [90, 210, 330]; // 度，繞圓心均分三道
  return angles
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x = (r * Math.cos(rad)).toFixed(1);
      const y = (r * Math.sin(rad)).toFixed(1);
      return `M 0 0 L ${x} ${y}`;
    })
    .join(' ');
}

/** 護罩前方（+x）三道由近到遠的風線（「>>>」造型），起點貼著護罩邊緣。 */
function windPath(radiusPx: number): string {
  const gap = 4;
  const step = 6;
  const half = 3;
  let d = '';
  for (let i = 0; i < 3; i++) {
    const x0 = radiusPx + gap + i * step;
    const x1 = x0 + step * 0.7;
    d += `M ${x0} ${-half} L ${x1} 0 L ${x0} ${half} `;
  }
  return d.trim();
}

/**
 * 圖示的固定結構（issue #67 事後檢視追加）：本地座標系以圖示中心（＝風扇原點）
 * 為圓心、面向 +x 吹風。馬達（固定小圓）在後方（−x）；護罩（圓，半徑動態
 * 反映 `width`）置中在圖示錨點上——這正是矩形近端邊的中心，圓的視覺涵蓋範圍
 * 因此跟矩形近端邊實際寬度同步變化；扇葉在護罩內放射狀排列；風線在護罩前方
 * （+x）。純向量圖佔位，非正式美術資產。回傳各動態部件的節點參照，讓
 * `update()` 能在半徑變動時改寫它們的屬性，不用整個圖示重建。
 */
function buildFanIcon(): {
  g: SVGGElement;
  motor: SVGCircleElement;
  grille: SVGCircleElement;
  blades: SVGPathElement;
  wind: SVGPathElement;
} {
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'jelly-fan-overlay-icon');

  const motor = document.createElementNS(ns, 'circle');
  motor.setAttribute('class', 'jelly-fan-overlay-icon-motor');
  motor.setAttribute('cy', '0');
  motor.setAttribute('r', '6');
  g.appendChild(motor);

  const grille = document.createElementNS(ns, 'circle');
  grille.setAttribute('class', 'jelly-fan-overlay-icon-guard');
  grille.setAttribute('cx', '0');
  grille.setAttribute('cy', '0');
  g.appendChild(grille);

  const blades = document.createElementNS(ns, 'path');
  blades.setAttribute('class', 'jelly-fan-overlay-icon-blades');
  g.appendChild(blades);

  const wind = document.createElementNS(ns, 'path');
  wind.setAttribute('class', 'jelly-fan-overlay-icon-wind');
  g.appendChild(wind);

  return { g, motor, grille, blades, wind };
}

/** 世界座標 `width` 換算成螢幕像素半徑後，夾到圖示可視範圍——`JellySandbox.frame` 用。 */
export function clampFanIconRadiusPx(radiusPx: number): number {
  return Math.min(Math.max(radiusPx, MIN_RADIUS_PX), MAX_RADIUS_PX);
}
