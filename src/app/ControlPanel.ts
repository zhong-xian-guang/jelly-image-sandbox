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
 * 「Demo」按鈕（issue #15）播放中會被 `JellySandbox` 呼叫 `setPlaybackControlsEnabled(false)`
 * 全部鎖住，理由同上——避免疊加播放兩個 Demo 留下沒人清的殘留 Pin/Grab。
 *
 * 「Track」錄製（issue #29 / V2 T1a）：一顆「開始錄製／停止錄製」切換鈕，錄製中
 * 比照 Pin 模式的手法——文字變色＋脈動（`.jelly-recording-active`，樣式見
 * `style.css`）——低頭一眼就知道現在正在錄。停止後解鎖「播放 Track」按鈕重播剛
 * 錄好的那條。`setPlaybackControlsEnabled(false)` 也會一併鎖住這兩顆鈕：Track
 * 重播跟 Demo 播放共用同一個 `DemoRunner`，播放中不能再錄一次或重疊播放。
 *
 * 「Substep」是 issue #16 追加的唯讀 debug 讀出，`JellySandbox` 每幀呼叫
 * `setPerfStatus` 同步目前的 `PerfMonitor.substeps` / `degraded`——手動測試「節流
 * CPU 降級」時（見該 issue 驗收條件）用眼睛確認 4→2→4 有沒有真的發生，不用開
 * DevTools 斷點。`setPerfStatus` 內部比對是否真的變了才寫 DOM，值沒變的每幀呼叫
 * 不會產生多餘的 reflow（在想省效能的降級路徑上，多餘 DOM 寫入是反效果）。
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
  /** 「開始錄製／停止錄製」切換鈕（issue #29）。 */
  onToggleRecording: () => void;
  /** 「播放 Track」按鈕（issue #29）——只在錄過至少一次、且沒有播放中鎖住時可按。 */
  onPlayTrack: () => void;
}

export class ControlPanel {
  readonly element: HTMLElement;
  /** 播放中鎖住，避免疊加播放兩個 Demo（issue #15）——見 `setPlaybackControlsEnabled`。 */
  private readonly demoButtons: HTMLButtonElement[] = [];
  private readonly recordButton: HTMLButtonElement;
  private readonly playTrackButton: HTMLButtonElement;
  /** 是否已經錄過至少一次（哪怕是空 Track）——`setTrackPlaybackEnabled` 維護。 */
  private trackReady = false;
  /** Demo／Track 播放中鎖住——`setPlaybackControlsEnabled` 維護，跟 `trackReady` 一起決定播放鈕能不能按。 */
  private playbackLocked = false;
  private readonly perfStatus: HTMLElement;
  /** `setPerfStatus` 比對用；避免值沒變時每幀重寫 DOM。 */
  private lastPerfText: string | null = null;

  constructor(opts: ControlPanelOptions) {
    const panel = document.createElement('div');
    panel.className = 'jelly-control-panel';

    this.perfStatus = this.perfStatusRow();

    panel.append(
      this.perfStatus,
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
      this.trackHeading(),
    );

    const track = this.trackRow(opts.onToggleRecording, opts.onPlayTrack);
    this.recordButton = track.recordButton;
    this.playTrackButton = track.playTrackButton;
    panel.append(track.row, this.buttonRow('停止／重設', opts.onReset));

    this.element = panel;
  }

  /**
   * Demo／Track 播放中呼叫 `setPlaybackControlsEnabled(false)` 鎖住所有 Demo 按鈕
   * 跟「開始錄製」「播放 Track」（issue #15、issue #29）——不然疊加按下另一個
   * Demo，前一個 Demo 已經建立的 Pin/Grab 不會被清掉（`DemoRunner.start` 只換
   * 排程，不會回頭釋放已生效的約束），會留下一個永遠釘住卻沒人記得的 Pin；
   * Track 重播跟 Demo 共用同一個 `DemoRunner`，同樣的理由也適用。播完或按
   * 「停止／重設」都要解鎖，見 `JellySandbox.frame`／`setPlaybackLocked`。
   */
  setPlaybackControlsEnabled(enabled: boolean): void {
    for (const button of this.demoButtons) button.disabled = !enabled;
    this.recordButton.disabled = !enabled;
    this.playbackLocked = !enabled;
    this.updatePlayTrackButtonState();
  }

