/**
 * `BrushCursor`（issue #69 / V2 T3-5；issue #70 追加 `setVariant`）的 DOM 測試
 * ——這層唯一有狀態的地方是「顯示與否 = 工具是撒 Pin／移除 Pin × 指標在畫布
 * 範圍內」這個組合、切到哪個用途（顏色 class），以及指標離開後不要留下鬼影。
 * 圓圈長什麼樣子（虛線、實際顏色）是 CSS 的事，jsdom 載不到樣式表，那部分靠
 * 瀏覽器人工驗證，不在這裡測。
 *
 * issue #79 / V2 T3-8 起，「指標在不在畫布上、在哪裡」由 `CanvasHover` 判定後
 * 餵進來（見 `CanvasHover.test.ts`），這裡只驗「拿到位置／拿到 null 之後怎麼
 * 顯示」——所以下面用 `setPosition` 取代原本直接派送 DOM 指標事件。
 */

import { describe, expect, it } from 'vitest';

import { BrushCursor } from './BrushCursor';

function makeCursor() {
  const cursor = new BrushCursor();
  document.body.appendChild(cursor.element);
  const isVisible = () => cursor.element.classList.contains('is-active');
  return { cursor, isVisible };
}

describe('BrushCursor — 撒 Pin 的筆刷圓圈游標（issue #69 / V2 T3-5）', () => {
  it('預設不顯示；沒切到撒 Pin 工具時，指標怎麼動都不顯示', () => {
    const { cursor, isVisible } = makeCursor();
    expect(isVisible()).toBe(false);
    cursor.setPosition({ x: 10, y: 10 });
    expect(isVisible()).toBe(false);
    cursor.destroy();
  });

  it('切到撒 Pin 工具 + 指標進到畫布上 → 顯示', () => {
    const { cursor, isVisible } = makeCursor();
    cursor.setActive(true);
    expect(isVisible()).toBe(false); // 指標還沒進來，先不要憑空冒出一個圓圈
    cursor.setPosition({ x: 10, y: 10 });
    expect(isVisible()).toBe(true);
    cursor.destroy();
  });

  it('位置變成 null（指標離開畫布）→ 收起來，不黏在最後一個位置', () => {
    const { cursor, isVisible } = makeCursor();
    cursor.setActive(true);
    cursor.setPosition({ x: 10, y: 10 });
    expect(isVisible()).toBe(true);

    cursor.setPosition(null);
    expect(isVisible()).toBe(false);

    cursor.setPosition({ x: 20, y: 20 }); // 回到畫布上 → 重新出現
    expect(isVisible()).toBe(true);
    cursor.destroy();
  });

  it('setPosition → 圓圈搬到該座標並以圓心對齊', () => {
    const { cursor } = makeCursor();
    cursor.setActive(true);
    cursor.setPosition({ x: 40, y: 25 });
    const circle = cursor.element.querySelector('.jelly-brush-cursor-circle') as HTMLElement;
    expect(circle.style.transform).toBe('translate(40px, 25px) translate(-50%, -50%)');
    cursor.destroy();
  });

  it('切離撒 Pin 工具 → 立刻收起來；再切回來要等指標重新進場', () => {
    const { cursor, isVisible } = makeCursor();
    cursor.setActive(true);
    cursor.setPosition({ x: 10, y: 10 });

    cursor.setActive(false);
    expect(isVisible()).toBe(false);

    cursor.setActive(true);
    expect(isVisible()).toBe(false);
    cursor.setPosition({ x: 20, y: 20 });
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

  // issue #70：移除 Pin 共用同一顆圓圈，只換顏色（CSS class）——同一時間只能帶
  // 一個用途的 class，不然兩組顏色規則會互相蓋。實際的顏色靠瀏覽器人工驗證。
  it('setVariant → 圓圈只帶目前用途的 class，預設是撒 Pin', () => {
    const { cursor } = makeCursor();
    const circle = cursor.element.querySelector('.jelly-brush-cursor-circle') as HTMLElement;
    expect(circle.classList.contains('is-spray')).toBe(true);
    expect(circle.classList.contains('is-erase')).toBe(false);

    cursor.setVariant('erase');
    expect(circle.classList.contains('is-erase')).toBe(true);
    expect(circle.classList.contains('is-spray')).toBe(false);

    cursor.setVariant('spray');
    expect(circle.classList.contains('is-spray')).toBe(true);
    expect(circle.classList.contains('is-erase')).toBe(false);
    cursor.destroy();
  });

  it('destroy → 元素從 DOM 移除', () => {
    const { cursor } = makeCursor();
    expect(cursor.element.isConnected).toBe(true);
    cursor.destroy();
    expect(cursor.element.isConnected).toBe(false);
  });
});
