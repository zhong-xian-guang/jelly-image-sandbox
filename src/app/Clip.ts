/**
 * Clip（片段，issue #163 / spec #158 B1）——片段可編輯資料的唯一擁有者：Track 清單、
 * 群組與獨奏、片段初始 Pin、錄製目標、Track 與群組流水號。見 GLOSSARY.md「片段（Clip）」。
 *
 * 範圍窄於「片段」這個概念：Scene（在 World）、來源圖庫、物理設定、Jelly／來源流水號
 * 仍由 `JellySandbox` 持有；存檔時沙盒把 `toClipPart()` 跟自己那幾塊拼成同一份
 * `ClipState`，載入時反過來拆開。
 *
 * 只管狀態：不持有 World、不碰 DOM。需要 World 資訊時由沙盒傳入（例如拍片段初始 Pin
 * 時沙盒交來 rest 座標）。每次狀態真的變了就呼叫建構時給的 `onChange`（沙盒在那裡把
 * `view()` 同步到側欄）；沒變（找不到 id、值相同）就不呼叫。
 *
 * **錄製／播放生命週期**（issue #164 / spec #158 B2）：單一互斥 `phase`（閒置／錄製中／播放中），
 * `paused` 只在播放中有意義。`DemoRunner`（播）與 `TrackRecorder`（錄）是內部零件。frame loop
 * 每個 sim step 呼叫一次 `step(dispatch)`——播放中經 `dispatch` 送出排定事件、自己播完時切回
 * 閒置並經 `onChange` 回報；沙盒每送出一個輸入事件就交給 `record()`。兩個播放入口：
 * `playTracks`（記下播放前鏡位，`reset()` 時交回一次）與 `playDemo`（不記鏡位）。
 *
 * **編輯許可**：`allows(動作)` 是「現在能不能做 X」的唯一規則（`clipAllows`）——側欄、鍵盤、
 * 右鍵選單與沙盒入口都問它；Clip 自己的指令在不允許時直接忽略。
 */

import type { CameraState } from '../camera';
import type { Point } from '../mesh';
import type { ClipCounters, ClipGroup, ClipPoint, ClipState, ClipTrack } from './clipFile';
import { DemoRunner } from './demos/DemoRunner';
import {
  mergeTracks,
  overlappingCameraTrackIds,
  setupPinsTrack,
  type OverlayTrack,
} from './demos/overlay';
import { secondsToStep, stepToSeconds } from './demos/time';
import type { DemoEvent, DemoStep } from './demos/types';
import {
  TrackRecorder,
  createDefaultGroup,
  DEFAULT_GROUP_ID,
  toggleSolo,
  tracksInEnabledGroups,
  withGroupInvariant,
  type RecordTarget,
  type SoloState,
  type Track,
  type TrackGroup,
} from './track';

/**
 * 一條已錄好的 Track（issue #33 / V2 T1-1；issue #36 / V2 T1-4 加相機軌）——
 * `steps` 是相對自己起點的時間軸，`startStep` 是它在疊加時間軸上的起始 sim step
 * （UI 以「秒」編輯，`STEP_SECONDS` 換算），`label`／`customLabel` 是清單上顯示的
 * 名稱（見各欄註解），`id` 兼作 `mergeTracks` 的 `PointerId` 前綴來源（各條唯一）。
 *
 * `inStep`／`outStep`（issue #35 / V2 T1-3）是本地時間的頭尾修剪範圍（同樣以
 * step 存、UI 以「秒」編輯）：播放時只取 `[inStep, outStep]` 之間的排程項，其餘
 * 頭尾各切掉。錄好時 `inStep = 0`、`outStep = ` 最後一筆操作的 step（涵蓋整條）。
 *
 * `kind` 分動作軌／相機軌。相機軌（`kind === 'camera'`）另帶 `startCamera`——錄製
 * 起點的鏡頭快照，播放時由 `mergeTracks` 在起始 step 插一個絕對相機指令硬切進場
 * （issue #36）。動作軌 `startCamera` 為 `null`。
 *
 * `groupIds`（issue #43 / V2 T1-8）是這條屬於哪些群組（多對多）。新錄好時 =
 * `{ 預設群組 }`；不變式「每條 Track 永遠至少在一個群組」由 `withGroupInvariant`
 * 維持。播放時只取「至少屬於一個開啟中群組」的子集（`tracksInEnabledGroups`），
 * 順序照清單順序（決定性、`mergeTracks` 認先列不變）。
 */
