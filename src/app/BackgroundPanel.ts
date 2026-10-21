/**
 * 側欄「背景」分區的內容（issue #147 / 背景 T1；spec #146）——Background color（背景色）的
 * 顏色選擇器。
 *
 * 跟 `ControlPanel` 分開：「背景」區有自己的狀態要維護，塞進那個已經很大的面板只會讓建構子
 * 選項再長一截。`JellySandbox` 建好後掛進 `controlPanel.sectionBody('background')`，所以展開／
 * 收起、記住展開狀態都沿用既有分區的做法。
 *
 * 跟 `ControlPanel` 一樣是薄的 DOM 接線層：使用者操作只往外回呼，`setX` 只改顯示、不回呼。
 */

export interface BackgroundPanelOptions {
  /** 背景色（`#rrggbb`）的初值。 */
  initialColor: string;
  /** 使用者改了背景色——拖動選色器途中就會連續回呼，畫面即時跟著變。 */
  onColorChange: (color: string) => void;
}

export class BackgroundPanel {
  readonly element: HTMLElement;
  private readonly colorInput: HTMLInputElement;

  constructor(opts: BackgroundPanelOptions) {
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

    this.element.append(colorRow);
  }

  /** 從外部同步顯示的背景色（啟動時從儲存還原）——不回呼。 */
  setColor(color: string): void {
    this.colorInput.value = color;
  }
}
