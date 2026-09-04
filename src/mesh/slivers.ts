/**
 * 粗 sliver 清理，再把不再被任何三角形參照的頂點壓掉、重新編號。
 * 真正的品質細化（circumcenter 插點、encroachment 分裂）留給 T3（Ruppert，issue #4）。
 *
 * 兩道門檻刻意分開：
 * - **面積 < ε**：一律丟。沒有梯度的三角形留著只會拖垮 signed-area 約束。
 * - **最小角 < 門檻**：只丟「三個頂點都是內部 Steiner 點」的三角形。碰到輪廓的
 *   薄三角形若在此丟掉會侵蝕剪影邊緣（凹角尖端更沒有鄰居可併）——那些等 Ruppert
 *   補點後，T3 再做一次 sliver 清理。
 */

import { triangleMinAngleDeg, triangleSignedArea, triVerts } from './geometry';
import type { MeshBuffers, RawMesh } from './triangulate';

export function removeSlivers(mesh: RawMesh, minArea: number, minAngleDeg: number): MeshBuffers {
  const { positions, indices, boundaryCount } = mesh;
  const triCount = indices.length / 3;
  const isInterior = (v: number): boolean => v >= boundaryCount;

  const drop = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const [ax, ay, bx, by, cx, cy] = triVerts(positions, indices, t);
    if (Math.abs(triangleSignedArea(ax, ay, bx, by, cx, cy)) < minArea) {
      drop[t] = 1;
      continue;
    }
    if (minAngleDeg <= 0) continue;
    const a = indices[t * 3]!;
    const b = indices[t * 3 + 1]!;
    const c = indices[t * 3 + 2]!;
    if (!isInterior(a) || !isInterior(b) || !isInterior(c)) continue;
    if (triangleMinAngleDeg(ax, ay, bx, by, cx, cy) < minAngleDeg) drop[t] = 1;
  }

  // 壓掉孤立頂點，維持 positions.length / 2 == 實際 Particle 數。
  const remap = new Map<number, number>();
  const newPositions: number[] = [];
  const newIndices: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (drop[t]) continue;
    for (let k = 0; k < 3; k++) {
      const old = indices[t * 3 + k]!;
      let next = remap.get(old);
      if (next === undefined) {
        next = newPositions.length / 2;
        remap.set(old, next);
        newPositions.push(positions[old * 2]!, positions[old * 2 + 1]!);
      }
      newIndices.push(next);
    }
  }

  return { positions: newPositions, indices: newIndices };
}
