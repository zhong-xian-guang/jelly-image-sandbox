import { beforeEach, describe, expect, it } from 'vitest';

import { CameraInput } from './CameraInput';
import type { CameraCommand } from './types';

/** jsdom 沒實作 Pointer Capture API——補三個 no-op。 */
function stubPointerCapture(el: HTMLElement): void {
  Object.assign(el, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
  });
}

/**
 * jsdom 沒有全域 `PointerEvent` 建構子——借 `MouseEvent` 造一個帶
 * `pointerId`/`pointerType` 屬性的事件。
 */
function makePointerEvent(
  type: string,
  init: {
    pointerId: number;
    clientX: number;
    clientY: number;
    button?: number;
    pointerType?: string;
  },
): Event {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId });
  Object.defineProperty(ev, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return ev;
}

describe('CameraInput — 相機指標判定（滑鼠看鍵、觸控看是否命中背景）', () => {
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

  function drag(
    hitTest: (world: { x: number; y: number }) => boolean,
    downInit: { button?: number; pointerType?: string },
  ): CameraCommand[] {
    const cmds: CameraCommand[] = [];
    const input = new CameraInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      hitTest,
      emit: (c) => cmds.push(c),
    });

    el.dispatchEvent(
      makePointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, ...downInit }),
    );
    el.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 70, clientY: 60 }));
    input.destroy();
    return cmds;
  }

  it('滑鼠中鍵拖曳落在 Jelly 上（hitTest 命中）→ 仍然平移相機', () => {
    const cmds = drag(() => true, { button: 1 });
    expect(cmds.some((c) => c.type === 'panBy')).toBe(true);
  });

  it('滑鼠中鍵拖曳落在背景（hitTest 沒命中）→ 平移相機', () => {
    const cmds = drag(() => false, { button: 1 });
    expect(cmds.some((c) => c.type === 'panBy')).toBe(true);
  });

  it('滑鼠左鍵拖曳落在背景 → 不再觸發相機（改綁中鍵，左鍵留給 Grab）', () => {
    const cmds = drag(() => false, { button: 0 });
    expect(cmds).toHaveLength(0);
  });

  it('滑鼠左鍵拖曳落在 Jelly 上 → 不觸發相機（是 Grab）', () => {
    const cmds = drag(() => true, { button: 0 });
    expect(cmds).toHaveLength(0);
  });

  it('觸控落在背景（沒有「鍵」的概念）→ 維持原本行為，平移相機', () => {
    const cmds = drag(() => false, { pointerType: 'touch' });
    expect(cmds.some((c) => c.type === 'panBy')).toBe(true);
  });

  it('觸控落在 Jelly 上 → 不觸發相機（是 Grab）', () => {
    const cmds = drag(() => true, { pointerType: 'touch' });
    expect(cmds).toHaveLength(0);
  });
});
