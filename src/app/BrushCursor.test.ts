/**
 * `BrushCursor`（issue #69 / V2 T3-5）的 DOM 測試——這層唯一有狀態的地方是
 * 「顯示與否 = 工具是撒 Pin × 指標在畫布範圍內」這個組合，以及指標離開後不要
 * 留下鬼影。圓圈長什麼樣子（虛線、顏色）是 CSS 的事，jsdom 載不到樣式表，
 * 那部分靠瀏覽器人工驗證，不在這裡測。
 */

import { describe, expect, it } from 'vitest';

import { BrushCursor } from './BrushCursor';

/**
 * 同 `../input/PointerInput.test.ts`：這個專案用的 jsdom 版本沒有全域
 * `PointerEvent` 建構子，借 `MouseEvent` 造一個同名事件即可（`BrushCursor`
 * 只讀 `clientX`/`clientY`）。
 */
function pointerEvent(type: string, clientX = 0, clientY = 0): Event {
  return new MouseEvent(type, { bubbles: true, clientX, clientY });
}

function makeCursor() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cursor = new BrushCursor(root);
  root.appendChild(cursor.element);
  const isVisible = () => cursor.element.classList.contains('is-active');
  const movePointer = (clientX: number, clientY: number) =>
    root.dispatchEvent(pointerEvent('pointermove', clientX, clientY));
  return { root, cursor, isVisible, movePointer };
}

describe('BrushCursor — 撒 Pin 的筆刷圓圈游標（issue #69 / V2 T3-5）', () => {
  it('預設不顯示；沒切到撒 Pin 工具時，指標怎麼動都不顯示', () => {
    const { cursor, isVisible, movePointer } = makeCursor();
    expect(isVisible()).toBe(false);
    movePointer(10, 10);
    expect(isVisible()).toBe(false);
    cursor.destroy();
  });

  it('切到撒 Pin 工具 + 指標進到畫布上 → 顯示', () => {
    const { cursor, isVisible, movePointer } = makeCursor();
    cursor.setActive(true);
    expect(isVisible()).toBe(false); // 指標還沒進來，先不要憑空冒出一個圓圈
    movePointer(10, 10);
    expect(isVisible()).toBe(true);
    cursor.destroy();
  });

  it('指標移出畫布 → 收起來，不黏在最後一個位置', () => {
    const { root, cursor, isVisible, movePointer } = makeCursor();
    cursor.setActive(true);
    movePointer(10, 10);
    root.dispatchEvent(pointerEvent('pointerleave'));
    expect(isVisible()).toBe(false);
    cursor.destroy();
  });

  it('切離撒 Pin 工具 → 立刻收起來；再切回來要等指標重新進場', () => {
    const { cursor, isVisible, movePointer } = makeCursor();
    cursor.setActive(true);
    movePointer(10, 10);

    cursor.setActive(false);
    expect(isVisible()).toBe(false);

    cursor.setActive(true);
    expect(isVisible()).toBe(false);
    movePointer(20, 20);
    expect(isVisible()).toBe(true);
    cursor.destroy();
  });

  it('setRadiusPx → 圓圈直徑 = 半徑 × 2', () => {
    const { cursor } = makeCursor();
    cursor.setRadiusPx(60);
    const circle = cursor.element.querySelector('.jelly-brush-cursor-circle') as HTMLElement;
    expect(circle.style.width).toBe('120px');
    expect(circle.style.height).toBe('120px');
    cursor.destroy();
  });

  it('destroy → 解除 root 上的指標監聽（之後的事件不再改動狀態）', () => {
    const { cursor, isVisible, movePointer } = makeCursor();
    cursor.setActive(true);
    cursor.destroy();
    movePointer(10, 10);
    expect(isVisible()).toBe(false);
  });
});