interface RecordedTrack {
  id: string;
  kind: 'action' | 'camera';
  /**
   * `addTrack` 當下用 `summarizeTrack` 算一次的自動摘要（`動作軌 1（拖曳 · Pin）`），
   * 之後**不再重算**——調整起始／修剪／分群都不動它。
   */
  label: string;
  /**
   * 使用者在清單內改的名字（issue #54 / V2 T2-1）——非 `null` 時取代 `label` 顯示、
   * 也是之後寫進存檔的名稱（issue #57）。在欄位裡清成空字串 → 設回 `null`，顯示
   * 退回自動摘要 `label`。
   */
  customLabel: string | null;
  startStep: number;
  inStep: number;
  outStep: number;
  steps: Track;
  startCamera: CameraState | null;
  groupIds: Set<string>;
}

/** 群組區的一列（`ControlPanel` 的 `GroupListRow`）。 */
export interface ClipGroupRow {
  id: string;
  name: string;
  enabled: boolean;
  trackCount: number;
  soloed: boolean;
  deletable: boolean;
}

/** Track 清單的一列（`ControlPanel` 的 `TrackListRow`）。 */
export interface ClipTrackRow {
  id: string;
  kind: 'action' | 'camera';
  label: string;
  startSeconds: number;
  inSeconds: number;
  outSeconds: number;
  firstEventSeconds: number;
  lastEventSeconds: number;
  overlapping: boolean;
  groups: { id: string; name: string; member: boolean }[];
}

/** `view()` 的唯讀快照：側欄 Track／群組區要畫的全部資料。 */
export interface ClipView {
  groups: ClipGroupRow[];
  tracks: ClipTrackRow[];
  /** 開啟中群組成員聯集有幾條 Track（0 → 「▶ 播放」變灰）。 */
  playableTrackCount: number;
  /** 片段初始 Pin 快照有幾顆。 */
  setupPinCount: number;
  /** 錄製／播放狀態。 */
  phase: ClipPhase;
  /** 播放中是否暫停（其他 phase 一律 `false`）。 */
  paused: boolean;
}

/** 片段檔中 Clip 負責的那部分。 */
export interface ClipPart {
  tracks: ClipTrack[];
  groups: ClipGroup[];
  setupPins: ClipPoint[];
  counters: Pick<ClipCounters, 'nextTrackNum' | 'nextGroupNum'>;
}

/** 錄製／播放狀態（issue #164）：閒置／錄製中／播放中，三者互斥。 */
export type ClipPhase = 'idle' | 'recording' | 'playing';

/**
 * `allows` 問的具名動作（issue #164）——側欄按鈕、鍵盤、右鍵選單與沙盒入口都問同一處。
 * - `editTracks`：Track 清單與群組區的所有編輯
 * - `record`：「● 錄製／■ 停止錄製」鈕
 * - `play`：「▶ 播放」與 Demo 按鈕
 * - `setupPins`：片段初始 Pin 的「設為目前 Pin」「清除」
 * - `setInitialPose`／`rebuildAll`／`clearAll`：同名按鈕
 * - `rebuildJelly`／`removeJelly`：Jelly 右鍵選單的「重建」「移除」
 * - `selectRecordTarget`：錄製目標選擇器
 */
export type ClipAction =
  | 'editTracks'
  | 'record'
  | 'play'
  | 'setupPins'
  | 'setInitialPose'
  | 'rebuildAll'
  | 'clearAll'
  | 'rebuildJelly'
  | 'removeJelly'
  | 'selectRecordTarget';

/**
 * 某個 phase 允不允許某個動作（純函式，`Clip.allows` 用的就是它）：閒置時全部允許；錄製中
 * 只剩錄製鈕（此時是「■ 停止錄製」）與 Jelly 選單的「移除」（會被錄成事件）；播放中全部鎖住。
 */
export function clipAllows(phase: ClipPhase, action: ClipAction): boolean {
  if (phase === 'idle') return true;
  if (phase === 'recording') return action === 'record' || action === 'removeJelly';
  return false;
}

