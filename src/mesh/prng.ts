/**
 * 有種子的決定性 PRNG 與位元組雜湊。整條 mesh 管線的隨機性（只有 Steiner 點抖動）
 * 都經由這裡，絕不碰 `Math.random` 或 wall-clock，讓 `(pngBytes, params)` → `SimMesh`
 * 可重現（ADR-0005）。
 */

import type { BuildSimMeshParams } from './types';

/**
 * mulberry32：32-bit 狀態的小型 PRNG，回傳 `[0, 1)` 的浮點數。
 * 同一個種子永遠產生同一串數列。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a 32-bit 雜湊。可串接：把上一段的輸出當 `seed` 傳入即可繼續累積。
 */
export function fnv1a32(bytes: ArrayLike<number>, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]! & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 由降採樣後的 alpha mask 位元組 + 完整網格參數導出 PRNG 種子（ADR-0005 的
 * 「種子 = hash(降採樣 alpha bytes + 網格參數)」）。參數依鍵名排序後才攤平，
 * 所以呼叫端物件的鍵序無關、日後 `BuildSimMeshParams` 增減欄位也會自動納入。
 */
export function deriveSeed(maskBytes: ArrayLike<number>, params: BuildSimMeshParams): number {
  const ordered = (Object.keys(params) as (keyof BuildSimMeshParams)[])
    .sort()
    .map((k) => params[k]);
  const maskHash = fnv1a32(maskBytes);
  const paramBytes = new Uint8Array(new Float64Array(ordered).buffer);
  return fnv1a32(paramBytes, maskHash);
}
