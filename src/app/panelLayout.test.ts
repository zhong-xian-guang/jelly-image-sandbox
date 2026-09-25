/**
 * `panelLayout`（issue #128 / V4 U1）——側欄各分區展開狀態＋側欄收起狀態的讀寫。
 * 重點是「讀不到就用預設」：儲存不存在、丟錯、內容壞掉或缺欄位，都不能讓面板畫不出來。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_STORAGE_KEY,
  PANEL_SECTION_IDS,
  loadPanelLayout,
  savePanelLayout,
  type KeyValueStorage,
} from './panelLayout';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('panelLayout', () => {
  it('預設：只有物理展開、側欄沒收起', () => {
    const expanded = PANEL_SECTION_IDS.filter((id) => DEFAULT_PANEL_LAYOUT.expanded[id]);
    expect(expanded).toEqual(['physics']);
    expect(DEFAULT_PANEL_LAYOUT.sidebarCollapsed).toBe(false);
  });

  it('分區順序：匯入、片段、物理、檢視、Demo、錄製、開發者', () => {
    expect(PANEL_SECTION_IDS).toEqual([
      'import',
      'clip',
      'physics',
      'view',
      'demo',
      'record',
      'dev',
    ]);
  });

  it('沒有儲存（null storage 或沒有這個 key）→ 預設', () => {
    expect(loadPanelLayout(null)).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(loadPanelLayout(memoryStorage())).toEqual(DEFAULT_PANEL_LAYOUT);
  });

  it('存了再讀回來，一樣', () => {
    const storage = memoryStorage();
    const layout = {
      expanded: { ...DEFAULT_PANEL_LAYOUT.expanded, physics: false, record: true },
      sidebarCollapsed: true,
    };
    savePanelLayout(storage, layout);
    expect(storage.data[PANEL_LAYOUT_STORAGE_KEY]).toBeDefined();
    expect(loadPanelLayout(storage)).toEqual(layout);
  });

  it('讀寫丟錯 → 讀回預設、寫入不往外丟', () => {
    expect(loadPanelLayout(throwingStorage)).toEqual(DEFAULT_PANEL_LAYOUT);
    expect(() => savePanelLayout(throwingStorage, DEFAULT_PANEL_LAYOUT)).not.toThrow();
  });

  it('內容不是 JSON、或型別不對 → 預設', () => {
    for (const raw of ['{壞掉', '42', 'null', '[]', '"x"']) {
      expect(loadPanelLayout(memoryStorage({ [PANEL_LAYOUT_STORAGE_KEY]: raw }))).toEqual(
        DEFAULT_PANEL_LAYOUT,
      );
    }
  });

  it('缺欄位或欄位不是布林 → 那幾欄用預設，其他照存的', () => {
    const raw = JSON.stringify({ expanded: { demo: true, physics: 'yes', bogus: true } });
    const layout = loadPanelLayout(memoryStorage({ [PANEL_LAYOUT_STORAGE_KEY]: raw }));
    expect(layout.expanded).toEqual({ ...DEFAULT_PANEL_LAYOUT.expanded, demo: true });
    expect(layout.sidebarCollapsed).toBe(false);
    expect(Object.keys(layout.expanded)).toEqual([...PANEL_SECTION_IDS]);
  });
});
