/**
 * `Backdrops`（issue #165 / 架構整理 B3；spec #158、ADR-0017）——場上 Backdrop（背景圖）的
 * deep module。持有 `BackdropBoard`（純邏輯：清單、順序、選取、持久化），另擁有 Board 不管的
 * 那些事：
 *
 * - 每張 Backdrop 解碼好的貼圖與「解碼中」集合——還沒解好（或解不開）的不進繪製清單；
 * - 清單縮圖網址的建立與回收（Backdrop 刪掉時回收）；
 * - 匯入：解碼、長邊超過 `MAX_BACKDROP_SIZE` 先等比縮小並轉 WebP、cover 擺放；
 * - 背景圖工具的指令（選取、拖曳、右鍵＋滾輪調值、右鍵選單）與側欄清單的操作；
 * - 「有變動、待同步」的合併：`flush()` 每幀呼叫一次，沒變就回 `null`，變了才算一次
 *   交給 Renderer 的繪製清單與交給側欄的清單列。
 *
 * 圖片編解碼是注入的 seam（`BackdropImageCodec`）：瀏覽器用 `browserBackdropCodec`
 * （`createImageBitmap`／canvas／object URL），測試用假的——所以整條路徑在 jsdom 也測得到。
 *
 * ADR-0017 的定位不變：Backdrop 是純視覺、世界空間、不進片段檔，也不經 `World`、不錄進 Track。
 */

import type { BackdropCommand, BackdropMode } from '../input';
import type { Point } from '../sim';
import {
  type Backdrop,
  BackdropBoard,
  backdropNumber,
  stepBackdropValue,
  worldRectOf,
  type WorldRect,
} from './BackdropBoard';
import type { BackdropField, BackdropListRow } from './BackgroundPanel';
import { backdropMenuItems, type BackdropMenuItemId, type ContextMenuItem } from './ContextMenu';
import { backdropValueText } from './CursorLabel';

/**
 * Backdrop 圖片長邊上限（issue #148；spec #146 US38），像素——超過就等比縮小再存。4096 是
 * 幾乎所有 WebGL 裝置都保證支援的貼圖尺寸，再大有的 GPU 會直接顯示失敗。
 */
export const MAX_BACKDROP_SIZE = 4096;

/** 圖片編解碼 seam：`Img` 是可以交給 Renderer 畫的圖（瀏覽器是 `ImageBitmap`）。 */
export interface BackdropImageCodec<Img> {
  /** 把圖檔解碼成可繪製的圖；解不開就 reject。 */
  decode(blob: Blob): Promise<Img>;
  /** 圖的像素尺寸。 */
  size(image: Img): { width: number; height: number };
  /** 不再需要這張圖（釋放 GPU／記憶體）。 */
  release(image: Img): void;
  /** 等比縮放到 `width`×`height` 並轉 WebP，回新的圖檔與解好的圖；失敗回 `null`。不釋放原圖。 */
  resizeToWebp(
    image: Img,
    width: number,
    height: number,
  ): Promise<{ blob: Blob; image: Img } | null>;
  /** 清單縮圖網址。 */
  createThumbnailUrl(blob: Blob): string;
  revokeThumbnailUrl(url: string): void;
}

/** 交給 Renderer 的一張（結構同 `BackdropSprite`）。 */
export interface BackdropDrawItem<Img> {
  id: string;
  source: Img;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  alpha: number;
  visible: boolean;
}

/** 右鍵選單請求：在 `screen` 開 `items`，選了某項呼叫 `pick`。 */
export interface BackdropMenuRequest {
  screen: Point;
  items: ContextMenuItem<BackdropMenuItemId>[];
  pick: (item: BackdropMenuItemId) => void;
}

export interface BackdropsOptions<Img> {
  codec: BackdropImageCodec<Img>;
  /** 給使用者看的提示（匯入失敗、縮小了）。 */
  notify: (message: string) => void;
}

export class Backdrops<Img> {
  private readonly board: BackdropBoard;
  private readonly codec: BackdropImageCodec<Img>;
  private readonly notify: (message: string) => void;
  /** 每張 Backdrop 解碼好的貼圖；還在解碼或解不開的不在這裡，先不畫。 */
  private readonly textures = new Map<string, Img>();
  /** 正在解碼的 Backdrop id（還原時非同步解碼，避免同一張重複解）。 */
  private readonly decoding = new Set<string>();
  /** 清單縮圖網址，Backdrop 刪掉時回收。 */
  private readonly thumbs = new Map<string, string>();
  /** 有變動、還沒 `flush`。一開始是 `true`：還原來的清單要先同步一次。 */
  private dirty = true;
  private disposed = false;

  constructor(board: BackdropBoard, opts: BackdropsOptions<Img>) {
    this.board = board;
    this.codec = opts.codec;
    this.notify = opts.notify;
    board.onChange(() => (this.dirty = true));
  }

