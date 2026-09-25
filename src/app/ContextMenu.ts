/**
 * `ContextMenu`（issue #124 / V4 T3；spec #121「Jelly 工具」）——畫布上右鍵單擊跳出的小選單。
 * 第一個用它的是 Jelly 工具：右鍵點中某塊 Jelly → [重建｜移除]，作用在點中的那一塊
 * （`JellySandbox` 把那塊的 id 綁在 `open` 的回呼裡）。
 *
 * 純 DOM overlay（對照 `CursorLabel`／`BrushCursor`）：擺在畫布局部座標的游標處，自己
 * 收指標事件。暫時不能用的項目變灰（`disabled`）並把原因寫在項目旁邊——原因由呼叫端給
 * （`jellyMenuItems` 算 Jelly 選單的那一份），這個類別不知道播放／錄製的存在。
 *
 * 關閉條件：選了項目、在選單外面按下（任何鍵）、按 Esc、呼叫端 `close()`（切換工具時）。
 * 在畫布（`dismissBlockTarget`）上按**左鍵**關選單時，那一下被吞掉、不再傳給畫布——
 * 不然在 Jelly 工具下「點旁邊把選單關掉」會順便生成一塊。右鍵、中鍵照常傳下去：右鍵
 * 點另一塊就直接換成那一塊的選單，中鍵照樣平移相機。
 */

/** 選單的一個項目：`disabledReason` 非 `null` ＝ 變灰，並顯示這段原因。 */
export interface ContextMenuItem<Id extends string> {
  id: Id;
  label: string;
  disabledReason: string | null;
}

/** Jelly 右鍵選單的項目（CONTEXT.md「重建」「移除 Jelly」）。 */
export type JellyMenuItemId = 'rebuild' | 'remove';

/**
 * Jelly 右鍵選單的項目與鎖定原因（issue #124），沿用原本三個 Jelly 工具的鎖法：播放中
 * 移除與重建都不行（Scene 快照不該把 Track 正在播、播完就消失的塊收進去）；錄製中不能
 * 重建（重建只改 Scene、不是可以錄的事件——移除則照樣錄成 `remove` 事件，ADR-0013）。
 */
export function jellyMenuItems(state: {
  playing: boolean;
  recording: boolean;
}): ContextMenuItem<JellyMenuItemId>[] {
  const playing = state.playing ? '播放中不能重建或移除——先按「停止／重設」' : null;
  return [
    {
      id: 'rebuild',
      label: '重建',
      disabledReason: playing ?? (state.recording ? '錄製中不能重建' : null),
    },
    { id: 'remove', label: '移除', disabledReason: playing },
  ];
}

export interface ContextMenuOptions {
  /** 在它上面按左鍵關選單時吞掉那一下（畫布），見類別頂端說明。 */
  dismissBlockTarget?: HTMLElement;
}

export class ContextMenu {
  readonly element: HTMLDivElement;
  private readonly dismissBlockTarget: HTMLElement | undefined;
  private onSelect: ((id: string) => void) | null = null;

  constructor(opts: ContextMenuOptions = {}) {
    this.dismissBlockTarget = opts.dismissBlockTarget;
    this.element = document.createElement('div');
    this.element.className = 'jelly-context-menu';
    this.element.setAttribute('role', 'menu');
    this.element.hidden = true;
    this.element.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /**
   * 在 `at`（畫布局部座標＝選單所在容器的座標）開選單；已經開著就整份換掉。超出容器右／
   * 下緣時往左／上挪，整個留在畫面內。
   */
  open<Id extends string>(
    at: { x: number; y: number },
    items: readonly ContextMenuItem<Id>[],
    onSelect: (id: Id) => void,
  ): void {
    this.onSelect = onSelect as (id: string) => void;
    this.element.replaceChildren(...items.map((item) => this.itemButton(item)));
    this.element.style.left = `${at.x}px`;
    this.element.style.top = `${at.y}px`;
    if (!this.isOpen) {
      this.element.hidden = false;
      window.addEventListener('pointerdown', this.onWindowPointerDown, true);
      window.addEventListener('keydown', this.onKeyDown);
    }
    this.keepInsideContainer(at);
  }

  close(): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.onSelect = null;
    window.removeEventListener('pointerdown', this.onWindowPointerDown, true);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    this.close();
    this.element.remove();
  }

  private itemButton(item: ContextMenuItem<string>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jelly-context-menu-item';
    button.setAttribute('role', 'menuitem');
    button.dataset.item = item.id;
    const label = document.createElement('span');
    label.className = 'jelly-context-menu-label';
    label.textContent = item.label;
    button.appendChild(label);
    if (item.disabledReason !== null) {
      button.disabled = true;
      button.title = item.disabledReason;
      const reason = document.createElement('span');
      reason.className = 'jelly-context-menu-reason';
      reason.textContent = item.disabledReason;
      button.appendChild(reason);
    }
    button.addEventListener('click', () => {
      const onSelect = this.onSelect;
      this.close();
      onSelect?.(item.id);
    });
    return button;
  }

  private keepInsideContainer(at: { x: number; y: number }): void {
    const container = this.element.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const { width, height } = this.element.getBoundingClientRect();
    if (bounds.width > 0 && at.x + width > bounds.width) {
      this.element.style.left = `${Math.max(0, bounds.width - width)}px`;
    }
    if (bounds.height > 0 && at.y + height > bounds.height) {
      this.element.style.top = `${Math.max(0, bounds.height - height)}px`;
    }
  }

  private onWindowPointerDown = (ev: Event): void => {
    const target = ev.target;
    if (target instanceof Node && this.element.contains(target)) return;
    this.close();
    if (target === this.dismissBlockTarget && (ev as MouseEvent).button === 0) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this.close();
  };
}
