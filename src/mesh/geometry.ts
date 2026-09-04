/** 管線共用的平面幾何小工具。全部是無狀態純函式。 */

import type { Point } from './types';

/** 多邊形有號面積（shoelace）。CCW（y 向下座標系）為負、CW 為正。 */
export function signedPolygonArea(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * 從攤平的 `positions` + `indices` 取出第 `t` 個三角形的三頂點座標，
 * `[ax, ay, bx, by, cx, cy]`——可直接展開餵給 `triangleSignedArea` / `triangleMinAngleDeg`。
 */
export function triVerts(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  t: number,
): [number, number, number, number, number, number] {
  const a = indices[t * 3]!;
  const b = indices[t * 3 + 1]!;
  const c = indices[t * 3 + 2]!;
  return [
    positions[a * 2]!,
    positions[a * 2 + 1]!,
    positions[b * 2]!,
    positions[b * 2 + 1]!,
    positions[c * 2]!,
    positions[c * 2 + 1]!,
  ];
}

/** 三角形有號面積。 */
export function triangleSignedArea(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}

/** 三角形最小內角（度）。退化三角形回傳 0。 */
export function triangleMinAngleDeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const ab = Math.hypot(bx - ax, by - ay);
  const bc = Math.hypot(cx - bx, cy - by);
  const ca = Math.hypot(ax - cx, ay - cy);
  if (ab === 0 || bc === 0 || ca === 0) return 0;
  const angleA = Math.acos(clamp((ab * ab + ca * ca - bc * bc) / (2 * ab * ca), -1, 1));
  const angleB = Math.acos(clamp((ab * ab + bc * bc - ca * ca) / (2 * ab * bc), -1, 1));
  const angleC = Math.PI - angleA - angleB;
  return (Math.min(angleA, angleB, angleC) * 180) / Math.PI;
}

/**
 * 以 even-odd 規則判斷點是否落在一組環內部。外環 + 洞環一起丟進來即可：
 * 洞（奇偶相消）會自動被視為外部。點落在邊上時的結果不保證，呼叫端請自留容差。
 */
export function pointInRings(
  rings: readonly (readonly Point[])[],
  px: number,
  py: number,
): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      const straddles = a.y > py !== b.y > py;
      if (straddles && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** 點到線段的最短距離平方。 */
export function pointSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** 點到一組環所有邊的最短距離。 */
export function distanceToRings(
  rings: readonly (readonly Point[])[],
  px: number,
  py: number,
): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const d = pointSegmentDistanceSq(px, py, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * 攤平網格裡「壞」三角形的數量：最小內角 `< minAngleDeg` 或 |面積| `> maxArea`。
 * Ruppert 細化收斂後用它記錄殘餘（貼著 constrained segment、無法再補的少數例外）。
 */
export function countBadTriangles(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  minAngleDeg: number,
  maxArea: number,
): number {
  let bad = 0;
  for (let t = 0; t < indices.length / 3; t++) {
    const v = triVerts(positions, indices, t);
    if (
      triangleMinAngleDeg(...v) < minAngleDeg - 1e-6 ||
      Math.abs(triangleSignedArea(...v)) > maxArea + 1e-6
    ) {
      bad++;
    }
  }
  return bad;
}

/**
 * 三角形外心（外接圓圓心）。三頂點近共線（外接圓半徑發散）時回傳 `null`。
 * Ruppert 細化把「壞」三角形的外心當 Steiner 點插入。
 */
export function circumcenter(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): Point | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;
  return { x: ux, y: uy };
}

/**
 * 點 `p` 是否落在線段 `ab` 的直徑圓（以 `ab` 為直徑）內——即 Ruppert 的
 * encroachment 判定。等價於 `∠apb > 90°`，也就是 `(a−p)·(b−p) < 0`。
 * 端點本身（`p == a` 或 `p == b`）不算。
 */
export function encroachesSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  return (ax - px) * (bx - px) + (ay - py) * (by - py) < -1e-9;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
