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
 * Track 清單裡的一列（issue #33 / V2 T1-1；issue #36 加相機軌）——`ControlPanel`
 * 只拿它畫 UI，實際的錄製內容／sim-step 換算／重疊判定都在 `JellySandbox`。
 * `kind` 決定種類標記（動作／相機）。
 */
export interface TrackListRow {
  id: string;
  kind: 'action' | 'camera';
  /**
   * 清單上顯示的名稱：使用者自訂名（issue #54），或未改過時的自動摘要
   * （例如「動作軌 1（拖曳 · 輕拍 · Pin）」「相機軌 2（平移 · 縮放）」）。
   * 這一列是可原地編輯的 `input`（見 `trackRowEl`）。
   */
  label: string;
  /** 這條 Track 在片段時間軸上的起始秒數（可編輯）。 */
  startSeconds: number;
  /** 頭修剪：這條 Track 本地時間中，從第幾秒開始播（可編輯，issue #35）。 */
  inSeconds: number;
  /** 尾修剪：這條 Track 本地時間中，播到第幾秒為止（可編輯，issue #35）。 */
  outSeconds: number;
  /** 這條 Track 第一筆操作的本地秒數（唯讀顯示，幫使用者抓修剪起訖值）。 */
  firstEventSeconds: number;
  /** 這條 Track 最後一筆操作的本地秒數（唯讀顯示）。 */
  lastEventSeconds: number;
  /**
   * 相機軌才會為 `true`（issue #36）：這條在時間軸上跟另一條**開啟中群組聯集裡的**
   * 相機軌作用區間重疊（issue #37 / ADR-0008）——列標紅的軟警告（播放時重疊區間
   * 只認先列那條）。關掉某群組後，只屬於它的相機軌不再跟別條衝突，紅框消失。
   */
  overlapping?: boolean;
  /**
   * 這條 Track 的群組歸屬（issue #43 / V2 T1-8）——每個群組一項 + 是否屬於它。
   * 兩種用途：(1) Track 清單依此**分區顯示**（每條列在它所屬的每個群組底下，
   * 多屬則多次出現）；(2) `群組 ▾` 多選勾選狀態。動作軌（issue #43）與相機軌
   * （issue #37，見 ADR-0008）兩種都畫 `群組 ▾` 編輯器。
   */
  groups: readonly TrackGroupChoice[];
}

/** Track 列 `群組 ▾` 裡的一個可勾選項（issue #43）：群組 id／名稱／這條是否屬於它。 */
export interface TrackGroupChoice {
  id: string;
  name: string;
  member: boolean;
}

/**
 * 群組區的一列（issue #43 / V2 T1-8）——`ControlPanel` 只拿它畫 UI，歸屬計算／
 * 不變式／獨奏狀態都在 `../app/track/groups` 純函式 + `JellySandbox`。
 */
