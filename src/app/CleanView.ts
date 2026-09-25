/**
 * `CleanView`（issue #130 / V4 U3；spec #127「乾淨畫面」、CONTEXT.md「乾淨畫面」）——為了用外部
 * 螢幕錄影錄素材而切換的顯示狀態：畫布上只剩 Jelly。
 *
 * 這個模組只管「進出」本身：
 *
 * - 進入：側欄標題列的鈕（`createEnterButton`）。把 `hide` 裡的介面元素（側欄、播放控制條、相機
 *   按鈕、匯入提示字）設成 `hidden`，再呼叫 `onChange(true)`——提示、筆刷圓圈、游標標籤這些由呼叫端
 *   在自己的「意圖＋現算」出口裡多加一個條件壓下（比照「播放時隱藏提示」），不改寫任何使用者開關。
 * - 離開：按 Esc；或游標在畫布左上角一小塊範圍內停留約 0.5 秒，浮出「離開乾淨畫面」鈕
 *   （`element`，呼叫端放進 root），游標移開就再藏起來。
 *
 * `hide` 裡的元素的 `hidden` 歸乾淨畫面管：它們自己沒有顯示開關（側欄收起是側欄內部的
 * `.is-collapsed`／把手，不動外層元素），所以離開時直接取消 `hidden` 就等於回到進入前的樣子，
 * 不需要另外記快照。狀態不存檔。
 *
 * 比照 `HelpOverlay`／`ContextMenu`：純 DOM 元件，不知道 `JellySandbox` 的存在。
 */

/** 左上角「停留浮出離開鈕」的感應範圍（CSS px，相對 root 左上角的正方形）。 */
export const CLEAN_VIEW_CORNER_PX = 80;
/** 游標在感應範圍內停多久才浮出離開鈕（毫秒）。 */
export const CLEAN_VIEW_DWELL_MS = 500;

export interface CleanViewOptions {
  /** 畫布與各介面元素共同的容器——左上角感應範圍以它為準。 */
  root: HTMLElement;
  /** 進入時整個藏起來的介面元素（見類別說明：它們的 `hidden` 歸乾淨畫面管）。 */
  hide: readonly HTMLElement[];
  /** 進入／離開之後呼叫——呼叫端在這裡重算提示、游標回饋等「疊在自己開關上」的東西。 */
  onChange: (active: boolean) => void;
  /**
   * 這一下 Esc 已經有別人要用（例如右鍵選單開著：Esc 先關選單）——回 `true` 時不離開。
   * Esc 一次只剝掉最上面一層。
   */
  isEscapeClaimed?: () => boolean;
}

export class CleanView {
  /** 浮在左上角的「離開乾淨畫面」鈕——呼叫端放進 root。平常藏著。 */
  readonly element: HTMLButtonElement;
  private readonly root: HTMLElement;
  private readonly hide: readonly HTMLElement[];
  private readonly onChange: (active: boolean) => void;
  private readonly isEscapeClaimed: () => boolean;
  private active = false;
  /** 游標進了感應範圍、還在等 `CLEAN_VIEW_DWELL_MS` 的計時器（0 = 沒在等）。 */
  private dwellTimer = 0;

  constructor(opts: CleanViewOptions) {
    this.root = opts.root;
    this.hide = opts.hide;
    this.onChange = opts.onChange;
    this.isEscapeClaimed = opts.isEscapeClaimed ?? (() => false);

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'jelly-clean-view-exit';
    exit.textContent = '離開乾淨畫面';
    exit.hidden = true;
    exit.addEventListener('click', () => this.exit());
    this.element = exit;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 側欄標題列的「乾淨畫面」鈕——按了進入。 */
  createEnterButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jelly-clean-view-enter';
    button.textContent = '⛶';
    button.title = '乾淨畫面（只留 Jelly，方便錄影；Esc 離開）';
    button.setAttribute('aria-label', '進入乾淨畫面');
    button.addEventListener('click', () => this.enter());
    return button;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // 焦點留在要藏起來的鈕上（例如剛按的進入鈕）的話，之後的空白鍵會按到看不見的鈕。
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.hide.some((el) => el.contains(focused))) {
      focused.blur();
    }
    for (const el of this.hide) el.hidden = true;
    // 冒泡階段、掛在 document：比 window 上的 Esc 監聽（右鍵選單）先拿到，才問得到
    // 「選單還開著嗎」；「?」說明浮層在 window 的 capture 階段攔下 Esc，輪不到這裡。
    document.addEventListener('keydown', this.onKeyDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerleave', this.onPointerLeave);
    this.onChange(true);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    this.hideExitButton();
    for (const el of this.hide) el.hidden = false;
    this.onChange(false);
  }

  destroy(): void {
    this.exit();
    this.element.remove();
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || this.isEscapeClaimed()) return;
    ev.preventDefault();
    this.exit();
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (this.inExitZone(ev)) {
      if (this.element.hidden && this.dwellTimer === 0) {
        this.dwellTimer = window.setTimeout(() => {
          this.dwellTimer = 0;
          this.element.hidden = false;
        }, CLEAN_VIEW_DWELL_MS);
      }
    } else {
      this.hideExitButton();
    }
  };

  private readonly onPointerLeave = (): void => {
    this.hideExitButton();
  };

  /** 左上角的感應範圍，或（已浮出時）離開鈕本身——鈕比感應範圍寬，移到鈕上不該讓它消失。 */
  private inExitZone(ev: PointerEvent): boolean {
    if (ev.target instanceof Node && this.element.contains(ev.target)) return true;
    const bounds = this.root.getBoundingClientRect();
    const x = ev.clientX - bounds.left;
    const y = ev.clientY - bounds.top;
    return x >= 0 && y >= 0 && x < CLEAN_VIEW_CORNER_PX && y < CLEAN_VIEW_CORNER_PX;
  }

  private hideExitButton(): void {
    if (this.dwellTimer !== 0) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = 0;
    }
    if (this.element.hidden) return;
    if (this.element.contains(document.activeElement)) this.element.blur();
    this.element.hidden = true;
  }
}
