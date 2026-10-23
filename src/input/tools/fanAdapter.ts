/**
 * 電風扇（issue #66；ADR-0010 v1 單一實例）的 adapter（issue #161 從 `ToolRouter` 搬出）。
 *
 * `down` 先問 `getFan` 場上目前有沒有風扇、世界座標是否落在它的矩形內（`isPointInFanRect`）
 * ——落在裡面＝「拖曳既有風扇」（`FanMoveSession`，issue #67 事後追加：使用者不必每次都
 * 重新用滑鼠定義方向／距離才能微調位置），落在外面（或本來就沒有風扇）＝「放置新風扇」
 * （`FanPlaceSession`，原 issue #66 行為：`move` 不 emit，只更新內部預覽終點，`up` 用
 * 原點→放開點的位移算 `dirX`/`dirY`（正規化單位向量）與 `length`，連同目前的 `width`／
 * `strength`／`falloffExponent`／`frequency`——讀 `ToolParams`，issue #67：面板四個滑桿
 * 即時寫入——送一次 `setFan`，取代場上既有的風扇，ADR-0010：整包覆蓋，不用先送
 * `clearFan`）。位移為 0（點一下沒拖曳）時退回 `(1, 0)` 當方向，避免除以 0；風扇這時
 * `length` 也是 0，`SimCore.applyFan` 對 `length <= 0` 直接 no-op，等於沒有實際效果。
 *
 * 拖曳既有風扇（`FanMoveSession`）：`down` 當下拍下按下點與風扇原點的差
 * （`offsetX/offsetY = fan.origin − downWorld`）——**不**直接把 origin 設到指標位置，那樣
 * 不管按在矩形內哪裡，風扇中心都會瞬間跳到滑鼠下，手感很怪（issue #67 事後檢視回饋）。
 * 之後 `move`／`up` 都用「目前指標世界座標 + 這個 offset」算新原點，等於維持按下當下抓住的
 * 那一點跟指標的相對位置；`down` 當下 `emitFanMove` 算出來的原點因此精確等於原本的
 * `fan.originX/Y`，風扇不會因為按下就先跳一下。三者共用 `emitFanMove`。
 *
 * `cancel`：放置中視為放棄這次放置，只清掉 session，不 emit 任何事件（跟單點抓取放開一半的
 * Grab 不同——那邊 `cancel` 仍會 `release`，因為 Grab 已經是「活著」的約束；電風扇放置在
 * `up` 之前完全沒有送出任何 `InputEvent`，沒有東西需要收回）。拖曳中則不同——每次 `move`
 * 都已經即時把風扇挪過去了，`cancel` 只是停止繼續跟隨指標，風扇留在目前的位置，不回捲到
 * 拖曳起點（比照 Grab 的 `cancel` 不回捲已經發生過的 `moveGrab`）。「移除風扇」按鈕不經過
 * `ToolRouter`——由 `JellySandbox` 直接送 `clearFan`。
 *
 * **模式與右鍵**（issue #125 / V4 T4；spec #121「電風扇」）：模式不改左鍵，而是「按住右鍵＋
 * 滾輪要調哪個參數」——這由 `ToolRouter` 的滾輪退路依 `activeValueKey` 增減 `ToolParams`，
 * 所以這個 adapter 沒有自己的滾輪。右鍵單擊（`rightClick`）落在場上風扇的矩形內就 emit
 * `clearFan`——跟「移除風扇」按鈕同一個事件、經同一個 `emit`，所以錄製中照樣錄進 Track。
 * 按住右鍵期間滾過滾輪不算右鍵單擊（判定在 `CameraInput`），在風扇上調參數不會誤刪。
 */

import { isPointInFanRect, type Point, type PointerId } from '../../sim';
import type { ToolAdapter, ToolContext } from './ToolAdapter';

/** 放置新風扇進行中的狀態：世界座標原點 + 目前（拖曳中或放開時）的終點。 */
interface FanPlaceSession {
  mode: 'place';
  origin: Point;
  current: Point;
}

/**
 * 拖曳既有風扇進行中的狀態：`down` 當下拍下原風扇除了 `originX/originY` 以外的幾何／參數
 * 快照，以及按下點跟原點的相對位移 `offsetX/offsetY`（見檔頭說明）。
 */
interface FanMoveSession {
  mode: 'move';
  offsetX: number;
  offsetY: number;
  dirX: number;
  dirY: number;
  length: number;
  width: number;
  strength: number;
  falloffExponent: number;
  frequency: number;
}

type FanSession = FanPlaceSession | FanMoveSession;

export class FanAdapter implements ToolAdapter {
  /** 進行中的電風扇手勢（放置或拖曳），鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, FanSession>();

  constructor(private readonly ctx: ToolContext) {}

  down(id: PointerId, screenX: number, screenY: number): void {
    const world = this.ctx.project(screenX, screenY);
    const fan = this.ctx.getFan();
    if (fan && isPointInFanRect(fan, world)) {
      const session: FanMoveSession = {
        mode: 'move',
        offsetX: fan.originX - world.x,
        offsetY: fan.originY - world.y,
        dirX: fan.dirX,
        dirY: fan.dirY,
        length: fan.length,
        width: fan.width,
        strength: fan.strength,
        falloffExponent: fan.falloffExponent,
        frequency: fan.frequency,
      };
      this.sessions.set(id, session);
      this.emitFanMove(world, session);
    } else {
      this.sessions.set(id, { mode: 'place', origin: world, current: world });
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    const world = this.ctx.project(screenX, screenY);
    if (session.mode === 'move') {
      this.emitFanMove(world, session);
    } else {
      session.current = world;
    }
  }

  up(id: PointerId, screenX: number, screenY: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    const world = this.ctx.project(screenX, screenY);
    if (session.mode === 'move') {
      this.emitFanMove(world, session);
    } else {
      this.emitFanPlace(session.origin, world);
    }
  }

  cancel(id: PointerId): void {
    // 放置中：放棄這次放置，不 emit。拖曳中：停止跟隨，風扇留在目前位置（見檔頭說明）。
    this.sessions.delete(id);
  }

  /** 右鍵單擊落在場上風扇的矩形內＝移除風扇（issue #125）；點在外面或場上沒風扇不做事。 */
  rightClick(world: Point): void {
    const fan = this.ctx.getFan();
    if (fan && isPointInFanRect(fan, world)) this.ctx.emit({ type: 'clearFan' });
  }

  private emitFanPlace(origin: Point, current: Point): void {
    const dx = current.x - origin.x;
    const dy = current.y - origin.y;
    const length = Math.hypot(dx, dy);
    const [dirX, dirY] = length > 1e-9 ? [dx / length, dy / length] : [1, 0];
    const { params } = this.ctx;
    this.ctx.emit({
      type: 'setFan',
      originX: origin.x,
      originY: origin.y,
      dirX,
      dirY,
      length,
      width: params.get('fanWidth'),
      strength: params.get('fanStrength'),
      falloffExponent: params.get('fanFalloffExponent'),
      frequency: params.get('fanFrequency'),
    });
  }

  /** 拖曳既有風扇：原點 = 目前指標世界座標 + 按下當下拍下的 offset，其餘沿用快照。 */
  private emitFanMove(pointer: Point, session: FanMoveSession): void {
    this.ctx.emit({
      type: 'setFan',
      originX: pointer.x + session.offsetX,
      originY: pointer.y + session.offsetY,
      dirX: session.dirX,
      dirY: session.dirY,
      length: session.length,
      width: session.width,
      strength: session.strength,
      falloffExponent: session.falloffExponent,
      frequency: session.frequency,
    });
  }
}
