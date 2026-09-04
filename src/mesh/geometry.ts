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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