export interface GroupListRow {
  id: string;
  /** 可編輯的群組名稱。 */
  name: string;
  /** 開啟／關閉狀態（播放取所有開啟中群組的成員聯集）。 */
  enabled: boolean;
  /** 目前有幾條 Track 屬於這個群組（顯示成「（N 條）」）。 */
  trackCount: number;
  /** 這個群組正被「獨奏」——獨奏鈕高亮。 */
  soloed: boolean;
  /** 可否刪除（預設群組不可刪）。 */
  deletable: boolean;
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
  /** 「▶ 播放」按鈕（issue #33；issue #43 改播「開啟中群組成員聯集」）——依起始時間疊加重播。 */
  onPlayAll: () => void;
  /** 「片段初始 Pin：設為目前 Pin」被按（issue #39）——把畫面上所有 Pin 拍成片段初始快照。 */
  onSnapshotSetupPins: () => void;
  /** 「片段初始 Pin：清除」被按（issue #39）——清空快照。 */
  onClearSetupPins: () => void;
  /** 「＋ 新增群組」被按（issue #43）。 */
  onAddGroup: () => void;
  /** 某群組的開啟／關閉勾選框被切換（issue #43）。 */
  onGroupEnabledChange: (id: string, enabled: boolean) => void;
  /** 某群組被改名（issue #43）。 */
  onGroupRename: (id: string, name: string) => void;
  /** 某群組的「獨奏」鈕被按（issue #43）——只留它開／再按還原。 */
  onGroupSolo: (id: string) => void;
  /** 某群組的「刪除」鈕被按（issue #43）——只解除歸屬、不刪成員 Track。 */
  onDeleteGroup: (id: string) => void;
  /** 某條 Track 的 `群組 ▾` 勾選變更（issue #43）——傳回勾好的群組 id 清單。 */
  onTrackGroupsChange: (trackId: string, groupIds: readonly string[]) => void;
  /** 「⏸ 暫停／▶ 繼續」切換鈕（issue #34）——只在播放中有作用。 */
  onTogglePause: () => void;
  /** 某條 Track 的「起始秒數」欄位被改（issue #33）。 */
  onTrackStartTimeChange: (id: string, seconds: number) => void;
  /** 某條 Track 的「從 X 秒」（頭修剪）欄位被改（issue #35）。 */
  onTrackTrimInChange: (id: string, seconds: number) => void;
  /** 某條 Track 的「到 Y 秒」（尾修剪）欄位被改（issue #35）。 */
  onTrackTrimOutChange: (id: string, seconds: number) => void;
  /** 某條 Track 的刪除鈕被按（issue #33）。 */
  onDeleteTrack: (id: string) => void;
  /**
   * 某條 Track 在清單內被改名（issue #54 / V2 T2-1）——比照群組改名的互動
   * （失焦／Enter 回報一次、`name` 已 trim），差別是**空字串照樣回報**：呼叫端
   * 據此把使用者覆寫清掉、顯示退回自動摘要（群組改名則是把空字串吞掉不回報）。
   */
  onTrackRename: (id: string, name: string) => void;
}

