/**
 * 簡化輪廓環 + 內部點 → constrained Delaunay 三角化（`cdt2d`），
 * 只留落在輪廓內的三角形（洞與外部切掉）。
 *
 * Ruppert 品質細化在 `refine.ts`，跑在這一步之後（見 issue #4 / ADR-0002）。
 * 這裡把 PSLG 組裝（`buildPslg`）與三角形過濾（`filterCells`）拆成具名匯出，
 * 讓細化那一步共用同一套量化去重與內外判斷，避免兩份會漂移的實作。
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
   * 前 `boundaryCount` 個頂點在 constrained segment 上（輪廓環頂點 + 細化時分裂出的
   * segment 中點）；其餘是內部 Steiner 點。sliver 清理靠這個界線避免侵蝕剪影邊緣。
   */
  boundaryCount: number;
}

/** 量化去重的網格精度：座標乘以此值後四捨五入當 key。`cdt2d` 對重複點很敏感。 */
export const POINT_QUANT = 16;

/** 量化後的點 key，用於跨管線一致地去重（不假設座標範圍）。 */
export function pointKey(x: number, y: number): string {
  return `${Math.round(x * POINT_QUANT)},${Math.round(y * POINT_QUANT)}`;
}

/** 平面直線圖（PSLG）：去重後的點、約束邊、以及「在約束邊上」的頂點數（排在最前）。 */
export interface Pslg {
  points: number[][];
  /** 約束邊 `[i, j]`，索引指向 `points`；`i, j < boundaryCount`。 */
  edges: number[][];
  boundaryCount: number;
}

/**
 * 由輪廓環（外環 + 洞環）與內部點組出 PSLG。輪廓頂點量化去重後排在最前，
 * 接著才是不與任何既有點重合的內部點。約束邊 = 每個環的相鄰頂點對。
 */
export function buildPslg(rings: readonly Point[][], interior: readonly Point[]): Pslg {
  const points: number[][] = [];
  const seen = new Map<string, number>();
  const indexOf = (x: number, y: number): number => {
    const key = pointKey(x, y);
    const hit = seen.get(key);
    if (hit !== undefined) return hit;
    const id = points.length;
    seen.set(key, id);
    points.push([x, y]);
    return id;
  };

  const edges: number[][] = [];
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

  return { points, edges, boundaryCount };
}

/**
 * 把 `cdt2d` 回傳的 cell 過濾成攤平 `indices`：重心落在輪廓內、且有號面積非零的才留。
 * `cdt2d({ exterior: false })` 已切掉洞與外部，這裡用重心再過濾一次當保險。
 */
export function filterCells(
  points: readonly number[][],
  cells: readonly number[][],
  rings: readonly (readonly Point[])[],
): number[] {
  const indices: number[] = [];
  for (const cell of cells) {
    const a = cell[0]!;
    const b = cell[1]!;
    const c = cell[2]!;
    const ax = points[a]![0]!;
    const ay = points[a]![1]!;
    const bx = points[b]![0]!;
    const by = points[b]![1]!;
    const cx = points[c]![0]!;
    const cy = points[c]![1]!;
    if (!pointInRings(rings, (ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
    if (triangleSignedArea(ax, ay, bx, by, cx, cy) === 0) continue;
    indices.push(a, b, c);
  }
  return indices;
}

/**
 * @param rings 簡化後輪廓環（外環 + 洞環），作為約束邊。
 * @param interior scatterInteriorPoints 產生的內部點。
 */
export function triangulate(rings: readonly Point[][], interior: readonly Point[]): RawMesh {
  const { points, edges, boundaryCount } = buildPslg(rings, interior);
  const cells = cdt2d(points, edges, { exterior: false });
  const positions: number[] = [];
  for (const p of points) positions.push(p[0]!, p[1]!);
  const indices = filterCells(points, cells, rings);
  return { positions, indices, boundaryCount };
}
