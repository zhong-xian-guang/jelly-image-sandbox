import { describe, expect, it } from 'vitest';

import { largestOpaqueComponent } from './components';
import type { Mask } from './types';

/** 從 ASCII 列陣（`#` = 不透明）建遮罩。 */
function maskFrom(rows: string[]): Mask {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) data[y * width + x] = row[x] === '#' ? 1 : 0;
  });
  return { width, height, data };
}

describe('largestOpaqueComponent', () => {
  it('不連通輸入 → 只留最大的一塊', () => {
    const { mask, count } = largestOpaqueComponent(
      maskFrom(['#..###', '..####', '......', '#.....']),
    );
    expect(count).toBe(7);
    // 左上與左下的孤立像素被丟掉
    expect(mask.data[0]).toBe(0);
    expect(mask.data[3 * 6 + 0]).toBe(0);
    // 右上那塊（row0/row1 的 x=3,4,5）留下
    expect(mask.data[3]).toBe(1);
    expect(mask.data[6 + 5]).toBe(1);
  });

  it('對角相鄰不算連通（4-連通）', () => {
    const { count } = largestOpaqueComponent(maskFrom(['#.', '.#']));
    expect(count).toBe(1);
  });

  it('保留元件內的洞（不填滿）', () => {
    const { mask } = largestOpaqueComponent(
      maskFrom(['#####', '#...#', '#.#.#', '#...#', '#####']),
    );
    // 甜甜圈本體
    expect(mask.data[0]).toBe(1);
    // 洞維持 0（中央那顆孤立 # 屬於另一個元件，被丟棄）
    expect(mask.data[2 * 5 + 2]).toBe(0);
  });

  it('全透明 → count 0', () => {
    expect(largestOpaqueComponent(maskFrom(['...', '...'])).count).toBe(0);
  });
});
