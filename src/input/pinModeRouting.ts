/**
 * Pin 模式輸入轉接（issue #14 / T13）——控制面板開啟「Pin 模式」時，把原本會變成
 * Grab 的指標事件改成直接放 Pin：`grab` → `pin`（同座標、同 id，立即硬鎖，見
 * ADR-0004）。`moveGrab`/`release` 原樣轉發——對一個已經是 Pin 的約束來說本來就
 * 是 no-op（`SimCore.applyInput` 只對未鎖的 Grab 處理這兩種事件），不用另外攔。
 * `tap` 被丟棄，避免快速點一下同時放 Pin 又戳一下（兩個手感衝突的效果疊在一起）。
 *
 * 純函式：不知道 DOM，也不碰 `SimCore`，方便單元測試；接線在 `JellySandbox`。
 */

import type { InputEvent } from '../sim';

/** `pinModeEnabled` 為 false 時原樣放行；為 true 時依上述規則轉換／丟棄。 */
export function routeForPinMode(event: InputEvent, pinModeEnabled: boolean): InputEvent | null {
  if (!pinModeEnabled) return event;
  switch (event.type) {
    case 'grab':
      return { type: 'pin', id: event.id, x: event.x, y: event.y };
    case 'tap':
      return null;
    default:
      return event;
  }
}
