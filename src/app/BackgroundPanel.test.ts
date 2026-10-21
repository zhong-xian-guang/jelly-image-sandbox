import { describe, expect, it, vi } from 'vitest';

import { BackgroundPanel, type BackgroundPanelOptions } from './BackgroundPanel';

function makeOptions(overrides: Partial<BackgroundPanelOptions> = {}): BackgroundPanelOptions {
  return {
    initialColor: '#1a1a1a',
    onColorChange: () => {},
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
