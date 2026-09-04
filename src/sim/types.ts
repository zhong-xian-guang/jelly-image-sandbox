/**
 * 模擬核心（issue #5 / #6…）的型別。
 *
 * 求解器與 DOM／算繪無關，只吃 `SimMesh` + 參數、吐 Particle 位置與少數統計讀出。
 * 所有會影響模擬的輸入都走單一窄介面 `applyInput(event)`（ADR-0005）：T4 實作
 * `grab` / `moveGrab` / `release`，T5 加 `pin` / `unpin` / `movePin`，T7 加 `tap`。
 * 相機**不**進求解器——手動相機輸入是另一條獨立的流（`CameraCommand`，見
 * `src/camera/`）；v2 錄製器在外層把兩條流併起來錄放。
 */

import type { Point } from '../mesh';

export type { Point };

/** 指標／觸點識別碼。多指 = 多個並存的 Grab，各自獨立。 */
export type PointerId = number | string;

/**
 * `applyInput` 接受的事件。`id` 是指標／約束識別碼；Grab 與 Pin 共用同一個 `id`
 * 命名空間（一條約束在其生命期內 id 不變）。
 *
 * - `grab`：在世界座標 `(x, y)` 抓住 Jelly 表面那一點（picking → 三角形 + 重心座標）。
 *   `radius` 是「點落在所有三角形外」時退回吸附最近 Particle 的搜尋半徑；預設 =
 *   靜止 bbox 對角線 × 0.1。半徑內沒有 Particle → 整個 grab 為 no-op（ADR-0003）。
 * - `moveGrab`：更新既有（未鎖）Grab 的目標點。找不到／已鎖時 no-op。
 * - `release`：解除該 `id` 的 Grab。**不會**解除 Pin（要用 `unpin`）。被抓的
 *   Particle 本身帶著拖曳速度 → 放開即是 Fling。
 * - `pin`：建立／轉成 Pin（目標點凍結、絕對硬鎖，ADR-0004）。帶 `(x, y)` = 在該
 *   座標 picking 建立；不帶座標 = 把該 `id` 既有的 Grab 就地凍結（不跳動）。
 * - `unpin`：解除該 `id` 的 Pin（未鎖的 Grab 不受影響）。
 * - `movePin`：把該 `id` 的 Pin 鎖定點移到 `(x, y)` 並在該處重新硬鎖。
 * - `tap`：在 `(x, y)` 施加一次性向內徑向脈衝（凹陷後彈回）。`strength` 預設
 *   `params.tapStrength`。半徑（目前 bbox 對角線 × 0.2）內無 Particle → no-op。
 *   無 `id`：Tap 不是持續狀態。
 */
export type InputEvent =
  | { type: 'grab'; id: PointerId; x: number; y: number; radius?: number }
  | { type: 'moveGrab'; id: PointerId; x: number; y: number }
  | { type: 'release'; id: PointerId }
  | { type: 'pin'; id: PointerId; x?: number; y?: number; radius?: number }
  | { type: 'unpin'; id: PointerId }
  | { type: 'movePin'; id: PointerId; x: number; y: number }
  | { type: 'tap'; x: number; y: number; strength?: number };

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
  /**
   * XPBD 細節層開關（shape-matching 之後、Grab/Pin 之前疊加）：每條邊一條 distance
   * 約束、每個三角形一條 signed-area 約束。補脊椎缺的局部拉伸擠壓彈性 + 第二道防翻面。
   * 預設 true。
   */
  xpbd: boolean;
  /** XPBD distance 約束的 compliance（越大越軟）。預設 1.5e-4（prototype）。 */
  distCompliance: number;
  /** XPBD signed-area 約束的 compliance（越大越軟）。預設 3e-3（prototype）。 */
  areaCompliance: number;
  /** `tap` 事件未帶 `strength` 時的預設脈衝強度。預設 6000（prototype 實測）。 */
  tapStrength: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  cellFrac: 0.15,
  alphaSm: 0.7,
  damping: 0.02,
  substeps: 4,
  grabBeta: 1,
  xpbd: true,
  distCompliance: 1.5e-4,
  areaCompliance: 3e-3,
  tapStrength: 6000,
};

/**
 * Jelly 表面上的一點：`tri`（三個 Particle 索引）+ 重心座標 `w`（和為 1）。
 * `pick(x, y)` 的回傳；輸入層拿它去建 Grab／Pin，或當作「指標是否落在 Jelly 上」的判定。
 */
export interface SurfacePoint {
  tri: readonly [number, number, number];
  w: readonly [number, number, number];
}

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

/**
 * 三角形有號面積比統計：`目前有號面積 / 靜止有號面積`，掃過所有非退化三角形
 * （|靜止面積| ≥ 1）。靜置時為 1；`min` ≤ 0 代表有三角形翻面。
 */
export interface AreaStats {
  min: number;
  max: number;
}
