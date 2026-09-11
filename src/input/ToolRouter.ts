/**
 * `ToolRouter`（issue #65 / V2 T3-1）——沙盒工具切換的地基，取代 `PointerInput`
 * 原本直接持有的 `GestureTracker`。
 *
 * ADR-0011：「目前工具」選擇器只涵蓋新增的沙盒工具（電風扇／編隊抓取／撒
 * Pin／移除 Pin），Grab／Pin／Tap 三個既有操作維持純手勢辨識、不進選擇器。
 * 這張票本身不新增任何工具行為——`ToolId` 目前只有 `'general'`（＝維持既有
 * 手勢），`down`/`move`/`up`/`cancel` 在這個狀態下原封不動委派給內部持有的
 * `GestureTracker`，不修改 `GestureTracker` 本身。後續四個工具會在這裡加上
 * 對應的 `ToolId` 分支。
 */

import type { PointerId } from '../sim';
import { GestureTracker, type GestureTrackerOptions } from './GestureTracker';

/** 目前唯一的值 `'general'`＝既有 Grab/Pin/Tap 手勢（ADR-0011 的「一般操作」）。 */
export type ToolId = 'general';

export const DEFAULT_TOOL: ToolId = 'general';

export type ToolRouterOptions = GestureTrackerOptions;

export class ToolRouter {
  private readonly gestureTracker: GestureTracker;
  private activeTool: ToolId = DEFAULT_TOOL;

  constructor(opts: ToolRouterOptions) {
    this.gestureTracker = new GestureTracker(opts);
  }

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
  }

  get currentTool(): ToolId {
    return this.activeTool;
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.activeTool === 'general') this.gestureTracker.down(id, screenX, screenY, timeMs);
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    if (this.activeTool === 'general') this.gestureTracker.move(id, screenX, screenY);
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.activeTool === 'general') this.gestureTracker.up(id, screenX, screenY, timeMs);
  }

  cancel(id: PointerId): void {
    if (this.activeTool === 'general') this.gestureTracker.cancel(id);
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數）——比照 `GestureTracker.activeCount`。 */
  get activeCount(): number {
    return this.gestureTracker.activeCount;
  }
}
