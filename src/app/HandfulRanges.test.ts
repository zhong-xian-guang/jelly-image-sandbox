/**
 * `HandfulRanges`（issue #135）的 DOM 測試——只驗「給幾顆畫幾顆、多的收起來、整層開關」；
 * 圓圈外觀是 CSS 的事，靠瀏覽器驗證（jsdom 載不到樣式表）。
 */

import { describe, expect, it } from 'vitest';

import { HandfulRanges } from './HandfulRanges';

function shown(ranges: HandfulRanges): HTMLElement[] {
  return [...ranges.element.querySelectorAll<HTMLElement>('.jelly-brush-cursor.is-active')].map(
    (el) => el.querySelector<HTMLElement>('.jelly-brush-cursor-circle')!,
  );
}

describe('HandfulRanges — 大把抓取範圍圈（可多顆，issue #135）', () => {
  it('給幾顆畫幾顆：位置與直徑照餵進來的螢幕座標／半徑，顏色是大把的青綠', () => {
    const ranges = new HandfulRanges();
    ranges.update([
      { x: 10, y: 20, radiusPx: 30 },
      { x: 100, y: 50, radiusPx: 30 },
    ]);
    const circles = shown(ranges);
    expect(circles).toHaveLength(2);
    expect(circles[0]!.style.transform).toContain('translate(10px, 20px)');
    expect(circles[1]!.style.transform).toContain('translate(100px, 50px)');
    expect(circles[0]!.style.width).toBe('60px');
    expect(circles.every((c) => c.classList.contains('is-handful'))).toBe(true);
  });

  it('顆數變少 → 多的收起來；再變多 → 重用，不會越長越多節點', () => {
    const ranges = new HandfulRanges();
    ranges.update([
      { x: 0, y: 0, radiusPx: 5 },
      { x: 1, y: 1, radiusPx: 5 },
      { x: 2, y: 2, radiusPx: 5 },
    ]);
    ranges.update([{ x: 0, y: 0, radiusPx: 5 }]);
    expect(shown(ranges)).toHaveLength(1);
    ranges.update([]);
    expect(shown(ranges)).toHaveLength(0);
    ranges.update([
      { x: 0, y: 0, radiusPx: 5 },
      { x: 1, y: 1, radiusPx: 5 },
    ]);
    expect(shown(ranges)).toHaveLength(2);
    expect(ranges.element.querySelectorAll('.jelly-brush-cursor')).toHaveLength(3);
  });

  it('setVisible(false) 整層藏起來（is-hidden），打開恢復', () => {
    const ranges = new HandfulRanges();
    ranges.setVisible(false);
    expect(ranges.element.classList.contains('is-hidden')).toBe(true);
    ranges.setVisible(true);
    expect(ranges.element.classList.contains('is-hidden')).toBe(false);
  });
});
