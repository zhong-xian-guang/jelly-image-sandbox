/**
 * 剛體擬合（issue #155「設為初始位置」）——一組點目前的位置相對 rest 位置，最接近的「平移＋
 * 旋轉」是多少：位置看質心、角度看整塊的最佳擬合旋轉（2D Kabsch：讓 Σ|R·(r − r̄) − (x − x̄)|²
 * 最小的 R，跟 shape matching 取旋轉同一套概念）。變形（拉伸、擠壓）不算進來——剩下的就是
 * 「這塊果凍整體被搬到哪、轉了幾度」。
 *
 * 每個點等權（Particle 質量相同）。純函式，不碰求解器狀態。
 */

import type { Point } from './types';

export interface RigidFit {
  /** rest 位置的質心。 */
  restCentroid: Point;
  /** 目前位置的質心。 */
  centroid: Point;
  /** 最佳擬合旋轉（弧度，`(−π, π]`，正值＝從 +x 往 +y 轉）。 */
  angle: number;
}

/** `rest`／`current` 都是 `[x0, y0, x1, y1, …]`，長度相同。 */
export function fitRigidTransform(rest: ArrayLike<number>, current: ArrayLike<number>): RigidFit {
  const n = rest.length / 2;
  const restCentroid = centroidOf(rest);
  const centroid = centroidOf(current);
  // 2×2 共變異 H = Σ (x − x̄)(r − r̄)ᵀ；2D 的最佳旋轉角 = atan2(H₂₁ − H₁₂, H₁₁ + H₂₂)。
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    const rx = rest[2 * i]! - restCentroid.x;
    const ry = rest[2 * i + 1]! - restCentroid.y;
    const cx = current[2 * i]! - centroid.x;
    const cy = current[2 * i + 1]! - centroid.y;
    dot += rx * cx + ry * cy;
    cross += rx * cy - ry * cx;
  }
  return { restCentroid, centroid, angle: Math.atan2(cross, dot) };
}

/** `[x0, y0, x1, y1, …]` 的質心（等權）——`World` 擺放有角度的 rest 時也用它。 */
export function centroidOf(points: ArrayLike<number>): Point {
  const n = points.length / 2;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += points[2 * i]!;
    y += points[2 * i + 1]!;
  }
  return { x: x / n, y: y / n };
}
