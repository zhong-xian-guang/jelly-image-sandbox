/**
 * Demo 腳本用的純幾何小工具——只吃 `sim.positions`（`[x0,y0,x1,y1,...]`），不碰
 * `SimCore`。讓 Demo 能在「目前這個」Jelly 的實際形狀上找角、找中心，而不是套用
 * 寫死座標（非矩形、匯入後大小不一的圖片都要能跑）。
 */

import type { Point } from '../../sim';

/**
 * 沿 `(dirX, dirY)` 方向最靠邊緣的 Particle（例如 `(1,1)` = 右下角、`(-1,-1)` =
 * 左上角）。回傳的是實際存在的 Particle 座標——保證 `grab`/`pin` 在該點一定
 * picking 得到（不會落在非矩形形狀的空白角落）。
 */
export function extremeParticle(positions: Float64Array, dirX: number, dirY: number): Point {
  const n = positions.length / 2;
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[2 * i]!;
    const y = positions[2 * i + 1]!;
    const score = x * dirX + y * dirY;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { x: positions[2 * bestIdx]!, y: positions[2 * bestIdx + 1]! };
}

/** 所有 Particle 位置的平均（同 `SimCore.centroid()`，但只吃位置陣列）。 */
export function centroidOf(positions: Float64Array): Point {
  const n = positions.length / 2;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += positions[2 * i]!;
    my += positions[2 * i + 1]!;
  }
  return { x: mx / n, y: my / n };
}

/** 目前包圍盒的對角線長度——用來把「拉到多遠」換算成跟這個 Jelly 大小成比例的位移。 */
export function bboxDiagonal(positions: Float64Array): number {
  const n = positions.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[2 * i]!;
    const y = positions[2 * i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

export function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * 「抓一角、往中心的反方向拉開」這個模式（拉到極限放開／用力甩／Pin+拉一角三個
 * Demo 共用）：找出 `cornerDir` 方向那個角，沿「中心→該角」方向再往外延伸
 * `factor` 倍對角線長度，回傳角本身跟延伸後的目標點。
 */
export function dragTargetFromCorner(
  positions: Float64Array,
  cornerDir: Point,
  factor: number,
): { corner: Point; target: Point } {
  const corner = extremeParticle(positions, cornerDir.x, cornerDir.y);
  const center = centroidOf(positions);
  const diag = bboxDiagonal(positions);
  const dir = normalize({ x: corner.x - center.x, y: corner.y - center.y });
  return { corner, target: { x: corner.x + dir.x * diag * factor, y: corner.y + dir.y * diag * factor } };
}

/** 把 `center + v` 繞 `center` 轉 `angle` 弧度後的點——雙點扭轉 Demo 用來畫圓弧軌跡。 */
export function rotateAround(v: Point, angle: number, center: Point): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + v.x * cos - v.y * sin,
    y: center.y + v.x * sin + v.y * cos,
  };
}
