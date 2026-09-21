import { describe, expect, it } from 'vitest';

import { contourEdges, surfaceParticles } from './contour';
import { gridMesh } from './testFixtures';

/** 邊 `a → b` 的外法線（`nsign · perp(b − a)`）在中點與「指向 `(cx, cy)`」的內積。 */
function outwardDot(
  e: { a: number; b: number; nsign: 1 | -1 },
  pos: Float32Array,
  cx: number,
  cy: number,
): number {
  const ax = pos[2 * e.a]!;
  const ay = pos[2 * e.a + 1]!;
  const bx = pos[2 * e.b]!;
  const by = pos[2 * e.b + 1]!;
  const nx = e.nsign * (by - ay);
  const ny = e.nsign * -(bx - ax);
  return nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy);
}

describe('contourEdges — 有洞的網格（issue #96）', () => {
  it('4×4 頂點挖掉正中央 cell → 外圈 12 條 + 洞 4 條，洞的外法線指向洞內', () => {
    const mesh = gridMesh(4, 4, 10, (i, j) => !(i === 1 && j === 1)); // 洞 = [10, 20]²
    const edges = contourEdges(mesh.indices, mesh.positions);
    expect(edges.length).toBe(16);
    const pos = mesh.positions;
    const onHole = (e: (typeof edges)[number]) =>
      [e.a, e.b].every((p) => {
        const x = pos[2 * p]!;
        const y = pos[2 * p + 1]!;
        return x >= 10 && x <= 20 && y >= 10 && y <= 20;
      });
    const hole = edges.filter(onHole);
    const outer = edges.filter((e) => !onHole(e));
    expect(hole.length).toBe(4);
    expect(outer.length).toBe(12);
    // 外圈：法線背向網格中心 (15, 15)；洞：法線朝向洞心 (15, 15)（洞是網格的「外面」）。
    for (const e of outer) expect(outwardDot(e, pos, 15, 15)).toBeGreaterThan(0);
    for (const e of hole) expect(outwardDot(e, pos, 15, 15)).toBeLessThan(0);
    // 輪廓 Particle = 全部 16 個頂點（洞的 4 個角也在輪廓上）。
    expect(surfaceParticles(edges).length).toBe(16);
  });

  it('沒有輪廓的退化輸入：空 indices → 空清單', () => {
    expect(contourEdges([], [])).toEqual([]);
    expect(surfaceParticles([]).length).toBe(0);
  });
});
