/**
 * `FormationOverlay`（issue #68 / V2 T3-4）——編隊抓取的形狀標記視覺提示，比照
 * `PinMarkers`／`FanOverlay` 的純 DOM overlay 模式：不知道 `SimCore`／相機的
 * 存在，呼叫端（`JellySandbox`）每幀把投影好的螢幕座標餵進來（`update`）。
 * `pointer-events: none`——不擋手勢。
 *
 * 一組（`FormationOverlayGroup`）= 一個主點 + 其餘偏移點的目前螢幕座標，畫成
 * 「主點 → 每個偏移點各一條線」+ 每個點各一個小圓標記。定義形狀中
 * （`ToolRouter.isDefiningFormation`）與拖曳中（`ToolRouter.formationActiveGroups`）
 * 共用同一個資料形狀：定義中只有一組（目前按過的點，第一個是主點）；拖曳中
 * 每個作用中的指標各是一組。兩者互斥（定義中不會同時有作用中的拖曳），呼叫端
 * 只需決定當下要餵哪一份。
 *
 * 每幀整批重繪（`update` 清空重建）——點數最多幾十個，不是效能熱點，換取比照
 * `PinMarkers` 的節點重用機制簡單得多的實作。
 */

export interface FormationOverlayPoint {
  x: number;
  y: number;
}

/** 一組編隊：`points[0]` 是主點，其餘是偏移點——`update` 畫主點到每個偏移點的連線。 */
export interface FormationOverlayGroup {
  points: readonly FormationOverlayPoint[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class FormationOverlay {
  readonly element: HTMLDivElement;
  private readonly svg: SVGSVGElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-formation-overlay';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'jelly-formation-overlay-svg');
    this.element.appendChild(this.svg);
  }

  /** 每幀呼叫：整批重畫成目前的形狀（定義中的點，或作用中每個拖曳的目前位置）。 */
  update(groups: readonly FormationOverlayGroup[]): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    for (const group of groups) {
      const [primary, ...rest] = group.points;
      if (!primary) continue;
      for (const p of rest) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'jelly-formation-overlay-line');
        line.setAttribute('x1', String(primary.x));
        line.setAttribute('y1', String(primary.y));
        line.setAttribute('x2', String(p.x));
        line.setAttribute('y2', String(p.y));
        this.svg.appendChild(line);
      }
      for (const p of group.points) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('class', 'jelly-formation-overlay-point');
        circle.setAttribute('cx', String(p.x));
        circle.setAttribute('cy', String(p.y));
        circle.setAttribute('r', '5');
        this.svg.appendChild(circle);
      }
    }
  }

  /** 「顯示編隊抓取提示」開關——整層藏起來，不用逐一移除節點。 */
  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  destroy(): void {
    this.element.remove();
  }
}
