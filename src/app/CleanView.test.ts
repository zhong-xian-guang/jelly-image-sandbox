import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLEAN_VIEW_CORNER_PX, CLEAN_VIEW_DWELL_MS, CleanView } from './CleanView';
import { HelpOverlay } from './HelpOverlay';

function pressKey(key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** jsdom 沒有 `PointerEvent`，用帶 `clientX/Y` 的 `MouseEvent` 冒充（監聽端只讀這兩個與 target）。 */
function pointerMove(target: Element, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}

describe('CleanView — 乾淨畫面進出（issue #130）', () => {
  let root: HTMLDivElement;
  let chrome: HTMLElement[];
  let onChange: ReturnType<typeof vi.fn<(active: boolean) => void>>;
  let view: CleanView;
  let escapeClaimed: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.appendChild(root);
    chrome = ['panel', 'bar', 'camera', 'import-hint'].map((name) => {
      const el = document.createElement('div');
      el.dataset.name = name;
      root.appendChild(el);
      return el;
    });
    onChange = vi.fn<(active: boolean) => void>();
    escapeClaimed = false;
    view = new CleanView({
      root,
      hide: chrome,
      onChange,
      isEscapeClaimed: () => escapeClaimed,
    });
    root.appendChild(view.element);
  });

  afterEach(() => {
    view.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('一開始不在乾淨畫面，離開鈕藏著', () => {
    expect(view.isActive).toBe(false);
    expect(view.element.hidden).toBe(true);
    expect(chrome.every((el) => !el.hidden)).toBe(true);
  });

  it('按標題列的進入鈕 → 介面元素全部藏起來、通知呼叫端', () => {
    view.createEnterButton().click();
    expect(view.isActive).toBe(true);
    expect(chrome.every((el) => el.hidden)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    // 離開鈕不是一進入就出現——要游標到左上角停一下。
    expect(view.element.hidden).toBe(true);
  });

  it('離開後介面元素回到看得見、通知呼叫端', () => {
    view.enter();
    view.exit();
    expect(view.isActive).toBe(false);
    expect(chrome.every((el) => !el.hidden)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('重複進入／離開不會重複通知', () => {
    view.enter();
    view.enter();
    view.exit();
    view.exit();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('進入時焦點若在要藏起來的元素裡，就把焦點拿掉（免得空白鍵按到看不見的鈕）', () => {
    const button = document.createElement('button');
    chrome[0]!.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);
    view.enter();
    expect(document.activeElement).not.toBe(button);
  });

  describe('Esc 離開', () => {
    it('乾淨畫面中按 Esc → 離開', () => {
      view.enter();
      const event = pressKey('Escape');
      expect(view.isActive).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it('不在乾淨畫面時 Esc 不做事、不擋預設行為', () => {
      const event = pressKey('Escape');
      expect(onChange).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('其他鍵不離開（空白鍵、數字鍵照常給快捷鍵用）', () => {
      view.enter();
      pressKey(' ');
      pressKey('1');
      expect(view.isActive).toBe(true);
    });

    it('Esc 被別人要走（例如右鍵選單開著）→ 這一下不離開，下一下才離開', () => {
      view.enter();
      escapeClaimed = true;
      pressKey('Escape');
      expect(view.isActive).toBe(true);
      escapeClaimed = false;
      pressKey('Escape');
      expect(view.isActive).toBe(false);
    });

    it('「?」說明浮層開著時，Esc 只關說明、不離開乾淨畫面', () => {
      const help = new HelpOverlay({ storage: null });
      document.body.appendChild(help.element);
      view.enter();
      help.open();
      pressKey('Escape');
      expect(help.isOpen).toBe(false);
      expect(view.isActive).toBe(true);
      pressKey('Escape');
      expect(view.isActive).toBe(false);
      help.destroy();
    });
  });

  describe('左上角停留浮出離開鈕', () => {
    const inside = CLEAN_VIEW_CORNER_PX / 2;

    it('游標停在左上角約 0.5 秒 → 浮出離開鈕', () => {
      view.enter();
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS - 1);
      expect(view.element.hidden).toBe(true);
      vi.advanceTimersByTime(1);
      expect(view.element.hidden).toBe(false);
    });

    it('在角落裡小幅移動不會重新計時', () => {
      view.enter();
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS / 2);
      pointerMove(root, inside + 5, inside + 5);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS / 2);
      expect(view.element.hidden).toBe(false);
    });

    it('還沒停夠就移開 → 不浮出', () => {
      view.enter();
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS / 2);
      pointerMove(root, CLEAN_VIEW_CORNER_PX + 50, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      expect(view.element.hidden).toBe(true);
    });

    it('浮出後游標移開 → 再藏起來；游標離開 root 也一樣', () => {
      view.enter();
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      pointerMove(root, 400, 300);
      expect(view.element.hidden).toBe(true);

      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      expect(view.element.hidden).toBe(false);
      root.dispatchEvent(new MouseEvent('pointerleave'));
      expect(view.element.hidden).toBe(true);
    });

    it('移到離開鈕上（鈕比感應範圍寬）不會藏起來', () => {
      view.enter();
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      pointerMove(view.element, CLEAN_VIEW_CORNER_PX + 40, inside);
      expect(view.element.hidden).toBe(false);
    });

    it('按離開鈕 → 離開乾淨畫面，離開鈕藏起來', () => {
      view.enter();
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      view.element.click();
      expect(view.isActive).toBe(false);
      expect(view.element.hidden).toBe(true);
      expect(chrome.every((el) => !el.hidden)).toBe(true);
    });

    it('不在乾淨畫面時游標到左上角不會浮出離開鈕', () => {
      pointerMove(root, inside, inside);
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS * 2);
      expect(view.element.hidden).toBe(true);
    });

    it('停留計時中就離開乾淨畫面 → 計時作廢，下次進入不會自己冒出來', () => {
      view.enter();
      pointerMove(root, inside, inside);
      view.exit();
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      expect(view.element.hidden).toBe(true);
      view.enter();
      vi.advanceTimersByTime(CLEAN_VIEW_DWELL_MS);
      expect(view.element.hidden).toBe(true);
    });
  });
});
