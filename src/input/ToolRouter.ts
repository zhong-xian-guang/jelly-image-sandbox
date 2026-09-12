/**
 * `ToolRouter`（issue #65 / V2 T3-1）——沙盒工具切換的地基，取代 `PointerInput`
 * 原本直接持有的 `GestureTracker`。issue #66 / V2 T3-2 加上第一個新工具：電風扇。
 *
 * ADR-0011：「目前工具」選擇器只涵蓋新增的沙盒工具（電風扇／編隊抓取／撒
 * Pin／移除 Pin），Grab／Pin／Tap 三個既有操作維持純手勢辨識、不進選擇器。
 * `'general'` 下 `down`/`move`/`up`/`cancel` 原封不動委派給內部持有的
 * `GestureTracker`，不修改 `GestureTracker` 本身。後續三個工具會在這裡加上
 * 對應的 `ToolId` 分支。
 *
 * **電風扇**（issue #66；ADR-0010 v1 單一實例）：`down` 先問 `getFan` 場上目前
 * 有沒有風扇、世界座標是否落在它的矩形內（`isPointInFanRect`）——落在裡面＝
 * 「拖曳既有風扇」（`FanMoveSession`，issue #67 事後追加：使用者不必每次都
 * 重新用滑鼠定義方向／距離才能微調位置），落在外面（或本來就沒有風扇）＝
 * 「放置新風扇」（`FanPlaceSession`，原 issue #66 行為：`move` 不 emit，只
 * 更新內部預覽終點，`up` 用原點→放開點的位移算 `dirX`/`dirY`（正規化單位
 * 向量）與 `length`，連同目前的 `width`／`strength`／`falloffExponent`——
 * `setFanParams`，issue #67：面板三個滑桿即時寫入——送一次 `setFan`，取代
 * 場上既有的風扇，ADR-0010：整包覆蓋，不用先送 `clearFan`）。位移為 0（點一
 * 下沒拖曳）時退回 `(1, 0)` 當方向，避免除以 0；風扇這時 `length` 也是 0，
 * `SimCore.applyFan` 對 `length <= 0` 直接 no-op，等於沒有實際效果。
 *
 * 拖曳既有風扇（`FanMoveSession`）則相反：`down` 當下就先照按下點送一次
 * `setFan`（原方向／長度／寬度／強度／衰減不變，只有 `originX/originY` 換成
 * 按下點），`move` 每次都比照 `movePin`/`moveGrab` 的既有慣例即時送一次
 * （直接把 origin 設到目前指標的世界座標，不維持按下當下的相對位移），`up`
 * 在放開點再送最後一次收尾；三者共用 `emitFanMove`。
 *
 * `cancel`：放置中（`FanPlaceSession`）視為放棄這次放置，只清掉 `fanSessions`
 * 裡的紀錄，不 emit 任何事件（跟 `general` 底下放開一半的 Grab 不同——那邊
 * `cancel` 仍會 `release`，因為 Grab 已經是「活著」的約束；電風扇放置在 `up`
 * 之前完全沒有送出任何 `InputEvent`，沒有東西需要收回）。拖曳中
 * （`FanMoveSession`）則不同——每次 `move` 都已經即時把風扇挪過去了，`cancel`
 * 只是停止繼續跟隨指標，風扇留在目前的位置，不回捲到拖曳起點（比照 Grab 的
 * `cancel` 不回捲已經發生過的 `moveGrab`）。「移除風扇」按鈕不經過
 * `ToolRouter`——比照「清除所有 Pin」的模式，由 `JellySandbox` 直接對
 * `sim.applyInput({ type: 'clearFan' })`（見該檔 `removeFan`）。
 */

import { isPointInFanRect, type FanState, type PointerId, type Point } from '../sim';
import { GestureTracker, type GestureTrackerOptions } from './GestureTracker';

/** `'fan'`（issue #66）加進 ADR-0011 選擇器；`'general'` 維持既有 Grab/Pin/Tap 手勢。 */
export type ToolId = 'general' | 'fan';

export const DEFAULT_TOOL: ToolId = 'general';

/** 電風扇矩形的初始預設值（issue #66）——`setFanParams`（issue #67）可在執行期間覆寫。 */
export const DEFAULT_FAN_WIDTH = 150;
export const DEFAULT_FAN_STRENGTH = 4000;
/** 沿用 `SimCore.doTap` 既有的正規化距離冪次衰減慣例（`(1 − d/R)²`）。 */
export const DEFAULT_FAN_FALLOFF_EXPONENT = 2;

/** `setFanParams` 接受的部分更新——三個欄位皆可選，只覆寫有帶到的欄位。 */
export interface FanParams {
  width: number;
  strength: number;
  falloffExponent: number;
}

export interface ToolRouterOptions extends GestureTrackerOptions {
  /**
   * 場上目前的電風扇幾何（issue #67 追加）——`down` 落在既有風扇矩形內時，
   * 用它判斷該把這次手勢當「拖曳既有風扇」而非「放置新風扇」。不帶這個選項
   * （或回傳 `null`）等同「場上永遠沒有風扇」，一律走放置新風扇的既有行為
   * ——現有呼叫端／測試不用跟著改。
   */
  getFan?: () => FanState | null;
}

/** 放置新風扇進行中的狀態：世界座標原點 + 目前（拖曳中或放開時）的終點。 */
interface FanPlaceSession {
  mode: 'place';
  origin: Point;
  current: Point;
}

