import { describe, expect, it, vi } from 'vitest';

import { BackdropBoard, coverPlacement, type BackdropImage } from './BackdropBoard';
import { BackgroundStore, memoryKeyValueStore, type AsyncKeyValueStore } from './backgroundStore';

function image(width: number, height: number, tag = 'x'): BackdropImage {
  return { blob: new Blob([tag], { type: 'image/png' }), width, height };
}

/** 目前可視的世界範圍：中心 (100, 50)、寬 800、高 400。 */
const VIEW = { centerX: 100, centerY: 50, width: 800, height: 400 };

function memoryBoard(): {
  board: BackdropBoard;
  store: BackgroundStore;
  memory: AsyncKeyValueStore;
} {
  const memory = memoryKeyValueStore();
  const store = new BackgroundStore(memory, () => {});
  return { board: new BackdropBoard(store), store, memory };
}

describe('coverPlacement：剛好蓋滿可視範圍', () => {
  it('跟畫面同比例：縮放後剛好一樣大', () => {
    const p = coverPlacement(VIEW, 400, 200);
    expect(p).toEqual({ centerX: 100, centerY: 50, scale: 2 });
  });

  it('比畫面寬：高度對齊、左右超出', () => {
    const p = coverPlacement(VIEW, 1000, 200);
    expect(p.scale).toBe(2);
    expect(1000 * p.scale).toBeGreaterThanOrEqual(VIEW.width);
    expect(200 * p.scale).toBe(VIEW.height);
  });

  it('比畫面高：寬度對齊、上下超出', () => {
    const p = coverPlacement(VIEW, 100, 1000);
    expect(p.scale).toBe(8);
    expect(100 * p.scale).toBe(VIEW.width);
    expect(1000 * p.scale).toBeGreaterThanOrEqual(VIEW.height);
  });

  it('中心對準畫面中心', () => {
    const p = coverPlacement({ centerX: -300, centerY: 900, width: 50, height: 50 }, 10, 20);
    expect([p.centerX, p.centerY]).toEqual([-300, 900]);
  });
});

describe('BackdropBoard：新增、順序、刪除', () => {
  it('新增套用 cover 擺放，透明度 1、顯示中', () => {
    const { board } = memoryBoard();
    const b = board.add(image(400, 200), VIEW);
    expect(b).toMatchObject({ centerX: 100, centerY: 50, scale: 2, opacity: 1, visible: true });
    expect(board.list().map((x) => x.id)).toEqual([b.id]);
  });

  it('後加的疊在上面（list 依先畫→後畫）', () => {
    const { board } = memoryBoard();
    const a = board.add(image(10, 10), VIEW);
    const b = board.add(image(10, 10), VIEW);
    const c = board.add(image(10, 10), VIEW);
    expect(board.list().map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it('刪除只拿掉那一張；不存在的 id 不動作', () => {
    const { board } = memoryBoard();
    const a = board.add(image(10, 10), VIEW);
    const b = board.add(image(10, 10), VIEW);
    board.remove(a.id);
    board.remove('nope');
    expect(board.list().map((x) => x.id)).toEqual([b.id]);
  });

  it('變動時通知訂閱者', () => {
    const { board } = memoryBoard();
    const listener = vi.fn();
    board.onChange(listener);
    const a = board.add(image(10, 10), VIEW);
    board.remove(a.id);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('BackdropBoard：經記憶體儲存的來回', () => {
  it('寫入後用同一份儲存重建，圖片、位置、縮放、順序都一樣', async () => {
    const { board, store, memory } = memoryBoard();
    const a = board.add(image(400, 200, 'a'), VIEW);
    const bImage = image(100, 1000, 'b');
    const b = board.add(bImage, { ...VIEW, centerX: -500 });
    const c = board.add(image(30, 30, 'c'), VIEW);
    board.remove(c.id);
    await store.flush();

    const restored = await BackdropBoard.restore(new BackgroundStore(memory, () => {}));
    const list = restored.list();
    expect(list.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(list[0]).toMatchObject({
      centerX: 100,
      centerY: 50,
      scale: 2,
      opacity: 1,
      visible: true,
    });
    expect(list[1]).toMatchObject({ centerX: -500, scale: 8 });
    expect(list[0]!.image).toMatchObject({ width: 400, height: 200 });
    expect(list[1]!.image.blob).toBe(bImage.blob);
  });

  it('重建後新增的 id 不跟還原的撞號', async () => {
    const { board, store, memory } = memoryBoard();
    const a = board.add(image(10, 10), VIEW);
    const b = board.add(image(10, 10), VIEW);
    board.remove(a.id);
    await store.flush();
    const restored = await BackdropBoard.restore(new BackgroundStore(memory, () => {}));
    const c = restored.add(image(10, 10), VIEW);
    expect(c.id).not.toBe(b.id);
    expect(c.id).not.toBe(a.id);
  });

  it('清單指到的圖不見了就略過那一張', async () => {
    const { board, store, memory } = memoryBoard();
    const a = board.add(image(10, 10), VIEW);
    const b = board.add(image(10, 10), VIEW);
    await store.flush();
    const keys: string[] = [];
    // 直接把 a 的圖從底層刪掉，模擬寫到一半被關掉。
    for (const key of [`backdrop-image:${a.id}`]) {
      keys.push(key);
      await memory.delete(key);
    }
    const restored = await BackdropBoard.restore(new BackgroundStore(memory, () => {}));
    expect(restored.list().map((x) => x.id)).toEqual([b.id]);
  });

  it('儲存寫不進去時照樣能用（只在本次有效），只提示一次', async () => {
    const notify = vi.fn();
    const failing: AsyncKeyValueStore = {
      get: () => Promise.reject(new Error('blocked')),
      set: () => Promise.reject(new Error('blocked')),
      delete: () => Promise.reject(new Error('blocked')),
    };
    const store = new BackgroundStore(failing, notify);
    const board = new BackdropBoard(store);
    const a = board.add(image(10, 10), VIEW);
    board.add(image(10, 10), VIEW);
    board.remove(a.id);
    await store.flush();
    expect(board.list()).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
