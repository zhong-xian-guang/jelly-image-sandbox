/**
 * 手刻 marching squares：二值遮罩 → 一組封閉輪廓環（外環 + 洞環）。
 *
 * 掃描範圍外擴一圈——遮罩外的取樣點一律當透明——所以貼著畫框邊緣的剪影
 * 也會得到閉合的輪廓（環會落在 `-0.5` 那一圈上，把整個剪影包住）。
 * 座標系為遮罩像素；環的繞向不保證，下游一律用 even-odd 判斷內外。
 */

import type { Point } from './types';

type Edge = 'T' | 'R' | 'B' | 'L';

/** 每個 4-bit case 的有向線段，以「內部在前進方向左側」為準（y 向下）。 */
const SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [Edge, Edge]>> = [
  [], // 0
  [['L', 'T']], // 1  TL
  [['T', 'R']], // 2  TR
  [['L', 'R']], // 3  TL TR
  [['R', 'B']], // 4  BR
  [
    ['L', 'T'],
    ['R', 'B'],
  ], // 5  TL BR（saddle：分開兩個對角）
  [['T', 'B']], // 6  TR BR
  [['L', 'B']], // 7  TL TR BR
  [['B', 'L']], // 8  BL
  [['B', 'T']], // 9  TL BL
  [
    ['T', 'R'],
    ['B', 'L'],
  ], // 10 TR BL（saddle：分開兩個對角）
  [['B', 'R']], // 11 TL TR BL
  [['R', 'L']], // 12 BR BL
  [['R', 'T']], // 13 TL BR BL
  [['T', 'L']], // 14 TR BR BL
  [], // 15
];

/** 傳回封閉輪廓環的陣列；每個環是首尾相接（不重複收尾點）的點序列。 */
export function traceContours(data: Uint8Array, width: number, height: number): Point[][] {
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : data[y * width + x]!;

  const stride = 2 * height + 8;
  const keyOf = (x2: number, y2: number): number => (x2 + 2) * stride + (y2 + 2);
  const edgePoint = (cx: number, cy: number, e: Edge): [number, number] => {
    switch (e) {
      case 'T':
        return [2 * cx + 1, 2 * cy];
      case 'R':
        return [2 * cx + 2, 2 * cy + 1];
      case 'B':
        return [2 * cx + 1, 2 * cy + 2];
      case 'L':
        return [2 * cx, 2 * cy + 1];
    }
  };

  const next = new Map<number, number>();
  const coord = new Map<number, Point>();

  for (let cy = -1; cy < height; cy++) {
    for (let cx = -1; cx < width; cx++) {
      const idx = at(cx, cy) + at(cx + 1, cy) * 2 + at(cx + 1, cy + 1) * 4 + at(cx, cy + 1) * 8;
      for (const [from, to] of SEGMENTS[idx]!) {
        const [fx, fy] = edgePoint(cx, cy, from);
        const [tx, ty] = edgePoint(cx, cy, to);
        const fk = keyOf(fx, fy);
        const tk = keyOf(tx, ty);
        next.set(fk, tk);
        coord.set(fk, { x: fx / 2, y: fy / 2 });
        coord.set(tk, { x: tx / 2, y: ty / 2 });
      }
    }
  }

  const loops: Point[][] = [];
  const visited = new Set<number>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop: Point[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !visited.has(k)) {
      visited.add(k);
      loop.push(coord.get(k)!);
      k = next.get(k);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
