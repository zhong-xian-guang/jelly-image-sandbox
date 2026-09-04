/**
 * 簡化輪廓環 + 內部點 → constrained Delaunay 三角化（`cdt2d`），
 * 只留落在輪廓內的三角形（洞與外部切掉）。尚不含 Ruppert 細化（見 issue #4）。
 */

import cdt2d from 'cdt2d';

import { pointInRings, triangleSignedArea } from './geometry';
import type { Point } from './types';

/** 攤平的三角網格緩衝：`positions` `[x0,y0,...]`、`indices` 每 3 個一組。 */
export interface MeshBuffers {
  positions: number[];
  indices: number[];
}

export interface RawMesh extends MeshBuffers {
  /**
   * 前 `boundaryCount` 個頂點來自輪廓環（約束邊上）；其餘是內部 Steiner 點。
   * sliver 清理靠這個界線避免侵蝕剪影邊緣。
   */
  boundaryCount: number;
}

/**
 * @param rings 簡化後輪廓環（外環 + 洞環），作為約束邊。
 * @param interior scatterInteriorPoints 產生的內部點。
 */
export function triangulate(rings: readonly Point[][], interior: readonly Point[]): RawMesh {
  const positions: number[] = [];
  const points: number[][] = [];
  const edges: number[][] = [];
  // 量化去重：cdt2d 對重複點很敏感。字串 key，不假設座標範圍。
  const seen = new Map<string, number>();
  const quant = 16;
  const indexOf = (x: number, y: number): number => {
    const key = `${Math.round(x * quant)},${Math.round(y * quant)}`;
    const hit = seen.get(key);
    if (hit !== undefined) return hit;
    const id = points.length;
    seen.set(key, id);
    points.push([x, y]);
    positions.push(x, y);
    return id;
  };

  for (const ring of rings) {
    const ids = ring.map((p) => indexOf(p.x, p.y));
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]!;
      const b = ids[(i + 1) % ids.length]!;
      if (a !== b) edges.push([a, b]);
    }
  }
  const boundaryCount = points.length;
  for (const p of interior) indexOf(p.x, p.y);

  const cells = cdt2d(points, edges, { exterior: false });

  const indices: number[] = [];
  for (const cell of cells) {
    const a = cell[0]!;
    const b = cell[1]!;
    const c = cell[2]!;
    const ax = positions[a * 2]!;
    const ay = positions[a * 2 + 1]!;
    const bx = positions[b * 2]!;
    const by = positions[b * 2 + 1]!;
    const cx = positions[c * 2]!;
    const cy = positions[c * 2 + 1]!;
    // cdt2d 的 exterior:false 已切掉洞／外部，這裡用重心再過濾一次當保險。
    if (!pointInRings(rings, (ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
    if (triangleSignedArea(ax, ay, bx, by, cx, cy) === 0) continue;
    indices.push(a, b, c);
  }

  return { positions, indices, boundaryCount };
}
