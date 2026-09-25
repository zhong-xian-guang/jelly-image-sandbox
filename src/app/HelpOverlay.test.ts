import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HELP_SEEN_STORAGE_KEY, HelpOverlay } from './HelpOverlay';
import { HELP_GROUPS } from './helpText';
import type { KeyValueStorage } from './panelLayout';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
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

function pointerDown(target: Element, button = 0): void {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button }));
}

function contextMenu(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  target.dispatchEvent(event);
  return event;
}

function pressKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('HelpOverlay — 「?」操作說明浮層（issue #132）', () => {
  let overlays: HelpOverlay[];

  function make(storage: KeyValueStorage | null = memoryStorage()): HelpOverlay {
    const overlay = new HelpOverlay({ storage });
    document.body.appendChild(overlay.element);
    overlays.push(overlay);
    return overlay;
  }

  beforeEach(() => {
    overlays = [];
  });

  afterEach(() => {
    for (const overlay of overlays) overlay.destroy();
    document.body.innerHTML = '';
  });

  it('一開始是關著的', () => {
    const overlay = make();
    expect(overlay.isOpen).toBe(false);
    expect(overlay.element.hidden).toBe(true);
  });

  it('按「?」鈕打開', () => {
    const overlay = make();
    const button = overlay.createOpenButton();
    expect(button.textContent).toBe('?');
    button.click();
    expect(overlay.isOpen).toBe(true);
    expect(overlay.element.hidden).toBe(false);
  });

  it('按關閉鈕關掉', () => {
    const overlay = make();
    overlay.open();
    const close = overlay.element.querySelector<HTMLButtonElement>('.jelly-help-close')!;
    close.click();
    expect(overlay.isOpen).toBe(false);
    expect(overlay.element.hidden).toBe(true);
  });

  it('按 Esc 關掉，並吞掉這次 Esc', () => {
    const overlay = make();
    overlay.open();
    const event = pressKey('Escape');
    expect(overlay.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('關著時按 Esc 不做事、也不吞', () => {
    const overlay = make();
    const event = pressKey('Escape');
    expect(overlay.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('點浮層外面（背景）關掉；點浮層裡面不關', () => {
    const overlay = make();
    overlay.open();
    pointerDown(overlay.element.querySelector('.jelly-help-dialog h3')!);
    expect(overlay.isOpen).toBe(true);
    pointerDown(overlay.element);
    expect(overlay.isOpen).toBe(false);
  });

  it('右鍵、中鍵點背景不關浮層；背景上的右鍵也不跳原生選單（issue #138）', () => {
    const overlay = make();
    overlay.open();
    pointerDown(overlay.element, 2);
    expect(overlay.isOpen).toBe(true);
    pointerDown(overlay.element, 1);
    expect(overlay.isOpen).toBe(true);
    expect(contextMenu(overlay.element).defaultPrevented).toBe(true);
    expect(overlay.isOpen).toBe(true);
    // 左鍵照舊關得掉。
    pointerDown(overlay.element, 0);
    expect(overlay.isOpen).toBe(false);
  });

  it('列出四個工具、相機與快捷鍵，每組都有操作', () => {
    const overlay = make();
    const titles = [...overlay.element.querySelectorAll('.jelly-help-group h3')].map(
      (h) => h.textContent,
    );
    expect(titles).toEqual(HELP_GROUPS.map((g) => g.title));
    const text = overlay.element.textContent!;
    for (const part of ['抓取', 'Pin', '電風扇', 'Jelly', '相機', '快捷鍵']) {
      expect(text).toContain(part);
    }
    for (const part of ['單點', '大把', '編隊', '放', '拔', '中鍵拖曳', '滾輪', '空白鍵']) {
      expect(text).toContain(part);
    }
  });

  describe('第一次打開網頁自動出現一次', () => {
    it('沒看過：自動打開；關掉後記住，下一次不再自動出現', () => {
      const storage = memoryStorage();
      const first = make(storage);
      first.showIfFirstVisit();
      expect(first.isOpen).toBe(true);
      first.close();
      expect(storage.data.has(HELP_SEEN_STORAGE_KEY)).toBe(true);

      const second = make(storage);
      second.showIfFirstVisit();
      expect(second.isOpen).toBe(false);
    });

    it('還沒關掉就重新整理：下一次照樣出現', () => {
      const storage = memoryStorage();
      make(storage).showIfFirstVisit();
      const second = make(storage);
      second.showIfFirstVisit();
      expect(second.isOpen).toBe(true);
    });

    it('看過之後按「?」照樣打得開', () => {
      const storage = memoryStorage();
      storage.setItem(HELP_SEEN_STORAGE_KEY, '1');
      const overlay = make(storage);
      overlay.showIfFirstVisit();
      expect(overlay.isOpen).toBe(false);
      overlay.createOpenButton().click();
      expect(overlay.isOpen).toBe(true);
    });

    it('localStorage 讀寫都丟錯：當作第一次照樣出現，關掉也不壞', () => {
      const overlay = make(throwingStorage);
      expect(() => overlay.showIfFirstVisit()).not.toThrow();
      expect(overlay.isOpen).toBe(true);
      expect(() => overlay.close()).not.toThrow();
      expect(overlay.isOpen).toBe(false);
    });

    it('拿不到 localStorage（null）：當作第一次', () => {
      const overlay = make(null);
      overlay.showIfFirstVisit();
      expect(overlay.isOpen).toBe(true);
      overlay.close();
      expect(overlay.isOpen).toBe(false);
    });
  });

  it('destroy 後 Esc 監聽解掉', () => {
    const overlay = make();
    overlay.open();
    overlay.destroy();
    const event = pressKey('Escape');
    expect(event.defaultPrevented).toBe(false);
  });
});
