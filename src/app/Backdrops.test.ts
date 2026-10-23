import { describe, expect, it, vi } from 'vitest';

import { BackdropBoard, type Backdrop } from './BackdropBoard';
import { BackgroundStore, memoryKeyValueStore } from './backgroundStore';
import { type BackdropImageCodec, Backdrops, MAX_BACKDROP_SIZE } from './Backdrops';

/** 假圖片：解碼結果，記得自己是哪個 blob、多大、有沒有被釋放。 */
interface FakeImage {
  tag: string;
  width: number;
  height: number;
  released: boolean;
}

/** 假圖檔的內容（jsdom 的 Blob 讀不出內容，所以另外記）：`"寬x高"`，解不開的是 `bad`。 */
const blobSpec = new WeakMap<Blob, string>();

function fakeBlob(spec: string, type = 'image/png'): Blob {
  const blob = new Blob([spec], { type });
  blobSpec.set(blob, spec);
  return blob;
}

/**
 * 假編解碼 adapter：圖檔內容見 `blobSpec`。`decode` 回的 promise 先擱著，
 * 由測試 `finishDecodes()` 決定何時完成——「解碼完成才進繪製清單」才測得到。
 */
function fakeCodec() {
  const pending: { blob: Blob; resolve: (img: FakeImage) => void; reject: (e: unknown) => void }[] =
    [];
  const thumbs = new Map<string, Blob>();
  const revoked: string[] = [];
  let nextThumb = 1;
  let resizeFails = false;
  const codec: BackdropImageCodec<FakeImage> = {
    decode: (blob) =>
      new Promise<FakeImage>((resolve, reject) => pending.push({ blob, resolve, reject })),
    size: (img) => ({ width: img.width, height: img.height }),
    release: (img) => {
      img.released = true;
    },
    resizeToWebp: async (img, width, height) =>
      resizeFails
        ? null
        : {
            blob: fakeBlob(`${width}x${height}`, 'image/webp'),
            image: { tag: `resized:${img.tag}`, width, height, released: false },
          },
    createThumbnailUrl: (blob) => {
      const url = `thumb:${nextThumb++}`;
      thumbs.set(url, blob);
      return url;
    },
    revokeThumbnailUrl: (url) => {
      revoked.push(url);
    },
  };
  /** 完成所有擱著的解碼（依 blob 內容決定成功或失敗）。 */
  async function finishDecodes(): Promise<void> {
    while (pending.length > 0) {
      const { blob, resolve, reject } = pending.shift()!;
      const text = blobSpec.get(blob) ?? '';
      const match = /^(\d+)x(\d+)$/.exec(text);
      if (match) {
        resolve({ tag: text, width: Number(match[1]), height: Number(match[2]), released: false });
      } else reject(new Error('bad image'));
    }
    // 讓 `.then` 回呼跑完。
    await new Promise((r) => setTimeout(r, 0));
  }
  return {
    codec,
    finishDecodes,
    revoked,
    thumbs,
    failResize: () => (resizeFails = true),
  };
}

function png(width: number, height: number): Blob {
  return fakeBlob(`${width}x${height}`);
}

const VIEW = { centerX: 0, centerY: 0, width: 800, height: 400 };

function setup(restored: Backdrop[] = []) {
  const store = new BackgroundStore(memoryKeyValueStore(), () => {});
  const board = new BackdropBoard(store, restored);
  const fake = fakeCodec();
  const notices: string[] = [];
  const backdrops = new Backdrops(board, {
    codec: fake.codec,
    notify: (message) => notices.push(message),
  });
  return { backdrops, board, fake, notices };
}

/** 匯入一張並等它解碼完成。 */
async function importPng(
  ctx: ReturnType<typeof setup>,
  width: number,
  height: number,
): Promise<void> {
  const done = ctx.backdrops.import(png(width, height), VIEW);
  await ctx.fake.finishDecodes();
  await done;
}

