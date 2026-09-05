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
 *
 * 「顯示 Pin」關掉時，所見即所得：畫面上看不到 Pin 標記，「Pin 模式」勾選框跟
 * 「清除所有 Pin」按鈕就跟著鎖住（`disabled`）——不能對看不見的東西下手。原本
 * 已開著的「Pin 模式」也會被強制關掉，不會變成「看不到卻還在默默放 Pin」。
 *
 * 「顯示網格」是純 debug 用的三角化線框開關，接 `JellyRenderer.setWireframeVisible`。
 */

import type { BoundaryMode } from '../sim';

export interface ControlPanelInitial {
  boundary: BoundaryMode;
  /** Softness 滑桿目前值，0–1（見 `../sim/softness`）。 */
  softness: number;
  tapStrength: number;
  pinMode: boolean;
  /** Pin 標記顯示開關；關閉時 Pin 模式／清除所有 Pin 一併鎖住。 */
  showPins: boolean;
  followLocked: boolean;
  /** 網格線框開關（debug 用）。 */
  showWireframe: boolean;
}

export interface ControlPanelOptions {
  initial: ControlPanelInitial;
  tapStrengthRange: { min: number; max: number; step: number };
  onBoundaryChange: (mode: BoundaryMode) => void;
  onSoftnessChange: (t: number) => void;
  onTapStrengthChange: (strength: number) => void;
  onPinModeChange: (enabled: boolean) => void;
  onClearPins: () => void;
  onShowPinsChange: (visible: boolean) => void;
  onFollowLockChange: (locked: boolean) => void;
  onFrameJelly: () => void;
  onReset: () => void;
  onWireframeChange: (visible: boolean) => void;
}

export class ControlPanel {
  readonly element: HTMLElement;

  constructor(opts: ControlPanelOptions) {
    const panel = document.createElement('div');
    panel.className = 'jelly-control-panel';

    panel.append(
      this.boundaryRow(opts.initial.boundary, opts.onBoundaryChange),
      this.checkboxRow('顯示網格', opts.initial.showWireframe, opts.onWireframeChange),
      this.rangeRow('軟硬度', 0, 1, 0.01, opts.initial.softness, opts.onSoftnessChange),
      this.rangeRow(
        '輕拍力道',
        opts.tapStrengthRange.min,
        opts.tapStrengthRange.max,
        opts.tapStrengthRange.step,
        opts.initial.tapStrength,
        opts.onTapStrengthChange,
      ),
      ...this.pinRows(
        opts.initial.pinMode,
        opts.initial.showPins,
        opts.onPinModeChange,
        opts.onClearPins,
        opts.onShowPinsChange,
      ),
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

  /**
   * 兩排：「顯示 Pin」開關 + 「Pin 模式」/「清除所有 Pin」。後者的可用狀態跟著
   * 前者走——關掉顯示就鎖住、強制退出 Pin 模式（所見即所得，見類別頂端說明）。
   */
  private pinRows(
    initialPinMode: boolean,
    initialShowPins: boolean,
    onPinModeChange: (enabled: boolean) => void,
    onClearPins: () => void,
    onShowPinsChange: (visible: boolean) => void,
  ): HTMLElement[] {
    const pinRow = document.createElement('div');
    pinRow.className = 'jelly-control-row';

    const pinLabel = document.createElement('label');
    pinLabel.classList.toggle('jelly-pin-mode-active', initialPinMode);
    const pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.checked = initialPinMode;
    pinCheckbox.addEventListener('change', () => {
      pinLabel.classList.toggle('jelly-pin-mode-active', pinCheckbox.checked);
      onPinModeChange(pinCheckbox.checked);
    });
    pinLabel.append(pinCheckbox, 'Pin 模式');

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = '清除所有 Pin';
    clearButton.addEventListener('click', onClearPins);

    pinRow.append(pinLabel, clearButton);

    /** 「顯示 Pin」關／開時同步鎖住／解鎖 Pin 模式勾選框跟清除按鈕。 */
    const setPinControlsLocked = (locked: boolean): void => {
      pinCheckbox.disabled = locked;
      clearButton.disabled = locked;
    };
    setPinControlsLocked(!initialShowPins);

    const showRow = this.checkboxRow('顯示 Pin', initialShowPins, (visible) => {
      onShowPinsChange(visible);
      setPinControlsLocked(!visible);
      if (!visible && pinCheckbox.checked) {
        // 看不到 Pin 了，不能讓 Pin 模式繼續默默放看不到的 Pin。
        pinCheckbox.checked = false;
        pinLabel.classList.remove('jelly-pin-mode-active');
        onPinModeChange(false);
      }
    });

    return [showRow, pinRow];
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
