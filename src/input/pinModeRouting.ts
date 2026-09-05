/**
 * Pin 模式輸入轉接（issue #14 / T13，追加「點掉特定 Pin」）——控制面板開啟
 * 「Pin 模式」時，把原本會變成 Grab 的指標事件改成直接放 Pin，或者——如果點擊
 * 落在某個既有 Pin 附近——改成把那個 Pin 移除：
 *
 *  - `grab` 落在既有 Pin 的 `removeRadius` 內 → 轉成 `unpin`，用**那個 Pin 自己
 *    的 id**（不是這次手勢的 id）——直接點掉它，這是「移除特定 Pin」的手段。
 *  - 其餘 `grab` → `pin`（同座標、同 id，立即硬鎖，見 ADR-0004）。
 *  - `moveGrab`/`release` 原樣轉發——對一個已經是 Pin 的約束來說本來就是 no-op
 *    （`SimCore.applyInput` 只對未鎖的 Grab 處理這兩種事件），不用另外攔。
 *  - `tap` 被丟棄，避免快速點一下同時放 Pin 又戳一下（兩個手感衝突的效果疊在一起）。
 *
 * 純函式：不知道 DOM，也不碰 `SimCore`——目前的 Pin 清單由呼叫端（`JellySandbox`）
 * 從 `SimCore.listPins()` 讀出、跟移除半徑一起包進 `PinModeContext` 傳進來。
 */

import type { InputEvent, PinInfo, Point } from '../sim';

export interface PinModeContext {
  /** 目前所有作用中的 Pin（`SimCore.listPins()`）。 */
  pins: readonly PinInfo[];
  /** 點擊落在某個既有 Pin 這個世界座標半徑內（含邊界）→ 判定為「點掉它」。 */
  removeRadius: number;
}

/** `pinModeEnabled` 為 false 時原樣放行；為 true 時依上述規則轉換／丟棄。 */
export function routeForPinMode(
  event: InputEvent,
  pinModeEnabled: boolean,
  context: PinModeContext,
): InputEvent | null {
  if (!pinModeEnabled) return event;
  switch (event.type) {
    case 'grab': {
      const hit = nearestPinWithin(context.pins, event.x, event.y, context.removeRadius);
      if (hit) return { type: 'unpin', id: hit.id };
      return { type: 'pin', id: event.id, x: event.x, y: event.y };
    }
    case 'tap':
      return null;
    default:
      return event;
  }
}

/** `pins` 裡距離 `(x, y)` 最近、且落在 `radius` 內（含邊界）的那一個；沒有就回 `undefined`。 */
function nearestPinWithin(
  pins: readonly PinInfo[],
  x: number,
  y: number,
  radius: number,
): PinInfo | undefined {
  let best: PinInfo | undefined;
  let bestDist = radius;
  for (const pin of pins) {
    const d = distance(pin.point, x, y);
    if (d <= bestDist) {
      best = pin;
      bestDist = d;
    }
  }
  return best;
}

function distance(p: Point, x: number, y: number): number {
  return Math.hypot(p.x - x, p.y - y);
}
