/**
 * Walled 邊界範圍（issue #14 / T13）——切到「有牆」時，圍著 Jelly 目前 bbox
 * 展開一個正方形範圍當 `WalledBoundary` 的 AABB，給甩動留空間，同時仍然是
 * 有限大小（見 `docs/design/simulation-and-mesh.md`：「Walled：有限大小的桌面，
 * 牆壁會擋住 Jelly」）。純函式、只依賴呼叫端傳入的 bbox，方便單元測試——
 * DOM／求解器接線在 `JellySandbox`。
 */

import type { Bbox } from '../sim';

/** Walled 範圍邊長 = Jelly bbox 較長邊 × 此係數，未指定 `sizeFactor` 時的預設值。 */
export const WALLED_SIZE_FACTOR = 4;

/**
 * 以 `bbox` 中心為中心、邊長 = `bbox` 較長邊 × `sizeFactor` 的正方形範圍。
 * `bbox` 退化（寬或高為 0，例如單點）時邊長 clamp 到至少 1，避免範圍塌成一點。
 */
export function computeWalledBounds(bbox: Bbox, sizeFactor = WALLED_SIZE_FACTOR): Bbox {
  const w = Math.max(bbox.maxX - bbox.minX, 1);
  const h = Math.max(bbox.maxY - bbox.minY, 1);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const half = (Math.max(w, h) * sizeFactor) / 2;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}