export interface ClipOptions {
  /** 狀態真的變了才呼叫（沙盒據此同步側欄）。 */
  onChange?: () => void;
}

export class Clip {
  /**
   * 按下錄製前選定的錄製目標（issue #33）——只錄動作／只錄運鏡／兩者同時。是使用者
   * 的設定而非片段內容：`clear()`／`fromClipPart()` 都不動它（跟整理前一樣）。
   */
  private target: RecordTarget = 'action';
  /** 錄製／播放狀態（issue #164）：互斥的單一 phase。 */
  private currentPhase: ClipPhase = 'idle';
  private isPaused = false;
  private readonly recorder = new TrackRecorder();
  private readonly runner = new DemoRunner();
  /**
   * 播放前的鏡位（issue #156）——播放 Track 時記下，「停止／重設」由 `reset()` 交回一次。
   * 自己播完不清掉（播完再按重設仍會回到播放前）。
   */
  private cameraBeforePlayback: CameraState | null = null;
  /**
   * Track 清單——陣列順序＝錄製順序＝清單顯示順序＝相機軌「認先列」的先後
   * （`mergeTracks`）。生命週期（ADR-0013）：「清空全部」／載入片段才換掉；
   * 「停止／重設」與匯入圖片都保留。
   */
  private tracks: RecordedTrack[] = [];
  /** 下一條 Track 的流水號，兼作 `id`／`PointerId` 前綴（各條唯一）與預設標籤編號。 */
  private nextTrackNum = 1;
  /**
   * 片段初始 Pin 快照（issue #39 / ADR-0007 追記）——每個元素是一個 Pin 附著點在
   * **rest 形狀**下的世界座標，獨立於任何 Track。`overlayTracks()` 把它組成一條合成
   * 軌（`setupPinsTrack`）排在最前面，於 step 0 一次還原。生命週期比照 `tracks`。
   */
  private setupPins: Point[] = [];
  /** Track 群組清單（issue #43，ADR-0008）——`groups[0]` 永遠是預設群組（不可刪）。 */
  private groups: TrackGroup[] = [createDefaultGroup()];
  /** 下一個使用者新建群組的流水號（`g1`／`g2`…，兼作預設名稱編號）。 */
  private nextGroupNum = 1;
  /** 目前的「獨奏」狀態（`null` = 沒在獨奏）——狀態轉移見 `track/groups` 的 `toggleSolo`。 */
  private soloState: SoloState | null = null;
  private readonly onChange: () => void;

  constructor(options: ClipOptions = {}) {
    this.onChange = options.onChange ?? (() => {});
  }

  /** 目前的 phase 允不允許 `action`（規則見 `clipAllows`）。 */
  allows(action: ClipAction): boolean {
    return clipAllows(this.currentPhase, action);
  }

  /** 目前的錄製／播放狀態。 */
  get phase(): ClipPhase {
    return this.currentPhase;
  }

  get recordTarget(): RecordTarget {
    return this.target;
  }

  /** 「錄製目標」選擇器——錄製中／播放中不允許時忽略。 */
  set recordTarget(target: RecordTarget) {
    if (!this.allows('selectRecordTarget')) return;
    this.target = target;
  }

  /**
   * 「● 錄製／■ 停止錄製」切換鈕：閒置時依錄製目標起錄（`startCamera` 是錄製起點的鏡頭
   * 快照，相機軌硬切進場用，沙盒傳入前先拷貝）；錄製中則停止，把錄到的事件依種類拆成
   * 動作軌／相機軌，非空的各新增一列（「兩者同時」一次產出兩列）。播放中不允許、忽略。
   */
  toggleRecording(startCamera: CameraState): void {
    if (this.currentPhase === 'recording') {
      const { action, camera, startCamera: recordedCamera } = this.recorder.stop();
      this.currentPhase = 'idle';
      this.onChange();
      if (action.length > 0) this.addTrack('action', action, null);
      if (camera.length > 0) this.addTrack('camera', camera, recordedCamera ?? null);
      return;
    }
    if (!this.allows('record')) return;
    this.recorder.start(this.target, startCamera);
    this.currentPhase = 'recording';
    this.onChange();
  }

  /**
   * 沙盒每送出一個輸入事件或相機指令就交給這裡（錄製中才真的記下，時間戳記是錄製開始後
   * 跑過的 sim step 數）。
   */
  record(event: DemoEvent): void {
    this.recorder.record(event);
  }