export class ControlPanel {
  readonly element: HTMLElement;
  /** 播放中鎖住，避免疊加播放兩個 Demo（issue #15）——見 `setPlaybackControlsEnabled`。 */
  private readonly demoButtons: HTMLButtonElement[] = [];
  private readonly recordButton: HTMLButtonElement;
  private readonly playAllButton: HTMLButtonElement;
  private readonly recordTargetSelect: HTMLSelectElement;
  /**
   * 「片段初始 Pin：N 個 ｜ 設為目前 Pin ｜ 清除」列（issue #39 / ADR-0007 追記）
   * ——片段層級的狀態，不受 Track 數量影響。`setSetupPinCount` 更新數字；錄製中／
   * 播放中兩顆鈕跟著 Track 清單編輯一起鎖住（見 `updateTrackControlsState`）。
   */
  private readonly setupPinsCountEl: HTMLElement;
  private readonly setupPinsSnapshotButton: HTMLButtonElement;
  private readonly setupPinsClearButton: HTMLButtonElement;
  /**
   * 「鎖定跟隨」勾選框（issue #36 追加把手）——`setFollowLocked` 讓 `JellySandbox`
   * 每幀把它同步到相機實際的 `followEnabled`，這樣相機軌播放（`setState` 硬切、
   * 錄進去的 `setFollow`）或 `playAll` 重設鏡頭改動了跟隨狀態時，勾選框不會跟
   * 實際狀態脫鉤。
   */
  private readonly followLockCheckbox: HTMLInputElement;
  /** 「⏸ 暫停／▶ 繼續」鈕 + 「目前 X.XX 秒」讀出（issue #34）——同一列，只在播放中顯示。 */
  private readonly playbackStatusRow: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly playbackTimeEl: HTMLElement;
  /** `setPlaybackTime` 比對用；避免秒數字串沒變時每幀重寫 DOM（同 `lastPerfText`）。 */
  private lastPlaybackText: string | null = null;
  /**
   * Track 清單容器（issue #33；issue #43 改成**依群組分區**）——每個群組一段
   * `.jelly-group-section`：群組標頭列（開關／名稱／獨奏／刪除）+ 該群組的成員
   * Track 卡片。一條 Track 屬多個群組就在每段各出現一次。`setGroups`／`setTracks`
   * 任一被呼叫都整份重建（見 `renderGroupedTracks`）。
   */
  private readonly groupedTracksEl: HTMLElement;
  private readonly addGroupButton: HTMLButtonElement;
  /** 最近一次 `setGroups`／`setTracks` 收到的資料——`renderGroupedTracks` 兩者都要。 */
  private lastGroups: readonly GroupListRow[] = [];
  private lastTracks: readonly TrackListRow[] = [];
  private readonly onTrackStartTimeChange: (id: string, seconds: number) => void;
  private readonly onTrackTrimInChange: (id: string, seconds: number) => void;
  private readonly onTrackTrimOutChange: (id: string, seconds: number) => void;
  private readonly onDeleteTrack: (id: string) => void;
  private readonly onTrackRename: (id: string, name: string) => void;
  private readonly onAddGroup: () => void;
  private readonly onGroupEnabledChange: (id: string, enabled: boolean) => void;
  private readonly onGroupRename: (id: string, name: string) => void;
  private readonly onGroupSolo: (id: string) => void;
  private readonly onDeleteGroup: (id: string) => void;
  private readonly onTrackGroupsChange: (trackId: string, groupIds: readonly string[]) => void;
  /** 目前清單有幾條 Track——`setTracks` 維護；沒有任何 Track 時「▶ 播放」變灰。 */
  private trackCount = 0;
  /**
   * 目前展開著 `群組 ▾` 的 Track id（issue #43）——`setTracks` 每次整份重建列，
   * 靠這個把展開狀態帶過去，勾一個群組後選單不會收合（多選要能連續勾）。
   */
  private readonly openTrackGroupMenus = new Set<string>();
  /**
   * 目前「開啟中群組成員聯集」有幾條 Track（issue #43）——`setPlayableTrackCount`
   * 維護；為 0 時（所有群組都關／開啟中群組沒有成員）「▶ 播放」變灰。
   */
  private playableTrackCount = 0;
  /** 正在錄製中——`setRecordingActive` 維護；錄製與播放互斥，錄製中「播放全部」與清單編輯鎖住。 */
  private recording = false;
  /** Demo／Track 播放中鎖住——`setPlaybackControlsEnabled` 維護。 */
  private playbackLocked = false;
  private readonly perfStatus: HTMLElement;
  /** `setPerfStatus` 比對用；避免值沒變時每幀重寫 DOM。 */
  private lastPerfText: string | null = null;

