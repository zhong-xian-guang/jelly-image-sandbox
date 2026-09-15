/**
 * `CanvasHover`（issue #79 / V2 T3-8）的 DOM 測試——這層唯一的狀態是「指標現在
 * 在畫布上的哪裡，或不在畫布上」。測試涵蓋：只認畫布來源的事件（控制面板等
 * 其他子元素冒泡上來的不算）、離開畫布後不留下舊座標、`destroy` 後不再更新。
 *
 * 座標換算依賴 `getBoundingClientRect`，jsdom 下一律回傳 0——所以這裡只驗
 * 「有沒有位置」與相對關係，實際像素對不對得上靠瀏覽器人工驗證。
 */

import { describe, expect, it } from 'vitest';

import { CanvasHover, type HoverPoint } from './CanvasHover';

/**
 * 同 `BrushCursor.test.ts`：這個專案用的 jsdom 版本沒有全域 `PointerEvent`
 * 建構子，借 `MouseEvent` 造一個同名事件即可（只讀 `clientX`/`clientY`）。
 */
function pointerEvent(type: string, clientX = 0, clientY = 0): Event {
  return new MouseEvent(type, { bubbles: true, clientX, clientY });
}

function makeHover() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  // 畫布與控制面板都是 root 的子元素，兩者的指標事件都會冒泡上來——`isCanvas`
  // 就是用來分辨這兩種來源的。
  const canvas = document.createElement('canvas');
  const panel = document.createElement('div');
  root.append(canvas, panel);
  const changes: (HoverPoint | null)[] = [];
  const hover = new CanvasHover(root, {
    isCanvas: (target) => target === canvas,
    onChange: (p) => changes.push(p),
  });
  const moveOver = (target: HTMLElement, clientX = 0, clientY = 0) =>
    target.dispatchEvent(pointerEvent('pointermove', clientX, clientY));
  return {
    root,
    canvas,
    panel,
    hover,
    changes,
    moveOver,
    movePointer: (x: number, y: number) => moveOver(canvas, x, y),
  };
}

describe('CanvasHover — 畫布上的指標懸停位置（issue #79 / V2 T3-8）', () => {
  it('一開始沒有位置（指標還沒進過畫布）', () => {
    const { hover } = makeHover();
    expect(hover.point).toBeNull();
    hover.destroy();
  });

  it('指標在畫布上移動 → 有位置', () => {
    const { hover, movePointer } = makeHover();
    movePointer(30, 40);
    expect(hover.point).toEqual({ x: 30, y: 40 });
    hover.destroy();
  });

  // 控制面板也是 root 的子元素，事件照樣冒泡上來——只看「在 root 範圍內」的話，
  // 跟著這個位置畫的東西會滑到面板上（issue #69 檢視回饋學到的教訓）。
  it('指標移到控制面板等非畫布元素上 → 位置歸零，不停留在畫布內的舊值', () => {
    const { hover, panel, movePointer, moveOver } = makeHover();
    movePointer(30, 40);
    moveOver(panel, 5, 5);
    expect(hover.point).toBeNull();

    movePointer(50, 60); // 回到畫布上 → 重新有位置
    expect(hover.point).toEqual({ x: 50, y: 60 });
    hover.destroy();
  });

  it('指標離開 root → 位置歸零', () => {
    const { root, hover, movePointer } = makeHover();
    movePointer(30, 40);
    root.dispatchEvent(pointerEvent('pointerleave'));
    expect(hover.point).toBeNull();
    hover.destroy();
  });

  it('onChange 在進場／移動／離場各通知一次，離場帶 null', () => {
    const { root, hover, changes, movePointer } = makeHover();
    movePointer(10, 10);
    movePointer(20, 20);
    root.dispatchEvent(pointerEvent('pointerleave'));
    expect(changes).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }, null]);
    hover.destroy();
  });

  it('已經在畫布外時再收到離場事件 → 不重複通知', () => {
    const { root, hover, changes } = makeHover();
    root.dispatchEvent(pointerEvent('pointerleave'));
    root.dispatchEvent(pointerEvent('pointerleave'));
    expect(changes).toEqual([]);
    hover.destroy();
  });

  it('destroy → 解除 root 上的指標監聽（之後的事件不再改動狀態）', () => {
    const { hover, movePointer } = makeHover();
    hover.destroy();
    movePointer(30, 40);
    expect(hover.point).toBeNull();
  });
});
