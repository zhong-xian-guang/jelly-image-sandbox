/**
 * 「網格密度」拉霸（issue #89 / V3 T1-2，見 CONTEXT.md「網格密度」）的範圍、預設值，
 * 與效能退路的砍半規則。純函式、無 DOM——`JellySandbox` 在 `PerfMonitor` 降級那一幀
 * 呼叫 `halveMeshDensity` 壓拉霸，`ControlPanel` 只負責顯示。
 *
 * 拉霸值直接就是**下一次**匯入的 `targetParticleCount`（每塊的 Particle 數，不是
 * 單位面積密度）；場上的果凍網格已凍結，拉霸不影響它。
 */

import { DEFAULT_PARAMS } from '../mesh';

import type { RangeSpec } from './ControlPanel';

/**
 * 100 還看得出是同一張圖的果凍（三角形明顯粗）；800 在一般裝置上仍跑得動、
 * 三角形明顯細密。步進 10 讓拉霸不會有「349 vs 350」這種沒意義的差異。
 */
export const MESH_DENSITY_RANGE: RangeSpec = { min: 100, max: 800, step: 10 };
/** 預設 = 管線預設的 `targetParticleCount`（350）——拉霸沒動過時匯入結果跟以前一樣。 */
export const DEFAULT_MESH_DENSITY = DEFAULT_PARAMS.targetParticleCount;

/**
 * 效能退路（issue #16 的「下次匯入砍半」改成壓拉霸，issue #89）：`max(下限, 目前值 ÷ 2
 * 向下對齊步進)`。以 `min` 為基準對齊（`min + k·step`），跟 `<input type=range>` 自己
 * 吸附的格點一致，這樣 `setMeshDensity` 灌回去的值不會被瀏覽器再挪一格。向下取整
 * 是刻意的——退路的目的是至少砍一半，寧可多砍 5 也不要少砍。
 */
export function halveMeshDensity(value: number, range: RangeSpec): number {
  const half = value / 2;
  const aligned = range.min + Math.floor((half - range.min) / range.step) * range.step;
  return Math.max(range.min, aligned);
}
