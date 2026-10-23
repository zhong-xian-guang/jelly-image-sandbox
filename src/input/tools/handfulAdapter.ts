/**
 * 大把抓取（抓取工具的大把模式；issue #113 / V3 T4-1；ADR-0014）的 adapter（issue #162 從
 * `ToolRouter` 搬出）。
 *
 * 手勢跟單點抓取同形——`down`（落在 Jelly 上才算，同 `hitTest`）→ `grab{handfulRadius}`、
 * `move` → `moveGrab`、`up` → 快速按放（`isTap`，同一組門檻）先送 `tap{radius}`（打在按下點）
 * 再 `release`，`cancel` 只 `release`。id 直接用指標 id（`PointerInput` 每次按下都配新的），
 * 多指各自一把。半徑存在 `handfulRadius`（`ToolParams`，面板拉霸即時寫入），**按下當下**拍進
 * session——之後改半徑只影響下一把。把 N 顆展開的工作不在這裡：輸入層只送一個
 * `handfulRadius`，求解器依它決定性地挑出同一把（重播才一致）。按住途中切走工具，這一把仍照常
 * 跟隨、放開（分支在按下當下定下）。
 *
 * 右鍵＋滾輪調的大把抓取半徑由 `ToolRouter` 的滾輪退路處理（`activeValueKey`），這裡沒有自己的滾輪。
 */

import type { PointerId } from '../../sim';
import type { GestureStart } from '../GestureTracker';
import type { ToolAdapter, ToolContext } from './ToolAdapter';

/**
 * 進行中的一次大把抓取手勢：按下當下的定格（輕拍判定與 `tap` 座標用）+ 按下當下的半徑
 * （這一把的 `grab` 與可能的 `tap` 都用它，之後改拉霸不影響）。
 */
interface HandfulSession extends GestureStart {
  radius: number;
}

export class HandfulAdapter implements ToolAdapter {
  /** 進行中的大把抓取手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, HandfulSession>();

  constructor(private readonly ctx: ToolContext) {}

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const { ctx } = this;
    const start = ctx.gestureStart(screenX, screenY, timeMs);
    const world = start.startWorld;
    if (!ctx.hitTest(world)) return; // 背景拖曳 → 不歸求解器
    const radius = ctx.params.get('handfulRadius');
    this.sessions.set(id, { ...start, radius });
    ctx.emit({ type: 'grab', id, x: world.x, y: world.y, handfulRadius: radius });
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    if (!this.sessions.has(id)) return;
    const world = this.ctx.project(screenX, screenY);
    this.ctx.emit({ type: 'moveGrab', id, x: world.x, y: world.y });
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    // 快速按放＝以同一個半徑對按下點 Tap（ADR-0014），跟單點抓取的 grab → tap → release 同形。
    if (this.ctx.isTap(session, screenX, screenY, timeMs)) {
      this.ctx.emit({
        type: 'tap',
        x: session.startWorld.x,
        y: session.startWorld.y,
        radius: session.radius,
      });
    }
    this.ctx.emit({ type: 'release', id });
  }

  cancel(id: PointerId): void {
    // 大把抓取已經是活著的約束：中斷要真的放開（同單點抓取），不送 tap。
    if (this.sessions.delete(id)) this.ctx.emit({ type: 'release', id });
  }
}
