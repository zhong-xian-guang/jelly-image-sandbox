/** 每像素 alpha → 降採樣後的二值遮罩，把網格成本與來源圖解析度脫鉤。 */

import type { Mask } from './types';

/**
 * 先用 box filter 把 alpha 降採樣到最長邊 `<= maxEdge`，再以 `avg/255 >= threshold`
 * 二值化。最長邊已在上限內時不縮放、直接二值化。輸出座標系為降採樣後的 mask 像素。
 */
export function toDownsampledMask(
  alpha: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  maxEdge: number,
  threshold: number,
): Mask {
  const longest = Math.max(srcWidth, srcHeight);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));
  const data = new Uint8Array(width * height);
  const cut = threshold * 255;

  if (width === srcWidth && height === srcHeight) {
    for (let i = 0; i < data.length; i++) data[i] = alpha[i]! >= cut ? 1 : 0;
    return { width, height, data };
  }

  // 每個 mask 像素蓋住來源的一塊矩形 [x0, x1) × [y0, y1)，取平均 alpha。
  for (let my = 0; my < height; my++) {
    const y0 = Math.floor((my * srcHeight) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((my + 1) * srcHeight) / height));
    for (let mx = 0; mx < width; mx++) {
      const x0 = Math.floor((mx * srcWidth) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((mx + 1) * srcWidth) / width));
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * srcWidth;
        for (let sx = x0; sx < x1; sx++) {
          sum += alpha[row + sx]!;
          count++;
        }
      }
      data[my * width + mx] = sum / count >= cut ? 1 : 0;
    }
  }

  return { width, height, data };
}
