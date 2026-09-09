/**
 * 影像位元組 → 每像素 alpha（0–255）。管線只需要 alpha 通道；貼圖走 GPU、不經這裡。
 *
 * `decodeImageAlpha` 嗅探 magic bytes 分派到 PNG / JPEG / GIF 三條純 JS 解碼路徑
 * （`fast-png` / `jpeg-js` / `omggif`，皆免 canvas、可在 vitest 無頭決定性重現，
 * 見 ADR-0005 / ADR-0009）：
 *
 * - **PNG**：既有 `decodePngAlpha`，完整支援灰階／RGB／RGBA／調色盤 + tRNS。
 * - **JPEG**：沒有 alpha 通道 → 整張矩形視為不透明（`alpha` 全 255）。
 * - **GIF**：只取第一幀（當靜圖用）；palette 的透明索引 → alpha 0，其餘 255。
 *
 * 無法辨識的 magic（webp / avif / bmp…）丟 `MeshPipelineError`——呼叫端已有
 * 「`console.warn` 後安靜略過、不動現有果凍」的處理（見 issue #12 / #55）。
 */

import { decode as decodePng } from 'fast-png';
import { decode as decodeJpeg } from 'jpeg-js';
import { GifReader } from 'omggif';

import { MeshPipelineError } from './errors';

export interface DecodedAlpha {
  width: number;
  height: number;
  /** `alpha[y * width + x]`，0（全透明）–255（全不透明）。 */
  alpha: Uint8Array;
}

/**
 * `jpeg-js` 的解析度上限（百萬像素）。預設 100，遠高於任何拿來當果凍的圖，只當
 * 「圖大到不合理就丟錯而非吃光記憶體」的保險（見 issue #55「丟錯而非回垃圾」）。
 */
const JPEG_MAX_RESOLUTION_MP = 100;

export type ImageFormat = 'png' | 'jpeg' | 'gif';

