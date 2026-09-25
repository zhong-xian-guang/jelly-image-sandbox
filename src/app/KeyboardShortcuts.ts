/**
 * `KeyboardShortcuts`（issue #126 / V4 T5；spec #121「快捷鍵」、ADR-0016）——可有可無的
 * 鍵盤快捷鍵。操作設計以滑鼠為主（ADR-0016），這裡只補兩組：
 *
 * - 數字 1–4：切到工具列上對應順序的工具（`TOOL_IDS`：抓取、Pin、電風扇、Jelly）。
 * - 空白鍵：只在 Track／Demo 播放中切換暫停／繼續。
 *
 * 獨立的小模組，只在 window 上聽鍵盤、再呼叫注入的回呼——不碰 `ToolRouter`／`ControlPanel`
 * 的內部，切工具與暫停走的是跟工具列按鈕、暫停鈕相同的路徑（由呼叫端接線）。
 */

import { TOOL_IDS, type ToolId } from '../input';

export interface KeyboardShortcutHandlers {
  /** 切到這個工具（呼叫端要同步工具列高亮與參數卡）。 */
  selectTool(tool: ToolId): void;
  /** 目前是否正在播放 Track／Demo——空白鍵只在這時作用。 */
  isPlaying(): boolean;
  /** 切換播放暫停／繼續。 */
  togglePause(): void;
}

export class KeyboardShortcuts {
  /**
   * 這一下空白鍵被快捷鍵吃掉了（播放中暫停／繼續）——放開前的連發與放開那一下也要擋掉：
   * 按鈕與勾選框的空白鍵啟動發生在 keyup，只擋 keydown 的話聚焦中的按鈕還是會被按下。
   */
  private swallowingSpace = false;

  constructor(private readonly handlers: KeyboardShortcutHandlers) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === ' ') {
      if (ev.repeat && this.swallowingSpace) ev.preventDefault();
      if (!ev.repeat) this.swallowingSpace = false; // 上一次的 keyup 沒收到（例如視窗失焦）也不殘留
    }
    // 修飾鍵組合留給瀏覽器／系統（例如 Ctrl+1 切分頁）；連發（按住不放）不重複觸發；
    // 輸入法組字中的按鍵是在打字
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || ev.isComposing) return;
    if (isTextEntryTarget(ev.target)) return;
    if (ev.key === ' ') {
      if (!this.handlers.isPlaying()) return; // 沒在播放：不做事，空白鍵照常（例如按下聚焦中的按鈕）
      ev.preventDefault();
      this.swallowingSpace = true;
      this.handlers.togglePause();
      return;
    }
    const tool = toolForKey(ev.key);
    if (tool !== null) this.handlers.selectTool(tool);
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.key !== ' ' || !this.swallowingSpace) return;
    this.swallowingSpace = false;
    ev.preventDefault();
  };
}

/** 數字鍵 1–4 對應的工具（照工具列順序）；其他鍵回 `null`。 */
function toolForKey(key: string): ToolId | null {
  const index = Number.parseInt(key, 10) - 1;
  if (key.length !== 1 || !(index >= 0)) return null;
  return TOOL_IDS[index] ?? null;
}

/**
 * 焦點在會吃鍵盤的欄位上嗎（`input`／`textarea`／`select`／可編輯元素）——在 Track 名稱、
 * 秒數這類欄位裡打字時，數字與空白是要打進去的字，不是快捷鍵。`input` 不分 type 一律算：
 * 數字欄要吃數字、拉霸與勾選框本身也用鍵盤操作。
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select') !== null) return true;
  // jsdom 沒實作 `isContentEditable`，另外看屬性（`contenteditable="false"` 以外都算可編輯）
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const editable = target.closest('[contenteditable]');
  return editable !== null && editable.getAttribute('contenteditable') !== 'false';
}
