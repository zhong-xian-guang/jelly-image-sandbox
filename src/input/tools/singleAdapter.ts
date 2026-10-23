/**
 * 單點抓取（抓取工具的單點模式，原「一般操作」；issue #65 / #122）的 adapter（issue #161）：
 * `down`／`move`／`up`／`cancel` 原封不動委派給內部持有的 `GestureTracker`，不修改
 * `GestureTracker` 本身。沒有右鍵、沒有自己的滾輪（單點模式沒有數值，右鍵＋滾輪照舊縮放）。
 */

import type { PointerId } from '../../sim';
import { GestureTracker, type GestureTrackerOptions } from '../GestureTracker';
import type { ToolAdapter } from './ToolAdapter';

export class SingleAdapter implements ToolAdapter {
  private readonly tracker: GestureTracker;

  constructor(opts: GestureTrackerOptions) {
    this.tracker = new GestureTracker(opts);
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    this.tracker.down(id, screenX, screenY, timeMs);
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    this.tracker.move(id, screenX, screenY);
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    this.tracker.up(id, screenX, screenY, timeMs);
  }

  cancel(id: PointerId): void {
    this.tracker.cancel(id);
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數）——`ToolRouter.activeCount`。 */
  get activeCount(): number {
    return this.tracker.activeCount;
  }
}
