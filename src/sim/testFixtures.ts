/**
 * 求解器測試共用的 fixture（`SimCore.test.ts` 與 `World.test.ts`）——不經 mesh pipeline，
 * 讓求解器／多塊容器的測試獨立於管線。
 */

import type { SimMesh } from '../mesh';

/**
 * 手搭一張規則三角網格當測試 fixture（不經 mesh pipeline，讓求解器測試獨立）。
 * `nx × ny` 個頂點、間距 `s`，每個 cell 切兩個三角形（CCW，y 向下）。
 * 可選 `keepCell(i, j)`：只保留遮罩內的 cell（沒被任何三角形用到的頂點一併
 * 剔除、索引重編），用來刻凹形 fixture。
 */
export function gridMesh(
  nx: number,
  ny: number,
  s: number,
  keepCell: (i: number, j: number) => boolean = () => true,
): SimMesh {
  const idx = (i: number, j: number) => j * nx + i;
  const rawInd: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      if (!keepCell(i, j)) continue;
      rawInd.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
      rawInd.push(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
    }

  // 未用到的頂點剔除、其餘保持 row-major 順序重編（全保留時索引 = `j * nx + i`）。
  const used = new Set(rawInd);
  const remap = new Map<number, number>();
  const pos: number[] = [];
  for (let raw = 0; raw < nx * ny; raw++) {
    if (!used.has(raw)) continue;
    remap.set(raw, remap.size);
    pos.push((raw % nx) * s, Math.floor(raw / nx) * s);
  }
  const ind = rawInd.map((raw) => remap.get(raw)!);

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(ind);
  const restAreas = new Float64Array(indices.length / 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    restAreas[t / 3] =
      0.5 *
      ((positions[2 * b]! - positions[2 * a]!) * (positions[2 * c + 1]! - positions[2 * a + 1]!) -
        (positions[2 * b + 1]! - positions[2 * a + 1]!) * (positions[2 * c]! - positions[2 * a]!));
  }
  const uv = new Float32Array(positions.length);
  for (let k = 0; k < positions.length; k++) uv[k] = positions[k]! / (Math.max(nx, ny) * s);

  return { positions, indices, uv, restAreas };
}