  /**
   * frame loop 每個固定 sim step 呼叫一次（在 `world.step` 之前）：播放中把這個 step 排定的
   * 事件經 `dispatch` 送出，播完就切回閒置並通知；錄製中讓錄製時間軸前進一格。
   */
  step(dispatch: (event: DemoEvent) => void): void {
    if (this.currentPhase === 'playing' && !this.isPaused) {
      this.runner.advance(dispatch, dispatch);
      if (!this.runner.isRunning) this.endPlayback();
    }
    this.recorder.tick();
  }

  /** 播放中已推進的 sim step 數（控制條的「目前 X.XX 秒」）；暫停時定住。 */
  get playbackSteps(): number {
    return this.runner.elapsedSteps;
  }

  /** 播放中是否暫停（只在播放中有意義；播放結束一律歸零）。 */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * 「▶ 播放」：把 `overlayTracks()` 疊成一條全域時間軸開始播放，並記下播放前的鏡位
   * （`cameraNow`，「停止／重設」時由 `reset()` 交回）。不允許（錄製中、已在播放中）或沒有
   * 可播放的 Track 時忽略。回傳是否真的開始播——是的話沙盒要接著 `world.reset()`。
   */
  playTracks(cameraNow: CameraState): boolean {
    if (!this.allows('play')) return false;
    const overlay = this.overlayTracks();
    if (overlay.length === 0) return false;
    this.cameraBeforePlayback = cameraNow;
    this.startPlayback(mergeTracks(overlay));
    return true;
  }

  /** Demo 按鈕：播放一段現成的排程；不記播放前鏡位。不允許時忽略。 */
  playDemo(schedule: readonly DemoStep[]): void {
    if (!this.allows('play')) return;
    this.startPlayback(schedule);
  }

  /** 「⏸ 暫停／▶ 繼續」與空白鍵——只在播放中有作用。 */
  togglePause(): void {
    if (this.currentPhase !== 'playing') return;
    this.isPaused = !this.isPaused;
    this.onChange();
  }

  /** 只中斷播放（匯入圖片時）：錄製不受影響、播放前鏡位保留。 */
  stopPlayback(): void {
    if (this.currentPhase !== 'playing') return;
    this.runner.stop();
    this.endPlayback();
  }

  /** 中斷播放與錄製；進行中的錄製**丟棄**（「中斷」不是「存檔」）。播放前鏡位保留。 */
  halt(): void {
    this.stopPlayback();
    if (this.currentPhase === 'recording') {
      this.recorder.stop();
      this.currentPhase = 'idle';
      this.onChange();
    }
  }

  /**
   * 「停止／重設」：`halt()`，再交回播放前的鏡位（沒播放過、或已還原過則 `null`）——還原
   * 一次就丟掉，之後使用者重新擺的鏡位不會又被下一次重設拉回去。
   */
  reset(): CameraState | null {
    this.halt();
    const camera = this.cameraBeforePlayback;
    this.cameraBeforePlayback = null;
    return camera;
  }

  private startPlayback(schedule: readonly DemoStep[]): void {
    this.runner.start(schedule);
    if (!this.runner.isRunning) return;
    this.currentPhase = 'playing';
    this.isPaused = false;
    this.onChange();
  }

  private endPlayback(): void {
    this.currentPhase = 'idle';
    this.isPaused = false;
    this.onChange();
  }

  /**
   * 把剛錄好的一段 Track 加進清單。預設起始 0 秒、修剪範圍涵蓋整條（`inStep = 0`、
   * `outStep = ` 最後一筆操作的 step）。相機軌額外帶 `startCamera` 快照。新錄好的
   * Track 自動加入預設群組（ADR-0008）。回傳新 Track 的 id。
   */
  addTrack(kind: 'action' | 'camera', steps: Track, startCamera: CameraState | null): string {
    const num = this.nextTrackNum++;
    const id = `t${num}`;
    this.tracks.push({
      id,
      kind,
      label:
        kind === 'camera'
          ? summarizeTrack(`相機軌 ${num}`, steps, CAMERA_TRACK_KIND_LABELS)
          : summarizeTrack(`動作軌 ${num}`, steps, ACTION_TRACK_KIND_LABELS),
      customLabel: null,
      startStep: 0,
      inStep: 0,
      outStep: lastEventStep(steps),
      steps,
      startCamera,
      groupIds: new Set([DEFAULT_GROUP_ID]),
    });
    this.onChange();
    return id;
  }