  // ---- 查詢 ------------------------------------------------------------------

  /** 世界座標點上最上層、顯示中的那張；沒有回 `null`。 */
  hitTest(world: Point): string | null {
    return this.board.hitTest(world);
  }

  /** 選中那張（且顯示中）的世界範圍——外框用；沒有回 `null`。 */
  selectedRect(): WorldRect | null {
    const id = this.board.selectedId;
    const b = id === null ? undefined : this.board.get(id);
    return b !== undefined && b.visible ? worldRectOf(b) : null;
  }

  /** 游標標籤：右鍵＋滾輪此刻會調的那張的 `property` 值文字；沒有目標回 `null`。 */
  cursorValue(property: BackdropMode, at: Point | null): string | null {
    const target = this.adjustTarget(at);
    return target ? backdropValueText(property, target[property]) : null;
  }

  // ---- 匯入 ------------------------------------------------------------------

  /**
   * 匯入一個圖檔（issue #148）：瀏覽器原生解碼（不經 mesh pipeline，不受 ADR-0009 的格式
   * 清單限制）。長邊超過 `MAX_BACKDROP_SIZE` 先等比縮小（轉 WebP）再存並提示；解不開就只提示，
   * 現有的 Backdrop 不受影響。新的一張 cover 擺放在 `view` 上、疊在最上面。
   */
  async import(file: Blob, view: WorldRect): Promise<void> {
    let image: Img;
    try {
      image = await this.codec.decode(file);
    } catch (err) {
      console.warn('背景圖解碼失敗', err);
      this.notify('讀不出這張背景圖：檔案可能壞掉，或瀏覽器不支援這個格式');
      return;
    }
    let blob = file;
    let { width, height } = this.codec.size(image);
    const longest = Math.max(width, height);
    if (longest > MAX_BACKDROP_SIZE) {
      const k = MAX_BACKDROP_SIZE / longest;
      width = Math.max(1, Math.round(width * k));
      height = Math.max(1, Math.round(height * k));
      const resized = await this.codec.resizeToWebp(image, width, height);
      this.codec.release(image);
      if (!resized) {
        this.notify('背景圖太大，縮小時失敗了');
        return;
      }
      blob = resized.blob;
      image = resized.image;
      this.notify(`背景圖太大，已等比縮小到長邊 ${MAX_BACKDROP_SIZE} px`);
    }
    const backdrop = this.board.add({ blob, width, height }, view);
    this.textures.set(backdrop.id, image);
  }

  // ---- 指令 ------------------------------------------------------------------

  /**
   * 背景圖工具的指令（issue #149；issue #150 加調值與右鍵選單）。右鍵選單先選中點到的那張
   * （外框標出選單作用在哪一張），回傳選單請求由呼叫端開；其餘指令回 `null`。
   */
  command(cmd: BackdropCommand): BackdropMenuRequest | null {
    switch (cmd.type) {
      case 'select':
        this.board.select(cmd.id);
        return null;
      case 'move':
        this.board.move(cmd.id, cmd.dx, cmd.dy);
        return null;
      case 'adjust': {
        const target = this.adjustTarget(cmd.at);
        if (target) {
          const next = stepBackdropValue(cmd.property, target[cmd.property], cmd.steps);
          this.setValue(target.id, cmd.property, next);
        }
        return null;
      }
      case 'contextMenu':
        return this.menu(cmd.id, cmd.screen);
    }
  }

  /** 刪除一張（側欄刪除鈕、右鍵選單）。 */
  remove(id: string): void {
    this.board.remove(id);
  }

  select(id: string | null): void {
    this.board.select(id);
  }

  setVisible(id: string, visible: boolean): void {
    this.board.setVisible(id, visible);
  }

  moveUp(id: string): void {
    this.board.moveUp(id);
  }

  moveDown(id: string): void {
    this.board.moveDown(id);
  }

  /** 側欄清單的數字欄位（issue #151）。 */
  setField(id: string, field: BackdropField, value: number): void {
    const b = this.board.get(id);
    if (!b) return;
    if (field === 'centerX') this.board.setCenter(id, value, b.centerY);
    else if (field === 'centerY') this.board.setCenter(id, b.centerX, value);
    else this.setValue(id, field, value);
  }

  // ---- 同步 ------------------------------------------------------------------

