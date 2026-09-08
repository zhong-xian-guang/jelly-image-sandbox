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
import type { RecordTarget } from './track';

/** 一顆 Demo 按鈕要顯示的最小資訊——`ControlPanel` 特意不 import `./demos`，維持跟 `SimCore`/`JellySandbox` 無關的薄接線層，這裡自己開一個形狀就好。 */
export interface DemoMenuItem {
  id: string;
  label: string;
}

/**
 * Track 清單裡的一列（issue #33 / V2 T1-1）——`ControlPanel` 只拿它畫 UI，實際
 * 的錄製內容／sim-step 換算都在 `JellySandbox`。目前只有動作軌（`kind: 'action'`），
 * 相機軌（`'camera'`）留給之後的票。
 */
export interface TrackListRow {
  id: string;
  kind: 'action' | 'camera';
  /** 簡短標籤（例如「動作軌 1（拖曳 · 輕拍 · Pin）」）。 */
  label: string;
  /** 這條 Track 在片段時間軸上的起始秒數（可編輯）。 */
  startSeconds: number;
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
  /** 「錄製目標」選擇器的初始值（issue #33）。 */
  recordTarget: RecordTarget;
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
  /** 「錄製目標」選擇器變更（issue #33）——只錄動作／只錄運鏡／兩者同時。 */
  onRecordTargetChange: (target: RecordTarget) => void;
  /** 「開始錄製／停止錄製」切換鈕（issue #29）。 */
  onToggleRecording: () => void;
  /** 「▶ 播放全部」按鈕（issue #33）——把所有 Track 依起始時間疊加重播。 */
  onPlayAll: () => void;
  /** 某條 Track 的「起始秒數」欄位被改（issue #33）。 */
  onTrackStartTimeChange: (id: string, seconds: number) => void;
  /** 某條 Track 的刪除鈕被按（issue #33）。 */
  onDeleteTrack: (id: string) => void;
}

export class ControlPanel {
  readonly element: HTMLElement;
  /** 播放中鎖住，避免疊加播放兩個 Demo（issue #15）——見 `setPlaybackControlsEnabled`。 */
  private readonly demoButtons: HTMLButtonElement[] = [];
  private readonly recordButton: HTMLButtonElement;
  private readonly playAllButton: HTMLButtonElement;
  private readonly recordTargetSelect: HTMLSelectElement;
  /** Track 清單容器（issue #33）——`setTracks` 每次整份重建裡面的列。 */
  private readonly trackListEl: HTMLElement;
  private readonly onTrackStartTimeChange: (id: string, seconds: number) => void;
  private readonly onDeleteTrack: (id: string) => void;
  /** 目前清單有幾條 Track——`setTracks` 維護，空清單時「播放全部」變灰。 */
  private trackCount = 0;
  /** 正在錄製中——`setRecordingActive` 維護；錄製與播放互斥，錄製中「播放全部」與清單編輯鎖住。 */
  private recording = false;
  /** Demo／Track 播放中鎖住——`setPlaybackControlsEnabled` 維護。 */
  private playbackLocked = false;
  private readonly perfStatus: HTMLElement;
  /** `setPerfStatus` 比對用；避免值沒變時每幀重寫 DOM。 */
  private lastPerfText: string | null = null;

  constructor(opts: ControlPanelOptions) {
    this.onTrackStartTimeChange = opts.onTrackStartTimeChange;
    this.onDeleteTrack = opts.onDeleteTrack;

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

    const target = this.recordTargetRow(opts.initial.recordTarget, opts.onRecordTargetChange);
    this.recordTargetSelect = target.select;
    const track = this.trackRow(opts.onToggleRecording, opts.onPlayAll);
    this.recordButton = track.recordButton;
    this.playAllButton = track.playAllButton;
    this.trackListEl = document.createElement('div');
    this.trackListEl.className = 'jelly-track-list';

    panel.append(
      target.row,
      track.row,
      this.trackListEl,
      this.buttonRow('停止／重設', opts.onReset),
    );

    this.element = panel;
    this.updateTrackControlsState();
  }

  /**
   * Demo／Track 播放中呼叫 `setPlaybackControlsEnabled(false)` 鎖住所有 Demo 按鈕、
   * 「開始錄製」、「▶ 播放全部」、「錄製目標」選擇器與 Track 清單的所有編輯欄位
   * （issue #15、issue #29、issue #33）——不然疊加按下另一個 Demo，前一個已建立的
   * Pin/Grab 不會被清掉（`DemoRunner.start` 只換排程、不回頭釋放約束），會留下沒人
   * 記得的殘留；Track 疊加播放跟 Demo 共用同一個 `DemoRunner`，同樣的理由也適用。
   * 播完或按「停止／重設」都要解鎖，見 `JellySandbox.frame`／`setPlaybackLocked`。
   */
  setPlaybackControlsEnabled(enabled: boolean): void {
    for (const button of this.demoButtons) button.disabled = !enabled;
    this.playbackLocked = !enabled;
    this.updateTrackControlsState();
  }

