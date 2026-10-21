import { describe, expect, it, vi } from 'vitest';

import {
  BACKDROP_OPACITY_RANGE,
  BACKDROP_SCALE_RANGE,
  BACKDROP_SCALE_STEP,
  BackdropBoard,
  coverPlacement,
  stepBackdropValue,
  type BackdropImage,
} from './BackdropBoard';
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

describe('BackdropBoard：hit test、選取、移動（issue #149）', () => {
  /** 兩張重疊：a 在下（中心 0,0、200×100）、b 在上（中心 50,0、100×100）。 */
  function twoBoards() {
    const made = memoryBoard();
    const view = (cx: number, w: number, h: number) => ({
      centerX: cx,
      centerY: 0,
      width: w,
      height: h,
    });
    const a = made.board.add(image(200, 100), view(0, 200, 100));
    const b = made.board.add(image(100, 100), view(50, 100, 100));
    return { ...made, a, b };
  }

  it('只回最上層那張；點到外面回 null', () => {
    const { board, a, b } = twoBoards();
    expect(board.hitTest({ x: 60, y: 10 })).toBe(b.id);
    expect(board.hitTest({ x: -80, y: 10 })).toBe(a.id);
    expect(board.hitTest({ x: 0, y: 200 })).toBeNull();
    expect(board.hitTest({ x: 101, y: 0 })).toBeNull();
  });

  it('矩形邊界上也算點中', () => {
    const { board, a } = twoBoards();
    expect(board.hitTest({ x: -100, y: 50 })).toBe(a.id);
  });

  it('被隱藏的那張點不到，會點到底下那張', () => {
    const { board, a, b } = twoBoards();
    board.setVisible(b.id, false);
    expect(board.hitTest({ x: 60, y: 10 })).toBe(a.id);
  });

  it('移動改中心、hit test 跟著走', () => {
    const { board, b } = twoBoards();
    board.move(b.id, 1000, -20);
    expect(board.get(b.id)).toMatchObject({ centerX: 1050, centerY: -20 });
    expect(board.hitTest({ x: 1050, y: -20 })).toBe(b.id);
  });

  it('選取與取消選取；選不存在的 id 視為取消', () => {
    const { board, a } = twoBoards();
    expect(board.selectedId).toBeNull();
    board.select(a.id);
    expect(board.selectedId).toBe(a.id);
    board.select(null);
    expect(board.selectedId).toBeNull();
    board.select('nope');
    expect(board.selectedId).toBeNull();
  });

  it('刪除選中那張後選取被清掉；刪別張不影響', () => {
    const { board, a, b } = twoBoards();
    board.select(a.id);
    board.remove(b.id);
    expect(board.selectedId).toBe(a.id);
    board.remove(a.id);
    expect(board.selectedId).toBeNull();
  });

  it('移動後的位置存起來', async () => {
    const { board, store, memory, b } = twoBoards();
    board.move(b.id, 5, 6);
    board.move(b.id, 5, 6);
    await store.flush();
    const restored = await BackdropBoard.restore(new BackgroundStore(memory, () => {}));
    expect(restored.get(b.id)).toMatchObject({ centerX: 60, centerY: 12 });
  });
});

describe('BackdropBoard：縮放、透明度、疊放順序（issue #150）', () => {
  function threeBoards() {
    const made = memoryBoard();
    const a = made.board.add(image(10, 10), VIEW);
    const b = made.board.add(image(10, 10), VIEW);
    const c = made.board.add(image(10, 10), VIEW);
    return { ...made, a, b, c };
  }
  const order = (board: BackdropBoard) => board.list().map((x) => x.id);

  it('縮放夾在範圍內', () => {
    const { board, a } = threeBoards();
    board.setScale(a.id, 3);
    expect(board.get(a.id)!.scale).toBe(3);
    board.setScale(a.id, 1e9);
    expect(board.get(a.id)!.scale).toBe(BACKDROP_SCALE_RANGE.max);
    board.setScale(a.id, 0);
    expect(board.get(a.id)!.scale).toBe(BACKDROP_SCALE_RANGE.min);
  });

  it('透明度夾在範圍內', () => {
    const { board, a } = threeBoards();
    board.setOpacity(a.id, 0.4);
    expect(board.get(a.id)!.opacity).toBe(0.4);
    board.setOpacity(a.id, 2);
    expect(board.get(a.id)!.opacity).toBe(1);
    board.setOpacity(a.id, -1);
    expect(board.get(a.id)!.opacity).toBe(BACKDROP_OPACITY_RANGE.min);
  });

  it('滾輪一格：縮放乘上固定倍率、透明度走一格並對齊格點', () => {
    expect(stepBackdropValue('scale', 2, 1)).toBeCloseTo(2 * BACKDROP_SCALE_STEP);
    expect(stepBackdropValue('scale', 2, -2)).toBeCloseTo(2 / BACKDROP_SCALE_STEP ** 2);
    expect(stepBackdropValue('opacity', 0.5, -1)).toBe(0.45);
    expect(stepBackdropValue('opacity', 0.3, 1)).toBe(0.35);
    expect(stepBackdropValue('opacity', 1, 3)).toBe(1);
  });

  it('移到最上層／最下層', () => {
    const { board, a, b, c } = threeBoards();
    board.bringToFront(a.id);
    expect(order(board)).toEqual([b.id, c.id, a.id]);
    board.sendToBack(c.id);
    expect(order(board)).toEqual([c.id, b.id, a.id]);
  });

  it('已經在最上層／最下層時不動作（不通知）', () => {
    const { board, a, c } = threeBoards();
    const listener = vi.fn();
    board.onChange(listener);
    board.bringToFront(c.id);
    board.sendToBack(a.id);
    expect(listener).not.toHaveBeenCalled();
    expect(board.isTop(c.id)).toBe(true);
    expect(board.isBottom(a.id)).toBe(true);
  });

  it('縮放、透明度、順序都存起來', async () => {
    const { board, store, memory, a, b, c } = threeBoards();
    board.setScale(b.id, 4);
    board.setOpacity(b.id, 0.5);
    board.bringToFront(a.id);
    await store.flush();
    const restored = await BackdropBoard.restore(new BackgroundStore(memory, () => {}));
    expect(order(restored)).toEqual([b.id, c.id, a.id]);
    expect(restored.get(b.id)).toMatchObject({ scale: 4, opacity: 0.5 });
  });
});
