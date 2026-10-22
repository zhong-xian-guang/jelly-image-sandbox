import { describe, expect, it } from 'vitest';

import { fitRigidTransform } from './rigidFit';

/** 一個不對稱的小點集（避免對稱形狀讓旋轉不唯一）。 */
const REST = [0, 0, 40, 0, 40, 20, 10, 30, -5, 15];

function transform(points: readonly number[], angle: number, dx: number, dy: number): number[] {
  const n = points.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += points[2 * i]! / n;
    cy += points[2 * i + 1]! / n;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = points[2 * i]! - cx;
    const y = points[2 * i + 1]! - cy;
    out.push(cos * x - sin * y + cx + dx, sin * x + cos * y + cy + dy);
  }
  return out;
}

describe('fitRigidTransform（issue #155）', () => {
  it('沒動：角度 0、兩個質心一樣', () => {
    const fit = fitRigidTransform(REST, REST);
    expect(fit.angle).toBeCloseTo(0, 12);
    expect(fit.centroid).toEqual(fit.restCentroid);
  });

  it('純平移：角度 0、質心差 = 位移', () => {
    const fit = fitRigidTransform(REST, transform(REST, 0, 120, -35));
    expect(fit.angle).toBeCloseTo(0, 10);
    expect(fit.centroid.x - fit.restCentroid.x).toBeCloseTo(120, 10);
    expect(fit.centroid.y - fit.restCentroid.y).toBeCloseTo(-35, 10);
  });

  it('純旋轉（繞質心）：角度 = 旋轉量、質心不動', () => {
    const fit = fitRigidTransform(REST, transform(REST, 0.7, 0, 0));
    expect(fit.angle).toBeCloseTo(0.7, 10);
    expect(fit.centroid.x).toBeCloseTo(fit.restCentroid.x, 10);
  });

  it('平移加旋轉（超過 90°、負角度都對）', () => {
    for (const angle of [2.5, -1.2]) {
      const fit = fitRigidTransform(REST, transform(REST, angle, -60, 80));
      expect(fit.angle).toBeCloseTo(angle, 10);
      expect(fit.centroid.x - fit.restCentroid.x).toBeCloseTo(-60, 10);
      expect(fit.centroid.y - fit.restCentroid.y).toBeCloseTo(80, 10);
    }
  });

  it('有變形：等比拉伸不帶角度；非等比拉伸只帶出很小的角度，再轉 0.4 仍抓得到', () => {
    const n = REST.length / 2;
    const cx = REST.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b) / n;
    const cy = REST.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b) / n;
    const scale = (sx: number, sy: number) =>
      REST.map((v, i) => (i % 2 === 0 ? (v - cx) * sx + cx : (v - cy) * sy + cy));
    expect(fitRigidTransform(REST, scale(1.5, 1.5)).angle).toBeCloseTo(0, 10);
    // 不對稱形狀被非等比拉伸時，最佳擬合本來就會帶一點角度（這組約 1°）。
    expect(fitRigidTransform(REST, scale(1.6, 0.7)).angle).toBeCloseTo(0, 1);
    const fit = fitRigidTransform(REST, transform(scale(1.6, 0.7), 0.4, 10, 10));
    expect(fit.angle).toBeCloseTo(0.4, 1);
    expect(fit.centroid.x - fit.restCentroid.x).toBeCloseTo(10, 10);
  });
});
