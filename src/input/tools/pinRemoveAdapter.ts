/**
 * Pin 工具的拔模式（issue #123 / V4 T2；橡皮擦沿用 issue #70 / V2 T3-6）的 adapter（issue #162
 * 從 `ToolRouter` 搬出）。
 *
 * `down` 拔掉 `PIN_REMOVE_RADIUS_PX`（螢幕像素）內最近的一顆；拖曳超過 Tap 的位移門檻後
 * （`ctx.passedDragThreshold`）變成橡皮擦，每次 `move` 拔掉 Pin 筆刷半徑內的所有 Pin（見 `eraseAt`）。
 * 單擊不當橡皮擦：不然點一下就會清掉一整圈，「精準地拔一顆」做不到。直接送 `unpin`，不送
 * `tap`——快速按放不觸發 Tap。
 *
 * 橡皮擦每次用注入的 `listPins()` 掃一遍場上的 Pin，落在「目前指標為圓心、筆刷半徑為半徑」的
 * 圓內就送 `unpin`——被清掉的 Pin 跟使用者自己點掉的完全一樣。每次手勢記一組本次已經送過
 * `unpin` 的 Pin id（`erasedPinIds`，含按下當下點掉的那一顆），`up`／`cancel` 時連同 session 一起
 * 丟掉。真實路徑上 `emit` 是同步進 `sim.applyInput` 的，下一次 `listPins()` 本來就讀不到已經清掉
 * 的那顆——但這條保證來自呼叫端的接線方式；擦除又是每次 `move` 都重掃一遍的高頻迴圈，多送一次
 * `unpin` 在別的接線方式下（例如事件先進佇列、下一幀才套用）就會變成重複事件寫進 Track。記一組
 * id 是這裡自己把這件事關死。
 *
 * 只作用於 Pin：不碰 `release`，所以抓取（含還跟著別的指標走的那些）完全不受影響。`up` 跟
 * `cancel` 同放模式：結束這一筆、不補擦；已經拔掉的不會變回來。
 */

import { nearestPinWithin, type PinInfo, type Point, type PointerId } from '../../sim';
import type { DragSession, ToolAdapter, ToolContext } from './ToolAdapter';

/**
 * 拔模式單擊「點掉最近一顆」的判定半徑，**螢幕像素**（issue #14 的點掉特定 Pin，issue #123
 * 從 `JellySandbox` 搬進來）——跟 `.jelly-pin-marker` 的 CSS 直徑（16px）同數量級。換算
 * 回世界座標要看目前相機縮放（見 `worldRadiusAt`），判定範圍才不會隨縮放忽大忽小。
 */
export const PIN_REMOVE_RADIUS_PX = 16;

/**
 * 進行中的一次拔模式手勢：`dragged` 設起來後才當橡皮擦。`erasedPinIds` 是這次手勢裡已經送過
 * `unpin` 的 **Pin** id（`PinInfo.id`，跟 `sessions` 的鍵——指標 id——是兩回事，只是在這個專案
 * 裡兩者共用 `PointerId` 這個型別），避免同一顆被重複送（見檔頭說明）。
 */
interface PinRemoveSession extends DragSession {
  erasedPinIds: Set<PointerId>;
}

export class PinRemoveAdapter implements ToolAdapter {
  /** 進行中的拔模式手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, PinRemoveSession>();

  constructor(private readonly ctx: ToolContext) {}

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    // 按下當下只拔點擊半徑（螢幕像素）內最近的一顆；拖曳開始後才當橡皮擦（issue #123）。
    const session: PinRemoveSession = {
      ...this.ctx.gestureStart(screenX, screenY, timeMs),
      dragged: false,
      erasedPinIds: new Set(),
    };
    this.sessions.set(id, session);
    const radius = this.worldRadiusAt(screenX, screenY);
    const hit = nearestPinWithin(this.ctx.listPins(), session.startWorld, radius);
    if (hit) {
      session.erasedPinIds.add(hit.id);
      this.emitUnpin(hit, radius);
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    // 沒有進行中的手勢就不作用——橡皮擦是「按住拖過去才擦」，不是滑過就擦。
    const session = this.sessions.get(id);
    if (!session || !this.ctx.passedDragThreshold(session, screenX, screenY)) return;
    this.eraseAt(this.ctx.project(screenX, screenY), session, this.worldRadiusAt(screenX, screenY));
  }

  up(id: PointerId): void {
    this.sessions.delete(id);
  }

  cancel(id: PointerId): void {
    this.sessions.delete(id);
  }

  /**
   * 螢幕上 `PIN_REMOVE_RADIUS_PX` 像素在 `(screenX, screenY)` 這裡等於多少世界單位。相機只有
   * 平移＋等比縮放，所以量水平方向一段就夠了；這樣不必另外注入相機縮放，投影本身就帶著它。
   */
  private worldRadiusAt(screenX: number, screenY: number): number {
    const a = this.ctx.project(screenX, screenY);
    const b = this.ctx.project(screenX + PIN_REMOVE_RADIUS_PX, screenY);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /**
   * 擦一次。掃一遍 `listPins()`，凡是落在以 `center` 為圓心、Pin 筆刷半徑為半徑的圓內、且本次
   * 手勢還沒處理過的 Pin，就送一次 `unpin` 並記進 `session.erasedPinIds`。
   *
   * 邊界用 `<=`：半徑滑桿上的數字就是「這一圈裡面的都會被擦掉」，剛好壓在圈上的那顆算在裡面
   * 才符合圓圈視覺提示給人的預期。
   *
   * 刻意分兩段（先挑出 id、再逐一 emit）：呼叫端的 `emit` 通常是同步進 `sim.applyInput`，第一顆
   * `unpin` 送出去的當下場上的 Pin 清單就已經變了。邊走邊 emit 的話，如果 `listPins()` 回傳的是
   * 內部那份清單本身（而不是每次都新配的快照），迴圈就會邊跑邊被抽掉元素、漏掉後面幾顆。
   *
   * `matchRadius` 是送出的 `unpin` 用來對準那顆 Pin 的容許距離（點擊半徑換算成世界單位，見
   * `emitUnpin`），跟筆刷半徑無關。
   */
  private eraseAt(center: Point, session: PinRemoveSession, matchRadius: number): void {
    const radius = Math.max(0, this.ctx.params.get('pinBrushRadius'));
    const hits: PinInfo[] = [];
    for (const pin of this.ctx.listPins()) {
      if (session.erasedPinIds.has(pin.id)) continue;
      if (Math.hypot(pin.point.x - center.x, pin.point.y - center.y) > radius) continue;
      session.erasedPinIds.add(pin.id);
      hits.push(pin);
    }
    for (const pin of hits) this.emitUnpin(pin, matchRadius);
  }

  /**
   * 拔掉 `pin`（issue #154）：`unpin` 帶它的**世界座標**而不是 id——播放時 id 會被 Track 前綴
   * 改寫、片段初始 Pin 也另有 id，只有位置每次都一樣。`radius` 是對準用的容許距離（拔模式的
   * 點擊半徑換算成世界單位），附近有好幾顆時求解器拔最近的那一顆。
   */
  private emitUnpin(pin: PinInfo, radius: number): void {
    this.ctx.emit({ type: 'unpin', x: pin.point.x, y: pin.point.y, radius });
  }
}
