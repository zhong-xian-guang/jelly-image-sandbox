/**
 * `BackdropBoard`（issue #148 / 背景 T2；spec #146、ADR-0017）——場上 Backdrop（背景圖）的
 * 有序集合。純邏輯：不碰 DOM、GPU，也不認得求解器；圖片只當成不透明的 `Blob` 帶著走，
 * 解碼成貼圖是呼叫端（`JellySandbox`）的事。
 *
 * 每張 Backdrop 有穩定 id、圖（縮小後的 Blob＋像素尺寸）、世界座標中心、等比縮放（一個圖片
 * 像素＝幾個世界單位）、透明度、顯示與否。`list()` 依疊放順序（先畫→後畫），後新增的
 * 疊在上面。
 *
 * **持久化**：每個指令改完狀態就經 `BackgroundStore` 寫回——新增時先存圖再存清單、刪除時
 * 先存清單再刪圖（中途被關掉也不會留下指到不存在的圖的清單項；多出來的孤兒圖無害）。儲存
 * 寫不進去時由 `BackgroundStore` 退回成只在本次有效並提示一次，這裡照常運作。`restore`
 * 從儲存還原。
 *
 * Backdrop 不是 Scene、不是 Track 事件，也不進片段檔：停止、重設、清空全部、載入片段的程式
 * 路徑都不碰這裡。
 */

import type { BackgroundStore, StoredBackdropImage, StoredBackdropMeta } from './backgroundStore';

/** 一張 Backdrop 的圖：縮小後的圖檔與它的像素尺寸。 */
export type BackdropImage = StoredBackdropImage;

export interface Backdrop {
  readonly id: string;
  readonly image: BackdropImage;
  /** 世界座標中心。 */
  centerX: number;
  centerY: number;
  /** 等比縮放：一個圖片像素＝幾個世界單位。 */
  scale: number;
  /** 透明度 0–1。 */
  opacity: number;
  visible: boolean;
}

/** 世界座標的一個矩形範圍（中心＋寬高）——新增 Backdrop 時傳入目前看得到的範圍。 */
export interface WorldRect {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/**
 * Cover 擺放：中心對準 `view` 中心、等比縮放到剛好蓋滿 `view`（短的那一邊對齊，長的那一邊
 * 超出）。`width`／`height` 是圖片像素尺寸。
 */
export function coverPlacement(
  view: WorldRect,
  width: number,
  height: number,
): { centerX: number; centerY: number; scale: number } {
  return {
    centerX: view.centerX,
    centerY: view.centerY,
    scale: Math.max(view.width / width, view.height / height),
  };
}

const ID_PREFIX = 'backdrop/';

export class BackdropBoard {
  private readonly store: BackgroundStore;
  /** 依疊放順序（先畫→後畫）。 */
  private items: Backdrop[];
  private nextId: number;
  private readonly listeners = new Set<() => void>();

  constructor(store: BackgroundStore, restored: readonly Backdrop[] = []) {
    this.store = store;
    this.items = restored.map((b) => ({ ...b }));
    this.nextId =
      Math.max(0, ...this.items.map((b) => Number(b.id.slice(ID_PREFIX.length)) || 0)) + 1;
  }

  /** 從儲存還原（讀不到就是空的）。 */
  static async restore(store: BackgroundStore): Promise<BackdropBoard> {
    return new BackdropBoard(store, await store.loadBackdrops());
  }

  /** 依疊放順序（先畫→後畫）列出全部。 */
  list(): readonly Readonly<Backdrop>[] {
    return this.items;
  }

  get(id: string): Readonly<Backdrop> | undefined {
    return this.items.find((b) => b.id === id);
  }

  /** 變動通知（任何指令改了狀態之後）；回傳取消訂閱。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 新增一張，套用 cover 擺放（蓋滿 `view`），疊在最上面。 */
  add(image: BackdropImage, view: WorldRect): Readonly<Backdrop> {
    const backdrop: Backdrop = {
      id: `${ID_PREFIX}${this.nextId++}`,
      image,
      ...coverPlacement(view, image.width, image.height),
      opacity: 1,
      visible: true,
    };
    this.items.push(backdrop);
    this.store.saveBackdropImage(backdrop.id, image);
    this.changed();
    return backdrop;
  }

  /** 刪除一張；不存在不動作。 */
  remove(id: string): void {
    const index = this.items.findIndex((b) => b.id === id);
    if (index < 0) return;
    this.items.splice(index, 1);
    this.changed();
    this.store.deleteBackdropImage(id);
  }

  /** 狀態改了：寫回清單、通知訂閱者。 */
  private changed(): void {
    this.store.saveBackdropList(this.items.map(toMeta));
    for (const listener of this.listeners) listener();
  }
}

function toMeta(b: Backdrop): StoredBackdropMeta {
  return {
    id: b.id,
    centerX: b.centerX,
    centerY: b.centerY,
    scale: b.scale,
    opacity: b.opacity,
    visible: b.visible,
  };
}