  /**
   * 有變動才同步（每幀呼叫一次）：回收已刪掉那幾張的貼圖與縮圖、替新的建縮圖並開始解碼
   * （解好再變動一次），回傳繪製清單（只含解好的）與清單列；沒變動回 `null`。
   */
  flush(): { sprites: BackdropDrawItem<Img>[]; rows: BackdropListRow[] } | null {
    if (!this.dirty || this.disposed) return null;
    this.dirty = false;
    const list = this.board.list();
    const alive = new Set(list.map((b) => b.id));
    for (const [id, image] of this.textures) {
      if (alive.has(id)) continue;
      this.textures.delete(id);
      this.codec.release(image);
    }
    for (const [id, url] of this.thumbs) {
      if (alive.has(id)) continue;
      this.thumbs.delete(id);
      this.codec.revokeThumbnailUrl(url);
    }
    for (const b of list) {
      if (!this.thumbs.has(b.id))
        this.thumbs.set(b.id, this.codec.createThumbnailUrl(b.image.blob));
      if (!this.textures.has(b.id) && !this.decoding.has(b.id)) this.decodeRestored(b);
    }
    const selected = this.board.selectedId;
    return {
      sprites: list.flatMap((b) => {
        const source = this.textures.get(b.id);
        if (source === undefined) return [];
        return [{ id: b.id, source, ...worldRectOf(b), alpha: b.opacity, visible: b.visible }];
      }),
      rows: list.map((b) => ({
        id: b.id,
        label: `背景圖 ${backdropNumber(b.id)}`,
        thumbnailUrl: this.thumbs.get(b.id) ?? '',
        visible: b.visible,
        isTop: this.board.isTop(b.id),
        isBottom: this.board.isBottom(b.id),
        selected: b.id === selected,
        centerX: b.centerX,
        centerY: b.centerY,
        scale: b.scale,
        opacity: b.opacity,
      })),
    };
  }

  /** 釋放所有貼圖與縮圖網址（沙盒 `destroy`）。 */
  dispose(): void {
    this.disposed = true;
    for (const image of this.textures.values()) this.codec.release(image);
    for (const url of this.thumbs.values()) this.codec.revokeThumbnailUrl(url);
    this.textures.clear();
    this.thumbs.clear();
  }

  // ---- 內部 ------------------------------------------------------------------

  /** 還原來的（或匯入時貼圖沒留下的）一張：非同步解碼，解好算一次變動。 */
  private decodeRestored(b: Readonly<Backdrop>): void {
    this.decoding.add(b.id);
    this.codec.decode(b.image.blob).then(
      (image) => {
        this.decoding.delete(b.id);
        if (this.disposed || !this.board.get(b.id)) {
          this.codec.release(image);
          return;
        }
        this.textures.set(b.id, image);
        this.dirty = true;
      },
      (err) => {
        this.decoding.delete(b.id);
        console.warn('背景圖還原失敗', err);
      },
    );
  }

  /** 設某張的縮放或透明度（右鍵＋滾輪與清單數字欄位共用）。 */
  private setValue(id: string, property: BackdropMode, value: number): void {
    if (property === 'scale') this.board.setScale(id, value);
    else this.board.setOpacity(id, value);
  }

  /**
   * 右鍵＋滾輪調哪一張（issue #150）：選中的那張；沒選中就 `at`（游標下）最上層顯示中的
   * 那張。游標標籤的數值也問這裡，才會跟實際調的一致。
   */
  private adjustTarget(at: Point | null): Readonly<Backdrop> | undefined {
    const selected = this.board.selectedId;
    if (selected !== null) return this.board.get(selected);
    const hit = at && this.board.hitTest(at);
    return hit ? this.board.get(hit) : undefined;
  }

  /** 右鍵選單（issue #150）：先選中點到的那張，再回「刪除／移到最上層／移到最下層」。 */
  private menu(id: string, screen: Point): BackdropMenuRequest {
    this.board.select(id);
    return {
      screen,
      items: backdropMenuItems({ isTop: this.board.isTop(id), isBottom: this.board.isBottom(id) }),
      pick: (item) => {
        if (item === 'delete') this.board.remove(id);
        else if (item === 'bringToFront') this.board.bringToFront(id);
        else this.board.sendToBack(id);
      },
    };
  }
}

/**
 * 瀏覽器的圖片編解碼 adapter：`createImageBitmap` 解碼、canvas 縮小並轉 WebP（不支援編碼
 * WebP 的瀏覽器——Safari——會自動退回 PNG）、object URL 當縮圖。
 */
export const browserBackdropCodec: BackdropImageCodec<ImageBitmap> = {
  // `flush()` 在 frame loop 裡呼叫 `decode`：不支援 `createImageBitmap` 的環境要回失敗的
  // promise（當成「這張解不開」略過），不能同步丟例外。
  decode: async (blob) => {
    if (typeof createImageBitmap !== 'function') {
      throw new Error('這個環境不支援 createImageBitmap');
    }
    return createImageBitmap(blob);
  },
  size: (image) => ({ width: image.width, height: image.height }),
  release: (image) => image.close(),
  async resizeToWebp(image, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    // WebP 有透明度又比 PNG 小得多。
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.92),
    );
    if (!blob) return null;
    return { blob, image: await createImageBitmap(canvas) };
  },
  createThumbnailUrl: (blob) =>
    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '',
  revokeThumbnailUrl: (url) => {
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  },
};
