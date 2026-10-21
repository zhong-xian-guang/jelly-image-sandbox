import { describe, expect, it, vi } from 'vitest';

import {
  BackgroundStore,
  DEFAULT_BACKGROUND_COLOR,
  memoryKeyValueStore,
  type AsyncKeyValueStore,
} from './backgroundStore';

/** 每個操作都丟錯的儲存（IndexedDB 被擋、配額滿）。 */
function failingStore(): AsyncKeyValueStore & { calls: number } {
  const store = {
    calls: 0,
    get: async () => {
      store.calls++;
      throw new Error('blocked');
    },
    set: async () => {
      store.calls++;
      throw new Error('blocked');
    },
    delete: async () => {
      store.calls++;
      throw new Error('blocked');
    },
  };
  return store;
}

describe('BackgroundStore：背景色', () => {
  it('沒存過時讀回 null（呼叫端用預設色）', async () => {
    const store = new BackgroundStore(memoryKeyValueStore(), () => {});
    expect(await store.loadColor()).toBeNull();
    expect(DEFAULT_BACKGROUND_COLOR).toBe('#1a1a1a');
  });

  it('寫入後用同一份儲存重建，讀回同一個顏色', async () => {
    const memory = memoryKeyValueStore();
    const first = new BackgroundStore(memory, () => {});
    first.saveColor('#00ff00');
    await first.flush();

    const second = new BackgroundStore(memory, () => {});
    expect(await second.loadColor()).toBe('#00ff00');
  });

  it('連續改色只留最後一個', async () => {
    const memory = memoryKeyValueStore();
    const store = new BackgroundStore(memory, () => {});
    store.saveColor('#111111');
    store.saveColor('#222222');
    store.saveColor('#333333');
    await store.flush();
    expect(await new BackgroundStore(memory, () => {}).loadColor()).toBe('#333333');
  });

  it('存著的值不是顏色時當作沒存過', async () => {
    const memory = memoryKeyValueStore();
    await memory.set('backgroundColor', 'not a color');
    expect(await new BackgroundStore(memory, () => {}).loadColor()).toBeNull();
  });
});

describe('BackgroundStore：儲存不能用時退回本次有效', () => {
  it('寫入失敗只提示一次，之後不再嘗試寫入', async () => {
    const failing = failingStore();
    const notify = vi.fn();
    const store = new BackgroundStore(failing, notify);
    store.saveColor('#00ff00');
    await store.flush();
    const callsAfterFirst = failing.calls;
    store.saveColor('#0000ff');
    store.saveColor('#ff0000');
    await store.flush();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(failing.calls).toBe(callsAfterFirst);
    expect(store.isPersistent).toBe(false);
  });

  it('讀取失敗不提示，回 null', async () => {
    const notify = vi.fn();
    const store = new BackgroundStore(failingStore(), notify);
    expect(await store.loadColor()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('根本沒有儲存（null）時，第一次寫入才提示一次', async () => {
    const notify = vi.fn();
    const store = new BackgroundStore(null, notify);
    expect(await store.loadColor()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    store.saveColor('#00ff00');
    store.saveColor('#ff00ff');
    await store.flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