  /**
   * 「起始秒數」欄位（issue #33）——這條在片段時間軸上從第幾秒開始。負數 clamp 到 0。
   * 秒數一律量化成 step 存：輸入 0.11 秒時 `view()` 回報實際生效的 0.1167 秒。
   */
  setTrackStartTime(id: string, seconds: number): void {
    this.updateTrack(id, (track) => {
      track.startStep = Math.max(0, secondsToStep(seconds));
    });
  }

  /** 「從 X 秒」（頭修剪）欄位（issue #35）——clamp 到 `[0, outStep]`，不讓 in 越過 out。 */
  setTrackTrimIn(id: string, seconds: number): void {
    this.updateTrack(id, (track) => {
      track.inStep = Math.min(Math.max(0, secondsToStep(seconds)), track.outStep);
    });
  }

  /** 「到 Y 秒」（尾修剪）欄位（issue #35）——不小於 `inStep`；超過最後一筆操作不特別 clamp。 */
  setTrackTrimOut(id: string, seconds: number): void {
    this.updateTrack(id, (track) => {
      track.outStep = Math.max(secondsToStep(seconds), track.inStep);
    });
  }

  deleteTrack(id: string): void {
    if (!this.allows('editTracks')) return;
    this.tracks = this.tracks.filter((t) => t.id !== id);
    this.onChange();
  }

  /**
   * Track 清單內改名（issue #54）——呼叫端已 trim。空字串 → 退回自動摘要；非空 → 存成
   * 覆寫，之後調整起始／修剪／分群都不會蓋回。
   */
  renameTrack(id: string, name: string): void {
    if (!this.allows('editTracks')) return;
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    const next = name === '' ? null : name;
    if (track.customLabel === next) return;
    track.customLabel = next;
    this.onChange();
  }

  /**
   * 「片段初始 Pin：設為目前 Pin」（issue #39）——以沙盒交來的 rest 形狀附著座標取代
   * 上一份快照（存 rest 而非目前變形座標：播放會先 `world.reset()`，還原時才精準）。
   */
  setSetupPins(restPoints: readonly Point[]): void {
    if (!this.allows('setupPins')) return;
    this.setupPins = restPoints.map((p) => ({ x: p.x, y: p.y }));
    this.onChange();
  }

  /** 「片段初始 Pin：清除」（issue #39）。 */
  clearSetupPins(): void {
    if (!this.allows('setupPins')) return;
    if (this.setupPins.length === 0) return;
    this.setupPins = [];
    this.onChange();
  }

  /** 「＋ 新增群組」（issue #43）——新群組預設開啟、沒有成員；進行中的獨奏還原點作廢。 */
  addGroup(): void {
    if (!this.allows('editTracks')) return;
    const num = this.nextGroupNum++;
    this.groups.push({ id: `g${num}`, name: `群組 ${num}`, enabled: true });
    this.soloState = null;
    this.onChange();
  }

  /** 某群組的開啟／關閉（issue #43）——手動動過開關，進行中的獨奏還原點作廢。 */
  setGroupEnabled(id: string, enabled: boolean): void {
    if (!this.allows('editTracks')) return;
    const group = this.groups.find((g) => g.id === id);
    if (!group || group.enabled === enabled) return;
    group.enabled = enabled;
    this.soloState = null;
    this.onChange();
  }

  /** 某群組改名（issue #43）——`ControlPanel` 已擋掉空字串。 */
  renameGroup(id: string, name: string): void {
    if (!this.allows('editTracks')) return;
    const group = this.groups.find((g) => g.id === id);
    if (!group || group.name === name) return;
    group.name = name;
    this.onChange();
  }

  /** 「獨奏」鈕（issue #43）——只留該群組開；對正在獨奏的群組再按一次還原先前的開關。 */
  toggleGroupSolo(id: string): void {
    if (!this.allows('editTracks')) return;
    const { groups, solo } = toggleSolo(this.groups, this.soloState, id);
    this.groups = groups;
    this.soloState = solo;
    this.onChange();
  }

