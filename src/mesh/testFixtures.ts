/**
 * 測試用的影像 fixture 產生器——把一個「這個像素不透明嗎」的 predicate 編成
 * PNG / GIF / JPEG 位元組，餵給 `decodeImage` / `buildSimMesh` 的測試。
 *
 * 不是產品程式碼；放在 `src/` 下是為了讓 `decodeImage.test.ts` 與
 * `buildSimMesh.test.ts` 共用同一份編碼手法（見 issue #55 code review：避免
 * 兩個測試檔各自抄一份 `gifFrom`）。
 */

import { encode as encodePng } from 'fast-png';
import { encode as encodeJpeg } from 'jpeg-js';
import { GifWriter } from 'omggif';

export type OpaquePredicate = (x: number, y: number) => boolean;

/** 圓盤 predicate：`(cx, cy)` 為圓心、`r` 為半徑（含邊）。 */
export const disc =
  (cx: number, cy: number, r: number): OpaquePredicate =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** predicate → RGBA PNG（不透明 alpha 255、透明 alpha 0；RGB 固定為一個橘色）。 */
export function pngFrom(width: number, height: number, opaque: OpaquePredicate): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 200;
      data[i + 1] = 120;
      data[i + 2] = 60;
      data[i + 3] = opaque(x, y) ? 255 : 0;
    }
  }
  return encodePng({ width, height, data, channels: 4, depth: 8 });
}

/** predicate → GIF（palette 索引 0 = 透明、1 = 不透明色；只有一幀）。 */
export function gifFrom(width: number, height: number, opaque: OpaquePredicate): Uint8Array {
  const palette = [0x000000, 0xc8783c];
  const indexed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) indexed[y * width + x] = opaque(x, y) ? 1 : 0;
  }
  const buf = new Uint8Array(width * height + 4096);
  const gw = new GifWriter(buf, width, height, { palette });
  gw.addFrame(0, 0, width, height, indexed, { transparent: 0 });
  return buf.subarray(0, gw.end());
}

/** 全不透明 JPEG（JPEG 沒有 alpha 通道，所以不吃 predicate）。 */
export function jpegFrom(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4).fill(128);
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255;
  return Uint8Array.from(encodeJpeg({ width, height, data }, 90).data);
}