  /**
   * 錄製中／已停止的視覺切換（issue #29）——比照 Pin 模式的手法：按鈕文字變色
   * 加粗＋脈動（`.jelly-recording-active`，樣式見 `style.css`），低頭一眼就知道
   * 現在正在錄。
   */
  setRecordingActive(active: boolean): void {
    this.recordButton.classList.toggle('jelly-recording-active', active);
    this.recordButton.textContent = active ? '■ 停止錄製' : '● 開始錄製 Track';
  }

  /** 是否已經錄過至少一次（哪怕是空 Track）——決定「播放 Track」按鈕能不能按（issue #29）。 */
  setTrackPlaybackEnabled(ready: boolean): void {
    this.trackReady = ready;
    this.updatePlayTrackButtonState();
  }

  private updatePlayTrackButtonState(): void {
    this.playTrackButton.disabled = this.playbackLocked || !this.trackReady;
  }

  /**
   * `JellySandbox` 每幀同步一次目前的 substep 數／是否處於降級狀態（issue #16）。
   * 只在文字真的變了才寫 DOM（見類別頂端說明）。
   */
  setPerfStatus(substeps: number, degraded: boolean): void {
    const text = degraded ? `Substep：${substeps}（已降級）` : `Substep：${substeps}`;
    if (text === this.lastPerfText) return;
    this.lastPerfText = text;
    this.perfStatus.textContent = text;
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

  /** 唯讀 debug 讀出列，文字由 `setPerfStatus` 填入（建構時先放預設值）。 */
  private perfStatusRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jelly-control-row jelly-perf-status';
    row.textContent = 'Substep：4';
    return row;
  }

  /** Demo 按鈕列前的小標題，跟其他控制項分開一眼看出這區是「自動演出」。 */
  private demoHeading(): HTMLElement {
    const heading = document.createElement('div');
    heading.className = 'jelly-control-heading';
    heading.textContent = 'Demo';
    return heading;
  }

  /** Track 錄製列前的小標題（issue #29），跟 Demo 分開一眼看出這區是「使用者自己錄的」。 */
  private trackHeading(): HTMLElement {
    const heading = document.createElement('div');
    heading.className = 'jelly-control-heading';
    heading.textContent = 'Track';
    return heading;
  }

  /**
   * 「開始錄製／停止錄製」切換鈕 + 「播放 Track」按鈕（issue #29）。回傳個別按鈕
   * 讓建構子能直接賦值給欄位（`recordButton`/`playTrackButton` 是 `readonly`，
   * 賦值要發生在建構子本體才能通過 TS 的明確賦值檢查）。「播放 Track」初始鎖住——
   * 還沒錄過，沒有東西可以播（見 `setTrackPlaybackEnabled`）。
   */
  private trackRow(
    onToggleRecording: () => void,
    onPlayTrack: () => void,
  ): { row: HTMLElement; recordButton: HTMLButtonElement; playTrackButton: HTMLButtonElement } {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const recordButton = document.createElement('button');
    recordButton.type = 'button';
    recordButton.textContent = '● 開始錄製 Track';
    recordButton.addEventListener('click', onToggleRecording);

    const playTrackButton = document.createElement('button');
    playTrackButton.type = 'button';
    playTrackButton.textContent = '▶ 播放 Track';
    playTrackButton.disabled = true;
    playTrackButton.addEventListener('click', onPlayTrack);

    row.append(recordButton, playTrackButton);
    return { row, recordButton, playTrackButton };
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
