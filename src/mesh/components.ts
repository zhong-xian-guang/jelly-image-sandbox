/** 只保留最大的不透明連通元件（v1 丟棄其餘塊；元件內的洞留給 marching squares）。 */

import type { Mask } from './types';

export interface LargestComponent {
  /** 與輸入同尺寸的遮罩，只有最大 4-連通元件的像素為 1。 */
  mask: Mask;
  /** 該元件的像素數。輸入無不透明像素時為 0。 */
  count: number;
}

/**
 * 對不透明像素做 4-連通標記，回傳只留最大元件的遮罩。
 * 掃描順序固定（列優先），因此結果是決定性的。
 */
export function largestOpaqueComponent(mask: Mask): LargestComponent {
  const { width, height, data } = mask;
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let best: number[] = [];
  let bestCount = 0;

  for (let start = 0; start < n; start++) {
    if (data[start] !== 1 || label[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = start;
    const members: number[] = [];

    while (head < tail) {
      const p = queue[head++]!;
      members.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0 && data[p - 1] === 1 && label[p - 1] === -1) {
        label[p - 1] = start;
        queue[tail++] = p - 1;
      }
      if (x < width - 1 && data[p + 1] === 1 && label[p + 1] === -1) {
        label[p + 1] = start;
        queue[tail++] = p + 1;
      }
      if (y > 0 && data[p - width] === 1 && label[p - width] === -1) {
        label[p - width] = start;
        queue[tail++] = p - width;
      }
      if (y < height - 1 && data[p + width] === 1 && label[p + width] === -1) {
        label[p + width] = start;
        queue[tail++] = p + width;
      }
    }

    if (members.length > bestCount) {
      bestCount = members.length;
      best = members;
    }
  }

  const out = new Uint8Array(n);
  for (const p of best) out[p] = 1;
  return { mask: { width, height, data: out }, count: bestCount };
}
