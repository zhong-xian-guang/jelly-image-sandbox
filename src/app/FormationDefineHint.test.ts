import { describe, expect, it } from 'vitest';

import { FormationDefineHint } from './FormationDefineHint';
import { FORMATION_DEFINE_HINT } from './helpText';

describe('FormationDefineHint — 定義編隊形狀時畫布上方的說明（issue #132）', () => {
  it('一開始藏著，文字是固定的說明', () => {
    const hint = new FormationDefineHint();
    expect(hint.element.hidden).toBe(true);
    expect(hint.element.textContent).toBe(FORMATION_DEFINE_HINT);
  });

  it('setVisible 切顯示；不吃指標事件（由 CSS 負責，這裡只看 class）', () => {
    const hint = new FormationDefineHint();
    hint.setVisible(true);
    expect(hint.element.hidden).toBe(false);
    hint.setVisible(false);
    expect(hint.element.hidden).toBe(true);
    expect(hint.element.classList.contains('jelly-formation-define-hint')).toBe(true);
  });
});
