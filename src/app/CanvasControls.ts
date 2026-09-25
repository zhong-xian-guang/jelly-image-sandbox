/**
 * 畫布上的兩組控制（issue #129 / V4 U2；spec #127「播放控制條」「相機按鈕」）——
 * `ControlPanel` 建出來、`JellySandbox` 掛到畫布容器上，側欄不再有這些控制。
 *
 * - **播放控制條**（`PlaybackBar`）：常駐在畫布底部中央，[● 錄製] [▶ 播放] [⏸ 暫停／繼續]
 *   [■ 停止／重設]＋時間讀數。可用狀態由 `ControlPanel.updateTrackControlsState` 算好再灌進來
 *   （規則沿用側欄時代：沒有可播放的 Track 時播放是灰的、錄製中鎖播放、播放中鎖錄製、暫停
 *   只在播放中可按、停止／重設永遠可按）。
 * - **相機按鈕**（`CameraControls`）：畫布右下角，「鎖定跟隨」切換鈕、「框住果凍」、縮放倍率
 *   讀數（相對 zoom-to-fit 的倍率，見 `JellySandbox` 每幀的 `setZoomFactor`）。
 *
 * 兩組都是薄 DOM 接線（同 `ControlPanel`）：只畫、只回呼，不知道播放／相機的實際狀態，
 * 由呼叫端每次變化時灌回來。它們只佔自己那一小塊，畫布其他地方的指標事件照常落到畫布上。
 */

/** 播放控制條的四顆鈕，也是 DOM 上的 `data-action`。 */
export type PlaybackBarAction = 'record' | 'play' | 'pause' | 'stop';

export interface PlaybackBarOptions {
  onToggleRecording: () => void;
  onPlayAll: () => void;
  onTogglePause: () => void;
  onReset: () => void;
}

const RECORD_IDLE_TEXT = '● 錄製';
const RECORD_ACTIVE_TEXT = '■ 停止錄製';
const PAUSE_TEXT = '⏸ 暫停';
const RESUME_TEXT = '▶ 繼續';

export class PlaybackBar {
  readonly element: HTMLElement;
  private readonly buttons: Record<PlaybackBarAction, HTMLButtonElement>;
  private readonly timeEl: HTMLElement;
  /** `setTime` 比對用；避免秒數字串沒變時每幀重寫 DOM。 */
  private lastTimeText: string;

  constructor(opts: PlaybackBarOptions) {
    const bar = document.createElement('div');
    bar.className = 'jelly-playback-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '播放控制');

    this.buttons = {
      record: barButton('record', RECORD_IDLE_TEXT, opts.onToggleRecording),
      play: barButton('play', '▶ 播放', opts.onPlayAll),
      pause: barButton('pause', PAUSE_TEXT, opts.onTogglePause),
      stop: barButton('stop', '■ 停止／重設', opts.onReset),
    };
    this.buttons.record.title = '開始／停止錄製 Track（錄製目標在側欄「錄製」區）';
    this.buttons.play.title = '從頭疊加播放開啟中群組的 Track';
    this.buttons.stop.title = '停止播放／錄製，並把場景重設回 Scene';

    this.timeEl = document.createElement('span');
    this.timeEl.className = 'jelly-playback-time';
    this.lastTimeText = timeText(0);
    this.timeEl.textContent = this.lastTimeText;

    bar.append(
      this.buttons.record,
      this.buttons.play,
      this.buttons.pause,
      this.buttons.stop,
      this.timeEl,
    );
    this.element = bar;
    this.setPlaying(false);
  }

  /** 錄製中／已停止：錄製鈕換字＋變色脈動（`.jelly-recording-active`，沿用側欄時代的樣式）。 */
  setRecording(active: boolean): void {
    this.buttons.record.textContent = active ? RECORD_ACTIVE_TEXT : RECORD_IDLE_TEXT;
    this.buttons.record.classList.toggle('jelly-recording-active', active);
  }

