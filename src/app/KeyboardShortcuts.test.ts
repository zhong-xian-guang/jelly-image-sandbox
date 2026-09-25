import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolId } from '../input';
import { KeyboardShortcuts } from './KeyboardShortcuts';

describe('KeyboardShortcuts — 鍵盤快捷鍵（issue #126）', () => {
  let selected: ToolId[];
  let pauseToggles: number;
  let playing: boolean;
  let shortcuts: KeyboardShortcuts;

  beforeEach(() => {
    selected = [];
    pauseToggles = 0;
    playing = false;
    shortcuts = new KeyboardShortcuts({
      selectTool: (tool) => selected.push(tool),
      isPlaying: () => playing,
      togglePause: () => {
        pauseToggles++;
      },
    });
  });

  afterEach(() => {
    shortcuts.destroy();
    document.body.replaceChildren();
  });

  /** 從 `target` 送出一個會冒泡到 window 的 keydown，回傳它（看 `defaultPrevented`）。 */
  function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  }

  it('數字 1–4 依工具列順序切到抓取、Pin、電風扇、Jelly', () => {
    press('1');
    press('2');
    press('3');
    press('4');
    expect(selected).toEqual(['grab', 'pin', 'fan', 'jelly']);
  });

  it('其他數字不對應工具', () => {
    press('0');
    press('5');
    expect(selected).toEqual([]);
  });

  it('播放中按空白鍵切換暫停／繼續，並擋掉預設行為', () => {
    playing = true;
    const first = press(' ');
    const second = press(' ');
    expect(pauseToggles).toBe(2);
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
  });

  it('沒在播放時空白鍵不做事、也不擋預設行為', () => {
    const space = press(' ');
    expect(pauseToggles).toBe(0);
    expect(space.defaultPrevented).toBe(false);
  });

  it('播放中對著聚焦的按鈕按空白鍵：只暫停，放開時也擋掉，按鈕不會被按下', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    playing = true;
    press(' ', {}, button);
    // 按鈕／勾選框的空白鍵啟動發生在 keyup，所以放開那一下也要擋
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    button.dispatchEvent(up);
    expect(pauseToggles).toBe(1);
    expect(up.defaultPrevented).toBe(true);
  });

  it('沒被快捷鍵吃掉的空白鍵放開時不擋（按鈕照常可用空白鍵按）', () => {
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    press(' ');
    document.body.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
  });

  it('destroy 之後不再作用', () => {
    shortcuts.destroy();
    playing = true;
    press('1');
    press(' ');
    expect(selected).toEqual([]);
    expect(pauseToggles).toBe(0);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['按鍵連發', { repeat: true }],
    // 輸入法組字中（例如注音選字時按數字鍵、空白鍵）是在打字，不是快捷鍵（issue #139）
    ['輸入法組字中', { isComposing: true }],
  ])('%s 時數字鍵與空白鍵都不作用', (_name, init) => {
    playing = true;
    press('3', init);
    const space = press(' ', init);
    expect(selected).toEqual([]);
    expect(pauseToggles).toBe(0);
    expect(space.defaultPrevented).toBe(false);
  });

  it.each([
    [
      'Track 名稱（text input）',
      () => Object.assign(document.createElement('input'), { type: 'text' }),
    ],
    [
      '秒數（number input）',
      () => Object.assign(document.createElement('input'), { type: 'number' }),
    ],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      '可編輯元素的子節點',
      () => {
        const host = document.createElement('div');
        host.setAttribute('contenteditable', 'true');
        const child = document.createElement('span');
        host.appendChild(child);
        document.body.appendChild(host);
        return child;
      },
    ],
  ])('焦點在 %s 裡打字時不切工具、也不暫停', (_name, make) => {
    const field = make();
    if (!field.isConnected) document.body.appendChild(field);
    playing = true;
    press('2', {}, field);
    const space = press(' ', {}, field);
    expect(selected).toEqual([]);
    expect(pauseToggles).toBe(0);
    expect(space.defaultPrevented).toBe(false);
  });
});
