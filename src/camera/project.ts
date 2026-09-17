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

/**
 * 目前畫布橫向可視的世界 x 區間（issue #92）：把畫布左右緣投回世界座標，再以
 * `camera.x` 為中心向外擴 `overscan` 倍（`1` = 剛好可視範圍）。Floor 邊界的地板線
 * 左右無限，算繪端用它決定「畫多長才夠蓋住畫面」，相機平移／縮放／resize 時重算。
 * `scale = 0` 視為 1，避免除以零。
 */
export function visibleWorldSpanX(
  t: CameraTransform,
  canvasWidth: number,
  overscan = 1,
): { minX: number; maxX: number } {
  const safe = t.scale ? t : { ...t, scale: 1 };
  const canvas: CanvasSize = { width: canvasWidth, height: 0 };
  const left = screenToWorld(safe, canvas, 0, 0).x;
  const right = screenToWorld(safe, canvas, canvasWidth, 0).x;
  const half = ((right - left) / 2) * overscan;
  return { minX: safe.x - half, maxX: safe.x + half };
}
