import { describe, expect, it } from 'vitest';

import {
  distanceToRings,
  pointInRings,
  pointSegmentDistanceSq,
  signedPolygonArea,
  triangleMinAngleDeg,
  triangleSignedArea,
} from './geometry';
import type { Point } from './types';

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('signedPolygonArea', () => {
  it('大小 = 面積', () => {
    expect(Math.abs(signedPolygonArea(square))).toBe(100);
  });
});

describe('triangleSignedArea', () => {
  it('CCW 與 CW 只差一個負號', () => {
    const ccw = triangleSignedArea(0, 0, 4, 0, 0, 3);
    const cw = triangleSignedArea(0, 0, 0, 3, 4, 0);
    expect(Math.abs(ccw)).toBe(6);
    expect(cw).toBe(-ccw);
  });
});

describe('triangleMinAngleDeg', () => {
  it('正三角形 ≈ 60°', () => {
    expect(triangleMinAngleDeg(0, 0, 1, 0, 0.5, Math.sqrt(3) / 2)).toBeCloseTo(60, 5);
  });

  it('針狀 sliver 角度很小', () => {
    expect(triangleMinAngleDeg(0, 0, 100, 0, 50, 1)).toBeLessThan(2);
  });

  it('退化（共線）回傳 0', () => {
    expect(triangleMinAngleDeg(0, 0, 1, 0, 2, 0)).toBe(0);
  });
});

describe('pointInRings', () => {
  it('外環內部 → true，外部 → false', () => {
    expect(pointInRings([square], 5, 5)).toBe(true);
    expect(pointInRings([square], -1, 5)).toBe(false);
    expect(pointInRings([square], 20, 5)).toBe(false);
  });

  it('洞環讓洞內變成外部（even-odd）', () => {
    const hole: Point[] = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ];
    expect(pointInRings([square, hole], 5, 5)).toBe(false);
    expect(pointInRings([square, hole], 2, 2)).toBe(true);
  });
});

describe('pointSegmentDistanceSq', () => {
  it('垂足落在線段內', () => {
    expect(pointSegmentDistanceSq(5, 3, 0, 0, 10, 0)).toBe(9);
  });

  it('垂足落在端點外時取端點距離', () => {
    expect(pointSegmentDistanceSq(-4, 0, 0, 0, 10, 0)).toBe(16);
  });
});

describe('distanceToRings', () => {
  it('回傳到最近邊的距離', () => {
    expect(distanceToRings([square], 5, 2)).toBeCloseTo(2, 10);
  });
});
