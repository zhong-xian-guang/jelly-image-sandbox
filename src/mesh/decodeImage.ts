/** PNG 位元組 → 每像素 alpha（0–255）。管線只需要 alpha 通道；貼圖走 GPU、不經這裡。 */

import { decode } from 'fast-png';

export interface DecodedAlpha {
  width: number;
  height: number;
  /** `alpha[y * width + x]`，0（全透明）–255（全不透明）。 */
  alpha: Uint8Array;
}

/**
 * 解碼 PNG 並取出 alpha 平面。支援灰階／灰階+alpha／RGB／RGBA 與調色盤（含 tRNS）；
 * 16-bit 深度會降到 8-bit。沒有 alpha 資訊的影像一律視為完全不透明。
 */
export function decodePngAlpha(bytes: Uint8Array | ArrayBuffer): DecodedAlpha {
  const png = decode(bytes);
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
