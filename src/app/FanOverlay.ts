/**
 * `FanOverlay`（issue #66 / V2 T3-2；issue #67 / V2 T3-3 加旋轉圖示；歷經三輪
 * 事後檢視回饋調整外觀，第三輪起使用者提供參考圖定案——見下方「圖示外觀」）
 * ——電風扇的視覺提示，比照 `PinMarkers` 的純 DOM overlay 模式：不知道
 * `SimCore`／相機的存在，呼叫端（`JellySandbox`）每幀把投影好的螢幕座標、
 * 圖示的錨點／角度／護罩半徑餵進來（`update`）。
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
 * **圖示外觀**：前兩輪回饋在「側視圖」（護罩扁成一條線，看不出寬度）跟「正面圓
 * 護罩＋放射扇葉」（看得出寬度但不像側視圖）之間反覆橫跳。第三輪使用者直接
 * 提供一張參考圖定案，照它重畫：護罩是一顆立起來的橢圓（不是扁平線條，也不是
 * 正圓）——內部畫幾道垂直「籠子」桿線＋一條橫線做出立體感，寬度滑桿控制的是
 * 橢圓的縱向半徑（`ry`），不是圓的半徑；馬達殼在護罩後方（−x），旁邊一顆小
 * 旋鈕；馬達下方一顆頸關節，用一條弧線往下、往後掃到一個矮胖的底座；風線
 * 換成護罩前方（+x）的波浪線（不是人字形箭頭）。整組支架（馬達／旋鈕／頸關節
 * ／弧線／底座）固定畫在護罩後方偏下（本地座標 −x／+y 象限），隨圖示整體
 * 依 `dirX/dirY` 旋轉——這款遊戲是無重力俯視視角，「下方」沒有真正的物理
 * 意義，支架跟著風向轉動、不會永遠垂直於畫面，是刻意的風格化簡化，不是 bug。
 *
 * 矩形範圍／圖示各自有獨立的顯示開關（`setShowRange`／`setShowIcon`，issue #67
 * 事後檢視追加）——面板原本只有一顆「顯示風扇提示」同時管兩者，使用者可能
 * 只想看推力範圍評估手感、不想被圖示擋住畫面，或反過來只想看風扇本身、覺得
 * 矩形線框太干擾，兩種情境值得分開控制。實作上兩者都是疊在 `update` 的
 * `is-present`（有沒有風扇）之上的獨立開關，用 `!important` 的
 * `.jelly-fan-overlay-part-hidden` 蓋掉，不依賴 CSS 規則的宣告順序。
 */

