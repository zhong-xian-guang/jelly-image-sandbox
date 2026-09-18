/**
 * 邊界幾何換算與接觸常數（issue #14 / T13；issue #92 追加 Floor；issue #93 追加摩擦）
 * ——切邊界模式時從 Jelly 目前 bbox 算出該模式的幾何：
 *
 * - **Walled**：圍著 bbox 展開一個正方形範圍當 `WalledBoundary` 的 AABB，給甩動留
 *   空間，同時仍然是有限大小（見 `docs/design/simulation-and-mesh.md`：「Walled：
 *   有限大小的桌面，牆壁會擋住 Jelly」）。
 * - **Floor**：地板貼齊 bbox 底邊，切過去 Jelly 就已經站在地板上。
 *
 * 純函式、只依賴呼叫端傳入的 bbox，方便單元測試——DOM／求解器接線在 `JellySandbox`。
 */

import type { Bbox } from '../sim';

/** Walled 範圍邊長 = Jelly bbox 較長邊 × 此係數，未指定 `sizeFactor` 時的預設值。 */
export const WALLED_SIZE_FACTOR = 4;

/**
 * 牆與地板的切線摩擦（issue #93 / V3 T2-3；ADR-0012：固定手感值、不給拉霸、不進
 * 片段檔）。語意見 `ContactOptions.friction`；Walled 與 Floor 共用同一個值。實測
 * 見 `docs/design/simulation-and-mesh.md` 參數表。
 */
export const BOUNDARY_FRICTION = 0.3;

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

/**
 * Floor 邊界的地板高度（issue #92）：貼齊 `bbox` 底邊（世界 y 向下 → `maxY`），
 * 切換當下 Jelly 剛好站在地板上——不憑空掉一段、不半截埋進去。退化 bbox
 * （單點）同樣回 `maxY`，不需要另外處理。
 */
export function computeFloorY(bbox: Bbox): number {
  return bbox.maxY;
}
