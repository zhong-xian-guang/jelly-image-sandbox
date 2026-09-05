import { describe, expect, it } from 'vitest';

import { computeWalledBounds, WALLED_SIZE_FACTOR } from './walledBounds';

describe('computeWalledBounds', () => {
  it('以 bbox 中心為中心、正方形邊長 = 較長邊 × sizeFactor', () => {
    const bounds = computeWalledBounds({ minX: 0, minY: 0, maxX: 10, maxY: 20 }, 4);

    expect(bounds.minX).toBeCloseTo(-35, 9); // cx=5, half=(20*4)/2=40 → 5-40
    expect(bounds.maxX).toBeCloseTo(45, 9);
    expect(bounds.minY).toBeCloseTo(-30, 9); // cy=10, half=40 → 10-40
    expect(bounds.maxY).toBeCloseTo(50, 9);
  });

  it('未指定 sizeFactor 時使用預設常數 WALLED_SIZE_FACTOR', () => {
    const bbox = { minX: -5, minY: -5, maxX: 5, maxY: 5 };
    expect(computeWalledBounds(bbox)).toEqual(computeWalledBounds(bbox, WALLED_SIZE_FACTOR));
  });

  it('退化 bbox（單點）→ 邊長 clamp 到至少 1，不會塌成一點', () => {
    const bounds = computeWalledBounds({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 4);
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(4);
    expect(bounds.maxY - bounds.minY).toBeGreaterThanOrEqual(4);
  });

  it('完整覆蓋原本的 bbox（不會把 Jelly 現有範圍切掉）', () => {
    const bbox = { minX: -12, minY: 3, maxX: 40, maxY: 55 };
    const bounds = computeWalledBounds(bbox, 3);
    expect(bounds.minX).toBeLessThanOrEqual(bbox.minX);
    expect(bounds.minY).toBeLessThanOrEqual(bbox.minY);
    expect(bounds.maxX).toBeGreaterThanOrEqual(bbox.maxX);
    expect(bounds.maxY).toBeGreaterThanOrEqual(bbox.maxY);
  });
});
