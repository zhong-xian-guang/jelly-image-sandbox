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
 * **選取**（issue #149）：至多一張選中（`selectedId`），畫布上的「背景圖」工具與側欄清單共用
 * 這一份。選取不存檔；刪掉選中那張時一併清掉。
 *
 * **Hit test**（issue #149）：只看矩形範圍（圖片透明處也算點中，spec #146 US19），回最上層、
 * 目前顯示中的那張——被隱藏的點不到。
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

/**
 * 等比縮放的範圍（issue #150），一個圖片像素＝幾個世界單位。範圍放得很寬：cover 擺放算出來的
 * 值依圖片解析度與當時的相機縮放而定，可能落在很小或很大的地方；只擋掉會讓圖消失或爆掉的極端值。
 */
export const BACKDROP_SCALE_RANGE = { min: 0.001, max: 1000 } as const;
/** 右鍵＋滾輪一格的縮放倍率（往上滾放大、往下滾縮小）。 */
export const BACKDROP_SCALE_STEP = 1.1;
/**
 * 透明度的範圍與一格的量（issue #150）。下限不到 0：完全透明的圖還點得到卻看不見，只會讓人
 * 困惑——要暫時拿掉請用清單的顯示開關。
 */
export const BACKDROP_OPACITY_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 右鍵＋滾輪 `steps` 格之後的值（issue #150）：縮放每格乘上 `BACKDROP_SCALE_STEP`（等比縮放
 * 用倍率才有一致的手感），透明度每格加減一個 step、對齊格點並捨掉浮點誤差；都夾在範圍內。
 */
export function stepBackdropValue(
  property: 'scale' | 'opacity',
  value: number,
  steps: number,
): number {
  if (property === 'scale') {
    return clamp(
      value * BACKDROP_SCALE_STEP ** steps,
      BACKDROP_SCALE_RANGE.min,
      BACKDROP_SCALE_RANGE.max,
    );
  }
  const { min, max, step } = BACKDROP_OPACITY_RANGE;
  const snapped = Math.round((value + steps * step) / step) * step;
  return clamp(Number(snapped.toFixed(2)), min, max);
}

export class BackdropBoard {
  private readonly store: BackgroundStore;
  /** 依疊放順序（先畫→後畫）。 */
  private items: Backdrop[];
  private nextId: number;
  private selected: string | null = null;
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

  /** 目前選中的那張；沒有為 `null`。 */
  get selectedId(): string | null {
    return this.selected;
  }

  /** 選取（`null`＝取消選取；不存在的 id 也當成取消）。只通知、不存檔。 */
  select(id: string | null): void {
    const next = id !== null && this.get(id) ? id : null;
    if (next === this.selected) return;
    this.selected = next;
    this.notify();
  }

  /** 世界座標點上最上層、顯示中的那張（只看矩形範圍）；沒有回 `null`。 */
  hitTest(point: { x: number; y: number }): string | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i]!;
      if (!b.visible) continue;
      const halfW = (b.image.width * b.scale) / 2;
      const halfH = (b.image.height * b.scale) / 2;
      if (Math.abs(point.x - b.centerX) <= halfW && Math.abs(point.y - b.centerY) <= halfH) {
        return b.id;
      }
    }
    return null;
  }

  /** 直接設中心（issue #151：清單的 x／y 欄位）；不存在不動作。 */
  setCenter(id: string, centerX: number, centerY: number): void {
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
    this.update(id, (b) => {
      b.centerX = centerX;
      b.centerY = centerY;
    });
  }

  /** 移動一張（世界座標移動量）；不存在不動作。 */
  move(id: string, dx: number, dy: number): void {
    this.update(id, (b) => {
      b.centerX += dx;
      b.centerY += dy;
    });
  }

  /** 設定等比縮放（夾在 `BACKDROP_SCALE_RANGE` 內，中心不動）。 */
  setScale(id: string, scale: number): void {
    if (!Number.isFinite(scale)) return;
    this.update(id, (b) => {
      b.scale = clamp(scale, BACKDROP_SCALE_RANGE.min, BACKDROP_SCALE_RANGE.max);
    });
  }

  /** 設定透明度（夾在 `BACKDROP_OPACITY_RANGE` 內）。 */
  setOpacity(id: string, opacity: number): void {
    if (!Number.isFinite(opacity)) return;
    this.update(id, (b) => {
      b.opacity = clamp(opacity, BACKDROP_OPACITY_RANGE.min, BACKDROP_OPACITY_RANGE.max);
    });
  }

  /** 是不是疊在最上面那張。 */
  isTop(id: string): boolean {
    return this.items.at(-1)?.id === id;
  }

  /** 是不是墊在最下面那張。 */
  isBottom(id: string): boolean {
    return this.items[0]?.id === id;
  }

  /** 往上疊一層（issue #151）；已經在最上層（或不存在）不動作。 */
  moveUp(id: string): void {
    const index = this.items.findIndex((b) => b.id === id);
    if (index >= 0) this.reorder(id, Math.min(index + 1, this.items.length - 1));
  }

  /** 往下墊一層（issue #151）；已經在最下層（或不存在）不動作。 */
  moveDown(id: string): void {
    const index = this.items.findIndex((b) => b.id === id);
    if (index >= 0) this.reorder(id, Math.max(index - 1, 0));
  }

  /** 移到最上層；已經在最上層（或不存在）不動作。 */
  bringToFront(id: string): void {
    this.reorder(id, this.items.length - 1);
  }

  /** 移到最下層；已經在最下層（或不存在）不動作。 */
  sendToBack(id: string): void {
    this.reorder(id, 0);
  }

  /** 顯示／隱藏一張；被隱藏的不畫、也點不到。 */
  setVisible(id: string, visible: boolean): void {
    this.update(id, (b) => {
      b.visible = visible;
    });
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
    if (this.selected === id) this.selected = null;
    this.changed();
    this.store.deleteBackdropImage(id);
  }

  /** 把某張移到 `index`（疊放順序）；位置沒變或不存在不動作、不通知。 */
  private reorder(id: string, index: number): void {
    const from = this.items.findIndex((b) => b.id === id);
    if (from < 0 || from === index) return;
    const [backdrop] = this.items.splice(from, 1);
    this.items.splice(index, 0, backdrop!);
    this.changed();
  }

  /** 改某一張（不存在不動作），改完寫回並通知。 */
  private update(id: string, mutate: (b: Backdrop) => void): void {
    const backdrop = this.items.find((b) => b.id === id);
    if (!backdrop) return;
    mutate(backdrop);
    this.changed();
  }

  /** 狀態改了：寫回清單、通知訂閱者。 */
  private changed(): void {
    this.store.saveBackdropList(this.items.map(toMeta));
    this.notify();
  }

  private notify(): void {
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
