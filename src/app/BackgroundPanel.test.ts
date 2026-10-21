import { describe, expect, it, vi } from 'vitest';

import { BackgroundPanel, type BackgroundPanelOptions } from './BackgroundPanel';

function makeOptions(overrides: Partial<BackgroundPanelOptions> = {}): BackgroundPanelOptions {
  return {
    initialColor: '#1a1a1a',
    onColorChange: () => {},
    onImportBackdrop: () => {},
    onDeleteBackdrop: () => {},
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
      { id: 'backdrop/1', label: '背景圖 1', thumbnailUrl: 'blob:a' },
      { id: 'backdrop/2', label: '背景圖 2', thumbnailUrl: 'blob:b' },
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
      { id: 'backdrop/1', label: '背景圖 1', thumbnailUrl: 'blob:a' },
      { id: 'backdrop/2', label: '背景圖 2', thumbnailUrl: 'blob:b' },
    ]);
    button(rows(panel)[1]!, '刪除').click();
    expect(onDeleteBackdrop).toHaveBeenCalledWith('backdrop/1');
  });
});
