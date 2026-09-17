/**
 * 匯入尺寸縮放（issue #88 / V3 T1-1，見 CONTEXT.md「匯入尺寸」）——網格管線
 * **之後**的獨立一步：把 `buildSimMesh` 輸出的 mask 像素座標網格等比縮放到
 * 「bbox 最長邊 = 目標世界長度」。
 *
 * 刻意**不是** `BuildSimMeshParams` 的欄位：那些參數全部進種子雜湊（ADR-0005），
 * 加欄位會讓舊片段檔的種子改變、網格不再決定性重現。所以匯入尺寸留在管線外，
 * 由匯入層（`JellySandbox`）在 `buildSimMesh` 之後、建 `SimCore` 之前呼叫。
 *
 * 縮放以原點為錨（mask 座標原點在左上），不置中——相機會 zoom-to-fit，Track
 * 座標系也不需要原點在中心；多塊 Jelly 的擺放位置（ADR-0013）另外處理平移。
 */

import type { SimMesh } from './types';

/**
 * 純函式：回傳新的 `SimMesh`，`positions` × s、`restAreas` × s²，`indices` 與 `uv`
 * 原樣拷貝；不就地修改輸入。s = `targetLongestEdge ÷ bbox 最長邊`（寬高相等時任一
 * 邊）。退化 bbox（最長邊為 0，例如所有頂點重合）沒有可縮放的尺度，原樣回傳。
 */
export function scaleMeshToLongestEdge(mesh: SimMesh, targetLongestEdge: number): SimMesh {
  const longest = longestBBoxEdge(mesh.positions);
  if (!(longest > 0)) return mesh;
  const s = targetLongestEdge / longest;

  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = mesh.positions[i]! * s;
  const restAreas = new Float64Array(mesh.restAreas.length);
  const s2 = s * s;
  for (let i = 0; i < restAreas.length; i++) restAreas[i] = mesh.restAreas[i]! * s2;

  return {
    positions,
    indices: mesh.indices.slice(),
    uv: mesh.uv.slice(),
    restAreas,
  };
}

function longestBBoxEdge(positions: Float32Array): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}
