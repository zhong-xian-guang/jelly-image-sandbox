import { describe, expect, it } from 'vitest';

import {
  BOUNDARY_FRICTION,
  computeFloorY,
  computeWalledBounds,
  fitsInBoundaryFrame,
  placeBboxCentered,
  WALLED_SIZE_FACTOR,
} from './boundaryGeometry';

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

describe('computeFloorY（issue #92 / V3 T2-2）', () => {
  it('一般 bbox → 地板貼齊底邊（世界 y 向下 → maxY）', () => {
    expect(computeFloorY({ minX: -12, minY: 3, maxX: 40, maxY: 55 })).toBe(55);
  });

  it('退化 bbox（單點）也回 maxY——地板就在那一點上，不憑空掉一段、不埋進去', () => {
    expect(computeFloorY({ minX: 5, minY: 5, maxX: 5, maxY: 5 })).toBe(5);
  });
});

describe('BOUNDARY_FRICTION（issue #93）', () => {
  it('是 (0, 1] 之間的固定手感值——0 等於沒摩擦、> 1 會把切線速度反向', () => {
    expect(BOUNDARY_FRICTION).toBeGreaterThan(0);
    expect(BOUNDARY_FRICTION).toBeLessThanOrEqual(1);
  });
});

describe('placeBboxCentered（issue #97 / V3 T3-4）', () => {
  it('offset 把 bbox 中心搬到指定的點，擺完的 bbox 尺寸不變', () => {
    const rest = { minX: -40, minY: -10, maxX: 60, maxY: 30 }; // 中心 (10, 10)
    const { offset, bbox } = placeBboxCentered(rest, { x: 100, y: 200 });
    expect(offset).toEqual({ x: 90, y: 190 });
    expect(bbox).toEqual({ minX: 50, minY: 180, maxX: 150, maxY: 220 });
    expect(bbox.maxX - bbox.minX).toBe(rest.maxX - rest.minX);
    expect(bbox.maxY - bbox.minY).toBe(rest.maxY - rest.minY);
  });

  it('中心點就是原本的中心 → offset 為 0、bbox 原封不動', () => {
    const rest = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const { offset, bbox } = placeBboxCentered(rest, { x: 10, y: 10 });
    expect(offset).toEqual({ x: 0, y: 0 });
    expect(bbox).toEqual(rest);
  });
});

describe('fitsInBoundaryFrame（issue #97 / V3 T3-4；ADR-0013：範圍外拒絕生成）', () => {
  const walled = { kind: 'walled', minX: -100, minY: -100, maxX: 100, maxY: 100 } as const;
  const floor = { kind: 'floor', y: 50 } as const;

  it('Infinite（沒有外框）→ 哪裡都放得下', () => {
    expect(fitsInBoundaryFrame(null, { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 })).toBe(true);
  });

  it('Walled：整個在箱內才算放得下，貼齊邊界算在內', () => {
    expect(fitsInBoundaryFrame(walled, { minX: -10, minY: -10, maxX: 10, maxY: 10 })).toBe(true);
    expect(fitsInBoundaryFrame(walled, { minX: -100, minY: -100, maxX: 100, maxY: 100 })).toBe(
      true,
    );
  });

  it('Walled：任何一邊出界就放不下（四邊各驗一次）', () => {
    expect(fitsInBoundaryFrame(walled, { minX: -101, minY: 0, maxX: 0, maxY: 10 })).toBe(false);
    expect(fitsInBoundaryFrame(walled, { minX: 0, minY: 0, maxX: 101, maxY: 10 })).toBe(false);
    expect(fitsInBoundaryFrame(walled, { minX: 0, minY: -101, maxX: 10, maxY: 0 })).toBe(false);
    expect(fitsInBoundaryFrame(walled, { minX: 0, minY: 0, maxX: 10, maxY: 101 })).toBe(false);
  });

  it('Floor：底邊不能低於地板（世界 y 向下），左右上方不限', () => {
    expect(fitsInBoundaryFrame(floor, { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 50 })).toBe(true);
    expect(fitsInBoundaryFrame(floor, { minX: 0, minY: 0, maxX: 10, maxY: 51 })).toBe(false);
  });
});