/**
 * 拖曳既有風扇進行中的狀態：`down` 當下拍下原風扇除了 `originX/originY` 以外
 * 的幾何／參數快照——拖曳全程只有原點跟著指標跑，其餘照舊。
 */
interface FanMoveSession {
  mode: 'move';
  dirX: number;
  dirY: number;
  length: number;
  width: number;
  strength: number;
  falloffExponent: number;
}

type FanSession = FanPlaceSession | FanMoveSession;

export class ToolRouter {
  private readonly gestureTracker: GestureTracker;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly emit: ToolRouterOptions['emit'];
  private readonly getFan: (() => FanState | null) | undefined;
  private activeTool: ToolId = DEFAULT_TOOL;
  /** 進行中的電風扇手勢（放置或拖曳），鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly fanSessions = new Map<PointerId, FanSession>();
  /**
   * 下一次電風扇放置要用的寬度／強度／衰減冪次（issue #67）——`setFanParams`
   * 由面板滑桿即時寫入；`emitFan` 每次 `up` 讀目前值，不需要等下一次 `setActiveTool`。
   */
  private fanWidth = DEFAULT_FAN_WIDTH;
  private fanStrength = DEFAULT_FAN_STRENGTH;
  private fanFalloffExponent = DEFAULT_FAN_FALLOFF_EXPONENT;

  constructor(opts: ToolRouterOptions) {
    this.gestureTracker = new GestureTracker(opts);
    this.screenToWorld = opts.screenToWorld;
    this.emit = opts.emit;
    this.getFan = opts.getFan;
  }

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
  }

  /**
   * 面板三個電風扇滑桿的即時寫入口（issue #67）——只覆寫有帶到的欄位。影響
   * **下一次**放置（`emitFan` 讀這幾個欄位）；「即時反映到場上目前的風扇」
   * 由呼叫端（`JellySandbox`）另外對 `sim.applyInput` 補送一次帶新參數、原幾何
   * 不變的 `setFan`——`ToolRouter` 不知道場上是否已有風扇，這件事不歸它管。
   */
  setFanParams(params: Partial<FanParams>): void {
    if (params.width !== undefined) this.fanWidth = params.width;
    if (params.strength !== undefined) this.fanStrength = params.strength;
    if (params.falloffExponent !== undefined) this.fanFalloffExponent = params.falloffExponent;
  }

  get currentTool(): ToolId {
    return this.activeTool;
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.down(id, screenX, screenY, timeMs);
      return;
    }
    if (this.activeTool === 'fan') {
      const world = this.screenToWorld(screenX, screenY);
      const fan = this.getFan?.() ?? null;
      if (fan && isPointInFanRect(fan, world)) {
        const session: FanMoveSession = {
          mode: 'move',
          dirX: fan.dirX,
          dirY: fan.dirY,
          length: fan.length,
          width: fan.width,
          strength: fan.strength,
          falloffExponent: fan.falloffExponent,
        };
        this.fanSessions.set(id, session);
        this.emitFanMove(world, session);
      } else {
        this.fanSessions.set(id, { mode: 'place', origin: world, current: world });
      }
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.move(id, screenX, screenY);
      return;
    }
    if (this.activeTool === 'fan') {
      const session = this.fanSessions.get(id);
      if (!session) return;
      const world = this.screenToWorld(screenX, screenY);
      if (session.mode === 'move') {
        this.emitFanMove(world, session);
      } else {
        session.current = world;
      }
    }
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.up(id, screenX, screenY, timeMs);
      return;
    }
    if (this.activeTool === 'fan') {
      const session = this.fanSessions.get(id);
      if (!session) return;
      this.fanSessions.delete(id);
      const world = this.screenToWorld(screenX, screenY);
      if (session.mode === 'move') {
        this.emitFanMove(world, session);
      } else {
        this.emitFanPlace(session.origin, world);
      }
    }
  }

  cancel(id: PointerId): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.cancel(id);
      return;
    }
    // 放置中：放棄這次放置，不 emit 任何事件。拖曳中：`move` 已經即時把風扇挪
    // 過去了，這裡只是停止跟隨指標，風扇留在目前位置（見類別頂端說明）。
    if (this.activeTool === 'fan') this.fanSessions.delete(id);
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數，一般操作限定）——比照 `GestureTracker.activeCount`。 */
  get activeCount(): number {
    return this.gestureTracker.activeCount;
  }

  private emitFanPlace(origin: Point, current: Point): void {
    const dx = current.x - origin.x;
    const dy = current.y - origin.y;
    const length = Math.hypot(dx, dy);
    const [dirX, dirY] = length > 1e-9 ? [dx / length, dy / length] : [1, 0];
    this.emit({
      type: 'setFan',
      originX: origin.x,
      originY: origin.y,
      dirX,
      dirY,
      length,
      width: this.fanWidth,
      strength: this.fanStrength,
      falloffExponent: this.fanFalloffExponent,
    });
  }

  /** 拖曳既有風扇：原點換成 `at`，其餘沿用 `down` 當下拍下的快照。 */
  private emitFanMove(at: Point, session: FanMoveSession): void {
    this.emit({
      type: 'setFan',
      originX: at.x,
      originY: at.y,
      dirX: session.dirX,
      dirY: session.dirY,
      length: session.length,
      width: session.width,
      strength: session.strength,
      falloffExponent: session.falloffExponent,
    });
  }
}