describe('Backdrops：匯入', () => {
  it('匯入一張：進繪製清單與清單列（cover 擺放、縮圖網址）', async () => {
    const ctx = setup();
    await importPng(ctx, 400, 200);
    const out = ctx.backdrops.flush();
    expect(out).not.toBeNull();
    expect(out!.sprites).toHaveLength(1);
    expect(out!.sprites[0]).toMatchObject({
      centerX: 0,
      centerY: 0,
      width: 800,
      height: 400,
      alpha: 1,
      visible: true,
    });
    expect(out!.sprites[0]!.source.tag).toBe('400x200');
    expect(out!.rows).toEqual([
      expect.objectContaining({
        label: '背景圖 1',
        thumbnailUrl: 'thumb:1',
        visible: true,
        isTop: true,
        isBottom: true,
        selected: false,
      }),
    ]);
  });
});

/** 從儲存還原來的一張（還沒解碼）。 */
function restored(id: number, width = 100, height = 50, spec = `${width}x${height}`): Backdrop {
  return {
    id: `backdrop/${id}`,
    image: { blob: fakeBlob(spec), width, height },
    centerX: 10 * id,
    centerY: 0,
    scale: 1,
    opacity: 0.5,
    visible: true,
  };
}

describe('Backdrops：還原與解碼', () => {
  it('還原的那張：解碼完成前只有清單列、不進繪製清單；解好後下一次同步才畫', async () => {
    const ctx = setup([restored(3)]);
    const first = ctx.backdrops.flush()!;
    expect(first.sprites).toEqual([]);
    expect(first.rows.map((r) => r.label)).toEqual(['背景圖 3']);
    expect(ctx.backdrops.flush()).toBeNull();

    await ctx.fake.finishDecodes();
    const second = ctx.backdrops.flush()!;
    expect(second.sprites).toEqual([
      expect.objectContaining({
        id: 'backdrop/3',
        centerX: 30,
        width: 100,
        height: 50,
        alpha: 0.5,
      }),
    ]);
  });

  it('解不開的那張：一直不畫，清單列照樣在', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = setup([restored(1, 100, 50, 'bad')]);
    ctx.backdrops.flush();
    await ctx.fake.finishDecodes();
    expect(ctx.backdrops.flush()).toBeNull();
    ctx.backdrops.setVisible('backdrop/1', false);
    const out = ctx.backdrops.flush()!;
    expect(out.sprites).toEqual([]);
    expect(out.rows).toHaveLength(1);
    warn.mockRestore();
  });

  it('解碼中被刪掉：解好的圖直接釋放、不畫', async () => {
    const ctx = setup([restored(1)]);
    ctx.backdrops.flush();
    ctx.backdrops.remove('backdrop/1');
    await ctx.fake.finishDecodes();
    const out = ctx.backdrops.flush()!;
    expect(out.sprites).toEqual([]);
    expect(out.rows).toEqual([]);
  });
});

describe('Backdrops：同步合併', () => {
  it('多次變動，下一次同步只算一次；之後沒變就回 null', async () => {
    const ctx = setup();
    await importPng(ctx, 400, 200);
    ctx.backdrops.flush();
    const id = 'backdrop/1';
    ctx.backdrops.command({ type: 'select', id });
    ctx.backdrops.command({ type: 'move', id, dx: 5, dy: -5 });
    ctx.backdrops.setField(id, 'opacity', 0.3);
    const out = ctx.backdrops.flush()!;
    expect(out.sprites[0]).toMatchObject({ centerX: 5, centerY: -5, alpha: 0.3 });
    expect(out.rows[0]!.selected).toBe(true);
    expect(ctx.backdrops.flush()).toBeNull();
  });

  it('沒有任何變動時第一次同步也會給（還原後要先畫一次空清單）', () => {
    const ctx = setup();
    expect(ctx.backdrops.flush()).toEqual({ sprites: [], rows: [] });
    expect(ctx.backdrops.flush()).toBeNull();
  });
});

