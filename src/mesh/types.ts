/**
 * Mesh pipeline 的型別。管線是純函式、決定性的：`buildSimMesh(pngBytes, params)`
 * 對同一組輸入永遠回傳深度相等的 `SimMesh`（見 GitHub issue #3 / ADR-0002、ADR-0005）。
 */

/** `buildSimMesh` 的可調參數。全部有預設值，呼叫端可只帶想改的欄位。 */
export interface BuildSimMeshParams {
  /** Alpha mask 降採樣後最長邊的上限（px）。預設 1024。 */
  maxMaskEdge: number;
  /** Alpha 二值化門檻，`alpha/255 >= threshold` 視為不透明。預設 0.5。 */
  alphaThreshold: number;
  /** Douglas–Peucker 簡化容差，單位為降採樣 mask 像素。預設 1.5。 */
  simplifyTolerance: number;
  /** 目標 Particle 數，決定內部 Steiner 點的間距。預設 350（落在 200–500）。 */
  targetParticleCount: number;
  /** 粗 sliver 清理：|有號面積| 小於此值（mask px²）的三角形一律丟棄。預設 0.5。 */
  minTriangleArea: number;
  /**
   * 粗 sliver 清理：最小內角小於此值（度）的三角形丟棄，但只在丟掉它不會讓任一
   * 頂點變孤點時（見 `slivers.ts`）。預設 15（對齊設計文件步驟 9）；設 0 可完全關閉。
   * Ruppert 細化（見下）跑在 sliver 清理之前，貼著 constrained segment 而無鄰可併的
   * 少數殘餘 sliver 由這一步收掉。
   */
  minTriangleAngleDeg: number;
  /**
   * Ruppert 品質細化的最小內角下界（度）。三角形最小角低於此值就補外心。
   * 預設 25（設計文件步驟 8 / ADR-0002）。設 0 可完全關閉細化。
   */
  refineMinAngleDeg: number;
  /**
   * Ruppert 品質細化的最大面積上界 = 此係數 × 內部點目標間距²。三角形面積超過就補外心。
   * 預設 2。設 `Infinity` 只留最小角準則。
   */
  refineMaxAreaFactor: number;
  /**
   * Ruppert 細化的回合數上限（終止保險）。尖銳的凹形輸入角可能讓細化無法完全收斂，
   * 撞到此上限就停，殘餘交給 sliver 清理。預設 30。
   */
  refineMaxPasses: number;
}

export const DEFAULT_PARAMS: BuildSimMeshParams = {
  maxMaskEdge: 1024,
  alphaThreshold: 0.5,
  simplifyTolerance: 1.5,
  targetParticleCount: 350,
  minTriangleArea: 0.5,
  minTriangleAngleDeg: 15,
  refineMinAngleDeg: 25,
  refineMaxAreaFactor: 2,
  refineMaxPasses: 30,
};

/**
 * 凍結拓撲的模擬網格。座標系為降採樣後的 mask 像素（原點左上、y 向下）；
 * 呼叫端（匯入模組）負責置中／縮放到世界座標。
 */
export interface SimMesh {
  /** 頂點座標，`[x0, y0, x1, y1, ...]`，長度 = 2 × 頂點數。 */
  positions: Float32Array;
  /** 三角形頂點索引，每 3 個一組，長度 = 3 × 三角形數。 */
  indices: Uint32Array;
  /**
   * 每頂點 UV，`[u0, v0, ...]`，= 頂點在原圖的正規化座標（`position / 圖片尺寸`）。
   * 基本落在 [0, 1]；貼畫框邊緣的剪影因輪廓外擴一圈，邊界頂點會略微超出（約 ±1/邊長）。
   * 不 clamp——UV 必須與 `positions` 同源，貼圖才對得齊。
   */
  uv: Float32Array;
  /** 每個三角形的靜止有號面積（mask px²），順序對齊 `indices`。 */
  restAreas: Float64Array;
}

/** 二值 alpha 遮罩：`data[y * width + x]` 為 1（不透明）或 0（透明）。 */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 平面點。管線內部用物件座標，邊界回傳前才攤平成 typed array。 */
export interface Point {
  x: number;
  y: number;
}
