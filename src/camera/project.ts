/**
 * Camera 的世界↔螢幕投影（issue #13 / T12）。純數學、不碰 DOM。
 *
 * 兩邊都吃 `CameraTransform`：`screen = (world − {x, y}) · scale + 畫布中心`。
 * 這是全專案唯一一份這個公式——`updateCamera` 的縮放定點換算、Renderer 的
 * container 定位、輸入層的 picking 換算都從這裡取，不各自重算（見 CONTEXT.md
 * 「Camera」：所有繪製與 picking 都經過它）。
 */

import type { CameraTransform, CanvasSize } from './types';

/** 世界座標 → 畫布局部座標（左上為原點）。算繪定位用。 */
export function worldToScreen(
  t: CameraTransform,
  canvas: CanvasSize,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: (worldX - t.x) * t.scale + canvas.width / 2,
    y: (worldY - t.y) * t.scale + canvas.height / 2,
  };
}

/** 上式的逆：畫布局部座標 → 世界座標。picking／拖曳／zoom-to-cursor 用。 */
export function screenToWorld(
  t: CameraTransform,
  canvas: CanvasSize,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - canvas.width / 2) / t.scale + t.x,
    y: (screenY - canvas.height / 2) / t.scale + t.y,
  };
}