describe('Backdrops：刪除回收', () => {
  it('刪掉一張：下一次同步回收它的縮圖網址並釋放貼圖', async () => {
    const ctx = setup();
    await importPng(ctx, 400, 200);
    await importPng(ctx, 200, 100);
    const before = ctx.backdrops.flush()!;
    const thumb = before.rows[0]!.thumbnailUrl;
    const texture = before.sprites[0]!.source;
    ctx.backdrops.remove('backdrop/1');
    const after = ctx.backdrops.flush()!;
    expect(ctx.fake.revoked).toEqual([thumb]);
    expect(texture.released).toBe(true);
    expect(after.rows.map((r) => r.label)).toEqual(['背景圖 2']);
    expect(after.sprites[0]!.source.released).toBe(false);
  });

  it('dispose：全部縮圖回收、貼圖釋放', async () => {
    const ctx = setup();
    await importPng(ctx, 400, 200);
    const out = ctx.backdrops.flush()!;
    ctx.backdrops.dispose();
    expect(ctx.fake.revoked).toEqual([out.rows[0]!.thumbnailUrl]);
    expect(out.sprites[0]!.source.released).toBe(true);
  });
});

describe('Backdrops：匯入的失敗與縮小', () => {
  it('解不開：只提示，清單不變', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = setup();
    const done = ctx.backdrops.import(fakeBlob('bad'), VIEW);
    await ctx.fake.finishDecodes();
    await done;
    expect(ctx.notices).toEqual(['讀不出這張背景圖：檔案可能壞掉，或瀏覽器不支援這個格式']);
    expect(ctx.backdrops.flush()).toEqual({ sprites: [], rows: [] });
    warn.mockRestore();
  });

  it('長邊超過上限：等比縮小到長邊上限、存縮小後的圖並提示，原圖釋放', async () => {
    const ctx = setup();
    await importPng(ctx, 8192, 2048);
    expect(ctx.notices).toEqual([`背景圖太大，已等比縮小到長邊 ${MAX_BACKDROP_SIZE} px`]);
    const out = ctx.backdrops.flush()!;
    expect(out.sprites[0]!.source.tag).toBe('resized:8192x2048');
    // cover：800×400 的畫面蓋滿 4096×1024 的圖 → 高度對齊。
    expect(out.sprites[0]).toMatchObject({ width: 1600, height: 400 });
    expect(ctx.fake.thumbs.get(out.rows[0]!.thumbnailUrl)!.type).toBe('image/webp');
  });

  it('縮小失敗：提示，不新增', async () => {
    const ctx = setup();
    ctx.fake.failResize();
    await importPng(ctx, 5000, 10);
    expect(ctx.notices).toEqual(['背景圖太大，縮小時失敗了']);
    expect(ctx.backdrops.flush()!.rows).toEqual([]);
  });
});

