/**
 * `FanOverlay`（issue #66 / V2 T3-2；issue #67 / V2 T3-3 加旋轉圖示；歷經兩輪
 * 事後檢視回饋調整外觀——見下方「圖示外觀的取捨」）——電風扇的視覺提示，比照
 * `PinMarkers` 的純 DOM overlay 模式：不知道 `SimCore`／相機的存在，呼叫端
 * （`JellySandbox`）每幀把投影好的螢幕座標、圖示的錨點／角度／護罩半徑餵
 * 進來（`update`）。
 *
 * `pointer-events: none`——不擋手勢。矩形範圍仍用 SVG `<polygon>` 畫外框（純線框、
 * 無填色，issue #66 沿用），疊在上面的是依 `dirX`/`dirY` 旋轉的圖示——一個
 * `<g transform="translate(...) rotate(...)">`，本地座標系畫成「面向 +x（螢幕
 * 水平向右）＝吹風方向」的簡單向量圖佔位，非正式美術資產（見 issue #64 Out of
 * Scope）。護罩半徑＝世界座標 `width/2` 換算成目前相機縮放下的螢幕像素、再夾
 * 在 `[MIN_RADIUS_PX, MAX_RADIUS_PX]` 之間（見 `JellySandbox.frame` 的
 * `radiusPx` 計算）——寬度滑桿變大護罩就跟著變大。世界座標與螢幕座標同向、
 * 同比例縮放（`worldToScreen` 只有平移＋等比縮放、沒有旋轉，見
 * `camera/project.ts`），所以角度可以直接沿用 `Math.atan2(dirY, dirX)`、不需要
 * 另外經相機轉換。沒有風扇時整層藏起來（`update(null)`）。
 *
 * **圖示外觀的取捨**：第一輪回饋要求「側視圖」，護罩畫成側視會扁掉的細長
 * 橢圓——結果第二輪回饋是「不像風扇、看不出寬度」，改成正面圓形護罩＋放射
 * 扇葉後才解決；但第三輪回饋又要「側視圖、更真實、要有腳座」。這兩個方向直接
 * 衝突：嚴格側視的圓形護罩必然扁成一條線，沒辦法同時「一眼看出是風扇」又
 * 「看得出寬度」。這裡採取的折衷：護罩維持正面圓（辨識度／寬度都靠它），
 * 但補上只有側視角度才會出現的元素——馬達殼、頸關節、支柱、腳座——讓整體
 * 讀起來像「一台放在桌上、側面看過去的立扇」，而不是單純的抽象符號。這是
 * 刻意的風格化选择（跟很多俯視遊戲畫地面道具用側視／45° 圖示同一個做法），
 * 不是「真的」側視圖；若這個折衷仍不符合預期，需要換成真正的美術資產而非
 * 向量佔位圖（issue #64 Out of Scope 的範圍）。
 *
 * 支架（馬達殼＋頸關節＋支柱＋腳座）整組固定畫在護罩正下方偏後（本地座標
 * −x／+y 象限），隨圖示整體一起依 `dirX/dirY` 旋轉——這款遊戲是無重力俯視視角，
 * 「下方」本來就沒有真正的物理意義，支架跟著風向轉動、不會永遠垂直於畫面，
 * 是同一種風格化簡化，不是 bug。
 *
 * 矩形範圍／圖示各自有獨立的顯示開關（`setShowRange`／`setShowIcon`，issue #67
 * 事後檢視追加）——面板原本只有一顆「顯示風扇提示」同時管兩者，使用者可能
 * 只想看推力範圍評估手感、不想被圖示擋住畫面，或反過來只想看風扇本身、覺得
 * 矩形線框太干擾，兩種情境值得分開控制。實作上兩者都是疊在 `update` 的
 * `is-present`（有沒有風扇）之上的獨立開關，用 `!important` 的
 * `.jelly-fan-overlay-part-hidden` 蓋掉，不依賴 CSS 規則的宣告順序。
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
  private readonly motor: SVGRectElement;
  private readonly neck: SVGCircleElement;
  private readonly pole: SVGRectElement;
  private readonly base: SVGEllipseElement;
  /** 上一次畫的護罩半徑——值沒變就不重算各部件的座標／path 字串。 */
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
    this.base = icon.base;
    this.pole = icon.pole;
    this.neck = icon.neck;
    this.motor = icon.motor;
    this.grille = icon.grille;
    this.blades = icon.blades;
    this.wind = icon.wind;
    svg.appendChild(this.iconGroup);
    this.element.appendChild(svg);
  }

  /**
   * 每幀呼叫：`state` 帶矩形四角螢幕座標 + 圖示錨點／角度／護罩半徑，沒有風扇
   * 時傳 `null` 把外框跟圖示一起藏起來（`setShowRange`/`setShowIcon` 的個別
   * 開關疊在這之上，兩者都要通過才會真的畫出來，見這兩個方法的說明）。
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
      this.applyStandGeometry(radiusPx);
    }
  }

  /**
   * 支架（馬達殼＋頸關節＋支柱＋腳座）的座標，隨護罩半徑 `R` 等比縮放——見
   * 類別頂端「圖示外觀的取捨」。馬達殼緊貼護罩背後（`motorX`，稍微重疊邊緣
   * 顯得相連而非兩個分開的圖形），頸關節在馬達殼下緣，支柱從頸關節往下（本地
   * +y）接到腳座；各部件都有 `Math.max` 下限，避免護罩半徑夾到最小值
   * （`MIN_RADIUS_PX`）時支架細到消失或出現負值尺寸。
   */
  private applyStandGeometry(radiusPx: number): void {
    const motorW = Math.max(4, radiusPx * 0.7);
    const motorH = Math.max(6, radiusPx * 0.9);
    const motorX = -(radiusPx + motorW * 0.55);
    this.motor.setAttribute('x', String(motorX - motorW / 2));
    this.motor.setAttribute('y', String(-motorH / 2));
    this.motor.setAttribute('width', String(motorW));
    this.motor.setAttribute('height', String(motorH));
    this.motor.setAttribute('rx', String(Math.min(motorW, motorH) * 0.3));

    const neckY = motorH * 0.5;
    this.neck.setAttribute('cx', String(motorX));
    this.neck.setAttribute('cy', String(neckY));
    this.neck.setAttribute('r', String(Math.max(2, radiusPx * 0.12)));

    const poleW = Math.max(2, radiusPx * 0.12);
    const poleLen = Math.max(8, radiusPx * 0.9);
    this.pole.setAttribute('x', String(motorX - poleW / 2));
    this.pole.setAttribute('y', String(neckY));
    this.pole.setAttribute('width', String(poleW));
    this.pole.setAttribute('height', String(poleLen));

    this.base.setAttribute('cx', String(motorX));
    this.base.setAttribute('cy', String(neckY + poleLen));
    this.base.setAttribute('rx', String(Math.max(6, radiusPx * 0.55)));
    this.base.setAttribute('ry', String(Math.max(2, radiusPx * 0.16)));
  }

  /**
   * 「顯示風扇範圍提示」開關（issue #67 事後檢視追加）——只管矩形外框，跟
   * `setShowIcon` 各自獨立：使用者可能只想看推力範圍、不想被圖示擋住畫面，
   * 或反過來只想看風扇本身、不想看矩形線框。跟 `update` 的 `is-present`（有沒有
   * 風扇）是疊加關係，兩者都成立矩形才會真的畫出來（見類別頂端說明）。
   */
  setShowRange(visible: boolean): void {
    this.polygon.classList.toggle('jelly-fan-overlay-part-hidden', !visible);
  }

  /** 「顯示風扇圖示」開關（issue #67 事後檢視追加）——只管圖示，同 `setShowRange` 的獨立性說明。 */
  setShowIcon(visible: boolean): void {
    this.iconGroup.classList.toggle('jelly-fan-overlay-part-hidden', !visible);
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
 * 圖示的固定結構（issue #67 事後檢視追加＋再追加支架）：本地座標系以圖示
 * 中心（＝風扇原點）為圓心、面向 +x 吹風。由後到前疊放：腳座→支柱→頸關節
 * →馬達殼（都在 −x／+y 象限，見類別頂端「圖示外觀的取捨」）→護罩（圓，
 * 半徑動態反映 `width`，置中在圖示錨點上——這正是矩形近端邊的中心，圓的
 * 視覺涵蓋範圍因此跟矩形近端邊實際寬度同步變化）→扇葉（護罩內放射狀排列）
 * →風線（護罩前方 +x）。純向量圖佔位，非正式美術資產。回傳各動態部件的
 * 節點參照，讓 `update()`／`applyStandGeometry()` 能在半徑變動時改寫它們的
 * 屬性，不用整個圖示重建。
 */
function buildFanIcon(): {
  g: SVGGElement;
  base: SVGEllipseElement;
  pole: SVGRectElement;
  neck: SVGCircleElement;
  motor: SVGRectElement;
  grille: SVGCircleElement;
  blades: SVGPathElement;
  wind: SVGPathElement;
} {
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'jelly-fan-overlay-icon');

  const base = document.createElementNS(ns, 'ellipse');
  base.setAttribute('class', 'jelly-fan-overlay-icon-base');
  g.appendChild(base);

  const pole = document.createElementNS(ns, 'rect');
  pole.setAttribute('class', 'jelly-fan-overlay-icon-pole');
  g.appendChild(pole);

  const neck = document.createElementNS(ns, 'circle');
  neck.setAttribute('class', 'jelly-fan-overlay-icon-neck');
  g.appendChild(neck);

  const motor = document.createElementNS(ns, 'rect');
  motor.setAttribute('class', 'jelly-fan-overlay-icon-motor');
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

  return { g, base, pole, neck, motor, grille, blades, wind };
}

/** 世界座標 `width` 換算成螢幕像素半徑後，夾到圖示可視範圍——`JellySandbox.frame` 用。 */
export function clampFanIconRadiusPx(radiusPx: number): number {
  return Math.min(Math.max(radiusPx, MIN_RADIUS_PX), MAX_RADIUS_PX);
}
