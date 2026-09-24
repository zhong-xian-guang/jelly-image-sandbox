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
    buttons?: number;
    pointerType?: string;
  },
): Event {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
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

describe('CameraInput — 按住右鍵＋滾輪調工具半徑（issue #114）', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
    stubPointerCapture(el);
  });

  function setup(adjustToolRadius?: (steps: number) => boolean) {
    const cmds: CameraCommand[] = [];
    const input = new CameraInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      hitTest: () => false,
      emit: (c) => cmds.push(c),
      adjustToolRadius,
    });
    return { cmds, input };
  }

  function wheel(deltaY: number, buttons: number): WheelEvent {
    const ev = new WheelEvent('wheel', {
      deltaY,
      buttons,
      clientX: 50,
      clientY: 50,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  }

  it('按住右鍵＋滾輪、工具有半徑 → 交給 adjustToolRadius（往上滾 = +1、往下滾 = −1），相機不縮放', () => {
    const steps: number[] = [];
    const { cmds } = setup((s) => {
      steps.push(s);
      return true;
    });
    const ev = wheel(-100, 2);
    wheel(100, 2);
    expect(steps).toEqual([1, -1]);
    expect(cmds).toEqual([]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('按住右鍵＋滾輪、工具沒有半徑（adjustToolRadius 回報不處理）→ 照舊縮放', () => {
    const { cmds } = setup(() => false);
    wheel(-100, 2);
    expect(cmds.some((c) => c.type === 'zoomBy')).toBe(true);
  });

  it('沒按右鍵 → 不問 adjustToolRadius，照舊縮放', () => {
    let called = false;
    const { cmds } = setup(() => {
      called = true;
      return true;
    });
    wheel(-100, 0);
    wheel(-100, 1); // 只按左鍵也一樣
    expect(called).toBe(false);
    expect(cmds.filter((c) => c.type === 'zoomBy')).toHaveLength(2);
  });

  it('滾輪事件本身沒帶 buttons（部分瀏覽器）→ 改看指標事件記下的右鍵狀態', () => {
    const steps: number[] = [];
    const { cmds } = setup((s) => {
      steps.push(s);
      return true;
    });
    const at = { pointerId: 1, clientX: 50, clientY: 50 };
    el.dispatchEvent(makePointerEvent('pointerdown', { ...at, button: 2, buttons: 2 }));
    wheel(-100, 0);
    el.dispatchEvent(makePointerEvent('pointerup', { ...at, button: 2, buttons: 0 }));
    wheel(-100, 0);
    expect(steps).toEqual([1]);
    expect(cmds.filter((c) => c.type === 'zoomBy')).toHaveLength(1);
  });

  it('左鍵按住中再按右鍵（chorded，只有 pointermove）也算按住右鍵', () => {
    const steps: number[] = [];
    setup((s) => {
      steps.push(s);
      return true;
    });
    const at = { pointerId: 1, clientX: 50, clientY: 50 };
    el.dispatchEvent(makePointerEvent('pointerdown', { ...at, button: 0, buttons: 1 }));
    el.dispatchEvent(makePointerEvent('pointermove', { ...at, button: 2, buttons: 3 }));
    wheel(100, 0);
    expect(steps).toEqual([-1]);
  });

  it('畫布上的右鍵選單被擋掉', () => {
    setup();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('右鍵拖曳不觸發相機平移', () => {
    const { cmds } = setup();
    el.dispatchEvent(
      makePointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 2 }),
    );
    el.dispatchEvent(makePointerEvent('pointermove', { pointerId: 1, clientX: 90, clientY: 70 }));
    el.dispatchEvent(makePointerEvent('pointerup', { pointerId: 1, clientX: 90, clientY: 70 }));
    expect(cmds).toEqual([]);
  });
});
