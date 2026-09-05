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
 *
 * 「Demo」按鈕（issue #15）播放中會被 `JellySandbox` 呼叫 `setDemoButtonsEnabled(false)`
 * 全部鎖住，理由同上——避免疊加播放兩個 Demo 留下沒人清的殘留 Pin/Grab。
 */

import type { BoundaryMode } from '../sim';

/** 一顆 Demo 按鈕要顯示的最小資訊——`ControlPanel` 特意不 import `./demos`，維持跟 `SimCore`/`JellySandbox` 無關的薄接線層，這裡自己開一個形狀就好。 */
export interface DemoMenuItem {
  id: string;
  label: string;
}

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
  /** 「Demo」按鈕列表（issue #15），依序顯示；點下呼叫 `onRunDemo(id)`。 */
  demos: readonly DemoMenuItem[];
  onBoundaryChange: (mode: BoundaryMode) => void;
  onSoftnessChange: (t: number) => void;
  onTapStrengthChange: (strength: number) => void;
  onPinModeChange: (enabled: boolean) => void;
  onClearPins: () => void;
  onShowPinsChange: (visible: boolean) => void;
  onFollowLockChange: (locked: boolean) => void;
  onFrameJelly: () => void;
  onRunDemo: (id: string) => void;
  onReset: () => void;
  onWireframeChange: (visible: boolean) => void;
}

export class ControlPanel {
  readonly element: HTMLElement;
  /** 播放中鎖住，避免疊加播放兩個 Demo（issue #15）——見 `setDemoButtonsEnabled`。 */
  private readonly demoButtons: HTMLButtonElement[] = [];

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
      this.demoHeading(),
      ...opts.demos.map((demo) => this.demoButtonRow(demo.label, () => opts.onRunDemo(demo.id))),
      this.buttonRow('停止／重設', opts.onReset),
    );

    this.element = panel;
  }

  /**
   * Demo 播放中呼叫 `setDemoButtonsEnabled(false)` 鎖住所有 Demo 按鈕（issue #15）——
   * 不然疊加按下另一個 Demo，前一個 Demo 已經建立的 Pin/Grab 不會被清掉（`DemoRunner.start`
   * 只換排程，不會回頭釋放已生效的約束），會留下一個永遠釘住卻沒人記得的 Pin。播完
   * 或按「停止／重設」都要解鎖，見 `JellySandbox.frame`。
   */
  setDemoButtonsEnabled(enabled: boolean): void {
    for (const button of this.demoButtons) button.disabled = !enabled;
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

  /** Demo 按鈕列前的小標題，跟其他控制項分開一眼看出這區是「自動演出」。 */
  private demoHeading(): HTMLElement {
    const heading = document.createElement('div');
    heading.className = 'jelly-control-heading';
    heading.textContent = 'Demo';
    return heading;
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

  /** 同 `buttonRow`，另外把按鈕記進 `demoButtons`，讓 `setDemoButtonsEnabled` 管得到。 */
  private demoButtonRow(labelText: string, onClick: () => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    button.addEventListener('click', onClick);

    row.appendChild(button);
    this.demoButtons.push(button);
    return row;
  }
}
