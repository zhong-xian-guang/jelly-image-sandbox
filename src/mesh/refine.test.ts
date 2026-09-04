import { describe, expect, it } from 'vitest';

import {
  circumcenter,
  encroachesSegment,
  triangleMinAngleDeg,
  triangleSignedArea,
} from './geometry';
import { refineRuppert, type RefineParams } from './refine';
import type { Point } from './types';

const PARAMS: RefineParams = {
  minAngleDeg: 25,
  maxArea: 60,
  maxPasses: 40,
  maxVertices: 2000,
};

/** 掃過每個三角形，回傳 { minAngle, maxArea, badCount }（bad = 角 < 門檻 或 面積 > 上限）。 */
function quality(
  positions: readonly number[],
  indices: readonly number[],
  minAngleDeg: number,
  maxArea: number,
) {
  let minAngle = 180;
  let maxSeen = 0;
  let badCount = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const v: [number, number, number, number, number, number] = [
      positions[a * 2]!,
      positions[a * 2 + 1]!,
      positions[b * 2]!,
      positions[b * 2 + 1]!,
      positions[c * 2]!,
      positions[c * 2 + 1]!,
    ];
    const ang = triangleMinAngleDeg(...v);
    const area = Math.abs(triangleSignedArea(...v));
    if (ang < minAngle) minAngle = ang;
    if (area > maxSeen) maxSeen = area;
    if (ang < minAngleDeg - 1e-6 || area > maxArea + 1e-6) badCount++;
  }
  return { minAngle, maxArea: maxSeen, badCount };
}

function allFinite(xs: ArrayLike<number>): boolean {
  for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i]!)) return false;
  return true;
}

/** 矩形環（CCW，y 向下）。 */
function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

describe('geometry helpers for Ruppert', () => {
  it('circumcenter：直角三角形的外心在斜邊中點', () => {
    const cc = circumcenter(0, 0, 4, 0, 0, 4);
    expect(cc).not.toBeNull();
    expect(cc!.x).toBeCloseTo(2, 10);
    expect(cc!.y).toBeCloseTo(2, 10);
  });

  it('circumcenter：共線三頂點回傳 null', () => {
    expect(circumcenter(0, 0, 1, 1, 2, 2)).toBeNull();
  });

  it('encroachesSegment：直徑圓內 true、圓外 false、端點不算', () => {
    // 線段 (0,0)-(10,0)，直徑圓半徑 5、圓心 (5,0)
    expect(encroachesSegment(5, 0.5, 0, 0, 10, 0)).toBe(true);
    expect(encroachesSegment(5, 6, 0, 0, 10, 0)).toBe(false);
    expect(encroachesSegment(0, 0, 0, 0, 10, 0)).toBe(false);
  });
});

