/**
 * `FormationDefineHint`（issue #132 / V4 U5；spec #127「操作說明」）——定義編隊形狀時，畫布上方
 * 置中的一行說明「依序點出各點，按『完成設定』結束」。
 *
 * 它是**提示**（CONTEXT.md「提示」）：「播放時隱藏提示」與乾淨畫面都會把它壓下；要不要顯示由
 * `JellySandbox` 每幀算好餵進 `setVisible`（值沒變不寫 DOM）。`pointer-events: none`，不擋畫布
 * 上點形狀的那幾下。
 */

import { FORMATION_DEFINE_HINT } from './helpText';

export class FormationDefineHint {
  readonly element: HTMLDivElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-formation-define-hint';
    this.element.textContent = FORMATION_DEFINE_HINT;
    this.element.hidden = true;
  }

  setVisible(visible: boolean): void {
    if (this.element.hidden === !visible) return;
    this.element.hidden = !visible;
  }

  destroy(): void {
    this.element.remove();
  }
}
