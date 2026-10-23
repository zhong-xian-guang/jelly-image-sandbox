/**
 * Jelly 工具（issue #97 / V3 T3-4 的「點一下」手勢；issue #124 / V4 T3 把生成、移除、重建
 * 三個工具合成一個、沒有模式）的 adapter（issue #161 從 `ToolRouter` 搬出）。
 *
 * 左鍵——`down` 記下按下處，`up` 時只要途中沒拖曳（位移 ≤ `tapMaxDist`，跟一般操作同一把尺）
 * 就呼叫 `onClick(world)`（生成），帶的是按下當下的世界座標；點在既有 Jelly 上也照樣生成。
 * 分支在按下當下定下，按住途中切走工具，這次手勢仍算 Jelly 工具的。右鍵單擊點中某塊 Jelly
 * （`hitTest`）→ `onContextMenu(world, screen)` 開「重建／移除」選單；點在空白處什麼都不做。
 *
 * 這是唯一**不** emit `InputEvent` 的 Behavior 之一（另一個是背景圖）：要送進 `World` 的
 * `spawn` 需要來源圖、兩條拉霸的值與網格 bbox，`remove`／重建需要先 `pick` 出 `jellyId`——
 * 那些都是 `JellySandbox` 的狀態，輸入層只回報「在這個世界座標點了一下」（ADR-0005）。
 */

import type { Point, PointerId } from '../../sim';
import type { DragSession, ToolAdapter, ToolContext } from './ToolAdapter';

export interface JellyAdapterOptions {
  /** 左鍵點一下（生成），參數是**按下當下**的世界座標。不帶＝沒接線，點下去什麼都不發生。 */
  onClick?: (world: Point) => void;
  /** 右鍵單擊點中某塊 Jelly：`screen`（畫布局部座標）開選單，作用在 `world` 點中的那一塊。 */
  onContextMenu?: (world: Point, screen: Point) => void;
}

/**
 * 進行中的一次「點一下」手勢（issue #97）：`startWorld` 是按下當下的世界座標（回呼拿的就是
 * 它），`dragged` 一旦在 `move` 途中被設起來就不會再放下——拖出去又拖回原點仍然不算點一下。
 *
 * 刻意**只**看位移、不看按住多久（跟 `isTap` 不同）：生成是「放在這裡」而不是「輕拍
 * 一下」，瞄準位置多按了一秒再放開仍該生成，不然會變成「按太久就沒反應」的謎樣失敗。
 */
type ClickSession = DragSession;

export class JellyAdapter implements ToolAdapter {
  /** 進行中的「點一下」手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, ClickSession>();

  constructor(
    private readonly ctx: ToolContext,
    private readonly opts: JellyAdapterOptions,
  ) {}

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    // 生成要等 `up` 才算數——按下當下先記位置，拖曳與否由 `move` 判定。
    // 刻意不在 `down` 就動手：按錯地方時還能拖開取消。
    this.sessions.set(id, { ...this.ctx.gestureStart(screenX, screenY, timeMs), dragged: false });
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    const click = this.sessions.get(id);
    // 超過輕拍的位移門檻（跟一般操作同一把尺）就不再是「點一下」。
    if (click) this.ctx.passedDragThreshold(click, screenX, screenY);
  }

  up(id: PointerId): void {
    const click = this.sessions.get(id);
    if (!click) return;
    this.sessions.delete(id);
    if (!click.dragged) this.opts.onClick?.(click.startWorld);
  }

  cancel(id: PointerId): void {
    // 生成還沒發生（要等 `up`），中斷就是整個作廢，不留痕跡。
    this.sessions.delete(id);
  }

  rightClick(world: Point, screenX: number, screenY: number): void {
    if (!this.ctx.hitTest(world)) return;
    this.opts.onContextMenu?.(world, { x: screenX, y: screenY });
  }
}
