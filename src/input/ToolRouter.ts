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
 * **電風扇**（issue #66；ADR-0010 v1 單一實例）：`down` 記世界座標原點；`move`
 * 不 emit，只更新內部的 `fanSessions`（該指標目前的拖曳終點，供 `up` 算方向／
 * 長度用——「僅更新內部預覽狀態，不逐步 emit，避免洗版」，見 issue #64 的
 * Implementation Decisions）；`up` 用原點→放開點的位移算 `dirX`/`dirY`（正規化
 * 單位向量）與 `length`，連同固定預設的 `width`／`strength`／`falloffExponent`
 * （面板數值調整留給下一張票 issue #67）送一次 `setFan`——取代場上既有的風扇
 * （ADR-0010：整包覆蓋，不用先送 `clearFan`）。位移為 0（點一下沒拖曳）時退回
 * `(1, 0)` 當方向，避免除以 0；風扇這時 `length` 也是 0，`SimCore.applyFan` 對
 * `length <= 0` 直接 no-op，等於沒有實際效果。`cancel` 視為放棄這次放置：只清掉
 * `fanSessions` 裡的紀錄，不 emit 任何事件（跟 `general` 底下放開一半的 Grab
 * 不同——那邊 `cancel` 仍會 `release`，因為 Grab 已經是「活著」的約束；電風扇在
 * `up` 之前完全沒有送出任何 `InputEvent`，沒有東西需要收回）。「移除風扇」按鈕
 * 不經過 `ToolRouter`——比照「清除所有 Pin」的模式，由 `JellySandbox` 直接對
 * `sim.applyInput({ type: 'clearFan' })`（見該檔 `removeFan`）。
 */

import type { PointerId, Point } from '../sim';
import { GestureTracker, type GestureTrackerOptions } from './GestureTracker';

/** `'fan'`（issue #66）加進 ADR-0011 選擇器；`'general'` 維持既有 Grab/Pin/Tap 手勢。 */
export type ToolId = 'general' | 'fan';

export const DEFAULT_TOOL: ToolId = 'general';

/** 電風扇矩形的固定預設值（issue #66）——寬度／強度／衰減冪次的面板調整留給 issue #67，這裡先寫死。 */
export const DEFAULT_FAN_WIDTH = 150;
export const DEFAULT_FAN_STRENGTH = 4000;
/** 沿用 `SimCore.doTap` 既有的正規化距離冪次衰減慣例（`(1 − d/R)²`）。 */
export const DEFAULT_FAN_FALLOFF_EXPONENT = 2;

export type ToolRouterOptions = GestureTrackerOptions;

/** 一次電風扇放置手勢進行中的狀態：世界座標原點 + 目前（拖曳中或放開時）的終點。 */
interface FanSession {
  origin: Point;
  current: Point;
}

export class ToolRouter {
  private readonly gestureTracker: GestureTracker;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly emit: ToolRouterOptions['emit'];
  private activeTool: ToolId = DEFAULT_TOOL;
  /** 進行中的電風扇放置手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly fanSessions = new Map<PointerId, FanSession>();

  constructor(opts: ToolRouterOptions) {
    this.gestureTracker = new GestureTracker(opts);
    this.screenToWorld = opts.screenToWorld;
    this.emit = opts.emit;
  }

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
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
      const origin = this.screenToWorld(screenX, screenY);
      this.fanSessions.set(id, { origin, current: origin });
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
      session.current = this.screenToWorld(screenX, screenY);
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
      const current = this.screenToWorld(screenX, screenY);
      this.emitFan(session.origin, current);
    }
  }

  cancel(id: PointerId): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.cancel(id);
      return;
    }
    if (this.activeTool === 'fan') this.fanSessions.delete(id); // 放棄這次放置，不 emit 任何事件
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數，一般操作限定）——比照 `GestureTracker.activeCount`。 */
  get activeCount(): number {
    return this.gestureTracker.activeCount;
  }

  private emitFan(origin: Point, current: Point): void {
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
      width: DEFAULT_FAN_WIDTH,
      strength: DEFAULT_FAN_STRENGTH,
      falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
    });
  }
}
