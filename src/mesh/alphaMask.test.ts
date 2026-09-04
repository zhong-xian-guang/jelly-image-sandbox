import { describe, expect, it } from 'vitest';

import { toDownsampledMask } from './alphaMask';

describe('toDownsampledMask', () => {
  it('最長邊已在上限內 → 不縮放，只二值化（門檻 0.5）', () => {
    const alpha = new Uint8Array([0, 127, 128, 255]);
    const mask = toDownsampledMask(alpha, 2, 2, 1024, 0.5);
    expect([mask.width, mask.height]).toEqual([2, 2]);
    expect(Array.from(mask.data)).toEqual([0, 0, 1, 1]);
  });

  it('把最長邊縮到 <= maxEdge', () => {
    const alpha = new Uint8Array(100 * 40).fill(255);
    const mask = toDownsampledMask(alpha, 100, 40, 10, 0.5);
    expect(mask.width).toBe(10);
    expect(mask.height).toBe(4);
    expect(Array.from(mask.data).every((v) => v === 1)).toBe(true);
  });

  it('box filter 平均後再套門檻', () => {
    // 4×1：半滿(255,255,0,0) → 縮成 2×1 → 平均 [255, 0] → [1, 0]
    const alpha = new Uint8Array([255, 255, 0, 0]);
    const mask = toDownsampledMask(alpha, 4, 1, 2, 0.5);
    expect(Array.from(mask.data)).toEqual([1, 0]);
  });

  it('尺寸至少為 1', () => {
    const alpha = new Uint8Array(2000).fill(255);
    const mask = toDownsampledMask(alpha, 2000, 1, 1024, 0.5);
    expect(mask.height).toBe(1);
    expect(mask.width).toBe(1024);
  });
});
