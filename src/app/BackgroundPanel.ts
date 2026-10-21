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
 * 最上層排在最前面，跟一般圖層面板一樣「上面那列＝疊在上面那張」。每列有顯示開關、縮圖、名稱、
 * 上移／下移與刪除鈕（issue #151；在最上層／最下層時對應的鈕變灰）。點一列＝選中那張
 * （`onSelectBackdrop`）；選中的那一列展開 x／y／縮放／透明度的數字欄位，改了就回呼
 * （`onBackdropFieldChange`，透明度欄位是百分比，回呼時換回 0–1）。選取狀態是 `BackdropBoard`
 * 那一份，畫布上選中時呼叫端照樣灌回來，兩邊同步。
 *
 * 列的結構（哪幾張、順序、選取、開關與按鈕狀態）變了才整份重建；只有數值變了（例如在畫布上
 * 拖曳、每幀都在改中心）就地更新數字欄位，而且跳過使用者正在輸入的那一格——不然一邊拖一邊
 * 重建，焦點與輸入到一半的字都會被洗掉。
 */

/** 清單上的一列（issue #148；issue #151 加上開關、順序、選取與數值）。 */
export interface BackdropListRow {
  id: string;
  /** 顯示名稱（「背景圖 3」）。 */
  label: string;
  /** 縮圖網址（呼叫端用 `URL.createObjectURL` 給）。 */
  thumbnailUrl: string;
  visible: boolean;
  /** 疊在最上面（上移鈕變灰）。 */
  isTop: boolean;
  /** 墊在最下面（下移鈕變灰）。 */
  isBottom: boolean;
  selected: boolean;
  centerX: number;
  centerY: number;
  scale: number;
  /** 0–1。 */
  opacity: number;
}

/** 選中那一列的數字欄位（issue #151）。 */
export type BackdropField = 'centerX' | 'centerY' | 'scale' | 'opacity';

export interface BackgroundPanelOptions {
  /** 背景色（`#rrggbb`）的初值。 */
  initialColor: string;
  /** 使用者改了背景色——拖動選色器途中就會連續回呼，畫面即時跟著變。 */
  onColorChange: (color: string) => void;
  /** 「匯入背景圖…」按鈕（issue #148）。 */
  onImportBackdrop: () => void;
  /** 某列的刪除鈕（issue #148）。 */
  onDeleteBackdrop: (id: string) => void;
  /** 某列的顯示開關（issue #151）。 */
  onBackdropVisibleChange: (id: string, visible: boolean) => void;
  /** 某列的上移鈕（往上疊一層，issue #151）。 */
  onMoveBackdropUp: (id: string) => void;
  /** 某列的下移鈕（往下墊一層，issue #151）。 */
  onMoveBackdropDown: (id: string) => void;
  /** 點了某一列（issue #151）——選中那張。 */
  onSelectBackdrop: (id: string) => void;
  /** 選中那一列的數字欄位改了（issue #151）；透明度已換回 0–1。 */
  onBackdropFieldChange: (id: string, field: BackdropField, value: number) => void;
}

/** 一個數字欄位：標籤、step、怎麼顯示、輸入值怎麼換回 Backdrop 的值。 */
interface FieldSpec {
  field: BackdropField;
  label: string;
  step: string;
  show: (row: BackdropListRow) => string;
  parse: (value: number) => number;
}

/** 透明度欄位用百分比，比 0–1 好打。 */
const FIELDS: readonly FieldSpec[] = [
  { field: 'centerX', label: 'x', step: '1', show: (r) => fixed(r.centerX, 1), parse: (v) => v },
  { field: 'centerY', label: 'y', step: '1', show: (r) => fixed(r.centerY, 1), parse: (v) => v },
  { field: 'scale', label: '縮放', step: '0.01', show: (r) => fixed(r.scale, 3), parse: (v) => v },
  {
    field: 'opacity',
    label: '透明度 %',
    step: '5',
    show: (r) => String(Math.round(r.opacity * 100)),
    parse: (v) => v / 100,
  },
];

