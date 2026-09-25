import { describe, expect, it } from 'vitest';

import { CursorLabel, cursorLabelText, type CursorLabelInput } from './CursorLabel';

function text(input: Partial<CursorLabelInput>): string | null {
  return cursorLabelText({ mode: null, value: null, formation: 'none', ...input });
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

  it('編隊＋每點大把（issue #135）：「編隊 · 大把 <半徑>」；還沒設定形狀照舊不帶數值', () => {
    expect(text({ mode: 'formation', formation: 'ready', value: 140 })).toBe('編隊 · 大把 140');
    expect(text({ mode: 'formation', formation: 'none', value: 140 })).toBe('編隊（尚未設定形狀）');
    // 定義中範圍圈已經畫在點下的點上、滾輪也調得動，所以數值照樣顯示。
    expect(text({ mode: 'formation', formation: 'defining', value: 90 })).toBe(
      '編隊（設定形狀中） · 大把 90',
    );
  });

  it('Pin 工具（issue #123）：放／拔加上 Pin 筆刷半徑', () => {
    expect(text({ mode: 'place', value: 120 })).toBe('放 · 120');
    expect(text({ mode: 'remove', value: 120 })).toBe('拔 · 120');
  });

  it('電風扇（issue #125）：「參數名 · 數值」', () => {
    expect(text({ mode: 'width', value: 150 })).toBe('寬度 · 150');
    expect(text({ mode: 'strength', value: 4000 })).toBe('強度 · 4000');
    expect(text({ mode: 'falloff', value: 2.1 })).toBe('衰減 · 2.1');
    expect(text({ mode: 'frequency', value: 0.5 })).toBe('頻率 · 0.5');
  });

  it('沒有模式的工具 → 不顯示', () => {
    expect(text({ mode: null })).toBeNull();
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