/**
 * 護罩半徑（螢幕像素，＝橢圓縱向半徑 `ry`）的可視下限／上限——只防兩個極端：
 * 寬度滑桿拉到最小、或縮到很小的相機縮放時圖示整個消失（下限），或不合理的
 * 輸入（如手動改 clip JSON 塞進超大 width）讓圖示大到蓋掉整個畫面（上限，
 * 遠高於面板 `FAN_WIDTH_RANGE` 目前的上限 280，正常操作不會碰到）。介於中間
 * 的正常範圍完全不夾，圖示大小如實跟著 `width` 走。
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
  /** 護罩縱向半徑，畫布像素——反映 `fan.width`，呼叫端已 clamp 過（見類別頂端說明）。 */
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
  private readonly guard: SVGEllipseElement;
  private readonly bars: SVGPathElement;
  private readonly centerline: SVGLineElement;
  private readonly motor: SVGRectElement;
  private readonly knob: SVGCircleElement;
  private readonly tilt: SVGCircleElement;
  private readonly curve: SVGPathElement;
  private readonly base: SVGRectElement;
  private readonly wind: SVGPathElement;
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
    this.curve = icon.curve;
    this.tilt = icon.tilt;
    this.knob = icon.knob;
    this.motor = icon.motor;
    this.guard = icon.guard;
    this.bars = icon.bars;
    this.centerline = icon.centerline;
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
      this.applyGeometry(radiusPx);
    }
  }

  /**
   * 依護罩半徑 `R` 重新計算圖示每個部件的座標／path（issue #67 第三輪回饋，
   * 照使用者提供的參考圖比例）。護罩是橢圓（`rx = R×0.35`、`ry = R`，維持
   * 「立起來的橢圓」而非扁平線條或正圓）；馬達／旋鈕／頸關節／底座的尺寸與
   * 相對位置都取自參考圖估算的比例常數。各部件都有 `Math.max` 下限，避免
   * 護罩半徑夾到最小值時支架細到消失或出現負值尺寸。
   */
  private applyGeometry(radiusPx: number): void {
    const R = radiusPx;
    const guardRx = Math.max(2, R * 0.35);
    const guardRy = R;
    this.guard.setAttribute('rx', String(guardRx));
    this.guard.setAttribute('ry', String(guardRy));
    this.bars.setAttribute('d', cageBarsPath(guardRx, guardRy));
    this.centerline.setAttribute('x1', String(-guardRx));
    this.centerline.setAttribute('x2', String(guardRx));

    const motorW = Math.max(4, R * 0.55);
    const motorH = Math.max(6, R * 0.45);
    const motorGap = R * 0.05;
    const motorCx = -(guardRx + motorGap + motorW / 2);
    this.motor.setAttribute('x', String(motorCx - motorW / 2));
    this.motor.setAttribute('y', String(-motorH / 2));
    this.motor.setAttribute('width', String(motorW));
    this.motor.setAttribute('height', String(motorH));
    this.motor.setAttribute('rx', String(Math.min(motorW, motorH) * 0.25));

    const knobR = Math.max(2, R * 0.11);
    this.knob.setAttribute('cx', String(motorCx - motorW / 2 - knobR * 0.8));
    this.knob.setAttribute('cy', '0');
    this.knob.setAttribute('r', String(knobR));

    const tiltX = motorCx * 0.75;
    const tiltY = R * 0.55;
    const tiltR = Math.max(2, R * 0.11);
    this.tilt.setAttribute('cx', String(tiltX));
    this.tilt.setAttribute('cy', String(tiltY));
    this.tilt.setAttribute('r', String(tiltR));

    const baseW = Math.max(8, R * 1.1);
    const baseH = Math.max(3, R * 0.28);
    const baseCx = motorCx * 0.55;
    const baseY = R * 1.25;
    this.base.setAttribute('x', String(baseCx - baseW / 2));
    this.base.setAttribute('y', String(baseY - baseH / 2));
    this.base.setAttribute('width', String(baseW));
    this.base.setAttribute('height', String(baseH));
    this.base.setAttribute('rx', String(baseH * 0.4));

    // 頸關節往下、往後（−x）掃一條弧線到底座頂緣，比照參考圖的「弓形支架」。
    this.curve.setAttribute(
      'd',
      `M ${tiltX} ${tiltY} Q ${tiltX - R * 0.35} ${baseY - baseH * 0.2} ${baseCx} ${baseY - baseH / 2}`,
    );

    this.wind.setAttribute('d', windPath(guardRx, guardRy));
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
 * 護罩內的「籠子」桿線（issue #67 第三輪回饋，照參考圖）：5 道等距垂直線，
 * 每道的長度依橢圓方程式算到護罩邊緣（`y = ±ry·√(1 − (x/rx)²)`），不是簡單
 * 切齊矩形，桿線末端才會貼著橢圓輪廓、看起來像真的籠子而不是一堆穿出邊界
 * 的直線。
 */
function cageBarsPath(rx: number, ry: number): string {
  const fractions = [-0.7, -0.35, 0, 0.35, 0.7];
  return fractions
    .map((f) => {
      const x = rx * f;
      const halfY = ry * Math.sqrt(Math.max(0, 1 - f * f));
      return `M ${x.toFixed(1)} ${(-halfY).toFixed(1)} L ${x.toFixed(1)} ${halfY.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * 護罩前方（+x）四道由上到下的波浪風線（issue #67 第三輪回饋，照參考圖換成
 * 波浪造型，不再是人字形箭頭）：每道用兩段二次貝茲畫一個完整正弦波（先上凸
 * 再下凹），四道均勻分布在護罩的縱向範圍內。
 */
function windPath(guardRx: number, guardRy: number): string {
  const gap = guardRx * 0.6;
  const waveLen = guardRy * 0.9;
  const amp = guardRy * 0.12;
  const x0 = guardRx + gap;
  const rows = [-0.75, -0.25, 0.25, 0.75];
  return rows
    .map((f) => {
      const y = guardRy * f;
      const half = waveLen / 2;
      return `M ${x0} ${y} q ${half * 0.5} ${-amp} ${half} 0 q ${half * 0.5} ${amp} ${half} 0`;
    })
    .join(' ');
}

/**
 * 圖示的固定結構（issue #67 第三輪回饋，照使用者提供的參考圖重畫）：本地
 * 座標系以圖示中心（＝風扇原點）為圓心、面向 +x 吹風。由後到前疊放：底座→
 * 弧線支架→頸關節→旋鈕→馬達殼（都在 −x／+y 象限）→護罩（立起來的橢圓，
 * 縱向半徑動態反映 `width`，置中在圖示錨點上——這正是矩形近端邊的中心，
 * 橢圓的視覺涵蓋範圍因此跟矩形近端邊實際寬度同步變化）→護罩內的籠子桿線＋
 * 橫線→風線（護罩前方 +x，波浪造型）。純向量圖佔位，非正式美術資產。回傳
 * 各動態部件的節點參照，讓 `update()`／`applyGeometry()` 能在半徑變動時
 * 改寫它們的屬性，不用整個圖示重建。
 */
function buildFanIcon(): {
  g: SVGGElement;
  base: SVGRectElement;
  curve: SVGPathElement;
  tilt: SVGCircleElement;
  knob: SVGCircleElement;
  motor: SVGRectElement;
  guard: SVGEllipseElement;
  bars: SVGPathElement;
  centerline: SVGLineElement;
  wind: SVGPathElement;
} {
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'jelly-fan-overlay-icon');

  const base = document.createElementNS(ns, 'rect');
  base.setAttribute('class', 'jelly-fan-overlay-icon-base');
  g.appendChild(base);

  const curve = document.createElementNS(ns, 'path');
  curve.setAttribute('class', 'jelly-fan-overlay-icon-curve');
  g.appendChild(curve);

  const tilt = document.createElementNS(ns, 'circle');
  tilt.setAttribute('class', 'jelly-fan-overlay-icon-tilt');
  g.appendChild(tilt);

  const knob = document.createElementNS(ns, 'circle');
  knob.setAttribute('class', 'jelly-fan-overlay-icon-knob');
  g.appendChild(knob);

  const motor = document.createElementNS(ns, 'rect');
  motor.setAttribute('class', 'jelly-fan-overlay-icon-motor');
  g.appendChild(motor);

  const guard = document.createElementNS(ns, 'ellipse');
  guard.setAttribute('class', 'jelly-fan-overlay-icon-guard');
  guard.setAttribute('cx', '0');
  guard.setAttribute('cy', '0');
  g.appendChild(guard);

  const bars = document.createElementNS(ns, 'path');
  bars.setAttribute('class', 'jelly-fan-overlay-icon-bars');
  g.appendChild(bars);

  const centerline = document.createElementNS(ns, 'line');
  centerline.setAttribute('class', 'jelly-fan-overlay-icon-centerline');
  centerline.setAttribute('y1', '0');
  centerline.setAttribute('y2', '0');
  g.appendChild(centerline);

  const wind = document.createElementNS(ns, 'path');
  wind.setAttribute('class', 'jelly-fan-overlay-icon-wind');
  g.appendChild(wind);

  return { g, base, curve, tilt, knob, motor, guard, bars, centerline, wind };
}

/** 世界座標 `width` 換算成螢幕像素半徑後，夾到圖示可視範圍——`JellySandbox.frame` 用。 */
export function clampFanIconRadiusPx(radiusPx: number): number {
  return Math.min(Math.max(radiusPx, MIN_RADIUS_PX), MAX_RADIUS_PX);
}
