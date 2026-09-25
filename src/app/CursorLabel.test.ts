import { describe, expect, it } from 'vitest';

import { CursorLabel, cursorLabelText, type CursorLabelInput } from './CursorLabel';

function text(input: Partial<CursorLabelInput>): string | null {
  return cursorLabelText({ tool: 'grab', mode: null, value: null, formation: 'none', ...input });
}

describe('cursorLabelText（issue #122）', () => {
  it('抓取工具：單點只有模式名稱；大把加上半徑', () => {
    expect(text({ mode: 'single' })).toBe('單點');
    expect(text({ mode: 'handful', value: 140 })).toBe('大把 · 140');
  });

  it('編隊：還沒設定形狀、設定中、已有形狀各有不同文字', () => {
    expect(text({ mode: 'formation', formation: 'none' })).toBe('編隊（尚未設定形狀）');
    expect(text({ mode: 'formation', formation: 'defining' })).toBe('編隊（設定形狀中）');
    expect(text({ mode: 'formation', formation: 'ready' })).toBe('編隊');
  });

  it('沒有模式但有數值的舊工具（撒 Pin／移除 Pin）→ 工具名稱加數值', () => {
    expect(text({ tool: 'spray', value: 120 })).toBe('撒 Pin · 120');
    expect(text({ tool: 'erase', value: 100 })).toBe('移除 Pin · 100');
  });

  it('沒有模式也沒有數值 → 不顯示', () => {
    for (const tool of ['pin', 'fan', 'spawn', 'removeJelly', 'rebuildJelly'] as const) {
      expect(text({ tool })).toBeNull();
    }
  });
});

describe('CursorLabel — 顯示條件（issue #122）', () => {
  const visible = (label: CursorLabel) => label.element.classList.contains('is-visible');

  it('有文字、指標在畫布上、開關開著才顯示；跟著指標位置', () => {
    const label = new CursorLabel();
    label.setText('單點');
    expect(visible(label)).toBe(false); // 指標還沒進畫布
    label.setPosition({ x: 100, y: 50 });
    expect(visible(label)).toBe(true);
    expect(label.element.textContent).toBe('單點');
    expect(label.element.style.transform).toBe('translate(116px, 66px)');

    label.setPosition({ x: 10, y: 20 });
    expect(label.element.style.transform).toBe('translate(26px, 36px)');

    label.setPosition(null); // 移出畫布
    expect(visible(label)).toBe(false);
  });

  it('開關關掉 → 不顯示；打開 → 恢復', () => {
    const label = new CursorLabel();
    label.setText('大把 · 140');
    label.setPosition({ x: 0, y: 0 });
    label.setEnabled(false);
    expect(visible(label)).toBe(false);
    label.setEnabled(true);
    expect(visible(label)).toBe(true);
  });

  it('文字變成 null（沒有模式也沒有數值的工具）→ 不顯示', () => {
    const label = new CursorLabel();
    label.setPosition({ x: 0, y: 0 });
    label.setText('單點');
    label.setText(null);
    expect(visible(label)).toBe(false);
  });
});
