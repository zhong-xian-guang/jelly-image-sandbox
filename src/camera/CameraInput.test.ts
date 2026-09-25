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

describe('CameraInput — 按住右鍵＋滾輪調目前模式的數值（issue #114；issue #122 推廣）', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
    stubPointerCapture(el);
  });

  function setup(adjustModeValue?: (steps: number) => boolean) {
    const cmds: CameraCommand[] = [];
    const input = new CameraInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      hitTest: () => false,
      emit: (c) => cmds.push(c),
      adjustModeValue,
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

  it('按住右鍵＋滾輪、模式有數值 → 交給 adjustModeValue（往上滾 = +1、往下滾 = −1），相機不縮放', () => {
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

  it('按住右鍵＋滾輪、模式沒有數值（adjustModeValue 回報不處理）→ 照舊縮放', () => {
    const { cmds } = setup(() => false);
    wheel(-100, 2);
    expect(cmds.some((c) => c.type === 'zoomBy')).toBe(true);
  });

  it('沒按右鍵 → 不問 adjustModeValue，照舊縮放', () => {
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

describe('CameraInput — 中鍵單擊輪替模式、中鍵拖曳平移（issue #122；ADR-0016）', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
    stubPointerCapture(el);
  });

  function setup() {
    const cmds: CameraCommand[] = [];
    const clicks: { x: number; y: number }[] = [];
    const input = new CameraInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      hitTest: () => true,
      emit: (c) => cmds.push(c),
      onMiddleClick: (x, y) => clicks.push({ x, y }),
    });
    return { cmds, clicks, input };
  }

  function fire(type: string, init: Parameters<typeof makePointerEvent>[1]): void {
    el.dispatchEvent(makePointerEvent(type, init));
  }

  it('中鍵點放（沒動）→ 觸發中鍵單擊、相機不動', () => {
    const { cmds, clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 4 });
    fire('pointerup', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 0 });
    expect(clicks).toEqual([{ x: 50, y: 50 }]);
    expect(cmds).toEqual([]);
  });

  it('中鍵點放、途中抖動不超過 Tap 門檻 → 仍是單擊，完全不平移', () => {
    const { cmds, clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 4 });
    fire('pointermove', { pointerId: 1, clientX: 53, clientY: 52, buttons: 4 });
    fire('pointerup', { pointerId: 1, clientX: 53, clientY: 52, button: 1, buttons: 0 });
    expect(clicks).toHaveLength(1);
    expect(cmds).toEqual([]);
  });

  it('中鍵拖曳超過門檻 → 平移（第一筆就補上從按下點起算的整段位移），不輪替', () => {
    const { cmds, clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 4 });
    fire('pointermove', { pointerId: 1, clientX: 53, clientY: 50, buttons: 4 });
    fire('pointermove', { pointerId: 1, clientX: 70, clientY: 60, buttons: 4 });
    fire('pointermove', { pointerId: 1, clientX: 80, clientY: 60, buttons: 4 });
    fire('pointerup', { pointerId: 1, clientX: 80, clientY: 60, button: 1, buttons: 0 });
    expect(clicks).toEqual([]);
    expect(cmds).toEqual([
      { type: 'panBy', dxScreen: 20, dyScreen: 10 },
      { type: 'panBy', dxScreen: 10, dyScreen: 0 },
    ]);
  });

  it('拖出門檻又拖回原點放開 → 不算單擊', () => {
    const { clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 4 });
    fire('pointermove', { pointerId: 1, clientX: 90, clientY: 50, buttons: 4 });
    fire('pointermove', { pointerId: 1, clientX: 50, clientY: 50, buttons: 4 });
    fire('pointerup', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 0 });
    expect(clicks).toEqual([]);
  });

  it('中鍵 pointercancel → 不算單擊', () => {
    const { clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 4 });
    fire('pointercancel', { pointerId: 1, clientX: 50, clientY: 50 });
    expect(clicks).toEqual([]);
  });

  it('左鍵拖曳中再點中鍵（chorded，只有 pointermove）→ 算中鍵單擊，相機不動', () => {
    const { cmds, clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 0, buttons: 1 });
    fire('pointermove', { pointerId: 1, clientX: 60, clientY: 50, buttons: 1 });
    fire('pointermove', { pointerId: 1, clientX: 60, clientY: 50, button: 1, buttons: 5 });
    fire('pointermove', { pointerId: 1, clientX: 61, clientY: 50, button: 1, buttons: 1 });
    fire('pointerup', { pointerId: 1, clientX: 61, clientY: 50, button: 0, buttons: 0 });
    expect(clicks).toEqual([{ x: 61, y: 50 }]);
    expect(cmds).toEqual([]);
  });

  it('左鍵拖曳中按住中鍵拖一段（chorded）→ 不算單擊、也不平移（那個指標正在抓果凍）', () => {
    const { cmds, clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 0, buttons: 1 });
    fire('pointermove', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 5 });
    fire('pointermove', { pointerId: 1, clientX: 90, clientY: 50, buttons: 5 });
    fire('pointermove', { pointerId: 1, clientX: 90, clientY: 50, button: 1, buttons: 1 });
    fire('pointerup', { pointerId: 1, clientX: 90, clientY: 50, button: 0, buttons: 0 });
    expect(clicks).toEqual([]);
    expect(cmds).toEqual([]);
  });

  it('左鍵點放 → 不是中鍵單擊', () => {
    const { clicks } = setup();
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 0, buttons: 1 });
    fire('pointerup', { pointerId: 1, clientX: 50, clientY: 50, button: 0, buttons: 0 });
    expect(clicks).toEqual([]);
  });

  it('沒接 onMiddleClick → 中鍵點放什麼都不做、不爆炸', () => {
    const cmds: CameraCommand[] = [];
    new CameraInput(el, {
      screenToWorld: (x, y) => ({ x, y }),
      hitTest: () => true,
      emit: (c) => cmds.push(c),
    });
    fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 4 });
    fire('pointerup', { pointerId: 1, clientX: 50, clientY: 50, button: 1, buttons: 0 });
    expect(cmds).toEqual([]);
  });
});
