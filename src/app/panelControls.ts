/**
 * 側欄共用的兩個小元件（issue #131 / V4 U4；spec #127「防呆」「拉霸」）——跟 `ControlPanel`
 * 一樣是薄的 DOM 接線層，拆出來是為了讓每條拉霸、每顆要防呆的鈕都套同一份行為：
 *
 * - **拉霸＋數值**（`createRangeSlider`）：旁邊一律顯示數值（0–1 的量顯示成百分比，其他依
 *   step 的小數位數）；雙擊回到預設值，並走跟拖動相同的 `input` 事件 → 變更回呼。程式碼
 *   從外部灌回的值走 `setRangeSliderValue`：同步數值顯示、不觸發回呼。
 * - **再按一次確認**（`confirmOnSecondClick`）：第一次按只把文字換成確認提示並加上警示樣式，
 *   時限內再按才執行，逾時還原；呼叫端被鎖住時呼叫 `cancel()` 一併取消待確認。
 */

/** 一條拉霸的範圍（跟 `ControlPanel` 的 `RangeSpec` 同形狀）。 */
export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

export interface RangeSlider {
  /** 整列 `<label>`：文字＋拉霸＋數值。 */
  row: HTMLLabelElement;
  input: HTMLInputElement;
  output: HTMLOutputElement;
}

/** 每條拉霸旁的 `<output>`——`setRangeSliderValue` 只拿得到 input 時靠這個找。 */
const outputs = new WeakMap<HTMLInputElement, HTMLOutputElement>();

/**
 * 拉霸旁數值的文字：0–1 的量（`min` 0、`max` 1）顯示成四捨五入的百分比，其他依 `step`
 * 的小數位數固定位數（拖動時寬度不會跳）。
 */
export function formatSliderValue(value: number, range: SliderRange): string {
  if (range.min === 0 && range.max === 1) return `${Math.round(value * 100)}%`;
  return value.toFixed(decimalPlaces(range.step));
}

function decimalPlaces(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function rangeOf(input: HTMLInputElement): SliderRange {
  return { min: Number(input.min), max: Number(input.max), step: Number(input.step) };
}

/**
 * 一條「拉霸＋數值」列。`value` 同時是雙擊要回去的預設值——面板在啟動時建立，
 * 初始值就是各參數的預設值；之後外部灌值（`setRangeSliderValue`）不會改動它。
 */
export function createRangeSlider(
  labelText: string,
  range: SliderRange,
  value: number,
  onChange: (value: number) => void,
): RangeSlider {
  const row = document.createElement('label');
  row.className = 'jelly-control-row';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  input.title = '雙擊回到預設值';

  const output = document.createElement('output');
  output.className = 'jelly-range-value';
  output.textContent = formatSliderValue(value, range);
  outputs.set(input, output);

  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = formatSliderValue(next, range);
    onChange(next);
  });
  // 雙擊＝使用者把它拉回預設值：設好值後送一個跟拖動相同的 `input` 事件，回呼走同一條路。
  const defaultText = String(value);
  input.addEventListener('dblclick', () => {
    input.value = defaultText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  row.append(labelText, input, output);
  return { row, input, output };
}

/**
 * 程式碼從外部把值灌回拉霸（載入片段、效能退路、右鍵＋滾輪）：拉霸位置與數值一起
 * 更新、只在真的變了才寫 DOM、不觸發 `input` 事件（所以不會回呼變更）。
 */
export function setRangeSliderValue(input: HTMLInputElement, value: number): void {
  const text = String(value);
  if (input.value !== text) input.value = text;
  const output = outputs.get(input);
  if (!output) return;
  const shown = formatSliderValue(Number(input.value), rangeOf(input));
  if (output.textContent !== shown) output.textContent = shown;
}

/** 「再按一次確認」的時限（spec #127「防呆」）。 */
export const CONFIRM_TIMEOUT_MS = 3000;

/** 待確認時按鈕加上的警示樣式。 */
export const CONFIRM_PENDING_CLASS = 'jelly-confirm-pending';

export interface ConfirmButton {
  /** 取消待確認並還原（呼叫端把按鈕鎖住時呼叫）；沒在待確認時什麼都不做。 */
  cancel(): void;
}

/** 待確認時按鈕的文字（spec #127「防呆」）。 */
export const CONFIRM_TEXT = '再按一次確認…';

/**
 * 把一顆按鈕接成「再按一次確認」：第一次按把文字換成 `CONFIRM_TEXT`、加上警示樣式，
 * `timeoutMs` 內再按才呼叫 `onConfirm`（並還原），逾時自動還原。按鈕原本的文字在
 * 接上時記下來，還原時放回去。
 */
export function confirmOnSecondClick(
  button: HTMLButtonElement,
  onConfirm: () => void,
  timeoutMs = CONFIRM_TIMEOUT_MS,
): ConfirmButton {
  const idleText = button.textContent ?? '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reset = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    button.textContent = idleText;
    button.classList.remove(CONFIRM_PENDING_CLASS);
  };

  button.addEventListener('click', () => {
    if (timer !== null) {
      reset();
      onConfirm();
      return;
    }
    button.textContent = CONFIRM_TEXT;
    button.classList.add(CONFIRM_PENDING_CLASS);
    timer = setTimeout(reset, timeoutMs);
  });

  return { cancel: reset };
}
