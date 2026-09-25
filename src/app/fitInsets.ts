/**
 * 取景避開介面（issue #138）：量出畫布邊上被介面蓋住多少，交給相機的 zoom-to-fit
 * （`CanvasSize.fitInsets`）——預設取景、自動跟隨、「框住果凍」時果凍不會被底部的播放控制條、
 * 相機按鈕、匯入提示，以及展開的側欄蓋住。只影響相機取景，不動模擬、不進片段檔。
 *
 * `coveredInsets` 是純函式（吃量好的矩形），`visibleRect` 是唯一碰 DOM 的地方；看不到的元素
 * （乾淨畫面藏起來、側欄收起）量出來是 `null`，不佔位置。
 */

import type { ScreenInsets } from '../camera';

/** 視窗座標的矩形（`getBoundingClientRect` 的子集）。 */
export interface ClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 疊在畫布上的介面：貼底的幾塊、貼左的幾塊；`null`＝目前看不到。 */
export interface CoveringUi {
  bottom: readonly (ClientRect | null)[];
  left: readonly (ClientRect | null)[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * 畫布（`canvas`，視窗座標）四邊被蓋住多寬：底邊扣到貼底那幾塊裡最高的上緣、左邊扣到貼左
 * 那幾塊裡最右的右緣；夾在 0 到畫布尺寸之間。上、右目前沒有東西蓋，恆為 0。
 */
export function coveredInsets(canvas: ClientRect, covering: CoveringUi): ScreenInsets {
  const height = canvas.bottom - canvas.top;
  const width = canvas.right - canvas.left;
  let bottom = 0;
  for (const r of covering.bottom) if (r) bottom = Math.max(bottom, canvas.bottom - r.top);
  let left = 0;
  for (const r of covering.left) if (r) left = Math.max(left, r.right - canvas.left);
  return { top: 0, right: 0, bottom: clamp(bottom, 0, height), left: clamp(left, 0, width) };
}

/** 元素目前在畫面上的矩形；沒有排版框（`display: none`、不在文件裡）或面積為 0 ＝ `null`。 */
export function visibleRect(element: Element): ClientRect | null {
  if (element.getClientRects().length === 0) return null;
  const r = element.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}
