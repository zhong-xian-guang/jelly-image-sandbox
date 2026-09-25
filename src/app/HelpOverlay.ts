/**
 * `HelpOverlay`（issue #132 / V4 U5；spec #127「操作說明」）——側欄標題列「?」打開的操作說明
 * 浮層：四個工具在各模式下的滑鼠操作、相機操作與快捷鍵（文字在 `./helpText`）。
 *
 * - 關閉：按關閉鈕、按 Esc、或點浮層外面（整片半透明背景）。背景蓋住整個畫面，所以「點外面」
 *   那一下只會關掉說明，不會順手抓到果凍。
 * - 第一次打開網頁時自動出現一次（`showIfFirstVisit`），**關掉**時才在 `localStorage` 記下看過；
 *   讀不到或讀寫丟錯一律當作第一次（寧可多出現，spec #127）。
 *
 * 比照 `ContextMenu`：純 DOM 元件，不知道 `JellySandbox` 的存在；「?」鈕由 `createOpenButton`
 * 產生，呼叫端放進 `ControlPanel.titleBarActions`。
 */

import { HELP_GROUPS } from './helpText';
import type { KeyValueStorage } from './panelLayout';

/** 記「看過操作說明」的 `localStorage` key。 */
export const HELP_SEEN_STORAGE_KEY = 'jelly-sandbox:help-seen';

export interface HelpOverlayOptions {
  /** 記「看過」的地方；`null`＝拿不到儲存（每次都當第一次）。 */
  storage: KeyValueStorage | null;
}

function hasSeenHelp(storage: KeyValueStorage | null): boolean {
  try {
    return storage?.getItem(HELP_SEEN_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

function markHelpSeen(storage: KeyValueStorage | null): void {
  try {
    storage?.setItem(HELP_SEEN_STORAGE_KEY, '1');
  } catch {
    // 存不進去就算了：下次打開網頁會再出現一次，不影響這一頁。
  }
}

export class HelpOverlay {
  /** 整片背景（點它＝點浮層外面）；裡面是說明卡片。 */
  readonly element: HTMLDivElement;
  private readonly storage: KeyValueStorage | null;
  private openState = false;

  constructor(opts: HelpOverlayOptions) {
    this.storage = opts.storage;

    const backdrop = document.createElement('div');
    backdrop.className = 'jelly-help-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'jelly-help-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'jelly-help-title');

    const header = document.createElement('div');
    header.className = 'jelly-help-header';
    const title = document.createElement('h2');
    title.id = 'jelly-help-title';
    title.textContent = '操作說明';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'jelly-help-close';
    close.textContent = '×';
    close.title = '關閉';
    close.setAttribute('aria-label', '關閉操作說明');
    close.addEventListener('click', () => this.close());
    header.append(title, close);

    const groups = document.createElement('div');
    groups.className = 'jelly-help-groups';
    for (const group of HELP_GROUPS) {
      const section = document.createElement('section');
      section.className = 'jelly-help-group';
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const list = document.createElement('dl');
      for (const entry of group.entries) {
        const dt = document.createElement('dt');
        dt.textContent = entry.keys;
        const dd = document.createElement('dd');
        dd.textContent = entry.action;
        list.append(dt, dd);
      }
      section.append(heading, list);
      groups.appendChild(section);
    }

    dialog.append(header, groups);
    backdrop.appendChild(dialog);
    this.element = backdrop;
  }

  get isOpen(): boolean {
    return this.openState;
  }

  /** 側欄標題列的「?」鈕——按了打開說明。 */
  createOpenButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jelly-help-open';
    button.textContent = '?';
    button.title = '操作說明';
    button.setAttribute('aria-label', '操作說明');
    button.addEventListener('click', () => this.open());
    return button;
  }

  open(): void {
    if (this.openState) return;
    this.openState = true;
    this.element.hidden = false;
    // capture：比其他 window 上的 Esc 監聽（右鍵選單、之後的乾淨畫面）先拿到，關說明就好。
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.hidden = true;
    window.removeEventListener('keydown', this.onKeyDown, true);
    markHelpSeen(this.storage);
  }

  /** 第一次打開網頁（還沒關過說明）就自動打開。 */
  showIfFirstVisit(): void {
    if (!hasSeenHelp(this.storage)) this.open();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.element.remove();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };
}
