/**
 * 側欄「背景」分區的內容（issue #147 / 背景 T1；spec #146）——Background color（背景色）的
 * 顏色選擇器、「匯入背景圖…」按鈕與 Backdrop 清單（issue #148）。
 *
 * 跟 `ControlPanel` 分開：「背景」區有自己的狀態要維護（Backdrop 清單），塞進那個已經很大的
 * 面板只會讓建構子選項再長一截。`JellySandbox` 建好後掛進 `controlPanel.sectionBody('background')`，
 * 所以展開／收起、記住展開狀態都沿用既有分區的做法。
 *
 * 跟 `ControlPanel` 一樣是薄的 DOM 接線層：使用者操作只往外回呼，`setX` 只改顯示、不回呼。
 *
 * **Backdrop 清單**：`setBackdrops(rows)` 給依疊放順序（先畫→後畫）的資料，面板倒過來列——
 * 最上層排在最前面，跟一般圖層面板一樣「上面那列＝疊在上面那張」。每列有縮圖、名稱與刪除鈕。
 * 每次整份重建（列數很少）。
 */

/** 清單上的一列（issue #148）。 */
export interface BackdropListRow {
  id: string;
  /** 顯示名稱（「背景圖 3」）。 */
  label: string;
  /** 縮圖網址（呼叫端用 `URL.createObjectURL` 給）。 */
  thumbnailUrl: string;
}

export interface BackgroundPanelOptions {
  /** 背景色（`#rrggbb`）的初值。 */
  initialColor: string;
  /** 使用者改了背景色——拖動選色器途中就會連續回呼，畫面即時跟著變。 */
  onColorChange: (color: string) => void;
  /** 「匯入背景圖…」按鈕（issue #148）。 */
  onImportBackdrop: () => void;
  /** 某列的刪除鈕（issue #148）。 */
  onDeleteBackdrop: (id: string) => void;
}

export class BackgroundPanel {
  readonly element: HTMLElement;
  private readonly colorInput: HTMLInputElement;
  private readonly listEl: HTMLElement;
  private readonly opts: BackgroundPanelOptions;

  constructor(opts: BackgroundPanelOptions) {
    this.opts = opts;
    this.element = document.createElement('div');
    this.element.className = 'jelly-background-panel';

    const colorRow = document.createElement('label');
    colorRow.className = 'jelly-control-row';
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.className = 'jelly-background-color';
    this.colorInput.value = opts.initialColor;
    this.colorInput.addEventListener('input', () => opts.onColorChange(this.colorInput.value));
    colorRow.append('背景色', this.colorInput);

    const importRow = document.createElement('div');
    importRow.className = 'jelly-control-row';
    importRow.append(this.button('匯入背景圖…', opts.onImportBackdrop));

    this.listEl = document.createElement('div');
    this.listEl.className = 'jelly-backdrop-list';

    this.element.append(colorRow, importRow, this.listEl);
    this.setBackdrops([]);
  }

  /** 從外部同步顯示的背景色（啟動時從儲存還原）——不回呼。 */
  setColor(color: string): void {
    this.colorInput.value = color;
  }

  /** Backdrop 清單（依疊放順序，先畫→後畫）；整份重建。 */
  setBackdrops(rows: readonly BackdropListRow[]): void {
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jelly-control-row jelly-backdrop-empty';
      empty.textContent = '還沒有背景圖';
      this.listEl.replaceChildren(empty);
      return;
    }
    this.listEl.replaceChildren(...[...rows].reverse().map((row) => this.rowEl(row)));
  }

  private rowEl(row: BackdropListRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jelly-backdrop-row';
    el.dataset.backdropId = row.id;

    const thumb = document.createElement('img');
    thumb.className = 'jelly-backdrop-thumb';
    thumb.src = row.thumbnailUrl;
    thumb.alt = '';

    const name = document.createElement('span');
    name.className = 'jelly-backdrop-name';
    name.textContent = row.label;

    el.append(
      thumb,
      name,
      this.button('刪除', () => this.opts.onDeleteBackdrop(row.id)),
    );
    return el;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }
}