  /**
   * 播放開始／結束：暫停鈕只在播放中可按；開始時暫停鈕回到「⏸ 暫停」、時間讀數歸零，
   * 結束時讀數歸零；沒在播放時讀數變淡（控制條沒有 `.is-playing`）。
   */
  setPlaying(active: boolean): void {
    this.buttons.pause.disabled = !active;
    this.setPaused(false);
    this.setTime(0);
    this.element.classList.toggle('is-playing', active);
  }

  /** 暫停中：暫停鈕換成「▶ 繼續」並變色（`.jelly-paused-active`）。 */
  setPaused(paused: boolean): void {
    this.buttons.pause.textContent = paused ? RESUME_TEXT : PAUSE_TEXT;
    this.buttons.pause.classList.toggle('jelly-paused-active', paused);
  }

  /** 播放秒數讀數；字串沒變就不寫 DOM（每幀呼叫）。 */
  setTime(seconds: number): void {
    const text = timeText(seconds);
    if (text === this.lastTimeText) return;
    this.lastTimeText = text;
    this.timeEl.textContent = text;
  }

  /** 錄製鈕、播放鈕的可用狀態（規則在 `ControlPanel.updateTrackControlsState`）。 */
  setEnabled(action: 'record' | 'play', enabled: boolean): void {
    this.buttons[action].disabled = !enabled;
  }
}

export interface CameraControlsOptions {
  followLocked: boolean;
  onFollowLockChange: (locked: boolean) => void;
  onFrameJelly: () => void;
}

export class CameraControls {
  readonly element: HTMLElement;
  private readonly followLockButton: HTMLButtonElement;
  private readonly zoomReadout: HTMLOutputElement;
  private followLocked: boolean;

  constructor(opts: CameraControlsOptions) {
    const box = document.createElement('div');
    box.className = 'jelly-camera-controls';
    box.setAttribute('role', 'toolbar');
    box.setAttribute('aria-label', '相機');

    this.followLocked = opts.followLocked;
    this.followLockButton = barButton('follow-lock', '鎖定跟隨', () => {
      this.setFollowLocked(!this.followLocked);
      opts.onFollowLockChange(this.followLocked);
    });
    this.followLockButton.title = '鎖定後相機不再自動跟隨果凍（手動平移／縮放照常）';

    const frame = barButton('frame', '框住果凍', opts.onFrameJelly);
    frame.title = '把鏡頭緩動到剛好框住所有果凍（縮放回到 ×1.0）';

    this.zoomReadout = document.createElement('output');
    this.zoomReadout.className = 'jelly-zoom-readout';
    this.zoomReadout.title = '目前縮放，相對「框住果凍」的倍率';
    this.zoomReadout.textContent = formatZoomFactor(1);

    box.append(this.followLockButton, frame, this.zoomReadout);
    this.element = box;
    this.applyFollowLocked();
  }

  /** 從相機實際狀態灌回（每幀呼叫）——值沒變就不寫 DOM、不回呼。 */
  setFollowLocked(locked: boolean): void {
    if (this.followLocked === locked) return;
    this.followLocked = locked;
    this.applyFollowLocked();
  }

  /** 縮放倍率讀數（每幀呼叫）——文字沒變就不寫 DOM。 */
  setZoomFactor(factor: number): void {
    const text = formatZoomFactor(factor);
    if (this.zoomReadout.textContent !== text) this.zoomReadout.textContent = text;
  }

  private applyFollowLocked(): void {
    this.followLockButton.setAttribute('aria-pressed', String(this.followLocked));
    this.followLockButton.classList.toggle('is-active', this.followLocked);
  }
}

/** 縮放倍率的顯示格式：約 ≥ 1 一位小數（×1.5）、< 1 兩位小數（×0.25），縮小時才分得出差別。 */
export function formatZoomFactor(factor: number): string {
  return `×${factor.toFixed(factor >= 0.995 ? 1 : 2)}`; // 0.995 起四捨五入已是 1.00，改一位小數
}

function timeText(seconds: number): string {
  return `${seconds.toFixed(2)} 秒`;
}

function barButton(action: string, text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jelly-canvas-button';
  button.dataset.action = action;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}