  /**
   * 「刪除」群組（issue #43）——只解除歸屬、成員 Track 不刪；掉到 0 群組的 Track 補回
   * 預設群組（不變式）。預設群組不可刪。
   */
  deleteGroup(id: string): void {
    if (!this.allows('editTracks')) return;
    if (id === DEFAULT_GROUP_ID) return;
    this.groups = this.groups.filter((g) => g.id !== id);
    for (const track of this.tracks) {
      track.groupIds = withGroupInvariant(track.groupIds, this.groups);
    }
    this.soloState = null;
    this.onChange();
  }

  /** 某條 Track 的 `群組 ▾` 勾選（issue #43）——丟掉無效 id、全空時補回預設群組。 */
  setTrackGroups(trackId: string, groupIds: readonly string[]): void {
    if (!this.allows('editTracks')) return;
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.groupIds = withGroupInvariant(groupIds, this.groups);
    this.onChange();
  }

  /**
   * 要交給 `mergeTracks` 疊播的輸入：片段初始 Pin 合成軌排最前面（issue #39：`setup/`
   * 前綴、step 0 靠穩定排序先於所有軌的 step-0 事件），之後是開啟中群組的成員 Track，
   * **保留清單順序**（相機軌認先列）。沒有可播放的 Track 時回空陣列（不播）。
   */
  overlayTracks(): OverlayTrack[] {
    const active = tracksInEnabledGroups(this.tracks, this.groups);
    if (active.length === 0) return [];
    return [
      setupPinsTrack(this.setupPins),
      ...active.map((t) => ({
        startStep: t.startStep,
        idPrefix: `${t.id}/`,
        steps: t.steps,
        inStep: t.inStep,
        outStep: t.outStep,
        startCamera: t.startCamera,
      })),
    ];
  }

  /** 側欄 Track／群組區的唯讀快照（每次呼叫全新物件）。 */
  view(): ClipView {
    const overlapping = this.overlappingEnabledCameraTrackIds();
    return {
      groups: this.groups.map((g) => ({
        id: g.id,
        name: g.name,
        enabled: g.enabled,
        trackCount: this.tracks.filter((t) => t.groupIds.has(g.id)).length,
        soloed: this.soloState?.soloId === g.id,
        deletable: g.id !== DEFAULT_GROUP_ID,
      })),
      tracks: this.tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.customLabel ?? t.label,
        startSeconds: stepToSeconds(t.startStep),
        inSeconds: stepToSeconds(t.inStep),
        outSeconds: stepToSeconds(t.outStep),
        firstEventSeconds: stepToSeconds(firstEventStep(t.steps)),
        lastEventSeconds: stepToSeconds(lastEventStep(t.steps)),
        overlapping: overlapping.has(t.id),
        groups: this.groups.map((g) => ({ id: g.id, name: g.name, member: t.groupIds.has(g.id) })),
      })),
      playableTrackCount: tracksInEnabledGroups(this.tracks, this.groups).length,
      setupPinCount: this.setupPins.length,
      phase: this.currentPhase,
      paused: this.isPaused,
    };
  }

  /**
   * 片段檔中 Clip 那部分（issue #57 格式）：`groupIds` 的 `Set` → 陣列、`customLabel ??
   * label` → `name`、片段初始 Pin 拷成純 `{ x, y }`、兩個流水號。
   */
  toClipPart(): ClipPart {
    return {
      tracks: this.tracks.map((t): ClipTrack => ({
        id: t.id,
        kind: t.kind,
        name: t.customLabel ?? t.label,
        startStep: t.startStep,
        inStep: t.inStep,
        outStep: t.outStep,
        steps: t.steps,
        startCamera: t.startCamera,
        groupIds: [...t.groupIds],
      })),
      groups: this.groups.map((g) => ({ id: g.id, name: g.name, enabled: g.enabled })),
      setupPins: this.setupPins.map((p) => ({ x: p.x, y: p.y })),
      counters: { nextTrackNum: this.nextTrackNum, nextGroupNum: this.nextGroupNum },
    };
  }

  /**
   * 以片段檔的 Clip 那部分整包取代目前狀態（載入片段，issue #58）；先 `halt()` 中斷錄製／播放，
   * 獨奏狀態清掉。
   */
  fromClipPart(part: Readonly<ClipPart> | ClipState): void {
    this.halt();
    this.groups = part.groups.map((g) => ({ ...g }));
    this.tracks = part.tracks.map(hydrateClipTrack);
    this.nextTrackNum = part.counters.nextTrackNum;
    this.nextGroupNum = part.counters.nextGroupNum;
    this.soloState = null;
    this.setupPins = part.setupPins.map((p) => ({ x: p.x, y: p.y }));
    this.onChange();
  }

  /**
   * 回到全新片段（「清空全部」）：先 `halt()` 中斷錄製（丟棄）與播放，Track／群組／片段初始
   * Pin／流水號全部歸零；錄製目標與播放前鏡位不動（跟整理前一樣）。
   */
  clear(): void {
    this.halt();
    this.tracks = [];
    this.nextTrackNum = 1;
    this.setupPins = [];
    this.groups = [createDefaultGroup()];
    this.nextGroupNum = 1;
    this.soloState = null;
    this.onChange();
  }

  /** 找到 `id` 那條 Track、跑 `mutate` 改它的 step 欄位；找不到就不動。 */
  private updateTrack(id: string, mutate: (track: RecordedTrack) => void): void {
    if (!this.allows('editTracks')) return;
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    mutate(track);
    this.onChange();
  }

  /**
   * 要在面板標紅的相機軌 id（issue #36 軟警告）。issue #37 / ADR-0008：只對「開啟中群組
   * 聯集」裡的相機軌判定——跟播放時餵給 `mergeTracks` 的是同一個子集。
   */
  private overlappingEnabledCameraTrackIds(): Set<string> {
    const cameras = tracksInEnabledGroups(this.tracks, this.groups).filter(
      (t) => t.kind === 'camera',
    );
    return overlappingCameraTrackIds(cameras);
  }
}