  /**
   * 錄製中／已停止的視覺切換（issue #29）——比照 Pin 模式的手法：按鈕文字變色
   * 加粗＋脈動（`.jelly-recording-active`，樣式見 `style.css`），低頭一眼就知道
   * 現在正在錄。錄製中「▶ 播放全部」與清單編輯一併鎖住（錄製／播放互斥，issue #33）。
   */
  setRecordingActive(active: boolean): void {
    this.recording = active;
    this.recordButton.classList.toggle('jelly-recording-active', active);
    this.recordButton.textContent = active ? '■ 停止錄製' : '● 開始錄製 Track';
    this.updateTrackControlsState();
  }

  /**
   * 用最新的 Track 清單整份重建列 UI（issue #33）。每列：種類標記、簡短標籤、
   * 可編輯的「起始秒數」數字欄位、刪除鈕。清單空時「▶ 播放全部」變灰。
   */
  setTracks(rows: readonly TrackListRow[]): void {
    this.trackCount = rows.length;
    this.trackListEl.replaceChildren(...rows.map((row) => this.trackRowEl(row)));
    this.updateTrackControlsState();
  }

  /**
   * 依 `playbackLocked` / `recording` / `trackCount` 重算 Track 區塊每個控制項的
   * 可用狀態，集中一處免得各方法各自漏掉一顆按鈕。
   */
  private updateTrackControlsState(): void {
    const busy = this.playbackLocked || this.recording;
    // 錄製中「開始錄製」要保持可按（它此時是「停止錄製」）；只有播放中才鎖它。
    this.recordButton.disabled = this.playbackLocked;
    this.recordTargetSelect.disabled = busy;
    this.playAllButton.disabled = busy || this.trackCount === 0;
    for (const el of this.trackListEl.querySelectorAll('input, button')) {
      (el as HTMLInputElement | HTMLButtonElement).disabled = busy;
    }
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

  /** 「錄製目標」選擇器（issue #33）：只錄動作／只錄運鏡／兩者同時。按下錄製前選定。 */
  private recordTargetRow(
    initial: RecordTarget,
    onChange: (target: RecordTarget) => void,
  ): { row: HTMLElement; select: HTMLSelectElement } {
    const row = document.createElement('label');
    row.className = 'jelly-control-row';

    const select = document.createElement('select');
    for (const [value, text] of [
      ['action', '只錄動作'],
      ['camera', '只錄運鏡'],
      ['both', '兩者同時'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === initial;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value as RecordTarget));

    row.append('錄製目標', select);
    return { row, select };
  }

  /**
   * 「開始錄製／停止錄製」切換鈕 + 「▶ 播放全部」按鈕（issue #29 / issue #33）。
   * 回傳個別按鈕讓建構子能直接賦值給 `readonly` 欄位（明確賦值檢查要求賦值發生
   * 在建構子本體）。可用狀態一律交給 `updateTrackControlsState` 算，這裡不預設。
   */
  private trackRow(
    onToggleRecording: () => void,
    onPlayAll: () => void,
  ): { row: HTMLElement; recordButton: HTMLButtonElement; playAllButton: HTMLButtonElement } {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const recordButton = document.createElement('button');
    recordButton.type = 'button';
    recordButton.textContent = '● 開始錄製 Track';
    recordButton.addEventListener('click', onToggleRecording);

    const playAllButton = document.createElement('button');
    playAllButton.type = 'button';
    playAllButton.textContent = '▶ 播放全部';
    playAllButton.addEventListener('click', onPlayAll);

    row.append(recordButton, playAllButton);
    return { row, recordButton, playAllButton };
  }

  /**
   * Track 清單的一列（issue #33）：種類標記（動作／相機）、簡短標籤、可編輯的
   * 「起始秒數」數字欄位、刪除鈕。編輯欄位的鎖定由 `updateTrackControlsState`
   * 在錄製／播放中統一關掉。
   */
  private trackRowEl(row: TrackListRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jelly-track-row';

    const badge = document.createElement('span');
    badge.className = 'jelly-track-badge';
    badge.textContent = row.kind === 'camera' ? '相機' : '動作';

    const label = document.createElement('span');
    label.className = 'jelly-track-label';
    label.textContent = row.label;

    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.className = 'jelly-track-start';
    startInput.min = '0';
    startInput.step = '0.1';
    startInput.value = String(row.startSeconds);
    startInput.title = '起始秒數';
    startInput.addEventListener('change', () => {
      const seconds = Math.max(0, Number(startInput.value) || 0);
      startInput.value = String(seconds);
      this.onTrackStartTimeChange(row.id, seconds);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'jelly-track-delete';
    deleteButton.textContent = '刪除';
    deleteButton.addEventListener('click', () => this.onDeleteTrack(row.id));

    el.append(badge, label, '起始', startInput, '秒', deleteButton);
    return el;
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