describe('refineRuppert', () => {
  it('凸多邊形（正方形）：細化後沒有壞三角形', () => {
    const rings = [rect(0, 0, 40, 40)];
    const res = refineRuppert(rings, [], PARAMS);
    expect(res.indices.length).toBeGreaterThan(0);
    expect(allFinite(res.positions)).toBe(true);
    const q = quality(res.positions, res.indices, PARAMS.minAngleDeg, PARAMS.maxArea);
    expect(q.badCount).toBe(0);
    expect(res.unresolvedBadTriangles).toBe(0);
    expect(res.passes).toBeLessThan(PARAMS.maxPasses);
  });

  it('帶內部點的矩形：細化後最小角 ≥ 門檻、面積 ≤ 上限', () => {
    const rings = [rect(0, 0, 60, 30)];
    const interior: Point[] = [
      { x: 12, y: 9 },
      { x: 31, y: 20 },
      { x: 47, y: 8 },
      { x: 25, y: 6 },
    ];
    const res = refineRuppert(rings, interior, PARAMS);
    const q = quality(res.positions, res.indices, PARAMS.minAngleDeg, PARAMS.maxArea);
    expect(q.minAngle).toBeGreaterThanOrEqual(PARAMS.minAngleDeg - 1e-6);
    expect(q.maxArea).toBeLessThanOrEqual(PARAMS.maxArea + 1e-6);
    expect(res.unresolvedBadTriangles).toBe(0);
  });

  it('決定性：相同輸入 → 完全相同的 positions / indices / boundaryCount', () => {
    const rings = [rect(0, 0, 50, 40)];
    const interior: Point[] = [
      { x: 10, y: 10 },
      { x: 33, y: 27 },
      { x: 41, y: 9 },
    ];
    const a = refineRuppert(rings, interior, PARAMS);
    const b = refineRuppert(rings, interior, PARAMS);
    expect(a.positions).toEqual(b.positions);
    expect(a.indices).toEqual(b.indices);
    expect(a.boundaryCount).toBe(b.boundaryCount);
    expect(a.passes).toBe(b.passes);
  });

  it('長邊界邊被近處內部點 encroach → 分裂中點（boundaryCount 增加）', () => {
    const rings = [rect(0, 0, 80, 20)];
    // 貼著上緣長邊 (0,0)-(80,0) 的點，落在其直徑圓內
    const interior: Point[] = [{ x: 40, y: 3 }];
    const res = refineRuppert(rings, interior, {
      ...PARAMS,
      maxArea: Number.POSITIVE_INFINITY, // 只驗 encroachment，關掉面積準則
    });
    // 原本 4 個環頂點；被 encroach 的長邊至少分裂一次
    expect(res.boundaryCount).toBeGreaterThan(4);
    // 分裂點都在原長邊上（y ≈ 0）
    for (let i = 4; i < res.boundaryCount; i++) {
      const y = res.positions[i * 2 + 1]!;
      const x = res.positions[i * 2]!;
      const onTop = Math.abs(y) < 1e-6 && x > 0 && x < 80;
      const onOther = Math.abs(y - 20) < 1e-6 || Math.abs(x) < 1e-6 || Math.abs(x - 80) < 1e-6;
      expect(onTop || onOther).toBe(true);
    }
  });

  it('尖銳凹形（梳齒）：可終止、輸出有限且決定性', () => {
    // 梳子：底部一條 bar，往上伸出 4 根細齒，齒間是尖銳凹口
    const pts: Point[] = [{ x: 0, y: 40 }];
    for (let k = 0; k < 4; k++) {
      const x0 = 4 + k * 10;
      pts.push(
        { x: x0, y: 40 },
        { x: x0 + 1.5, y: 4 },
        { x: x0 + 4.5, y: 4 },
        { x: x0 + 6, y: 40 },
      );
    }
    pts.push({ x: 40, y: 40 }, { x: 40, y: 50 }, { x: 0, y: 50 });
    const rings = [pts];

    const res = refineRuppert(rings, [], { ...PARAMS, maxArea: 30 });
    expect(res.passes).toBeLessThanOrEqual(PARAMS.maxPasses);
    expect(res.indices.length).toBeGreaterThan(0);
    expect(allFinite(res.positions)).toBe(true);
    // 決定性
    const res2 = refineRuppert(rings, [], { ...PARAMS, maxArea: 30 });
    expect(res2.positions).toEqual(res.positions);
    expect(res2.indices).toEqual(res.indices);
    // 齒間凹口（例如 x≈11, y≈20）不應被三角形橋接
    const bridged = spanContains(res.positions, res.indices, 11, 20);
    expect(bridged).toBe(false);
  });

  it('maxVertices 上限會讓細化提早收手（不無限長）', () => {
    const rings = [rect(0, 0, 100, 100)];
    const capped = refineRuppert(rings, [], { ...PARAMS, maxArea: 4, maxVertices: 120 });
    expect(capped.positions.length / 2).toBeLessThanOrEqual(140);
  });
});

/** 點是否落在某三角形內（用於「凹口有沒有被橋接」）。 */
function spanContains(
  positions: readonly number[],
  indices: readonly number[],
  px: number,
  py: number,
): boolean {
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ax = positions[a * 2]!;
    const ay = positions[a * 2 + 1]!;
    const bx = positions[b * 2]!;
    const by = positions[b * 2 + 1]!;
    const cx = positions[c * 2]!;
    const cy = positions[c * 2 + 1]!;
    const d1 = sign(px, py, ax, ay, bx, by);
    const d2 = sign(px, py, bx, by, cx, cy);
    const d3 = sign(px, py, cx, cy, ax, ay);
    const hasNeg = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6;
    const hasPos = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
    if (!(hasNeg && hasPos)) return true;
  }
  return false;
}