  constructor(opts: ControlPanelOptions) {
    this.onTrackStartTimeChange = opts.onTrackStartTimeChange;
    this.onTrackTrimInChange = opts.onTrackTrimInChange;
    this.onTrackTrimOutChange = opts.onTrackTrimOutChange;
    this.onDeleteTrack = opts.onDeleteTrack;
    this.onTrackRename = opts.onTrackRename;
    this.onAddGroup = opts.onAddGroup;
    this.onGroupEnabledChange = opts.onGroupEnabledChange;
    this.onGroupRename = opts.onGroupRename;
    this.onGroupSolo = opts.onGroupSolo;
    this.onDeleteGroup = opts.onDeleteGroup;
    this.onTrackGroupsChange = opts.onTrackGroupsChange;

    const panel = document.createElement('div');
    panel.className = 'jelly-control-panel';

    this.perfStatus = this.perfStatusRow();

    const followLock = this.followLockRow(opts.initial.followLocked, opts.onFollowLockChange);
    this.followLockCheckbox = followLock.checkbox;

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
      followLock.row,
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

    const setupPins = this.setupPinsRow(opts.onSnapshotSetupPins, opts.onClearSetupPins);
    this.setupPinsCountEl = setupPins.countEl;
    this.setupPinsSnapshotButton = setupPins.snapshotButton;
    this.setupPinsClearButton = setupPins.clearButton;

    // 依群組分區的 Track 清單（issue #43）——群組標頭 + 底下該群組的成員卡片。
    this.groupedTracksEl = document.createElement('div');
    this.groupedTracksEl.className = 'jelly-grouped-tracks';
    const addGroup = this.addGroupRow(() => this.onAddGroup());
    this.addGroupButton = addGroup.button;

    const playback = this.playbackStatusRowEl(opts.onTogglePause);
    this.playbackStatusRow = playback.row;
    this.pauseButton = playback.pauseButton;
    this.playbackTimeEl = playback.timeEl;

    panel.append(
      target.row,
      track.row,
      setupPins.row,
      this.playbackStatusRow,
      this.groupedTracksEl,
      addGroup.row,
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
   * 最新的 Track 清單（issue #33；issue #35 頭尾修剪；issue #36 相機軌 + 重疊警告；
   * issue #43 改成依群組分區顯示）。每張卡兩行：種類標記＋簡短標籤＋（相機軌重疊
   * 時）⚠＋刪除鈕，下一行「起始／從／到」秒數欄位＋唯讀「錄到 X–Y 秒」，再加一個
   * `群組 ▾` 多選（issue #37 起動作軌／相機軌都有）。清單空時「▶ 播放」變灰；錄製／播放中整區鎖住
   * （見 `updateTrackControlsState`）。
   */
  setTracks(rows: readonly TrackListRow[]): void {
    this.trackCount = rows.length;
    const live = new Set(rows.map((r) => r.id));
    for (const id of this.openTrackGroupMenus)
      if (!live.has(id)) this.openTrackGroupMenus.delete(id);
    this.lastTracks = rows;
    this.renderGroupedTracks();
  }

  /**
   * 最新的群組清單（issue #43 / V2 T1-8）——每個群組畫成一段：標頭列
   * `[開啟▢] 名稱(可改)（N 條）[獨奏][刪除]`（預設群組不給刪除鈕），底下接該群組
   * 的成員 Track 卡片。錄製／播放中整區鎖住（見 `updateTrackControlsState`）。
   */
  setGroups(rows: readonly GroupListRow[]): void {
    this.lastGroups = rows;
    this.renderGroupedTracks();
  }

  /**
   * 依群組把 Track 清單整份重建（issue #43）——`setGroups`／`setTracks` 任一被
   * 呼叫都跑一次。每個群組一段 `.jelly-group-section`：`groupRowEl` 標頭 + 屬於
   * 該群組的每張 Track 卡片（依 `lastTracks` 原順序，即錄製順序 → `mergeTracks`
   * 認先列語意不變）。一條 Track 屬多個群組就在每段各出現一次。群組沒有成員時
   * 放一行淡提示。
   */
  private renderGroupedTracks(): void {
    const sections = this.lastGroups.map((group) => {
      const section = document.createElement('div');
      section.className = 'jelly-group-section';
      section.append(this.groupRowEl(group));

      const members = this.lastTracks.filter((t) =>
        t.groups.some((choice) => choice.id === group.id && choice.member),
      );
      if (members.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'jelly-group-empty';
        hint.textContent = '（尚無 Track）';
        section.append(hint);
      } else {
        for (const member of members) section.append(this.trackRowEl(member));
      }
      return section;
    });
    this.groupedTracksEl.replaceChildren(...sections);
    this.updateTrackControlsState();
  }

  /**
   * `JellySandbox` 每次群組開關／歸屬變動後同步一次「開啟中群組成員聯集」的
   * Track 數（issue #43）——為 0 時「▶ 播放」變灰（所有群組都關、或開啟中群組
   * 沒有任何成員）。
   */
  setPlayableTrackCount(count: number): void {
    this.playableTrackCount = count;
    this.updateTrackControlsState();
  }

  /**
   * `JellySandbox` 在片段初始 Pin 快照變動後同步一次數量（issue #39）——「片段初始
   * Pin：N 個」。片段層級狀態，不受 Track 數量影響，也不影響「▶ 播放」的可按條件
   * （維持「至少一條 Action Track」）。文字沒變不寫 DOM。
   */
  setSetupPinCount(count: number): void {
    const text = setupPinCountText(count);
    if (this.setupPinsCountEl.textContent === text) return;
    this.setupPinsCountEl.textContent = text;
  }

  /**
   * 依 `playbackLocked` / `recording` / `trackCount` / `playableTrackCount` 重算
   * Track 區塊每個控制項的可用狀態，集中一處免得各方法各自漏掉一顆按鈕。
   * issue #43：群組區（`群組 ▾`、開關、名稱、獨奏、刪除、＋ 新增群組）在錄製中、
   * 播放中一起鎖住。
   */
  private updateTrackControlsState(): void {
    const busy = this.playbackLocked || this.recording;
    // 錄製中「開始錄製」要保持可按（它此時是「停止錄製」）；只有播放中才鎖它。
    this.recordButton.disabled = this.playbackLocked;
    this.recordTargetSelect.disabled = busy;
    // 片段初始 Pin 的兩顆鈕比照 Track 清單編輯：錄製中／播放中鎖住（issue #39）。
    this.setupPinsSnapshotButton.disabled = busy;
    this.setupPinsClearButton.disabled = busy;
    // 「▶ 播放」：沒有任何 Track、或開啟中群組成員聯集為空時變灰（issue #43）。
    this.playAllButton.disabled = busy || this.trackCount === 0 || this.playableTrackCount === 0;
    this.addGroupButton.disabled = busy;
    // 分區清單裡的群組標頭控制項 + Track 卡片欄位 + `群組 ▾` 一起鎖住（issue #43）。
    for (const el of this.groupedTracksEl.querySelectorAll('input, button, select')) {
      (el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = busy;
    }
  }

  /**
   * 播放中／未播放的切換（issue #34）——`JellySandbox` 在 Demo／Track 播放開始
   * 與結束時各呼叫一次。播放中「⏸ 暫停／▶ 繼續」鈕與「目前 X.XX 秒」讀出才
   * 出現；結束時整列藏起來（「沒有在播放時暫停鈕隱藏」的驗收條件），並把讀出
   * 歸零、暫停鈕文字重設回「⏸ 暫停」。
   */
  setPlaybackActive(active: boolean): void {
    this.playbackStatusRow.hidden = !active;
    if (active) {
      this.setPaused(false);
      this.lastPlaybackText = null;
      this.setPlaybackTime(0);
    }
  }

  /**
   * `JellySandbox` 每幀同步一次目前的播放秒數（issue #34）——由 `DemoRunner`
   * 的全域 sim step 計數換算而來，暫停時 step 不前進、這個讀出跟著定住。只在
   * 秒數字串真的變了才寫 DOM（同 `setPerfStatus`）。
   */
  setPlaybackTime(seconds: number): void {
    const text = `目前 ${formatSeconds(seconds)} 秒`;
    if (text === this.lastPlaybackText) return;
    this.lastPlaybackText = text;
    this.playbackTimeEl.textContent = text;
  }

  /**
   * 「⏸ 暫停／▶ 繼續」鈕的視覺狀態（issue #34）——`JellySandbox` 切換暫停旗標
   * 時呼叫；暫停中按鈕變成「▶ 繼續」並加上 `.jelly-paused-active` 提示色。
   */
  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? '▶ 繼續' : '⏸ 暫停';
    this.pauseButton.classList.toggle('jelly-paused-active', paused);
  }

  /**
   * `JellySandbox` 每幀同步一次「鎖定跟隨」勾選框到相機實際的鎖定狀態（issue #36）
   * ——相機軌播放（`setState` 硬切、錄進去的 `setFollow`）或 `playAll` 重設鏡頭會
   * 在使用者沒點勾選框的情況下改動 `followEnabled`，同步後勾選框不會脫鉤。值沒變
   * 就不寫 DOM。
   */
  setFollowLocked(locked: boolean): void {
    if (this.followLockCheckbox.checked !== locked) this.followLockCheckbox.checked = locked;
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

  /**
   * 「鎖定跟隨」列（issue #36）——跟 `checkboxRow` 同構，但回傳勾選框本身，讓
   * `setFollowLocked` 能把它同步到相機實際狀態（相機軌播放會改 `followEnabled`）。
   */
  private followLockRow(
    locked: boolean,
    onChange: (locked: boolean) => void,
  ): { row: HTMLElement; checkbox: HTMLInputElement } {
    const row = document.createElement('label');
    row.className = 'jelly-control-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = locked;
    checkbox.addEventListener('change', () => onChange(checkbox.checked));

    row.append(checkbox, '鎖定跟隨');
    return { row, checkbox };
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

  /** 「＋ 新增群組」列（issue #43）——新群組預設開啟，見 `JellySandbox.addGroup`。 */
  private addGroupRow(onClick: () => void): { row: HTMLElement; button: HTMLButtonElement } {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jelly-group-add';
    button.textContent = '＋ 新增群組';
    button.addEventListener('click', onClick);

    row.appendChild(button);
    return { row, button };
  }

  /**
   * 一段群組的標頭列（issue #43）：`[開啟▢] 名稱(可改)（N 條）[獨奏][刪除]`，
   * 底下由 `renderGroupedTracks` 接該群組的成員 Track 卡片。名稱用 `change`
   *（失焦／Enter）回報，避免逐字觸發重繪。獨奏鈕在該群組正被獨奏時加
   * `.jelly-group-solo-active` 高亮。預設群組不給刪除鈕。
   */
  private groupRowEl(row: GroupListRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jelly-group-row';

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'jelly-group-enabled';
    enabled.checked = row.enabled;
    enabled.title = '開啟／關閉（播放取所有開啟中群組的成員聯集）';
    enabled.addEventListener('change', () => this.onGroupEnabledChange(row.id, enabled.checked));

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'jelly-group-name';
    name.value = row.name;
    name.addEventListener('change', () => {
      const trimmed = name.value.trim();
      if (trimmed === '') {
        name.value = row.name; // 空名字不接受，還原
        return;
      }
      this.onGroupRename(row.id, trimmed);
    });

    const count = document.createElement('span');
    count.className = 'jelly-group-count';
    count.textContent = `（${row.trackCount} 條）`;

    const solo = document.createElement('button');
    solo.type = 'button';
    solo.className = 'jelly-group-solo';
    solo.classList.toggle('jelly-group-solo-active', row.soloed);
    solo.textContent = '獨奏';
    solo.title = '只留這個群組開、其餘關；再按還原';
    solo.addEventListener('click', () => this.onGroupSolo(row.id));

    el.append(enabled, name, count, solo);

    if (row.deletable) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'jelly-group-delete';
      del.textContent = '刪除';
      del.title = '只解除歸屬，不刪成員 Track';
      del.addEventListener('click', () => this.onDeleteGroup(row.id));
      el.append(del);
    }

    return el;
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
    // issue #43：改播「開啟中群組成員聯集」，不一定是「全部」，鈕名收斂成「▶ 播放」。
    playAllButton.textContent = '▶ 播放';
    playAllButton.addEventListener('click', onPlayAll);

    row.append(recordButton, playAllButton);
    return { row, recordButton, playAllButton };
  }

  /**
   * 「片段初始 Pin：N 個 ｜ 設為目前 Pin ｜ 清除」列（issue #39 / ADR-0007 追記）。
   * 「設為目前 Pin」把畫面上所有 Pin 拍成片段初始快照（`播放全部` 於 step 0 還原）；
   * 「清除」清空快照。可用狀態一律交給 `updateTrackControlsState`（錄製中／播放中鎖住）。
   * 回傳個別節點讓建構子直接賦值給 `readonly` 欄位。
   */
  private setupPinsRow(
    onSnapshot: () => void,
    onClear: () => void,
  ): {
    row: HTMLElement;
    countEl: HTMLElement;
    snapshotButton: HTMLButtonElement;
    clearButton: HTMLButtonElement;
  } {
    const row = document.createElement('div');
    row.className = 'jelly-control-row jelly-setup-pins-row';

    const countEl = document.createElement('span');
    countEl.className = 'jelly-setup-pins-count';
    countEl.textContent = setupPinCountText(0);

    const snapshotButton = document.createElement('button');
    snapshotButton.type = 'button';
    snapshotButton.textContent = '設為目前 Pin';
    snapshotButton.title = '把畫面上現在所有 Pin 拍成片段初始快照——「▶ 播放」時於 step 0 還原';
    snapshotButton.addEventListener('click', onSnapshot);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = '清除';
    clearButton.title = '清空片段初始 Pin 快照';
    clearButton.addEventListener('click', onClear);

    row.append(countEl, snapshotButton, clearButton);
    return { row, countEl, snapshotButton, clearButton };
  }

  /**
   * 「⏸ 暫停／▶ 繼續」鈕 + 「目前 X.XX 秒」讀出（issue #34）——同一列，建構時
   * 先 `hidden`，由 `setPlaybackActive` 在播放開始／結束時顯示／隱藏。回傳個別
   * 節點讓建構子直接賦值給 `readonly` 欄位。
   */
  private playbackStatusRowEl(onTogglePause: () => void): {
    row: HTMLElement;
    pauseButton: HTMLButtonElement;
    timeEl: HTMLElement;
  } {
    const row = document.createElement('div');
    row.className = 'jelly-control-row jelly-playback-status';
    row.hidden = true;

    const pauseButton = document.createElement('button');
    pauseButton.type = 'button';
    pauseButton.textContent = '⏸ 暫停';
    pauseButton.addEventListener('click', onTogglePause);

    const timeEl = document.createElement('span');
    timeEl.className = 'jelly-playback-time';
    timeEl.textContent = '目前 0.00 秒';

    row.append(pauseButton, timeEl);
    return { row, pauseButton, timeEl };
  }

  /**
   * Track 清單的一列（issue #33；issue #35 加頭尾修剪；issue #54 名稱可原地編輯）。兩行：
   * 第一行 種類標記（動作／相機）＋可編輯的名稱欄位＋刪除鈕；
   * 第二行 可編輯的「起始 / 從 / 到」秒數欄位，加一段唯讀的「錄到 X–Y 秒」提示
   * （第一筆～最後一筆操作的本地秒數，幫使用者抓修剪起訖值）。
   * 名稱欄位比照群組改名（`groupRowEl`）的 `change`（失焦／Enter）回報一次、trim，
   * 但空字串不吞掉：走 `onTrackRename(id, '')` 由 `JellySandbox` 退回自動摘要；種類
   * 靠標記與分區顯示辨識、不靠名字。
   * 所有 `input`／`button` 的鎖定由 `updateTrackControlsState` 在錄製／播放中統一關掉
   *（「修剪欄位在播放中鎖住」的驗收條件）。
   */
  private trackRowEl(row: TrackListRow): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jelly-track-row';
    // 相機軌時間重疊的軟警告（issue #36）——整列標紅，播放時重疊區間只認先列那條。
    el.classList.toggle('jelly-track-row-overlap', row.overlapping === true);

    const badge = document.createElement('span');
    badge.className = 'jelly-track-badge';
    badge.textContent = row.kind === 'camera' ? '相機' : '動作';

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'jelly-track-label';
    label.value = row.label;
    label.title = '這條 Track 的名稱——清空以退回自動摘要';
    label.addEventListener('change', () => {
      // 空字串（trim 後）＝退回自動摘要，交給 `JellySandbox` 把覆寫清掉；
      // 整列會在 syncPanelTracks 後整份重繪，欄位值隨之校正回實際顯示名。
      this.onTrackRename(row.id, label.value.trim());
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'jelly-track-delete';
    deleteButton.textContent = '刪除';
    deleteButton.addEventListener('click', () => this.onDeleteTrack(row.id));

    const top = document.createElement('div');
    top.className = 'jelly-track-row-top';
    top.append(badge, label);
    if (row.overlapping === true) {
      const warn = document.createElement('span');
      warn.className = 'jelly-track-warn';
      warn.textContent = '⚠ 時間重疊';
      warn.title = '相機軌之間不該重疊——播放時重疊區間只認清單中較前面那條';
      top.append(warn);
    }
    top.append(deleteButton);

    const startInput = this.trackNumberInput(row.startSeconds, '起始秒數（在片段時間軸上）', (s) =>
      this.onTrackStartTimeChange(row.id, s),
    );
    const inInput = this.trackNumberInput(row.inSeconds, '從第幾秒開始播（頭修剪）', (s) =>
      this.onTrackTrimInChange(row.id, s),
    );
    const outInput = this.trackNumberInput(row.outSeconds, '播到第幾秒為止（尾修剪）', (s) =>
      this.onTrackTrimOutChange(row.id, s),
    );

    const recorded = document.createElement('span');
    recorded.className = 'jelly-track-recorded';
    recorded.textContent = `錄到 ${formatSeconds(row.firstEventSeconds)}–${formatSeconds(
      row.lastEventSeconds,
    )} 秒`;
    recorded.title = '第一筆～最後一筆操作的秒數';

    const fields = document.createElement('div');
    fields.className = 'jelly-track-row-fields';
    fields.append('起始', startInput, '秒　從', inInput, '到', outInput, '秒', recorded);

    el.append(top, fields);
    // 兩種軌都有 `群組 ▾` 多選（issue #43 動作軌；issue #37 相機軌一併接進，見 ADR-0008）。
    el.append(this.trackGroupsMenu(row.id, row.groups));
    return el;
  }

  /**
   * Track 列裡的 `群組 ▾` 多選（issue #43）——一個 `<details>` 收合核取方塊清單，
   * 勾選＝這條屬於該群組。任一項變更就把「目前勾好的」全部 id 回報給
   * `onTrackGroupsChange`；「每條 Track 至少在一個群組」的不變式由 `JellySandbox`
   * 收到後補（取消勾選最後一個 → 自動回預設群組），重繪整列時勾選會校正回來。
   */
  private trackGroupsMenu(trackId: string, choices: readonly TrackGroupChoice[]): HTMLElement {
    const details = document.createElement('details');
    details.className = 'jelly-track-groups';
    details.open = this.openTrackGroupMenus.has(trackId);
    details.addEventListener('toggle', () => {
      if (details.open) this.openTrackGroupMenus.add(trackId);
      else this.openTrackGroupMenus.delete(trackId);
    });

    const summary = document.createElement('summary');
    const memberNames = choices.filter((c) => c.member).map((c) => c.name);
    summary.textContent = `群組 ▾${memberNames.length > 0 ? `（${memberNames.join('、')}）` : ''}`;
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'jelly-track-groups-list';
    const boxes: { id: string; checkbox: HTMLInputElement }[] = [];
    for (const choice of choices) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = choice.member;
      checkbox.addEventListener('change', () => {
        this.onTrackGroupsChange(
          trackId,
          boxes.filter((b) => b.checkbox.checked).map((b) => b.id),
        );
      });
      boxes.push({ id: choice.id, checkbox });
      label.append(checkbox, choice.name);
      list.appendChild(label);
    }
    details.appendChild(list);
    return details;
  }

  /**
   * Track 列裡一個「秒數」數字欄位（起始／從／到共用）：change 時把輸入 clamp 到
   * ≥ 0、呼叫 `onChange`；欄位值的量化校正（step 對齊）由 `JellySandbox` 收到後
   * `syncTrackList()` 重繪整列時完成。
   */
  private trackNumberInput(
    value: number,
    title: string,
    onChange: (seconds: number) => void,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'jelly-track-seconds';
    input.min = '0';
    input.step = '0.1';
    input.value = String(value);
    input.title = title;
    input.addEventListener('change', () => {
      const seconds = Math.max(0, Number(input.value) || 0);
      input.value = String(seconds);
      onChange(seconds);
    });
    return input;
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

/** 面板上顯示秒數的統一格式（兩位小數）——播放讀出與 Track 列「錄到 X–Y 秒」共用。 */
function formatSeconds(seconds: number): string {
  return seconds.toFixed(2);
}

/** 「片段初始 Pin：N 個」讀出文字（issue #39）——初始渲染與 `setSetupPinCount` 共用，前綴字串只留一份。 */
function setupPinCountText(count: number): string {
  return `片段初始 Pin：${count} 個`;
}