describe('Backdrops：指令與選單', () => {
  async function three() {
    const ctx = setup();
    await importPng(ctx, 400, 200);
    await importPng(ctx, 400, 200);
    await importPng(ctx, 400, 200);
    return ctx;
  }
  const labels = (ctx: ReturnType<typeof setup>) => ctx.backdrops.flush()!.rows.map((r) => r.label);

  it('右鍵選單：先選中那張；最上層那張的「移到最上層」變灰', async () => {
    const ctx = await three();
    const menu = ctx.backdrops.command({
      type: 'contextMenu',
      id: 'backdrop/3',
      screen: { x: 7, y: 8 },
    })!;
    expect(menu.screen).toEqual({ x: 7, y: 8 });
    expect(menu.items.map((i) => [i.id, i.disabledReason !== null])).toEqual([
      ['delete', false],
      ['bringToFront', true],
      ['sendToBack', false],
    ]);
    expect(ctx.backdrops.flush()!.rows.find((r) => r.selected)?.label).toBe('背景圖 3');
  });

  it('選單：移到最下層、移到最上層、刪除', async () => {
    const ctx = await three();
    const at = { x: 0, y: 0 };
    ctx.backdrops
      .command({ type: 'contextMenu', id: 'backdrop/3', screen: at })!
      .pick('sendToBack');
    expect(labels(ctx)).toEqual(['背景圖 3', '背景圖 1', '背景圖 2']);
    ctx.backdrops
      .command({ type: 'contextMenu', id: 'backdrop/1', screen: at })!
      .pick('bringToFront');
    expect(labels(ctx)).toEqual(['背景圖 3', '背景圖 2', '背景圖 1']);
    ctx.backdrops.command({ type: 'contextMenu', id: 'backdrop/2', screen: at })!.pick('delete');
    expect(labels(ctx)).toEqual(['背景圖 3', '背景圖 1']);
  });

  it('其他指令不回選單', async () => {
    const ctx = await three();
    expect(ctx.backdrops.command({ type: 'select', id: null })).toBeNull();
  });

  it('右鍵＋滾輪：調選中那張；沒選中就調游標下那張；游標標籤數值同一張', async () => {
    const ctx = await three();
    const at = { x: 0, y: 0 };
    expect(ctx.backdrops.cursorValue('opacity', at)).toBe('100%');
    ctx.backdrops.command({ type: 'adjust', property: 'opacity', steps: -2, at });
    expect(ctx.backdrops.flush()!.rows.map((r) => r.opacity)).toEqual([1, 1, 0.9]);
    expect(ctx.backdrops.cursorValue('opacity', at)).toBe('90%');

    ctx.backdrops.select('backdrop/1');
    ctx.backdrops.command({ type: 'adjust', property: 'opacity', steps: -1, at });
    expect(ctx.backdrops.flush()!.rows.map((r) => r.opacity)).toEqual([0.95, 1, 0.9]);
    expect(ctx.backdrops.cursorValue('opacity', null)).toBe('95%');
  });

  it('游標下沒有、也沒選中：不調、沒有數值', async () => {
    const ctx = await three();
    const far = { x: 1e6, y: 0 };
    expect(ctx.backdrops.cursorValue('scale', far)).toBeNull();
    ctx.backdrops.flush();
    ctx.backdrops.command({ type: 'adjust', property: 'scale', steps: 1, at: far });
    expect(ctx.backdrops.flush()).toBeNull();
  });

  it('選中外框：選中且顯示中才有範圍', async () => {
    const ctx = await three();
    expect(ctx.backdrops.selectedRect()).toBeNull();
    ctx.backdrops.select('backdrop/2');
    expect(ctx.backdrops.selectedRect()).toEqual({
      centerX: 0,
      centerY: 0,
      width: 800,
      height: 400,
    });
    ctx.backdrops.setVisible('backdrop/2', false);
    expect(ctx.backdrops.selectedRect()).toBeNull();
  });

  it('清單欄位：x／y 只改那一軸，縮放夾在範圍內；上移下移', async () => {
    const ctx = await three();
    ctx.backdrops.setField('backdrop/1', 'centerX', 12);
    ctx.backdrops.setField('backdrop/1', 'centerY', -3);
    ctx.backdrops.setField('backdrop/1', 'scale', 1e9);
    ctx.backdrops.moveUp('backdrop/1');
    const rows = ctx.backdrops.flush()!.rows;
    expect(rows.map((r) => r.label)).toEqual(['背景圖 2', '背景圖 1', '背景圖 3']);
    expect(rows[1]).toMatchObject({ centerX: 12, centerY: -3, scale: 1000 });
    ctx.backdrops.moveDown('backdrop/1');
    expect(labels(ctx)).toEqual(['背景圖 1', '背景圖 2', '背景圖 3']);
  });

  it('hitTest：最上層、顯示中那張', async () => {
    const ctx = await three();
    expect(ctx.backdrops.hitTest({ x: 0, y: 0 })).toBe('backdrop/3');
    ctx.backdrops.setVisible('backdrop/3', false);
    expect(ctx.backdrops.hitTest({ x: 0, y: 0 })).toBe('backdrop/2');
    expect(ctx.backdrops.hitTest({ x: 1e6, y: 0 })).toBeNull();
  });
});