function fixed(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** 決定要不要整份重建的那些欄位（數值不在內，見檔頭）。 */
function structureKey(rows: readonly BackdropListRow[]): string {
  return JSON.stringify(
    rows.map((r) => [r.id, r.label, r.thumbnailUrl, r.visible, r.isTop, r.isBottom, r.selected]),
  );
}

export class BackgroundPanel {
  readonly element: HTMLElement;
  private readonly colorInput: HTMLInputElement;
  private readonly listEl: HTMLElement;
  private readonly opts: BackgroundPanelOptions;
  /** 目前畫出來的列結構（`structureKey`）；`null` = 還沒畫過。 */
  private renderedKey: string | null = null;
  /** 選中那一列的數字欄位（就地更新用）。 */
  private fieldInputs: { spec: FieldSpec; input: HTMLInputElement }[] = [];

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

  /** Backdrop 清單（依疊放順序，先畫→後畫）。結構變了才重建，否則就地更新數值。 */
  setBackdrops(rows: readonly BackdropListRow[]): void {
    const key = structureKey(rows);
    if (key === this.renderedKey) {
      this.updateFields(rows.find((r) => r.selected));
      return;
    }
    this.renderedKey = key;
    this.fieldInputs = [];
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jelly-control-row jelly-backdrop-empty';
      empty.textContent = '還沒有背景圖';
      this.listEl.replaceChildren(empty);
      return;
    }
    this.listEl.replaceChildren(...[...rows].reverse().map((row) => this.rowEl(row)));
  }

  private updateFields(row: BackdropListRow | undefined): void {
    if (!row) return;
    const active = this.element.ownerDocument.activeElement;
    for (const { spec, input } of this.fieldInputs) {
      if (input !== active) input.value = spec.show(row);
    }
  }

  private rowEl(row: BackdropListRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jelly-backdrop-row';
    el.classList.toggle('is-selected', row.selected);
    el.dataset.backdropId = row.id;
    // 點列的空白處、縮圖、名稱＝選取；開關、按鈕、數字欄位各自有自己的事。
    el.addEventListener('click', (ev) => {
      if ((ev.target as Element).closest('button, input, label')) return;
      this.opts.onSelectBackdrop(row.id);
    });

    const main = document.createElement('div');
    main.className = 'jelly-backdrop-row-main';

    const visible = document.createElement('input');
    visible.type = 'checkbox';
    visible.checked = row.visible;
    visible.title = '顯示';
    visible.setAttribute('aria-label', `顯示${row.label}`);
    visible.addEventListener('change', () =>
      this.opts.onBackdropVisibleChange(row.id, visible.checked),
    );

    const thumb = document.createElement('img');
    thumb.className = 'jelly-backdrop-thumb';
    thumb.src = row.thumbnailUrl;
    thumb.alt = '';

    const name = document.createElement('span');
    name.className = 'jelly-backdrop-name';
    name.textContent = row.label;

    const up = this.button('上移', () => this.opts.onMoveBackdropUp(row.id));
    up.title = '往上疊一層';
    up.disabled = row.isTop;
    const down = this.button('下移', () => this.opts.onMoveBackdropDown(row.id));
    down.title = '往下墊一層';
    down.disabled = row.isBottom;

    main.append(
      visible,
      thumb,
      name,
      up,
      down,
      this.button('刪除', () => this.opts.onDeleteBackdrop(row.id)),
    );
    el.append(main);
    if (row.selected) el.append(this.fieldsEl(row));
    return el;
  }

  /** 選中那一列底下的 x／y／縮放／透明度欄位（issue #151）。 */
  private fieldsEl(row: BackdropListRow): HTMLElement {
    const fields = document.createElement('div');
    fields.className = 'jelly-backdrop-fields';
    for (const spec of FIELDS) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'number';
      input.step = spec.step;
      input.value = spec.show(row);
      input.addEventListener('change', () => {
        const value = Number.parseFloat(input.value);
        if (Number.isFinite(value)) {
          this.opts.onBackdropFieldChange(row.id, spec.field, spec.parse(value));
        }
      });
      label.append(spec.label, input);
      fields.append(label);
      this.fieldInputs.push({ spec, input });
    }
    return fields;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }
}
