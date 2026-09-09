/**
 * 第三方套件的最小型別宣告。`cdt2d`（MIT）、`simplify-js`（BSD-2-Clause）與
 * `omggif`（MIT）沒有隨附或發佈 `@types`，這裡只宣告本專案實際用到的簽章。
 * （`jpeg-js` 自帶 `index.d.ts`，不需要在這裡補。）
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

declare module 'omggif' {
  interface GifFrameInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    has_local_palette: boolean;
    palette_offset: number | null;
    palette_size: number;
    data_offset: number;
    data_length: number;
    /** GIF89a 透明色索引；沒有透明色時為 `null`。 */
    transparent_index: number | null;
    interlaced: boolean;
    delay: number;
    disposal: number;
  }

  /** 逐幀讀 GIF。本專案只用第一幀（見 issue #55：GIF 當靜圖用）。 */
  export class GifReader {
    constructor(buf: Uint8Array);
    readonly width: number;
    readonly height: number;
    numFrames(): number;
    loopCount(): number;
    frameInfo(frame: number): GifFrameInfo;
    /**
     * 把第 `frame` 幀解碼並貼進 `pixels`（長度必須 = width × height × 4）。
     * 透明像素**不寫入**——呼叫端須先把緩衝區清零，未寫入處 alpha 即為 0。
     */
    decodeAndBlitFrameRGBA(frame: number, pixels: Uint8Array | number[]): void;
    decodeAndBlitFrameBGRA(frame: number, pixels: Uint8Array | number[]): void;
  }

  interface GifWriterFrameOptions {
    palette?: number[];
    delay?: number;
    disposal?: number;
    transparent?: number;
  }
  interface GifWriterOptions {
    palette?: number[];
    background?: number;
    loop?: number;
  }
  /** 只有測試 fixture 用得到（造 GIF 位元組餵解碼器）。 */
  export class GifWriter {
    constructor(buf: Uint8Array, width: number, height: number, gopts?: GifWriterOptions);
    addFrame(
      x: number,
      y: number,
      w: number,
      h: number,
      indexedPixels: Uint8Array | number[],
      opts?: GifWriterFrameOptions,
    ): number;
    end(): number;
  }
}