function toUint8(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function hasPrefix(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

/**
 * 從前幾個位元組判定影像格式。未知格式丟 `MeshPipelineError`。
 * `89 50 4E 47`＝PNG；`FF D8 FF`＝JPEG；`47 49 46 38`（`GIF8`）＝GIF87a/GIF89a。
 */
export function sniffImageFormat(bytes: Uint8Array | ArrayBuffer): ImageFormat {
  const u8 = toUint8(bytes);
  if (hasPrefix(u8, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (hasPrefix(u8, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (hasPrefix(u8, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  throw new MeshPipelineError('無法辨識的影像格式（只支援 PNG / JPEG / GIF）');
}

/** `ImageFormat` → 瀏覽器 `<img>` 能吃的 MIME（貼圖解碼用）。 */
export function imageFormatToMime(format: ImageFormat): 'image/png' | 'image/jpeg' | 'image/gif' {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
  }
}

/**
 * 嗅探格式並取出 alpha 平面。決定性、純函式、不碰 canvas。
 * 未知 magic 丟 `MeshPipelineError`；副檔名對但內容壞掉的圖同樣丟 `MeshPipelineError`
 * （而非回垃圾資料）。
 */
export function decodeImageAlpha(bytes: Uint8Array | ArrayBuffer): DecodedAlpha {
  const u8 = toUint8(bytes);
  switch (sniffImageFormat(u8)) {
    case 'png':
      return decodePngAlpha(u8);
    case 'jpeg':
      return decodeJpegAlpha(u8);
    case 'gif':
      return decodeGifAlpha(u8);
  }
}

/**
 * 解碼 PNG 並取出 alpha 平面。支援灰階／灰階+alpha／RGB／RGBA 與調色盤（含 tRNS）；
 * 16-bit 深度會降到 8-bit。沒有 alpha 資訊的影像一律視為完全不透明。
 */
export function decodePngAlpha(bytes: Uint8Array | ArrayBuffer): DecodedAlpha {
  const png = decodePng(bytes);
  const { width, height, channels, depth } = png;
  const src = png.data;
  const pixels = width * height;
  const alpha = new Uint8Array(pixels);
  const shift = depth === 16 ? 8 : 0;

  if (png.palette) {
    // 調色盤：tRNS 給前若干個索引的 alpha，其餘不透明。
    const trns = png.transparency;
    for (let i = 0; i < pixels; i++) {
      const idx = src[i * channels]! >> shift;
      alpha[i] = trns && idx < trns.length ? trns[idx]! : 255;
    }
    return { width, height, alpha };
  }

  switch (channels) {
    case 4: // RGBA
      for (let i = 0; i < pixels; i++) alpha[i] = src[i * 4 + 3]! >> shift;
      break;
    case 2: // 灰階 + alpha
      for (let i = 0; i < pixels; i++) alpha[i] = src[i * 2 + 1]! >> shift;
      break;
    case 1: // 灰階：tRNS 可指定單一透明灰值
    case 3: {
      // RGB：tRNS 可指定單一透明色
      const trns = png.transparency;
      if (trns && channels === 1) {
        const key = trns[0]! >> shift;
        for (let i = 0; i < pixels; i++) alpha[i] = src[i]! >> shift === key ? 0 : 255;
      } else if (trns && channels === 3) {
        const kr = trns[0]! >> shift;
        const kg = trns[1]! >> shift;
        const kb = trns[2]! >> shift;
        for (let i = 0; i < pixels; i++) {
          const r = src[i * 3]! >> shift;
          const g = src[i * 3 + 1]! >> shift;
          const b = src[i * 3 + 2]! >> shift;
          alpha[i] = r === kr && g === kg && b === kb ? 0 : 255;
        }
      } else {
        alpha.fill(255);
      }
      break;
    }
    default:
      alpha.fill(255);
  }

  return { width, height, alpha };
}

/**
 * 解碼 JPEG 並回傳「整張矩形都不透明」的 alpha 平面。JPEG 沒有 alpha 通道，
 * 所以匯入 JPEG＝整張照片變成一塊矩形果凍（見 issue #55 驗收條件）。
 */
export function decodeJpegAlpha(bytes: Uint8Array | ArrayBuffer): DecodedAlpha {
  let img: { width: number; height: number };
  try {
    img = decodeJpeg(toUint8(bytes), {
      useTArray: true,
      maxResolutionInMP: JPEG_MAX_RESOLUTION_MP,
    });
  } catch (err) {
    throw new MeshPipelineError(`JPEG 解碼失敗：${(err as Error).message}`);
  }
  if (img.width <= 0 || img.height <= 0) throw new MeshPipelineError('JPEG 尺寸無效');
  const alpha = new Uint8Array(img.width * img.height);
  alpha.fill(255);
  return { width: img.width, height: img.height, alpha };
}

/**
 * 解碼 GIF 的**第一幀**並取出 alpha 平面（動畫 GIF 當靜圖用）。palette 的透明索引
 * 對應到 alpha 0、其餘 255；第一幀矩形外（GIF 邏輯畫布較大時）也算透明。
 */
export function decodeGifAlpha(bytes: Uint8Array | ArrayBuffer): DecodedAlpha {
  let reader: GifReader;
  try {
    reader = new GifReader(toUint8(bytes));
  } catch (err) {
    throw new MeshPipelineError(`GIF 解碼失敗：${(err as Error).message}`);
  }
  const { width, height } = reader;
  if (width <= 0 || height <= 0) throw new MeshPipelineError('GIF 尺寸無效');
  if (reader.numFrames() < 1) throw new MeshPipelineError('GIF 沒有任何影格');

  // 清零 → `decodeAndBlitFrameRGBA` 不寫入透明像素，未寫入處 alpha 保持 0。
  const rgba = new Uint8Array(width * height * 4);
  try {
    reader.decodeAndBlitFrameRGBA(0, rgba);
  } catch (err) {
    throw new MeshPipelineError(`GIF 第一幀解碼失敗：${(err as Error).message}`);
  }
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
  return { width, height, alpha };
}
