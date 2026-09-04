/**
 * 第三方套件的最小型別宣告。`cdt2d`（MIT）與 `simplify-js`（BSD-2-Clause）
 * 沒有隨附或發佈 `@types`，這裡只宣告本專案實際用到的簽章。
 */

declare module 'cdt2d' {
  interface Cdt2dOptions {
    /** 保留約束邊外側的三角形。設 false 可切掉洞與外部（本專案唯一用到的選項）。預設 true。 */
    exterior?: boolean;
  }
  /**
   * Constrained Delaunay 三角化。
   * @param points 點座標，`[[x, y], ...]`。
   * @param edges 約束邊，`[[i, j], ...]`，索引指向 `points`。
   * @returns 三角形，`[[a, b, c], ...]`，索引指向 `points`。
   */
  function cdt2d(points: number[][], edges?: number[][], options?: Cdt2dOptions): number[][];
  export = cdt2d;
}

declare module 'simplify-js' {
  interface SimplifyPoint {
    x: number;
    y: number;
  }
  /**
   * Douglas–Peucker 多段線簡化（決定性）。
   * @param points 折線點。
   * @param tolerance 容差，與座標同單位。
   * @param highQuality 為 true 時跳過 radial-distance 預處理，品質較好。
   */
  function simplify<T extends SimplifyPoint>(
    points: T[],
    tolerance?: number,
    highQuality?: boolean,
  ): T[];
  export = simplify;
}
