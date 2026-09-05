/**
 * `ControlPanel`（issue #14 / T13）——玩家可調 UI。
 *
 * 薄的 DOM 接線層（對照 `PointerInput`/`CameraInput`/`DropImportInput`）：建控制
 * 項、聽使用者操作、透過回呼往外送——不知道 `SimCore`/`JellySandbox` 的存在，
 * 邏輯（Softness 曲線、Walled 邊界範圍、Pin 模式轉接）都在各自的純函式模組
 * （`../sim/softness`、`./walledBounds`、`../input/pinModeRouting`），接線在
 * `JellySandbox`。
 *
 * 「Pin 模式」開啟時勾選框旁的文字會變色加粗（`.jelly-pin-mode-active`，樣式
 * 見 `style.css`）——`JellySandbox` 另外還會把畫布游標換成十字、把 `PinMarkers`
 * 標記切成「可點掉」的視覺（紅色脈動），兩層加在一起讓「現在是不是在 Pin
 * 模式」不用低頭看面板就知道。
 */

import type { BoundaryMode } from '../sim';

export interface ControlPanelInitial {
  boundary: BoundaryMode;
  /** Softness 滑桿目前值，0–1（見 `../sim/softness`）。 */
  softness: number;
  tapStrength: number;
  pinMode: boolean;
  followLocked: boolean;
}

export interface ControlPanelOptions {
  initial: ControlPanelInitial;
  tapStrengthRange: { min: number; max: number; step: number };
  onBoundaryChange: (mode: BoundaryMode) => void;
  onSoftnessChange: (t: number) => void;
  onTapStrengthChange: (strength: number) => void;
  onPinModeChange: (enabled: boolean) => void;
  onClearPins: () => void;
  onFollowLockChange: (locked: boolean) => void;
  onFrameJelly: () => void;
  onReset: () => void;
}

export class ControlPanel {
  readonly element: HTMLElement;

  constructor(opts: ControlPanelOptions) {
    const panel = document.createElement('div');
    panel.className = 'jelly-control-panel';

    panel.append(
      this.boundaryRow(opts.initial.boundary, opts.onBoundaryChange),
      this.rangeRow('軟硬度', 0, 1, 0.01, opts.initial.softness, opts.onSoftnessChange),
      this.rangeRow(
        '輕拍力道',
        opts.tapStrengthRange.min,
        opts.tapStrengthRange.max,
        opts.tapStrengthRange.step,
        opts.initial.tapStrength,
        opts.onTapStrengthChange,
      ),
      this.pinRow(opts.initial.pinMode, opts.onPinModeChange, opts.onClearPins),
      this.checkboxRow('鎖定跟隨', opts.initial.followLocked, opts.onFollowLockChange),
      this.buttonRow('框住果凍', opts.onFrameJelly),
      this.buttonRow('停止／重設', opts.onReset),
    );

    this.element = panel;
  }

  destroy(): void {
    this.element.remove();
  }

  private boundaryRow(initial: BoundaryMode, onChange: (mode: BoundaryMode) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'jelly-control-row';

    const select = document.createElement('select');
    for (const [value, text] of [
      ['infinite', '無限'],
      ['walled', '有牆'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === initial;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value as BoundaryMode));

    row.append('邊界', select);
    return row;
  }

  private rangeRow(
    labelText: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (n: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'jelly-control-row';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => onChange(Number(input.value)));

    row.append(labelText, input);
    return row;
  }

  private pinRow(
    initial: boolean,
    onPinModeChange: (enabled: boolean) => void,
    onClearPins: () => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const pinLabel = document.createElement('label');
    pinLabel.classList.toggle('jelly-pin-mode-active', initial);
    const pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.checked = initial;
    pinCheckbox.addEventListener('change', () => {
      pinLabel.classList.toggle('jelly-pin-mode-active', pinCheckbox.checked);
      onPinModeChange(pinCheckbox.checked);
    });
    pinLabel.append(pinCheckbox, 'Pin 模式');

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = '清除所有 Pin';
    clearButton.addEventListener('click', onClearPins);

    row.append(pinLabel, clearButton);
    return row;
  }

  private checkboxRow(
    labelText: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'jelly-control-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => onChange(checkbox.checked));

    row.append(checkbox, labelText);
    return row;
  }

  private buttonRow(labelText: string, onClick: () => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    button.addEventListener('click', onClick);

    row.appendChild(button);
    return row;
  }
}