/** 事件 `type` → 清單標籤上的操作分類字；沒列到的 type 不進標籤。 */
const ACTION_TRACK_KIND_LABELS: Readonly<Record<string, string>> = {
  grab: '拖曳',
  moveGrab: '拖曳',
  release: '拖曳',
  tap: '輕拍',
  pin: 'Pin',
  movePin: 'Pin',
  unpin: 'Pin',
  clearPins: 'Pin',
  setFan: '電風扇',
  clearFan: '電風扇',
  spawn: '生成',
  remove: '移除',
};
const CAMERA_TRACK_KIND_LABELS: Readonly<Record<string, string>> = {
  panBy: '平移',
  zoomBy: '縮放',
  frame: '框住',
  setFollow: '鎖定跟隨',
};

/**
 * 一段 Track 的簡短標籤（issue #33 動作軌 / issue #36 相機軌）：`<name>` 後面括號
 * 列出這條錄到哪幾類操作（去重、保留出現順序）。沒有可辨識的操作就只回 `name`。
 */
function summarizeTrack(
  name: string,
  steps: Track,
  labels: Readonly<Record<string, string>>,
): string {
  const kinds = new Set<string>();
  for (const { event } of steps) {
    const label = labels[event.type];
    if (label !== undefined) kinds.add(label);
  }
  return kinds.size > 0 ? `${name}（${[...kinds].join(' · ')}）` : name;
}

/**
 * `ClipTrack`（存檔格式）→ `RecordedTrack`（記憶體格式），issue #58。存檔的 `name` 已是
 * `customLabel ?? label` 攤平後的最終顯示字串、分不出原本是哪一種——兩欄都設成它，
 * 使用者之後把名稱清空仍退回這個 `label`。
 */
function hydrateClipTrack(clip: ClipTrack): RecordedTrack {
  return {
    id: clip.id,
    kind: clip.kind,
    label: clip.name,
    customLabel: clip.name,
    startStep: clip.startStep,
    inStep: clip.inStep,
    outStep: clip.outStep,
    steps: clip.steps,
    startCamera: clip.startCamera,
    groupIds: new Set(clip.groupIds),
  };
}

/** 一段 Track 第一筆／最後一筆操作的 step（依 `atStep` 升冪，取頭尾）；空 Track 回 0。 */
function firstEventStep(steps: Track): number {
  return steps[0]?.atStep ?? 0;
}

function lastEventStep(steps: Track): number {
  return steps[steps.length - 1]?.atStep ?? 0;
}
