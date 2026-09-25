/**
 * `HandfulRanges`（issue #135；原本是 issue #113 的單一顆範圍圈）——大把抓取的範圍圈，
 * 可以同時畫好幾顆：大把模式是跟著游標的一顆，編隊的每點大把是每個編隊點各一顆
 * （CONTEXT.md「提示」：大把抓取的範圍圈是提示，有自己的開關、播放時被壓下）。
 *
 * 每一顆就是一個 `'handful'` 樣式的 `BrushCursor`（幾何、顏色都沿用），這裡只管一個
 * 池子：`update` 給幾顆就顯示幾顆，多出來的收起來、留著下次重用——編隊點數最多幾十個，
 * 每幀只改有變動的 `transform`／尺寸（`BrushCursor` 值沒變不寫 DOM）。
 *
 * 跟其他 overlay 一樣是被動的：呼叫端（`JellySandbox`）每幀把螢幕座標與螢幕半徑算好餵進來；
 * `pointer-events: none`，不擋手勢。
 */

import { BrushCursor } from './BrushCursor';

/** 一顆範圍圈：圓心（畫布局部座標）＋螢幕半徑（px）。 */
export interface HandfulRangeCircle {
  x: number;
  y: number;
  radiusPx: number;
}

export class HandfulRanges {
  readonly element: HTMLDivElement;
  private readonly pool: BrushCursor[] = [];

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-handful-ranges';
  }

  /** 這一幀要畫的圈（空陣列＝一顆都不畫）。 */
  update(circles: readonly HandfulRangeCircle[]): void {
    while (this.pool.length < circles.length) {
      const cursor = new BrushCursor();
      cursor.setVariant('handful');
      cursor.setActive(true);
      this.element.appendChild(cursor.element);
      this.pool.push(cursor);
    }
    this.pool.forEach((cursor, i) => {
      const circle = circles[i];
      if (circle) {
        cursor.setPosition(circle);
        cursor.setRadiusPx(circle.radiusPx);
      } else {
        cursor.setPosition(null);
      }
    });
  }

  /** 「顯示大把抓取範圍」提示實際上可不可見（使用者開關＋播放時壓下）——整層藏起來。 */
  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  destroy(): void {
    this.element.remove();
  }
}
