/**
 * 在輪廓內撒抖動網格 Steiner 點當內部 Particle。間距由目標 Particle 數與輪廓面積
 * 推得；抖動用傳入的有種子 PRNG，所以同輸入同參數永遠得到同一組點（ADR-0005）。
 */

import { distanceToRings, pointInRings, signedPolygonArea } from './geometry';
import type { Point } from './types';

/**
 * 內部 Steiner 點的目標間距：由輪廓淨面積（外環扣洞環）與剩餘 Particle 預算推得。
 * Ruppert 細化的最大面積上界也以此為基準（`≈ 間距²`），兩邊用同一個數才一致。
 */
export function interiorSpacing(rings: readonly Point[][], targetCount: number): number {
  if (rings.length === 0) return 1;
  let area = Math.abs(signedPolygonArea(rings[0]!));
  for (let i = 1; i < rings.length; i++) area -= Math.abs(signedPolygonArea(rings[i]!));
  const contourVerts = rings.reduce((sum, r) => sum + r.length, 0);
  const interiorBudget = Math.max(1, targetCount - contourVerts);
  return Math.max(1, Math.sqrt(area / interiorBudget));
}

/**
 * @param rings 簡化後的輪廓環（外環 + 洞環），even-odd 內外。
 * @param targetCount 目標總 Particle 數（含輪廓頂點）。
 * @param rand `[0,1)` 的決定性亂數來源。
 * @returns 落在輪廓內、且離任何輪廓邊至少 ~0.4 間距的內部點。
 */
export function scatterInteriorPoints(
  rings: readonly Point[][],
  targetCount: number,
  rand: () => number,
): Point[] {
  if (rings.length === 0) return [];
  const outer = rings[0]!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const spacing = interiorSpacing(rings, targetCount);
  const margin = 0.4 * spacing;

  const points: Point[] = [];
  const cols = Math.ceil((maxX - minX) / spacing);
  const rows = Math.ceil((maxY - minY) / spacing);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const jx = (rand() - 0.5) * 0.8 * spacing;
      const jy = (rand() - 0.5) * 0.8 * spacing;
      const x = minX + c * spacing + jx;
      const y = minY + r * spacing + jy;
      if (!pointInRings(rings, x, y)) continue;
      if (distanceToRings(rings, x, y) < margin) continue;
      points.push({ x, y });
    }
  }
  return points;
}
