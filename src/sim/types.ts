/**
 * 模擬核心（T4 / GitHub issue #5）的型別。
 *
 * 求解器與 DOM／算繪無關，只吃 `SimMesh` + 參數、吐 Particle 位置與少數統計讀出。
 * 所有會影響模擬的輸入都走單一窄介面 `applyInput(event)`（ADR-0005）；T4 只實作
 * `grab` / `moveGrab` / `release`，`pin` / `tap` / … 由後續 ticket 擴充這個聯集。
 */

import type { Point } from '../mesh';

export type { Point };

/** 指標／觸點識別碼。多指 = 多個並存的 Grab，各自獨立。 */
export type PointerId = number | string;

/**
 * `applyInput` 接受的事件。T4 範圍：
 * - `grab`：在世界座標 `(x, y)` 抓住 Jelly 表面那一點（picking → 三角形 + 重心座標）。
 *   `radius` 是「點落在所有三角形外」時退回吸附最近 Particle 的搜尋半徑；預設 =
 *   靜止 bbox 對角線 × 0.1。半徑內沒有 Particle → 整個 grab 為 no-op（ADR-0003）。
 * - `moveGrab`：更新既有 Grab 的目標點。找不到該 `id` 時 no-op。
 * - `release`：解除該 `id` 的 Grab。被抓的 Particle 本身帶著拖曳速度 → 放開即是 Fling。
 */
export type InputEvent =
  | { type: 'grab'; id: PointerId; x: number; y: number; radius?: number }
  | { type: 'moveGrab'; id: PointerId; x: number; y: number }
  | { type: 'release'; id: PointerId };

/** 求解器的手感參數。全部有預設值，建構時可只帶想改的欄位。 */
export interface SimParams {
  /**
   * Region cell 邊長 = Jelly 對角線 × 此係數。Softness 的主旋鈕（越大越硬）。
   * 改這個之後要呼叫 `rebuildRegions()`。預設 0.15（prototype 手感實測）。
   */
  cellFrac: number;
  /** shape-matching 把位置拉向 goal 的混合係數 `α_sm`。預設 0.7。 */
  alphaSm: number;
  /** 每個 substep 的全域速度阻尼：`v *= (1 − damping)`。調到放手後約 1–2 秒靜止。預設 0.02。 */
  damping: number;
  /** 每次 `step(dt)` 的物理 substep 數（弱裝置降到 2）。預設 4。 */
  substeps: number;
  /** Grab 硬度 `β`：1 = 精準貼目標點、< 1 = 彈性把手。預設 1。 */
  grabBeta: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  cellFrac: 0.15,
  alphaSm: 0.7,
  damping: 0.02,
  substeps: 4,
  grabBeta: 1,
};

/** 軸對齊包圍盒（世界座標）。 */
export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 邊長拉伸比統計：`目前長度 / 靜止長度`。 */
export interface StretchStats {
  /** 所有 Sim mesh 邊中的最大拉伸比。 */
  max: number;
  /** 平均拉伸比（靜置時為 1）。 */
  avg: number;
}
