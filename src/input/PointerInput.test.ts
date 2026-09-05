import { beforeEach, describe, expect, it } from 'vitest';

import type { InputEvent } from '../sim';
import { PointerInput } from './PointerInput';

/**
 * jsdom（這個專案用的版本）沒實作 Pointer Capture API——補三個 no-op，
 * 不然 `PointerInput` 建構／收放事件時會直接丟例外。
 */
function stubPointerCapture(el: HTMLElement): void {
  Object.assign(el, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
  });
}

/**
 * 這個專案用的 jsdom 版本沒有全域 `PointerEvent` 建構子——借 `MouseEvent` 造一個
 * 帶 `pointerId` 屬性的事件，`PointerInput` 只讀得到 `pointerId`/`clientX`/`clientY`。
 */
function makePointerEvent(
  type: string,
  init: { pointerId: number; clientX: number; clientY: number; button?: number },
): Event {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId });
  return ev;
}

function fireDown(target: EventTarget, pointerId: number, x: number, y: number, button = 0): void {
  target.dispatchEvent(
    makePointerEvent('pointerdown', { pointerId, clientX: x, clientY: y, button }),
  );
}

function fireUp(target: EventTarget, pointerId: number, x: number, y: number): void {
  target.dispatchEvent(makePointerEvent('pointerup', { pointerId, clientX: x, clientY: y }));
}

describe('PointerInput — 每個手勢配一個獨立 id（不直接沿用瀏覽器的 pointerId）', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        x: 0,
        y: 0,
      }) as DOMRect;
    stubPointerCapture(el);
  });

  it('滑鼠永遠回報同一個 pointerId，但兩次分開的 down→up 手勢要拿到不同的內部 id', () => {
    const events: InputEvent[] = [];
    const input = new PointerInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      applyInput: (e) => events.push(e),
    });

    fireDown(el, 1, 10, 10);
    fireUp(el, 1, 10, 10);
    fireDown(el, 1, 50, 50);
    fireUp(el, 1, 50, 50);

    const grabs = events.filter((e) => e.type === 'grab');
    expect(grabs).toHaveLength(2);
    expect(grabs[0]!.id).not.toBe(grabs[1]!.id);

    input.destroy();
  });

  it('同一個 id 放開後再重用（模擬瀏覽器 pointerId 循環使用）也不會混到上一次手勢', () => {
    const events: InputEvent[] = [];
    const input = new PointerInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      applyInput: (e) => events.push(e),
    });

    fireDown(el, 7, 0, 0);
    fireUp(el, 7, 0, 0);
    events.length = 0;

    // 新手勢重用同一個瀏覽器 pointerId=7；只有這次的 grab/release 該出現。
    fireDown(el, 7, 20, 20);
    fireUp(el, 7, 20, 20);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'grab')).toHaveLength(1);
    expect(types.filter((t) => t === 'release')).toHaveLength(1);

    input.destroy();
  });

  it('滑鼠中鍵按下不算 Grab（中鍵留給 CameraInput 當相機平移）', () => {
    const events: InputEvent[] = [];
    const input = new PointerInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      applyInput: (e) => events.push(e),
    });

    fireDown(el, 1, 10, 10, 1); // button === 1（中鍵）
    fireUp(el, 1, 10, 10);

    expect(events).toHaveLength(0);

    input.destroy();
  });
});
