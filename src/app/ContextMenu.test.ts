import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContextMenu, jellyMenuItems, type ContextMenuItem } from './ContextMenu';

describe('jellyMenuItems — Jelly 右鍵選單的項目與鎖定原因（issue #124）', () => {
  it('平常：重建、移除都能按', () => {
    expect(jellyMenuItems({ playing: false, recording: false })).toEqual([
      { id: 'rebuild', label: '重建', disabledReason: null },
      { id: 'remove', label: '移除', disabledReason: null },
    ]);
  });

  it('播放中：兩項都變灰，附原因', () => {
    const items = jellyMenuItems({ playing: true, recording: false });
    expect(items.map((i) => i.id)).toEqual(['rebuild', 'remove']);
    for (const item of items) expect(item.disabledReason).toMatch(/播放中/);
  });

  it('錄製中：只有重建變灰（移除照樣錄成事件）', () => {
    const [rebuild, remove] = jellyMenuItems({ playing: false, recording: true });
    expect(rebuild!.disabledReason).toMatch(/錄製中/);
    expect(remove!.disabledReason).toBeNull();
  });
});

describe('ContextMenu — 畫布上的右鍵選單（issue #124）', () => {
  let root: HTMLDivElement;
  let blockTarget: HTMLCanvasElement;
  let menu: ContextMenu;

  const items: ContextMenuItem<'a' | 'b'>[] = [
    { id: 'a', label: '甲', disabledReason: null },
    { id: 'b', label: '乙', disabledReason: '現在不行' },
  ];

  beforeEach(() => {
    root = document.createElement('div');
    blockTarget = document.createElement('canvas');
    root.appendChild(blockTarget);
    document.body.appendChild(root);
    menu = new ContextMenu({ dismissBlockTarget: blockTarget });
    root.appendChild(menu.element);
  });

  afterEach(() => {
    menu.destroy();
    root.remove();
  });

  function buttons(): HTMLButtonElement[] {
    return [...menu.element.querySelectorAll('button')];
  }

  function pointerdown(target: EventTarget, button = 0): Event {
    const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button });
    target.dispatchEvent(ev);
    return ev;
  }

  it('一開始是關的；open 後在指定位置顯示各項目，變灰的項目 disabled 並顯示原因', () => {
    expect(menu.isOpen).toBe(false);
    expect(menu.element.hidden).toBe(true);
    menu.open({ x: 120, y: 80 }, items, () => {});
    expect(menu.isOpen).toBe(true);
    expect(menu.element.hidden).toBe(false);
    expect(menu.element.style.left).toBe('120px');
    expect(menu.element.style.top).toBe('80px');
    const [a, b] = buttons();
    expect(a!.textContent).toContain('甲');
    expect(a!.disabled).toBe(false);
    expect(b!.disabled).toBe(true);
    expect(b!.textContent).toContain('現在不行');
  });

  it('選了項目 → 回呼收到 id，選單關閉', () => {
    const picked: string[] = [];
    menu.open({ x: 0, y: 0 }, items, (id) => picked.push(id));
    buttons()[0]!.click();
    expect(picked).toEqual(['a']);
    expect(menu.isOpen).toBe(false);
  });

  it('變灰的項目按不下去', () => {
    const picked: string[] = [];
    menu.open({ x: 0, y: 0 }, items, (id) => picked.push(id));
    buttons()[1]!.click();
    expect(picked).toEqual([]);
    expect(menu.isOpen).toBe(true);
  });

  it('按 Esc → 關閉，不回呼', () => {
    const picked: string[] = [];
    menu.open({ x: 0, y: 0 }, items, (id) => picked.push(id));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.isOpen).toBe(false);
    expect(picked).toEqual([]);
  });

  it('在選單外面按下 → 關閉；在選單裡按下不關', () => {
    menu.open({ x: 0, y: 0 }, items, () => {});
    pointerdown(buttons()[0]!);
    expect(menu.isOpen).toBe(true);
    pointerdown(document.body);
    expect(menu.isOpen).toBe(false);
  });

  it('點畫布左鍵關選單時，那一下被吞掉（不會順便生成）；右鍵照常傳下去（可以直接換一塊開選單）', () => {
    let reached = 0;
    blockTarget.addEventListener('pointerdown', () => reached++);
    menu.open({ x: 0, y: 0 }, items, () => {});
    pointerdown(blockTarget, 0);
    expect(menu.isOpen).toBe(false);
    expect(reached).toBe(0);

    menu.open({ x: 0, y: 0 }, items, () => {});
    pointerdown(blockTarget, 2);
    expect(menu.isOpen).toBe(false);
    expect(reached).toBe(1);

    // 選單關著時不吞任何東西。
    pointerdown(blockTarget, 0);
    expect(reached).toBe(2);
  });

  it('close() 可以從外面關（切換工具）；關著時再呼叫無害', () => {
    menu.open({ x: 0, y: 0 }, items, () => {});
    menu.close();
    expect(menu.isOpen).toBe(false);
    menu.close();
    expect(menu.element.hidden).toBe(true);
  });

  it('重新 open 換掉項目與回呼', () => {
    const picked: string[] = [];
    menu.open({ x: 0, y: 0 }, items, () => picked.push('old'));
    menu.open({ x: 5, y: 5 }, [{ id: 'a', label: '丙', disabledReason: null }], (id) =>
      picked.push(`new:${id}`),
    );
    expect(buttons()).toHaveLength(1);
    buttons()[0]!.click();
    expect(picked).toEqual(['new:a']);
  });

  it('選單上的瀏覽器右鍵選單被擋掉', () => {
    menu.open({ x: 0, y: 0 }, items, () => {});
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    menu.element.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
