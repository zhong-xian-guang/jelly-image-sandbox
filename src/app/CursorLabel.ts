/**
 * `CursorLabel`（issue #122 / V4 T1；spec #121「游標標籤」）——跟著指標的小標籤，顯示
 * 目前模式，有數值時加上數值（「單點」「大把 · 140」「編隊（尚未設定形狀）」「放 · 120」）。模式是
 * 看不見的狀態，中鍵單擊切換之後要馬上看得出切到哪（ADR-0016）。
 *
 * 它**不是**提示（CONTEXT.md「提示」）：跟筆刷圓圈同一類的游標回饋，不受「播放時隱藏
 * 提示」影響，只聽自己的「顯示游標標籤」開關。比照 `BrushCursor` 的純 DOM overlay：
 * 位置由呼叫端每幀從 `CanvasHover` 餵進來（指標不在畫布上就是 `null`，標籤收起來），
 * `pointer-events: none` 不擋手勢。
 *
 * 文字由純函式 `cursorLabelText` 算，DOM 類別只管顯示——文字規則可以不開瀏覽器就測。
 */

import type { ToolMode } from '../input';
import type { HoverPoint } from './CanvasHover';
import { MODE_LABELS } from './toolLabels';

const VISIBLE_CLASS = 'is-visible';

/** 標籤相對指標的位移（CSS px）——擺在游標右下，不蓋住指標本身與筆刷圓心。 */
const OFFSET_PX = 16;

/** 編隊形狀的狀態：還沒定義過／正在定義中／已有形狀。 */
export type FormationShapeState = 'none' | 'defining' | 'ready';

export interface CursorLabelInput {
  /** 目前工具的模式；沒有模式為 `null`。 */
  mode: ToolMode | null;
  /** 目前模式用右鍵＋滾輪調的數值；沒有為 `null`。 */
  value: number | null;
  /** 編隊形狀的狀態——只有編隊模式會用到。 */
  formation: FormationShapeState;
}

/**
 * 標籤文字（「單點」「大把 · 140」「編隊 · 大把 140」「放 · 120」「強度 · 4000」）；工具沒有模式時回 `null`
 * （不顯示）——目前有數值可調的都是有模式的工具（大把抓取半徑、Pin 筆刷半徑、電風扇參數）。
 */
export function cursorLabelText(input: CursorLabelInput): string | null {
  if (input.mode === null) return null;
  let name = MODE_LABELS[input.mode];
  if (input.mode === 'formation') {
    // 編隊的數值只有每點大把的半徑（issue #135）：「編隊 · 大把 140」。還沒設定形狀時
    // 照舊只提示要先設定——那時畫面上沒有範圍圈，數值沒有對照對象。
    if (input.formation === 'none') return `${name}（尚未設定形狀）`;
    if (input.formation === 'defining') name += '（設定形狀中）';
    return input.value === null ? name : `${name} · ${MODE_LABELS.handful} ${input.value}`;
  }
  return input.value === null ? name : `${name} · ${input.value}`;
}

export class CursorLabel {
  readonly element: HTMLDivElement;
  private enabled = true;
  private text: string | null = null;
  private inside = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'jelly-cursor-label';
    this.element.setAttribute('aria-hidden', 'true');
  }

  /** 「顯示游標標籤」開關。 */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.applyVisibility();
  }

  /** 標籤文字（`cursorLabelText` 的結果）；`null` = 不顯示。值沒變不寫 DOM。 */
  setText(text: string | null): void {
    if (this.text === text) return;
    this.text = text;
    if (text !== null) this.element.textContent = text;
    this.applyVisibility();
  }

  /** 指標在畫布上的位置（`CanvasHover.point`）；離開畫布餵 `null`，標籤收起來。 */
  setPosition(point: HoverPoint | null): void {
    if (point) {
      this.element.style.transform = `translate(${point.x + OFFSET_PX}px, ${point.y + OFFSET_PX}px)`;
    }
    const inside = point !== null;
    if (this.inside === inside) return;
    this.inside = inside;
    this.applyVisibility();
  }

  destroy(): void {
    this.element.remove();
  }

  private applyVisibility(): void {
    this.element.classList.toggle(VISIBLE_CLASS, this.enabled && this.inside && this.text !== null);
  }
}
