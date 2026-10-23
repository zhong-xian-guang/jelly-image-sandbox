/**
 * 背景圖工具（issue #149 / 背景 T3；spec #146、ADR-0017）的 adapter（issue #161 從
 * `ToolRouter` 搬出）：操作 Backdrop（背景圖）。
 *
 * 左鍵 `down` 用注入的 `hitTest` 判定點中哪一張（最上層、顯示中、只看矩形範圍——判定本身在
 * `BackdropBoard`），送 `select`（點空白處 `id: null`＝取消選取）；點中時之後每次 `move`
 * 送這一格的世界座標移動量 `move`。Jelly 不擋：這個 adapter 根本不問 Jelly 的 `hitTest`。
 *
 * 這些手勢走獨立的出口 `onCommand`，**不是** `emit`——Backdrop 不是模擬的一部分，不送任何
 * `InputEvent`，所以天生不會被錄進 Action Track，錄製中照樣能操作。
 *
 * **模式與右鍵**（issue #150 / 背景 T4）：模式是「右鍵＋滾輪調什麼」——縮放／透明度。右鍵＋
 * 滾輪送 `adjust`（調的是場上某一張 Backdrop，不是 `ToolParams`，所以滾輪一律由這裡處理、
 * 不走 `ToolRouter` 的退路），右鍵單擊點中某張送 `contextMenu`（呼叫端開「刪除／移到最上層／
 * 移到最下層」選單）。按在 Backdrop 上的指標歸這個工具（`ownsPointerAt`，觸控拖曳不平移
 * 相機）；游標標籤的數值由呼叫端依目前模式算（`cursorValue`）。
 */

import type { Point, PointerId } from '../../sim';
import type { BackdropMode } from '../ToolRouter';
import type { ToolAdapter, ToolContext } from './ToolAdapter';

/**
 * 背景圖工具送出的指令（issue #149；issue #150 加 `adjust`／`contextMenu`）——走
 * `onCommand`，不是 `InputEvent`（見檔頭說明）。`select` 的 `id: null`＝取消選取；
 * `move` 是這一格的世界座標移動量；`adjust` 是右鍵＋滾輪 `steps` 格，調哪一張（選中那張，沒
 * 選中就 `at` 游標下那張）由呼叫端決定；`contextMenu` 是右鍵單擊點中某張，`screen` 是畫布
 * 局部座標（選單擺的位置）。
 */
export type BackdropCommand =
  | { type: 'select'; id: string | null }
  | { type: 'move'; id: string; dx: number; dy: number }
  | { type: 'adjust'; property: BackdropMode; steps: number; at: Point }
  | { type: 'contextMenu'; id: string; screen: Point };

export interface BackdropAdapterOptions {
  /** 這個世界座標上最上層、顯示中的 Backdrop id，沒有回 `null`。不帶＝場上沒有 Backdrop。 */
  hitTest?: (world: Point) => string | null;
  /** 指令出口——獨立於 `emit`，不會進求解器也不會被錄進 Track。 */
  onCommand?: (cmd: BackdropCommand) => void;
  /**
   * 游標標籤數值（issue #161）：右鍵＋滾輪此刻會調的那張（選中的，沒有就 `at` 游標下的）的
   * `property` 值顯示文字，沒有目標回 `null`。不帶＝不顯示數值。
   */
  cursorValue?: (property: BackdropMode, at: Point | null) => string | null;
  /** 目前模式（`ToolRouter` 擁有模式）。 */
  mode: () => BackdropMode;
}

/** 進行中的一次 Backdrop 拖曳：拖哪一張、指標上一格的世界座標。 */
interface BackdropDragSession {
  id: string;
  lastWorld: Point;
}

export class BackdropAdapter implements ToolAdapter {
  /** 進行中的 Backdrop 拖曳，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, BackdropDragSession>();

  constructor(
    private readonly ctx: ToolContext,
    private readonly opts: BackdropAdapterOptions,
  ) {}

  private hit(world: Point): string | null {
    return this.opts.hitTest?.(world) ?? null;
  }

  down(id: PointerId, screenX: number, screenY: number): void {
    // 點中哪一張由 Backdrop 自己的判定決定，Jelly 不擋。
    const world = this.ctx.project(screenX, screenY);
    const hit = this.hit(world);
    this.opts.onCommand?.({ type: 'select', id: hit });
    // 同一張已經有別的指標在拖（多指觸控）就不再多開一個跟隨——各送一份移動量會讓
    // 位移疊加成兩倍（#152 驗證回饋）。由先按下的那根帶著走。
    const alreadyDragged = [...this.sessions.values()].some((s) => s.id === hit);
    if (hit !== null && !alreadyDragged) this.sessions.set(id, { id: hit, lastWorld: world });
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    const world = this.ctx.project(screenX, screenY);
    const dx = world.x - session.lastWorld.x;
    const dy = world.y - session.lastWorld.y;
    session.lastWorld = world;
    if (dx !== 0 || dy !== 0) this.opts.onCommand?.({ type: 'move', id: session.id, dx, dy });
  }

  up(id: PointerId): void {
    // 放開前瀏覽器一定送過同座標的 `move`，這裡只是結束這次拖曳。
    this.sessions.delete(id);
  }

  cancel(id: PointerId): void {
    // 已經移過去的不回捲（比照拖曳風扇的 cancel），只是停止跟隨指標。
    this.sessions.delete(id);
  }

  /** 點中某張 Backdrop 才開選單；點空白處什麼都不做。 */
  rightClick(world: Point, screenX: number, screenY: number): void {
    const hit = this.hit(world);
    if (hit !== null) {
      this.opts.onCommand?.({ type: 'contextMenu', id: hit, screen: { x: screenX, y: screenY } });
    }
  }

  /** 依目前模式送 `adjust`（帶滾輪當下游標的世界座標）；一律算已處理、相機不縮放。 */
  wheel(steps: number, screenX: number, screenY: number): boolean {
    this.opts.onCommand?.({
      type: 'adjust',
      property: this.opts.mode(),
      steps,
      at: this.ctx.project(screenX, screenY),
    });
    return true;
  }

  ownsPointerAt(world: Point): boolean {
    return this.hit(world) !== null;
  }

  cursorValue(world: Point | null): string | null {
    return this.opts.cursorValue?.(this.opts.mode(), world) ?? null;
  }
}
