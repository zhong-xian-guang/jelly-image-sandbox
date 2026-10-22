import { describe, expect, it, vi } from 'vitest';

import {
  BackgroundPanel,
  type BackdropListRow,
  type BackgroundPanelOptions,
} from './BackgroundPanel';

function makeOptions(overrides: Partial<BackgroundPanelOptions> = {}): BackgroundPanelOptions {
  return {
    initialColor: '#1a1a1a',
    onColorChange: () => {},
    onImportBackdrop: () => {},
    onDeleteBackdrop: () => {},
    onBackdropVisibleChange: () => {},
    onMoveBackdropUp: () => {},
    onMoveBackdropDown: () => {},
    onSelectBackdrop: () => {},
    onBackdropFieldChange: () => {},
    ...overrides,
  };
}

function colorInput(panel: BackgroundPanel): HTMLInputElement {
  const input = panel.element.querySelector('input[type="color"]') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

describe('BackgroundPanel — 背景色（issue #147）', () => {
  it('顏色選擇器的初值是傳進來的顏色', () => {
    const panel = new BackgroundPanel(makeOptions({ initialColor: '#00ff00' }));
    expect(colorInput(panel).value).toBe('#00ff00');
  });

  it('拖動選色時即時回呼新顏色', () => {
    const onColorChange = vi.fn();
    const panel = new BackgroundPanel(makeOptions({ onColorChange }));
    const input = colorInput(panel);
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input'));
    expect(onColorChange).toHaveBeenCalledWith('#ff0000');
  });

  it('setColor 只改顯示、不回呼', () => {
    const onColorChange = vi.fn();
    const panel = new BackgroundPanel(makeOptions({ onColorChange }));
    panel.setColor('#123456');
    expect(colorInput(panel).value).toBe('#123456');
    expect(onColorChange).not.toHaveBeenCalled();
  });
});

function listRow(id: string, label: string, thumbnailUrl: string): BackdropListRow {
  return {
    id,
    label,
    thumbnailUrl,
    visible: true,
    isTop: false,
    isBottom: false,
    selected: false,
    centerX: 0,
    centerY: 0,
    scale: 1,
    opacity: 1,
  };
}

function rows(panel: BackgroundPanel): HTMLElement[] {
  return [...panel.element.querySelectorAll('.jelly-backdrop-row')] as HTMLElement[];
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  expect(found, text).toBeDefined();
  return found!;
}

describe('BackgroundPanel — Backdrop 匯入與清單（issue #148）', () => {
  it('「匯入背景圖…」按鈕回呼', () => {
    const onImportBackdrop = vi.fn();
    const panel = new BackgroundPanel(makeOptions({ onImportBackdrop }));
    button(panel.element, '匯入背景圖…').click();
    expect(onImportBackdrop).toHaveBeenCalledTimes(1);
  });

  it('沒有 Backdrop 時清單顯示空狀態', () => {
    const panel = new BackgroundPanel(makeOptions());
    expect(rows(panel)).toHaveLength(0);
    expect(panel.element.querySelector('.jelly-backdrop-empty')).not.toBeNull();
  });

  it('每張一列：縮圖與名稱，最上層排在最前面', () => {
    const panel = new BackgroundPanel(makeOptions());
    panel.setBackdrops([
      listRow('backdrop/1', '背景圖 1', 'blob:a'),
      listRow('backdrop/2', '背景圖 2', 'blob:b'),
    ]);
    const list = rows(panel);
    expect(list.map((r) => r.dataset.backdropId)).toEqual(['backdrop/2', 'backdrop/1']);
    expect(list[0]!.querySelector('img')!.getAttribute('src')).toBe('blob:b');
    expect(list[0]!.textContent).toContain('背景圖 2');
    expect(panel.element.querySelector('.jelly-backdrop-empty')).toBeNull();
  });

  it('刪除鈕回呼那一列的 id', () => {
    const onDeleteBackdrop = vi.fn();
    const panel = new BackgroundPanel(makeOptions({ onDeleteBackdrop }));
    panel.setBackdrops([
      listRow('backdrop/1', '背景圖 1', 'blob:a'),
      listRow('backdrop/2', '背景圖 2', 'blob:b'),
    ]);
    button(rows(panel)[1]!, '刪除').click();
    expect(onDeleteBackdrop).toHaveBeenCalledWith('backdrop/1');
  });
});

describe('BackgroundPanel — 清單完整版（issue #151）', () => {
  function fullRow(id: string, overrides: Partial<BackdropListRow> = {}): BackdropListRow {
    return {
      id,
      label: id,
      thumbnailUrl: '',
      visible: true,
      isTop: false,
      isBottom: false,
      selected: false,
      centerX: 10,
      centerY: 20,
      scale: 1.5,
      opacity: 0.8,
      ...overrides,
    };
  }

  function fullOptions() {
    const calls = {
      visible: vi.fn(),
      up: vi.fn(),
      down: vi.fn(),
      select: vi.fn(),
      field: vi.fn(),
    };
    const panel = new BackgroundPanel(
      makeOptions({
        onBackdropVisibleChange: calls.visible,
        onMoveBackdropUp: calls.up,
        onMoveBackdropDown: calls.down,
        onSelectBackdrop: calls.select,
        onBackdropFieldChange: calls.field,
      }),
    );
    return { panel, calls };
  }

  function visibleToggle(row: HTMLElement): HTMLInputElement {
    return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
  }

  it('顯示開關反映狀態，切換時回呼', () => {
    const { panel, calls } = fullOptions();
    panel.setBackdrops([fullRow('a', { visible: false })]);
    const toggle = visibleToggle(rows(panel)[0]!);
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(calls.visible).toHaveBeenCalledWith('a', true);
  });

  it('上移／下移按鈕回呼；最上層的上移、最下層的下移是灰的', () => {
    const { panel, calls } = fullOptions();
    panel.setBackdrops([
      fullRow('a', { isBottom: true }),
      fullRow('b'),
      fullRow('c', { isTop: true }),
    ]);
    const [c, b, a] = rows(panel);
    expect(button(c!, '上移').disabled).toBe(true);
    expect(button(a!, '下移').disabled).toBe(true);
    button(b!, '上移').click();
    button(b!, '下移').click();
    expect(calls.up).toHaveBeenCalledWith('b');
    expect(calls.down).toHaveBeenCalledWith('b');
  });

  it('點一列回呼選取；按鈕與開關不算點列', () => {
    const { panel, calls } = fullOptions();
    panel.setBackdrops([fullRow('a'), fullRow('b')]);
    const row = rows(panel)[1]!;
    row
      .querySelector('.jelly-backdrop-name')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls.select).toHaveBeenCalledWith('a');
    calls.select.mockClear();
    button(row, '上移').click();
    visibleToggle(row).click();
    expect(calls.select).not.toHaveBeenCalled();
  });

  it('只有選中那一列展開 x／y／縮放／透明度欄位', () => {
    const { panel } = fullOptions();
    panel.setBackdrops([fullRow('a'), fullRow('b', { selected: true })]);
    const [b, a] = rows(panel);
    expect(b!.classList.contains('is-selected')).toBe(true);
    expect(b!.querySelectorAll('input[type="number"]')).toHaveLength(4);
    expect(a!.querySelectorAll('input[type="number"]')).toHaveLength(0);
    const values = [...b!.querySelectorAll('input[type="number"]')].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(values).toEqual(['10', '20', '1.5', '80']);
  });

  it('改數字欄位回呼（透明度欄位是百分比）', () => {
    const { panel, calls } = fullOptions();
    panel.setBackdrops([fullRow('a', { selected: true })]);
    const inputs = [
      ...rows(panel)[0]!.querySelectorAll('input[type="number"]'),
    ] as HTMLInputElement[];
    const set = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('change'));
    };
    set(inputs[0]!, '-5');
    set(inputs[1]!, '7.5');
    set(inputs[2]!, '2');
    set(inputs[3]!, '40');
    set(inputs[3]!, 'abc');
    expect(calls.field.mock.calls).toEqual([
      ['a', 'centerX', -5],
      ['a', 'centerY', 7.5],
      ['a', 'scale', 2],
      ['a', 'opacity', 0.4],
    ]);
  });

  it('只有數值變了（拖曳中）時就地更新欄位，不重建列、不動正在輸入的欄位', () => {
    const { panel } = fullOptions();
    panel.setBackdrops([fullRow('a', { selected: true })]);
    const row = rows(panel)[0]!;
    const inputs = [...row.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    document.body.appendChild(panel.element);
    inputs[1]!.focus();
    inputs[1]!.value = '99';
    panel.setBackdrops([fullRow('a', { selected: true, centerX: 50, centerY: 60 })]);
    expect(rows(panel)[0]).toBe(row);
    expect(inputs[0]!.value).toBe('50');
    expect(inputs[1]!.value).toBe('99');
    panel.element.remove();
  });
});

describe('BackgroundPanel — 數字欄位送出超出範圍的值（#152 驗證回饋）', () => {
  it('按 Enter 送出後，就算欄位還有焦點也會顯示被夾住後的值', () => {
    const panel = new BackgroundPanel(makeOptions());
    document.body.appendChild(panel.element);
    const row = { ...listRow('a', 'a', ''), selected: true, opacity: 0.4 };
    panel.setBackdrops([row]);
    const opacity = [
      ...rows(panel)[0]!.querySelectorAll('input[type="number"]'),
    ][3] as HTMLInputElement;
    opacity.focus();
    opacity.value = '0';
    opacity.dispatchEvent(new Event('change'));
    panel.setBackdrops([{ ...row, opacity: 0.05 }]);
    expect(opacity.value).toBe('5');
    // 送出那一次之後，繼續輸入中的欄位照舊不被洗掉。
    opacity.value = '7';
    panel.setBackdrops([{ ...row, opacity: 0.05 }]);
    expect(opacity.value).toBe('7');
    panel.element.remove();
  });
});
