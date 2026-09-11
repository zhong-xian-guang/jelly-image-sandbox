/**
 * `JellySandbox`（issue #11 / T10，issue #13 / T12 接入 Camera，issue #12 / T11
 * 接入拖放匯入，issue #14 / T13 接入控制面板）——第一個能玩的組裝：`SimCore`
 * （模擬）+ `JellyRenderer`（算繪）+ `PointerInput`（輸入）+ `CameraInput`
 * （相機手動輸入）+ 固定步主迴圈。
 *
 * 主迴圈用 `FixedStepAccumulator`（+ 250ms clamp）把真實時間切成 60Hz 固定步推進
 * 求解器；每幀再用**真實**幀時距（clamp 到 100ms）呼叫純函式 `updateCamera` 推進
 * 相機（平滑是視覺的、不進物理）。所有影響模擬的輸入都經 `PointerInput` →
 * `sim.applyInput`；所有相機手動輸入都經 `CameraInput` → 收集成 `CameraCommand[]`
 * 每幀餵給 `updateCamera`（ADR-0005：兩條輸入流都不繞過各自的窄介面）。
 *
 * picking／算繪都吃 `cameraState.transform`——相機平移／縮放後仍命中正確的表面點。
 *
 * **拖放匯入**：`DropImportInput`（薄的接線層，對照 `PointerInput`/`CameraInput`）
 * 挑出拖放的影像檔（png/jpeg/gif）、讀成位元組後回呼 `importImage` → `buildSimMesh` → 換一套新的
 * `SimCore` + `JellyRenderer`（拓撲變了、舊 Mesh geometry 沒法沿用）。新 Renderer
 * 先建好、確定成功了才拆舊的，畫面不會有空檔；解碼／建網格失敗（非圖片、不支援
 * 格式、壞檔）一律 `console.warn` ＋ 畫面上閃一行 `notice` 後放棄，不影響原本的
 * Jelly。匯入時把控制面板目前設定（Softness、輕拍力道、Boundary 模式）重新套到
 * 新的 `SimCore`，面板不會顯示跟實際物理不一致的值。`importHint`（issue #12 追加）
 * 是常駐在角落的低調小字，提示「可以拖圖片進來」——`dropHint` 只在拖曳中才出現，
 * 沒有這個常駐提示的話使用者無從發現這個功能本身存在。
 *
 * **控制面板**：`ControlPanel`（同樣是薄的 DOM 接線層）建 UI、回呼往外送；實際
 * 換算邏輯都在純函式模組——Softness 曲線見 `../sim/softness`，Walled 邊界範圍見
 * `./walledBounds`，Pin 模式的輸入轉接見 `../input/pinModeRouting`（開啟 Pin 模式
 * 後，`PointerInput` 原本會發的 `grab` 改由它轉成 `pin`，直接放 Pin 而非可拖曳
 * 的 Grab；點在既有 Pin 附近則轉成 `unpin`，即「點掉特定 Pin」）。
 *
 * **Pin 的視覺提示**：`PinMarkers`（DOM 覆蓋層）每幀把 `sim.listPins()` 的世界
 * 座標投影成螢幕座標畫成小圓點；Pin 模式開啟時標記變紅脈動（提示可以點掉）、
 * 畫布游標也換成十字——兩層一起讓「現在是不是在 Pin 模式」不用低頭看面板就
 * 知道（見 `setPinMode`）。「顯示 Pin」關掉時整層藏起來、`frame()` 也跳過投影
 * 計算（見 `setPinsVisible`）；`ControlPanel` 那邊會同時鎖住 Pin 模式／清除所有
 * Pin，所見即所得。
 *
 * **牆壁邊框**（issue #9 追加）：切到 Walled 邊界時，`WalledBoundary.box`（世界
 * 座標常數）同步畫成 `JellyRenderer` 裡的一個外框（見 `setWallBounds`），撞牆
 * 時看得到界線在哪，不會覺得「明明沒碰到東西卻被彈回來」。切回 Infinite 或
 * 重新匯入圖片都會同步藏起來／重套（`applyBoundaryMode`、`replaceJelly`）。
 *
 * **Demo**（issue #15 / T14 追加）：`./demos` 提供純函式腳本（`DEMOS`）+
 * `DemoRunner`（依 sim-step 計數排定事件，見該檔說明）。主迴圈每跑一個固定
 * step 前先呼叫 `demoRunner.advance(...)`，把該 step 排定的 `InputEvent` 一樣
 * 經 `sim.applyInput` 送進去——跟即時輸入同一條窄介面，不繞道。「停止／重設」
 * 按鈕（`resetSim`）先停 Demo 排程再重設 `SimCore`，避免重設後殘留事件繼續
 * 觸發；重新匯入圖片（`replaceJelly`）也會中斷 Demo，因為排定座標是對著舊
 * 網格算的，套到新網格沒意義。播放中鎖住所有 Demo 按鈕（`setPlaybackLocked`），
 * 擋掉「疊加播放另一個 Demo」——`DemoRunner.start` 只換排程、不會回頭釋放前一個
 * Demo 已經建立的 Pin/Grab，疊加播放會留下一個沒人記得、永遠釘住的 Pin。
 *
 * **Track 錄製 + 疊加播放**（issue #29 / V2 T1a，issue #33 / V2 T1-1 依 ADR-0007
 * 改為多動作軌，issue #36 / V2 T1-4 加相機軌）：`./track` 提供 `TrackRecorder`
 * ——跟 `DemoRunner` 互補的純類別，依 sim-step 排程「錄」而非「播」事件。攔截點
 * 是 `attachInputHandlers` 裡既有的兩個派送點（`sim.applyInput(routed)` 之前、
 * `cameraInput` 的 `emit` 推進 `cameraCommands` 之前）＋ `emitCamera`（「框住果凍」
 * ／「鎖定跟隨」按鈕）——錄製開啟時額外把同一個事件轉呼叫進
 * `trackRecorder.record()`，不新增輸入路徑（ADR-0005）。主迴圈每個固定 step
 * 呼叫一次 `trackRecorder.tick()`，讓錄下的時間戳記跟 `DemoRunner` 重播時的
 * step 計數對得上。
 *
 * 停止錄製時 `TrackRecorder.stop()` 依事件種類把錄到的內容拆成 `{ action, camera }`
 * 兩份 ＋ 錄製起點鏡頭快照 `startCamera`（ADR-0007 的拆軌模型）。「錄製目標」為
 * `both` 時兩份都消化——各非空就新增一列（一條動作軌 + 一條相機軌）；單頻道
 * 只消化被選那一份，另一路的操作即時生效但不錄進去。「▶ 播放全部」把清單裡
 * 所有 Track 依各自的 `startStep`／頭尾修剪用 `mergeTracks`（`demos/overlay.ts`
 * 純函式）壓成一條全域時間軸——平移 `atStep`、動作軌 `PointerId` 加軌別前綴避免
 * 跨軌 `release` 誤放別條的 Grab、相機軌在起始 step 插 `setState` 硬切、相機軌
 * 重疊區間只認先列那條、依全域 `atStep` 穩定排序——交給 `demoRunner` 精準重播
 * （Track 排程格式跟 `DemoStep[]` 相同，不需要另外寫播放器）。多條各自單指標的
 * 動作軌疊起來等於同時多點抓取（Multi-grab）。
 *
 * **Track 座標對齊**：Grab/Tap/Pin 記的是錄製當下的絕對世界座標，`playAll`
 * 因此在 `demoRunner.start` 之前先 `sim.reset()`（場景回 rest 狀態，絕對世界
 * 座標才準確落在果凍上）。相機：整段沒有相機軌時，重設後推一個一次性 `frame`
 * 指令把鏡頭框回果凍靜止狀態；有相機軌時改由每條相機軌自帶的 `setState` 硬切
 * 在它的起始 step 把鏡頭瞬間設回錄製起點——兩種都是離散、決定性的瞬間對齊，
 * 確保「連按播放全部結果逐格一致」（issue #33 / #36 決定性驗收條件）不受播放前
 * 場景／相機被怎麼動過影響。
 *
 * **場景狀態整合**（issue #38 / V2 T1-6）：「停止／重設」（`resetSim`）與「重新
 * 匯入 PNG」（`replaceJelly`）共用 `haltPlaybackAndRecording()` 把場景收束成
 * 一致的乾淨狀態；「Track 清單保留 vs 清空」的分野見那個方法的說明。錄製中與
 * 播放中互斥（`ControlPanel` 依 `setRecordingActive`／`setPlaybackControlsEnabled`
 * 互相鎖住對方的按鈕）。
 *
 * **substep 自動降級 + 網格解析度退路**（issue #16 / T15）：`PerfMonitor`（純
 * 狀態機，見該檔）每幀吃「這幀花了幾毫秒」，持續超標（弱裝置／背景分頁搶資源）
 * 就把 `sim.params.substeps` 從 4 降到 2，讓每步花的運算變少、幀率回穩；持續
 * 回穩又升回 4。降級當下順便點亮一次性的「網格退路」旗標——舊 Jelly 拓撲已凍結
 * 沒法即時減面，只能讓**下一次**拖放匯入改用較低的 `targetParticleCount`（見
 * `REDUCED_TARGET_PARTICLE_COUNT`），新匯入的 Jelly 三角形數變少、負擔跟著降。
 * `frame()` 每幀把目前 substep 數同步到 `ControlPanel.setPerfStatus`，手動用
 * DevTools CPU 節流測試時能直接看到 4→2→4 有沒有真的發生。
 */

import {
  CameraInput,
  type CameraCommand,
  type CameraState,
  createCameraState,
  screenToWorld,
  updateCamera,
  worldToScreen,
} from '../camera';
import { PointerInput, routeForPinMode } from '../input';
import {
  buildSimMesh,
  DEFAULT_PARAMS,
  imageFormatToMime,
  sniffImageFormat,
  type BuildSimMeshParams,
  type SimMesh,
} from '../mesh';
import { JellyRenderer } from '../render';
import {
  type Bbox,
  type BoundaryMode,
  InfiniteBoundary,
  type InputEvent,
  type Point,
  SimCore,
  softnessToParams,
  WalledBoundary,
} from '../sim';
import { ClipFileInput } from './ClipFileInput';
import {
  ClipFileError,
  clipFileTimestamp,
  parseClipFile,
  serializeClip,
  type ClipImage,
  type ClipState,
  type ClipTrack,
} from './clipFile';
import { ControlPanel } from './ControlPanel';
import { canvasToPng, createDefaultJelly } from './defaultJelly';
import {
  DEMOS,
  DemoRunner,
  mergeTracks,
  overlappingCameraTrackIds,
  setupPinsTrack,
  STEP_SECONDS,
  secondsToStep,
  stepToSeconds,
} from './demos';
import { DropImportInput } from './DropImportInput';
import { FileImportInput } from './FileImportInput';
import { FixedStepAccumulator } from './FixedStepAccumulator';
import { PerfMonitor } from './PerfMonitor';
import { PinMarkers } from './PinMarkers';
import {
  createDefaultGroup,
  DEFAULT_GROUP_ID,
  type SoloState,
  toggleSolo,
  TrackRecorder,
  type RecordTarget,
  type Track,
  type TrackGroup,
  tracksInEnabledGroups,
  withGroupInvariant,
} from './track';
import { computeWalledBounds } from './walledBounds';

/** 相機平滑用的單幀時距上限（分頁切回來不會讓相機瞬移）。 */
const CAMERA_MAX_DT = 0.1;
/** 拖曳中疊在畫面上的提示層 class（樣式見 `style.css`）。 */
const DROP_HINT_ACTIVE_CLASS = 'is-active';
/** 匯入被拒／失敗提示（`jelly-notice`）顯示中的 class，以及自動隱藏的秒數。 */
const NOTICE_VISIBLE_CLASS = 'is-visible';
const NOTICE_DURATION_MS = 4000;
/**
 * 輕拍力道滑桿的範圍；中點 = `DEFAULT_SIM_PARAMS.tapStrength`（6000）——同
 * `../sim/softness` 的理由，滑桿沒被動過時中點顯示的值要跟實際生效的一致。
 */
const TAP_STRENGTH_RANGE = { min: 1000, max: 11000, step: 100 };
/** Softness 滑桿初始位置（0–1 中點 = `DEFAULT_SIM_PARAMS`，見 `../sim/softness`）。 */
const DEFAULT_SOFTNESS = 0.5;
/**
 * Pin 模式下「點掉既有 Pin」的判定半徑，螢幕像素——跟 `.jelly-pin-marker` 的
 * CSS 直徑（16px）同數量級，換算回世界座標時要除以目前相機縮放（見
 * `pinModeContext`），這樣判定範圍不會隨縮放忽大忽小。
 */
const PIN_REMOVE_RADIUS_PX = 16;
/**
 * 網格解析度退路（issue #16）：substep 降級發生後，下一次拖放匯入改用這個較低的
 * `targetParticleCount`（預設 `DEFAULT_PARAMS.targetParticleCount` 的一半），讓
 * 新匯入的 Jelly 三角形數變少、負擔跟著降下來。舊 Jelly 拓撲已凍結沒法即時降，
 * 這條退路只影響「下一張」匯入的圖（見 `PerfMonitor.consumeMeshFallbackPending`）。
 */
const REDUCED_TARGET_PARTICLE_COUNT = Math.round(DEFAULT_PARAMS.targetParticleCount / 2);

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
 * 維持。播放時 `playAll` 只取「至少屬於一個開啟中群組」的子集
 * （`tracksInEnabledGroups`），順序照清單順序（決定性、`mergeTracks` 認先列不變）。
 * `群組 ▾` UI（issue #43 動作軌；issue #37 相機軌一併接進，見 ADR-0008）兩種軌都掛。
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

export class JellySandbox {
  private sim: SimCore;
  private renderer: JellyRenderer;
  private input: PointerInput;
  private cameraInput: CameraInput;
  private readonly dropImportInput: DropImportInput;
  /** 「匯入圖片」按鈕與角落提示字點擊 → 原生檔案選擇器 → 與拖放相同的匯入路徑（issue #56）。 */
  private readonly fileImportInput: FileImportInput;
  /** 「載入片段」按鈕 → 原生檔案選擇器挑 `.json` → `onLoadClip`（issue #58）。 */
  private readonly clipFileInput: ClipFileInput;
  private readonly controlPanel: ControlPanel;
  private readonly pinMarkers: PinMarkers;
  private readonly demoRunner = new DemoRunner();
  private readonly trackRecorder = new TrackRecorder();
  private readonly accumulator = new FixedStepAccumulator(STEP_SECONDS);
  private readonly perfMonitor = new PerfMonitor();
  private readonly root: HTMLElement;
  private readonly dropHint: HTMLDivElement;
  private readonly importHint: HTMLDivElement;
  /** 匯入被拒／失敗時，畫面上短暫顯示一行說明的浮層（見 `showNotice`）。 */
  private readonly notice: HTMLDivElement;
  /** `notice` 的自動隱藏計時器（`window.setTimeout` 的回傳值，0 = 沒有）。 */
  private noticeTimer = 0;

  private cameraState: CameraState;
  /** `CameraInput` 逐事件塞入，主迴圈每幀取出餵 `updateCamera` 後清空。 */
  private cameraCommands: CameraCommand[] = [];
  /** 拖放匯入進行中——擋掉重疊的第二次匯入（連續拖放兩張圖不會互相打架）。 */
  private importing = false;
  /** 目前的 Boundary 模式——`SimCore` 沒有 getter，重新匯入圖片時要靠這個重套。 */
  private boundaryMode: BoundaryMode = 'infinite';
  /** `walled` 時目前的牆壁 AABB（給 `JellyRenderer.setWallBounds` 畫外框），`infinite` 時為 `null`。 */
  private wallBox: Bbox | null = null;
  /** 控制面板「Pin 模式」開關；`attachInputHandlers` 的 `applyInput` 靠它轉接。 */
  private pinModeEnabled = false;
  /** 「顯示 Pin」開關——關閉時 `pinMarkers` 整層藏起來、跳過每幀的投影計算。 */
  private pinsVisible = true;
  /** 網格線框開關（debug 用）——`SimCore` 沒有它，重新匯入圖片時要靠這個重套。 */
  private wireframeVisible = false;
  /** `controlPanel.setPlaybackControlsEnabled` 目前套用的鎖定狀態，`frame()` 靠它避免每幀重複寫入同樣的值。 */
  private playbackLocked = false;
  /**
   * 播放暫停旗標（issue #34 / V2 T1-2）——開著時 `frame()` 整個略過固定步迴圈與
   * 相機更新，只保留算繪：果凍定格在當下形變、播放秒數不動、鏡頭不動、排定
   * 事件不觸發。只在播放中（`demoRunner.isRunning`）能切換；播放結束會被強制
   * 歸零（見 `setPlaybackLocked`）。
   */
  private paused = false;
  /** 按下錄製前選定的錄製目標（issue #33）——只錄動作／只錄運鏡／兩者同時。 */
  private recordTarget: RecordTarget = 'action';
  /**
   * 已錄好的 Track 清單（issue #33；issue #36 加相機軌）——記憶體內，重新匯入 PNG
   * 即清空；「停止／重設」保留。陣列順序＝錄製順序＝清單顯示順序＝相機軌「認先列」
   * 的先後（`mergeTracks`）。
   */
  private tracks: RecordedTrack[] = [];
  /** 下一條 Track 的流水號，兼作 `id`／`PointerId` 前綴（各條唯一）與預設標籤編號。 */
  private nextTrackNum = 1;
  /**
   * 片段初始 Pin 快照（issue #39 / ADR-0007 追記）——每個元素是一個 Pin 附著點在
   * **rest 形狀**下的世界座標（`sim.restAttachPoint`），獨立於任何 Track。`playAll`
   * 在 `sim.reset()` 之後、`demoRunner.start` 之前，把它組成一條合成 `OverlayTrack`
   *（`setupPinsTrack`）排在 `mergeTracks` 輸入最前面，於 step 0 一次還原。生命週期
   * 比照 `tracks`：`停止／重設` 保留、重新匯入 PNG 清空（座標對舊網格沒意義）。
   */
  private setupPins: Point[] = [];
  /**
   * Track 群組清單（issue #43 / V2 T1-8，見 ADR-0008）——`groups[0]` 永遠是預設
   * 群組（`DEFAULT_GROUP_ID`、不可刪、新錄好的 Track 自動加入）。生命週期比照
   * `tracks`：`停止／重設` 保留、重新匯入 PNG 重建成只剩預設群組。
   */
  private groups: TrackGroup[] = [createDefaultGroup()];
  /** 下一個使用者新建群組的流水號（`g1`／`g2`…，兼作預設名稱編號）。 */
  private nextGroupNum = 1;
  /** 目前的「獨奏」狀態（`null` = 沒在獨奏）——狀態轉移見 `track/groups` 的 `toggleSolo`。 */
  private soloState: SoloState | null = null;

  /**
   * 軟硬度滑桿目前值本身（0–1）——`setSoftness` 收到後即轉成 `cellFrac`／`alphaSm`
   * 套進 `sim.params`，滑桿原始值 `SimCore` 不留，這裡記著供存檔（issue #57）。
   */
  private softness = DEFAULT_SOFTNESS;
  /**
   * 最近一次匯入實際餵給 `buildSimMesh` 的**解析後完整**參數（issue #57）——含可能被
   * 效能退路砍半的 `targetParticleCount`。存檔時原樣寫進 `ClipState.meshParams`，載入端
   * （issue #58）據此決定性重算 mesh。還沒匯入任何圖時 = `DEFAULT_PARAMS`（內建果凍）。
   */
  private lastMeshParams: BuildSimMeshParams = { ...DEFAULT_PARAMS };
  /**
   * 最近一次成功匯入的來源影像（issue #57）——存檔時原樣成為 `ClipState.image`。
   * `null` = 還沒匯入任何圖，仍是內建預設果凍：存檔當下改用
   * `canvasToPng(defaultTexture)` 拍成 `format: 'png'`（見 `buildClipState`）。
   */
  private lastImage: ClipImage | null = null;

  private rafId = 0;
  private lastFrameMs = 0;

  private constructor(
    root: HTMLElement,
    sim: SimCore,
    renderer: JellyRenderer,
    cameraState: CameraState,
    /** 內建預設果凍的貼圖畫布——沒匯入任何圖時，存檔靠它拍一張 PNG（issue #57）。 */
    private readonly defaultTexture: HTMLCanvasElement,
  ) {
    this.root = root;
    this.sim = sim;
    this.renderer = renderer;
    this.cameraState = cameraState;

    ({ input: this.input, cameraInput: this.cameraInput } = this.attachInputHandlers(
      renderer.canvas,
    ));

    this.renderer.setCamera(this.cameraState.transform);
    window.addEventListener('resize', this.onResize);

    this.dropHint = this.createDropHint();
    root.appendChild(this.dropHint);
    this.importHint = this.createImportHint();
    root.appendChild(this.importHint);
    this.notice = this.createNotice();
    root.appendChild(this.notice);
    this.dropImportInput = new DropImportInput(root, {
      onImport: this.onDropImport,
      onDragActiveChange: (active) =>
        this.dropHint.classList.toggle(DROP_HINT_ACTIVE_CLASS, active),
      onReject: (message) => this.showNotice(message),
    });
    // 匯入圖片的第二條入口（issue #56）：按鈕與角落常駐提示字都開這個隱藏 file input，
    // 選到的圖走 `onDropImport` ——與拖放完全相同的後續路徑。
    this.fileImportInput = new FileImportInput(root.ownerDocument, {
      onImport: this.onDropImport,
      onReject: (message) => this.showNotice(message),
    });
    this.importHint.addEventListener('click', this.onImportHintClick);
    // 「載入片段」按鈕（issue #58）：選到的 .json 檔走 onLoadClip ——解析／驗證失敗
    // 或場景整包取代失敗都在那裡 catch，原本的 Jelly 不受影響。
    this.clipFileInput = new ClipFileInput(root.ownerDocument, {
      onLoad: this.onLoadClip,
      onReject: (message) => this.showNotice(message),
    });

    this.controlPanel = new ControlPanel({
      initial: {
        boundary: this.boundaryMode,
        softness: DEFAULT_SOFTNESS,
        tapStrength: this.sim.params.tapStrength,
        pinMode: this.pinModeEnabled,
        showPins: this.pinsVisible,
        followLocked: !this.cameraState.followEnabled,
        showWireframe: this.wireframeVisible,
        recordTarget: this.recordTarget,
      },
      tapStrengthRange: TAP_STRENGTH_RANGE,
      demos: DEMOS.map((demo) => ({ id: demo.id, label: demo.label })),
      onImportImage: () => this.fileImportInput.open(),
      onSaveClip: () => this.saveClip(),
      onLoadClip: () => this.clipFileInput.open(),
      onBoundaryChange: (mode) => this.setBoundaryMode(mode),
      onSoftnessChange: (t) => this.setSoftness(t),
      onTapStrengthChange: (strength) => this.setTapStrength(strength),
      onPinModeChange: (enabled) => this.setPinMode(enabled),
      onClearPins: () => this.clearPins(),
      onShowPinsChange: (visible) => this.setPinsVisible(visible),
      onFollowLockChange: (locked) => this.setFollowLock(locked),
      onFrameJelly: () => this.frameJelly(),
      onRunDemo: (id) => this.runDemo(id),
      onReset: () => this.resetSim(),
      onWireframeChange: (visible) => this.setWireframeVisible(visible),
      onRecordTargetChange: (target) => {
        this.recordTarget = target;
      },
      onToggleRecording: () => this.toggleRecording(),
      onPlayAll: () => this.playAll(),
      onSnapshotSetupPins: () => this.snapshotSetupPins(),
      onClearSetupPins: () => this.clearSetupPins(),
      onTogglePause: () => this.togglePause(),
      onTrackStartTimeChange: (id, seconds) => this.setTrackStartTime(id, seconds),
      onTrackTrimInChange: (id, seconds) => this.setTrackTrimIn(id, seconds),
      onTrackTrimOutChange: (id, seconds) => this.setTrackTrimOut(id, seconds),
      onDeleteTrack: (id) => this.deleteTrack(id),
      onTrackRename: (id, name) => this.renameTrack(id, name),
      onAddGroup: () => this.addGroup(),
      onGroupEnabledChange: (id, enabled) => this.setGroupEnabled(id, enabled),
      onGroupRename: (id, name) => this.renameGroup(id, name),
      onGroupSolo: (id) => this.toggleGroupSolo(id),
      onDeleteGroup: (id) => this.deleteGroup(id),
      onTrackGroupsChange: (trackId, groupIds) => this.setTrackGroups(trackId, groupIds),
    });
    root.appendChild(this.controlPanel.element);

    this.pinMarkers = new PinMarkers();
    root.appendChild(this.pinMarkers.element);
    this.applyPinModeCursor();

    // 一開始就把群組區畫出來（預設群組永遠存在）——Track 清單仍空，但使用者能先
    // 看到「群組」這個概念、按「＋ 新增群組」（issue #43）。
    this.syncPanelTracks();
  }

  /** 建立預設 Jelly 並組裝好；呼叫 `start()` 開始跑。 */
  static async create(root: HTMLElement): Promise<JellySandbox> {
    const { mesh, texture } = createDefaultJelly();
    const sim = new SimCore(mesh);

    const renderer = await JellyRenderer.create({
      width: root.clientWidth,
      height: root.clientHeight,
      mesh,
      positions: sim.positions,
      texture,
      background: { color: 0x1a1a1a, alpha: 1 },
    });
    root.appendChild(renderer.canvas);

    const cameraState = createCameraState(
      { bbox: sim.bbox() },
      {
        width: root.clientWidth,
        height: root.clientHeight,
      },
    );
    return new JellySandbox(root, sim, renderer, cameraState, texture);
  }

  start(): void {
    if (this.rafId) return;
    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  destroy(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.dropImportInput.destroy();
    this.fileImportInput.destroy();
    this.clipFileInput.destroy();
    this.dropHint.remove();
    this.importHint.removeEventListener('click', this.onImportHintClick);
    this.importHint.remove();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.notice.remove();
    this.controlPanel.destroy();
    this.pinMarkers.destroy();
    this.input.destroy();
    this.cameraInput.destroy();
    this.renderer.destroy();
  }

  /** 「鎖定跟隨」開關（issue #14 控制面板接這裡）——關掉自動跟隨，手動仍可動。 */
  setFollowLock(locked: boolean): void {
    this.emitCamera({ type: 'setFollow', enabled: !locked });
  }

  /**
   * 「框住果凍」按鈕（issue #14）——一次性緩動 fit 當前 bbox。純一次性動作，
   * 不碰「鎖定跟隨」狀態（`updateCamera` 的 `frame` 指令不改 `followEnabled`），
   * 按這顆鈕不會讓控制面板的「鎖定跟隨」勾選框跟實際狀態對不上。
   */
  frameJelly(): void {
    this.emitCamera({ type: 'frame' });
  }

  /**
   * 送一個相機指令：進佇列給 `updateCamera`，同時（錄製開著時）轉呼叫
   * `trackRecorder.record()`——「框住果凍」「鎖定跟隨」按鈕的操作在錄運鏡時
   * 也要一起錄進 Camera Track（issue #36 / US15）。走的還是 `CameraCommand`
   * 窄介面（ADR-0005），不新增輸入路徑。`CameraInput` 的 `emit` 回呼另外自己
   * 做了同樣兩件事（見 `attachInputHandlers`）。
   */
  private emitCamera(cmd: CameraCommand): void {
    this.cameraCommands.push(cmd);
    this.trackRecorder.record(cmd); // no-op 除非正在錄製
  }

  /**
   * Demo 按鈕（issue #15）：依 `id` 找到腳本，用「目前」`sim.positions` 算出這個
   * Jelly 形狀上的時間軸交給 `demoRunner`。已在播放中的 Demo（若有）直接被取代。
   */
  private runDemo(id: string): void {
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    this.demoRunner.start(demo.build(this.sim.positions));
    this.setPlaybackLocked(true); // 立即鎖住，擋掉「趁還沒進下一幀又點另一個 Demo」的疊加播放
  }

  /**
   * 「開始錄製／停止錄製」切換鈕（issue #29 / issue #33 拆軌 / issue #36 加相機軌）：
   * 開始時依「錄製目標」`this.recordTarget` 起錄，並把當下的鏡頭狀態快照傳給
   * `TrackRecorder`（相機軌硬切進場用）；停止時取回 `TrackRecorder.stop()` 拆好的
   * `action`／`camera` 兩份，非空的各新增一列到清單——「兩者同時」一次產出兩列。
   * 錄製中的事件本身不是在這裡送出的——是 `attachInputHandlers` 的兩個既有派送點
   * ＋ `emitCamera` 在錄製旗標開著時順手轉呼叫 `trackRecorder.record()`。
   *
   * `ControlPanel` 那邊：`setRecordingActive` 會在錄製中把「▶ 播放全部」與清單
   * 編輯一併鎖住（錄製／播放互斥，issue #33），不用在這裡另外處理。
   */
  private toggleRecording(): void {
    if (this.trackRecorder.isRecording) {
      const { action, camera, startCamera } = this.trackRecorder.stop();
      this.controlPanel.setRecordingActive(false);
      if (action.length > 0) this.addTrack('action', action, null);
      if (camera.length > 0) this.addTrack('camera', camera, startCamera ?? null);
    } else {
      this.trackRecorder.start(this.recordTarget, cloneCameraState(this.cameraState));
      this.controlPanel.setRecordingActive(true);
    }
  }

  /**
   * 把剛錄好的一段 Track 加進清單，並同步到面板。預設起始 0 秒、修剪範圍涵蓋
   * 整條（`inStep = 0`、`outStep = ` 最後一筆操作的 step）。相機軌額外帶
   * `startCamera` 快照。
   */
  private addTrack(kind: 'action' | 'camera', steps: Track, startCamera: CameraState | null): void {
    const num = this.nextTrackNum++;
    this.tracks.push({
      id: `t${num}`,
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
      // 新錄好的 Track 自動加入預設群組（issue #43 / ADR-0008）。
      groupIds: new Set([DEFAULT_GROUP_ID]),
    });
    this.syncPanelTracks();
  }

  /**
   * 找到 `id` 那條 Track、跑 `mutate` 改它的 step 欄位、再 `syncPanelTracks()` 把
   * 欄位重寫成量化後的秒數——三個「秒數欄位被改」的處理共用這層 find／防呆／同步
   * （issue #35 code review）。內部一律存量化過的 step 計數：使用者輸入 0.11 秒
   *（不是 1/60 的整數倍）時，欄位會校正成實際生效的 0.1167 秒，看到的即是播放
   * 時用的值。
   */
  private updateTrack(id: string, mutate: (track: RecordedTrack) => void): void {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    mutate(track);
    this.syncPanelTracks();
  }

  /** 「起始秒數」欄位（issue #33）——這條在片段時間軸上從第幾秒開始。負數 clamp 到 0。 */
  private setTrackStartTime(id: string, seconds: number): void {
    this.updateTrack(id, (track) => {
      track.startStep = Math.max(0, secondsToStep(seconds));
    });
  }

  /**
   * 「從 X 秒」（頭修剪）欄位（issue #35）——clamp 到 `[0, outStep]`，不讓 in 越過
   * out（`in > out` 的防呆，UI 這層先擋住，`mergeTracks` 那層另有一道）。
   */
  private setTrackTrimIn(id: string, seconds: number): void {
    this.updateTrack(id, (track) => {
      track.inStep = Math.min(Math.max(0, secondsToStep(seconds)), track.outStep);
    });
  }

  /**
   * 「到 Y 秒」（尾修剪）欄位（issue #35）——不小於 `inStep`（同上防呆）。超過最後
   * 一筆操作的秒數不特別 clamp——尾端多留一點空白不影響播放內容。
   */
  private setTrackTrimOut(id: string, seconds: number): void {
    this.updateTrack(id, (track) => {
      track.outStep = Math.max(secondsToStep(seconds), track.inStep);
    });
  }

  private deleteTrack(id: string): void {
    this.tracks = this.tracks.filter((t) => t.id !== id);
    this.syncPanelTracks();
  }

  /**
   * Track 清單內改名（issue #54 / V2 T2-1）——比照 `renameGroup`（`ControlPanel` 在
   * 失焦／Enter 回報一次、已 trim，這裡就信任呼叫端不再 trim），差別是空字串不忽略：
   * → `customLabel` 設回 `null`，顯示退回 `addTrack` 當下算的自動摘要 `label`。非空
   * → 存成覆寫，之後調整起始／修剪／分群都不會蓋回（那些只改 step 欄位、不碰
   * `customLabel`）。
   */
  private renameTrack(id: string, name: string): void {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    const next = name === '' ? null : name;
    if (track.customLabel === next) return;
    track.customLabel = next;
    this.syncPanelTracks();
  }

  /**
   * 「片段初始 Pin：設為目前 Pin」（issue #39 / ADR-0007 追記）——把畫面上現在所有
   * Pin（`sim.listPins()`）的**rest 形狀附著座標**（`sim.restAttachPoint`）拍成快照，
   * 取代上一份。存 rest 座標而非目前變形座標：`playAll` 會先 `sim.reset()`，還原時
   * 這些座標才精準落在原本的表面點，也不隨拍快照當下的變形而偏。`ControlPanel`
   * 那邊錄製中／播放中已把這顆鈕鎖住，這裡不用再擋。
   */
  private snapshotSetupPins(): void {
    this.setupPins = this.sim.listPins().flatMap((pin) => {
      // `restAttachPoint` 回傳全新的 `Point`；作用中的 Pin 必有約束，`null` 只是防呆。
      const rest = this.sim.restAttachPoint(pin.id);
      return rest ? [rest] : [];
    });
    this.syncPanelTracks();
  }

  /** 「片段初始 Pin：清除」（issue #39）——清空快照，之後 `playAll` 不再放任何初始 Pin。 */
  private clearSetupPins(): void {
    if (this.setupPins.length === 0) return;
    this.setupPins = [];
    this.syncPanelTracks();
  }

  /**
   * 「＋ 新增群組」（issue #43）——新群組預設**開啟**（ADR-0008）；沒有成員，
   * 使用者再用各條 Track 的 `群組 ▾` 指派進來。新增動作讓進行中的獨奏還原點作廢。
   */
  private addGroup(): void {
    const num = this.nextGroupNum++;
    this.groups.push({ id: `g${num}`, name: `群組 ${num}`, enabled: true });
    this.soloState = null;
    this.syncPanelTracks();
  }

  /** 某群組的開啟／關閉勾選框（issue #43）——手動動過開關，進行中的獨奏還原點作廢。 */
  private setGroupEnabled(id: string, enabled: boolean): void {
    const group = this.groups.find((g) => g.id === id);
    if (!group || group.enabled === enabled) return;
    group.enabled = enabled;
    this.soloState = null;
    this.syncPanelTracks();
  }

  /** 某群組改名（issue #43）——`ControlPanel` 已擋掉空字串。 */
  private renameGroup(id: string, name: string): void {
    const group = this.groups.find((g) => g.id === id);
    if (!group || group.name === name) return;
    group.name = name;
    this.syncPanelTracks();
  }

  /**
   * 「獨奏」鈕（issue #43）——只留該群組開、其餘關；對正在獨奏的群組再按一次
   * 還原先前的開關狀態。狀態轉移在純函式 `toggleSolo`（見 `track/groups`）。
   */
  private toggleGroupSolo(id: string): void {
    const { groups, solo } = toggleSolo(this.groups, this.soloState, id);
    this.groups = groups;
    this.soloState = solo;
    this.syncPanelTracks();
  }

  /**
   * 「刪除」群組（issue #43）——只從清單移除、解除所有 Track 對它的歸屬；成員
   * Track 不刪。因此掉到 0 群組的 Track 由 `withGroupInvariant` 補回預設群組
   * （不變式：每條 Track 永遠至少在一個群組）。預設群組不可刪（`ControlPanel`
   * 不給它刪除鈕，這裡再擋一道）。
   */
  private deleteGroup(id: string): void {
    if (id === DEFAULT_GROUP_ID) return;
    this.groups = this.groups.filter((g) => g.id !== id);
    for (const track of this.tracks) {
      track.groupIds = withGroupInvariant(track.groupIds, this.groups);
    }
    this.soloState = null;
    this.syncPanelTracks();
  }

  /**
   * 某條 Track 的 `群組 ▾` 勾選變更（issue #43）——`groupIds` 是勾好的群組 id 清單，
   * 過 `withGroupInvariant`：丟掉無效 id、全空時補回預設群組（取消勾選最後一個
   * 群組 → 自動回預設群組）。
   */
  private setTrackGroups(trackId: string, groupIds: readonly string[]): void {
    const track = this.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.groupIds = withGroupInvariant(groupIds, this.groups);
    this.syncPanelTracks();
  }

  /**
   * 把 `tracks` 清單、群組區、與「▶ 播放」的可用狀態一次同步到 `ControlPanel`
   *（issue #33 起；issue #43 加群組區）。動作軌與相機軌兩種列都帶 `群組 ▾` 多選
   * 資料（issue #37 把相機軌一併接進分群 UI，見 ADR-0008）。
   */
  private syncPanelTracks(): void {
    const overlapping = this.overlappingEnabledCameraTrackIds();
    this.controlPanel.setGroups(
      this.groups.map((g) => ({
        id: g.id,
        name: g.name,
        enabled: g.enabled,
        trackCount: this.tracks.filter((t) => t.groupIds.has(g.id)).length,
        soloed: this.soloState?.soloId === g.id,
        deletable: g.id !== DEFAULT_GROUP_ID,
      })),
    );
    this.controlPanel.setTracks(
      this.tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.customLabel ?? t.label,
        startSeconds: stepToSeconds(t.startStep),
        inSeconds: stepToSeconds(t.inStep),
        outSeconds: stepToSeconds(t.outStep),
        firstEventSeconds: stepToSeconds(firstEventStep(t.steps)),
        lastEventSeconds: stepToSeconds(lastEventStep(t.steps)),
        overlapping: overlapping.has(t.id),
        // 兩種軌都帶群組歸屬：清單依此分區顯示 + 畫 `群組 ▾` 編輯器（issue #37
        // 把相機軌一併接進，見 ADR-0008）。
        groups: this.trackGroupChoices(t),
      })),
    );
    this.controlPanel.setPlayableTrackCount(tracksInEnabledGroups(this.tracks, this.groups).length);
    this.controlPanel.setSetupPinCount(this.setupPins.length);
  }

  /** 一條 Track 的 `群組 ▾` 勾選資料（issue #43 動作軌；issue #37 相機軌）——每個群組一項 + 這條是否屬於它。 */
  private trackGroupChoices(track: RecordedTrack): { id: string; name: string; member: boolean }[] {
    return this.groups.map((g) => ({ id: g.id, name: g.name, member: track.groupIds.has(g.id) }));
  }

  /**
   * 要在面板標紅的相機軌 id 集合（issue #36 起的軟警告：允許暫時重疊，播放時
   * 重疊區間只認先列那條，見 `mergeTracks`）。issue #37 / ADR-0008：只對「開啟中
   * 群組聯集」裡的相機軌判定——`tracksInEnabledGroups` 先濾成播放時真的會一起
   * 出現的子集（`playAll` 餵給 `mergeTracks` 的也是同一個子集），關掉某群組後
   * 那條相機軌不再跟別條衝突，紅框就消失。重疊判定本身在純函式
   * `overlappingCameraTrackIds`（`demos/overlay.ts`）。
   */
  private overlappingEnabledCameraTrackIds(): Set<string> {
    const cameras = tracksInEnabledGroups(this.tracks, this.groups).filter(
      (t) => t.kind === 'camera',
    );
    return overlappingCameraTrackIds(cameras);
  }

  /**
   * 「▶ 播放」按鈕（issue #33；issue #36 加相機軌；issue #43 加群組過濾）：先把
   * `tracks` 濾成「至少屬於一個開啟中群組」的子集（`tracksInEnabledGroups`，
   * **保留清單順序** → `mergeTracks` 認先列語意不變），再依各自的 `startStep`／
   * 頭尾修剪疊加成一條全域時間軸（`mergeTracks` 純函式——平移 `atStep`、動作軌
   * `PointerId` 加軌別前綴避免跨軌碰撞、相機軌在起始 step 插 `setState` 硬切、
   * 相機軌重疊區間只認先列那條、依全域 `atStep` 穩定排序），交給 `demoRunner`
   * 精準重播。不手動分群時所有 Track 都在預設群組、預設開啟，子集＝全部，行為
   * 跟 issue #33 的「播放全部」完全相同。開啟中群組成員聯集為空時直接返回
   *（`ControlPanel` 那邊按鈕也已變灰）。
   *
   * 播放前先 `sim.reset()`：Track 裡 Grab/Tap/Pin 記的是錄製當下的絕對世界座標，
   * 場景回到 rest 狀態它們才會準確落在果凍上、每次疊加結果才逐格一致（issue #33
   * 決定性驗收條件），不受「播放前場景被怎麼動過」影響。
   *
   * 相機：整段沒有任何 Camera Track 時，重設後推一個一次性 `frame` 指令把鏡頭
   * 框回果凍靜止狀態（不停在上一次亂動到的位置）。有 Camera Track 時改成把
   * `cameraState` 同步重設成剛框好的靜止狀態——這樣第一條相機軌起始秒數若被
   * 調到 > 0，它生效前那段的鏡頭是從一個固定鏡位開始（決定性），而不是承接
   * 播放前手動亂動到的鏡位；相機軌一生效，自帶的 `setState` 硬切就接管
   * （issue #36 決定性驗收條件：不管播放前鏡頭在哪、重複播放鏡頭路徑都一致）。
   */
  private playAll(): void {
    const active = tracksInEnabledGroups(this.tracks, this.groups);
    if (active.length === 0) return;
    this.sim.reset();
    const hasCameraTrack = active.some((t) => t.kind === 'camera');
    if (hasCameraTrack) {
      this.cameraState = createCameraState({ bbox: this.sim.bbox() }, this.canvasSize());
      this.cameraCommands = [];
    } else {
      this.cameraCommands.push({ type: 'frame' });
    }
    this.demoRunner.start(
      mergeTracks([
        // 片段初始 Pin 合成軌排在最前面（issue #39）：`setup/` 前綴不撞 Action Track
        // 的 `t{n}/`，一串 `atStep: 0` 的 `pin` 事件靠穩定排序落在所有軌的 step-0
        // 事件之前——`sim.reset()` 後先在 step 0 還原初始 Pin，再開演。空快照時這條
        // steps 為空，`mergeTracks` 不貢獻任何事件。
        setupPinsTrack(this.setupPins),
        ...active.map((t) => ({
          startStep: t.startStep,
          idPrefix: `${t.id}/`,
          steps: t.steps,
          inStep: t.inStep,
          outStep: t.outStep,
          startCamera: t.startCamera,
        })),
      ]),
    );
    this.setPlaybackLocked(true); // 立即鎖住，理由同 runDemo
  }

  /**
   * 集中處理鎖定狀態變化，`frame()` 每幀同步一次時才不會對沒變的按鈕重複寫
   * `disabled`。`locked` 等同「Demo／Track 正在播放」——同步驅動 issue #34 的
   * 播放狀態列（暫停鈕＋秒數讀出只在播放中出現），並在播放結束時把暫停旗標
   * 強制歸零，下一次播放不會殘留上一輪的定格狀態。
   */
  private setPlaybackLocked(locked: boolean): void {
    if (this.playbackLocked === locked) return;
    this.playbackLocked = locked;
    this.controlPanel.setPlaybackControlsEnabled(!locked);
    this.controlPanel.setPlaybackActive(locked);
    if (!locked) this.setPaused(false);
  }

  /**
   * 「⏸ 暫停／▶ 繼續」切換鈕（issue #34）——只在播放中有作用（沒在播放時
   * `demoRunner.isRunning` 為 false，直接忽略，對應「暫停鈕無作用」的驗收條件；
   * 面板那邊此時整列也是隱藏的）。
   */
  private togglePause(): void {
    if (!this.demoRunner.isRunning) return;
    this.setPaused(!this.paused);
  }

  /** 切換暫停旗標並同步面板按鈕視覺；值沒變則不動作。 */
  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.controlPanel.setPaused(paused);
  }

  /**
   * 「停止／重設」與「重新匯入 PNG」共用的場景狀態收束（issue #38 / V2 T1-6）——
   * 兩條路徑對「正在進行的疊加播放／錄製／播放鎖定」要處理得一模一樣，這裡集中
   * 一處保證一致：
   * 1. `demoRunner.stop()` 立即中斷排程中的 Demo／Track 事件——否則場景重設或換
   *    網格後，還沒播完的排程繼續把事件砸進去（看起來像「重設沒生效」，或讓舊
   *    網格算的座標砸進新網格）。
   * 2. `setPlaybackLocked(false)` 解鎖被播放鎖住的所有控制項（Demo 鈕、開始錄製、
   *    ▶ 播放、錄製目標選擇器、Track 清單編輯、群組區），並把暫停旗標歸零、收起
   *    播放狀態列（見 `setPlaybackLocked`）。
   * 3. 仍在進行中的錄製一併中斷並**丟棄**（不進清單）——「中斷」不是「存檔」。
   *
   * 差別只在呼叫端各自接的下一步：`resetSim` 呼 `sim.reset()` 但**保留** Track／
   * 群組清單；`replaceJelly` 連清單一起清空、換上新網格（ADR-0007 生命週期：
   * `停止／重設` 保留、重新匯入清空）。
   */
  private haltPlaybackAndRecording(): void {
    this.demoRunner.stop();
    this.setPlaybackLocked(false);
    if (this.trackRecorder.isRecording) {
      this.trackRecorder.stop();
      this.controlPanel.setRecordingActive(false);
    }
  }

  /**
   * 「停止／重設」（issue #14；issue #15 追加停 Demo；issue #38 收束播放／錄製）：
   * 先 `haltPlaybackAndRecording()`，再 `sim.reset()` 把 Jelly 回 rest 座標、速度
   * 歸零、清掉所有 Grab／Pin。Track／群組清單與片段初始 Pin 快照（issue #39）
   * **保留**（拓撲沒變，錄好的還能疊加播放）——只有 `replaceJelly` 才清空。
   */
  private resetSim(): void {
    this.haltPlaybackAndRecording();
    this.sim.reset();
  }

  /**
   * Boundary 切換（issue #14）：`walled` 用目前 bbox 算一個正方形邊界範圍（見
   * `./walledBounds`）、`infinite` 換回無邊界。記在 `boundaryMode`——`replaceJelly`
   * 換新 `SimCore` 時要重套，否則面板顯示的模式會跟實際物理不一致。同時把
   * `wallBox` 套到 Renderer（issue #9 追加）：撞牆時畫面上有外框可以對照，
   * 不會覺得「明明沒碰到東西卻被彈回來」。
   */
  private setBoundaryMode(mode: BoundaryMode): void {
    this.boundaryMode = mode;
    this.applyBoundaryMode(this.sim);
    this.renderer.setWallBounds(this.wallBox);
  }

  /** 套用 `boundaryMode` 到 `sim`，並同步 `wallBox`（`replaceJelly` 換新 Renderer 後要另外重套，見該處）。 */
  private applyBoundaryMode(sim: SimCore): void {
    if (this.boundaryMode === 'walled') {
      const boundary = new WalledBoundary(computeWalledBounds(sim.bbox()));
      sim.setBoundary(boundary);
      this.wallBox = boundary.box;
    } else {
      sim.setBoundary(new InfiniteBoundary());
      this.wallBox = null;
    }
  }

  /** Softness 滑桿（issue #14）：0–1 → `cellFrac` + `alphaSm`（見 `../sim/softness`）。滑桿原始值另記一份供存檔（issue #57）。 */
  private setSoftness(t: number): void {
    this.softness = t;
    const { cellFrac, alphaSm } = softnessToParams(t);
    this.sim.params.cellFrac = cellFrac;
    this.sim.params.alphaSm = alphaSm;
    this.sim.rebuildRegions();
  }

  /** 輕拍力道滑桿（issue #14）。 */
  private setTapStrength(strength: number): void {
    this.sim.params.tapStrength = strength;
  }

  /**
   * 「Pin 模式」開關（issue #14）——`attachInputHandlers` 的 `applyInput` 靠
   * `pinModeEnabled` 轉接；這裡順便切畫布游標（十字）跟 Pin 標記的「可點掉」
   * 視覺（紅色脈動），兩者都是純粹的提示，不影響任何判定邏輯。
   */
  private setPinMode(enabled: boolean): void {
    this.pinModeEnabled = enabled;
    this.applyPinModeCursor();
    this.pinMarkers.setRemovable(enabled);
  }

  private applyPinModeCursor(): void {
    this.renderer.canvas.style.cursor = this.pinModeEnabled ? 'crosshair' : '';
  }

  /**
   * 「清除所有 Pin」按鈕（issue #14；issue #51 起改走窄介面）——跟指標事件同一條
   * 路：一個無 `id` 的「清除 Pin 事件」`InputEvent` 送進 `sim.applyInput`，同時
   * `trackRecorder.record`（no-op 除非正在錄製）。不再直呼 `sim.clearPins()`，回到
   * ADR-0005「所有影響模擬的輸入都經 `applyInput`」——這樣錄製中按這顆鈕會落進
   * Action Track，重播到那個 step 清掉畫面上所有 Pin（含片段初始 Pin，刻意跨軌，
   * 見 ADR-0007 追記）。`applyInput` 不會前進錄製 step 計數，兩行順序不影響結果。
   */
  private clearPins(): void {
    const event: InputEvent = { type: 'clearPins' };
    this.sim.applyInput(event);
    this.trackRecorder.record(event); // no-op 除非正在錄製（issue #51）
  }

  /**
   * 「顯示 Pin」開關——只管標記的顯示／隱藏。`ControlPanel` 那邊已經在使用者
   * 關掉顯示時順便把「Pin 模式」的勾選框也一起強制關掉（所見即所得），這裡
   * 不用重複處理；只要單純記著這個旗標，`frame()` 每幀據此決定要不要投影更新。
   */
  private setPinsVisible(visible: boolean): void {
    this.pinsVisible = visible;
    this.pinMarkers.setVisible(visible);
  }

  /** 「顯示網格」開關（issue #14 追加，debug 用）——記在 `wireframeVisible`，`replaceJelly` 換新 `JellyRenderer` 時要重套。 */
  private setWireframeVisible(visible: boolean): void {
    this.wireframeVisible = visible;
    this.renderer.setWireframeVisible(visible);
  }

  /**
   * `removeRadius` 換算成螢幕像素、再除以目前的相機縮放（`transform.scale`）
   * 換回世界座標——這樣不管縮多近多遠，「點多靠近算點中一個 Pin」在螢幕上看
   * 起來永遠是同樣大小（跟 Pin 標記本身固定的 CSS 像素直徑一致）。原本用
   * 「bbox 對角線的固定比例」是世界座標常數，縮得越近，同一個世界半徑換算成
   * 螢幕像素就越大，會出現「明明離標記很遠，點下去卻被當成點中」的錯覺。
   */
  private pinModeContext(): { pins: ReturnType<SimCore['listPins']>; removeRadius: number } {
    return {
      pins: this.sim.listPins(),
      removeRadius: PIN_REMOVE_RADIUS_PX / this.cameraState.transform.scale,
    };
  }

  /**
   * `DropImportInput` 挑到影像位元組後的回呼：`buildSimMesh` → 解碼貼圖 →
   * 換掉整套 `SimCore` + `JellyRenderer`。任何一步失敗（非圖片、不支援格式、
   * 壞檔、貼圖解碼失敗）都在這個共用 try/catch 裡 `console.warn` 後放棄，原本的
   * Jelly 不受影響（issue #12 / #55 驗收條件：「提示後略過、不崩」）。
   * `importing` 擋掉重疊呼叫。
   */
  private onDropImport = (imageBytes: Uint8Array): void => {
    if (this.importing) return;
    this.importing = true;
    this.importImage(imageBytes)
      .catch((err: unknown) => {
        console.warn('[jelly] 影像匯入失敗，已略過', err);
        this.showNotice('這張圖片沒辦法變成果凍，已略過');
      })
      .finally(() => {
        this.importing = false;
      });
  };

  private async importImage(imageBytes: Uint8Array): Promise<void> {
    // 網格解析度退路（issue #16）：上次 substep 降級以來還沒消化過，這次匯入改用
    // 較低的 targetParticleCount（見 REDUCED_TARGET_PARTICLE_COUNT、PerfMonitor）。
    // 這裡就把參數**解析完整**（不只帶 diff），存檔要原樣寫進 `ClipState.meshParams`
    // 供載入端決定性重算（issue #57）。
    const meshParams: BuildSimMeshParams = {
      ...DEFAULT_PARAMS,
      ...(this.perfMonitor.consumeMeshFallbackPending()
        ? { targetParticleCount: REDUCED_TARGET_PARTICLE_COUNT }
        : {}),
    };
    const mesh: SimMesh = buildSimMesh(imageBytes, meshParams);
    const texture = await decodeTextureImage(imageBytes);
    await this.replaceJelly(mesh, texture);
    // 換果凍成功後才記住這次的來源影像與完整參數（供存檔）——`buildSimMesh` / 貼圖
    // 解碼 / `replaceJelly` 中途丟錯時維持上一份，跟畫面上實際還在的果凍一致。
    this.lastImage = { format: sniffImageFormat(imageBytes), bytes: imageBytes };
    this.lastMeshParams = meshParams;
  }

  /**
   * 「儲存片段」按鈕（issue #57 / V2 T2-4）——把目前整個片段序列化成一個帶時間戳
   * 的 `.json` 下載（`jelly-sandbox-<YYYYMMDD-HHMMSS>.json`，多版本不互相覆蓋）。
   * 任何時候都可用：還沒匯入任何圖時，內建預設果凍在此刻用 `canvasToPng` 拍成
   * `format: 'png'`（載入端零特例）。
   */
  private saveClip(): void {
    const json = serializeClip(this.buildClipState());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const doc = this.root.ownerDocument;
    const a = doc.createElement('a');
    a.href = url;
    a.download = `jelly-sandbox-${clipFileTimestamp(new Date())}.json`;
    a.rel = 'noopener';
    // 有些瀏覽器（Firefox）對沒掛進 DOM 的 <a> 不觸發下載——掛上、點、拆掉。
    doc.body.appendChild(a);
    a.click();
    a.remove();
    // 下載串流開始前就撤銷 object URL 會中斷下載——延到下一輪 tick 再撤。
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * 蒐集目前記憶體狀態成 `ClipState`（issue #57）——`RecordedTrack` 攤成 `ClipTrack`
   * （`groupIds` 的 `Set` → 陣列、`customLabel ?? label` → `name`）、`setupPins`
   * 拷成純 `{ x, y }`、`sim` 帶滑桿原始值。還沒匯入任何圖時 `image` 用內建預設
   * 果凍此刻拍下的 PNG。
   */
  private buildClipState(): ClipState {
    const image: ClipImage = this.lastImage ?? {
      format: 'png',
      bytes: canvasToPng(this.defaultTexture),
    };
    return {
      image,
      meshParams: this.lastMeshParams,
      sim: {
        softness: this.softness,
        tapStrength: this.sim.params.tapStrength,
        boundary: this.boundaryMode,
      },
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
   * `ClipFileInput` 選到 `.json` 檔讀出文字後的回呼（issue #58）：`parseClipFile`
   * 解析／驗證失敗（非 JSON／版本不符／欄位缺或型別錯）就在這裡接住、顯示提示、
   * 目前場景**完全不動**（不進 `applyClipState`，不觸碰任何既有狀態）。解析成功
   * 才交給 `applyClipState` 走場景整包取代；`importing` 擋掉跟拖放／按鈕匯入圖片
   * 重疊的呼叫（共用同一套「換 sim/renderer」機制，不能兩邊同時動）。
   */
  private onLoadClip = (text: string): void => {
    if (this.importing) return;
    let clip: ClipState;
    try {
      clip = parseClipFile(text);
    } catch (err: unknown) {
      const message = err instanceof ClipFileError ? err.message : '片段檔案格式不對';
      console.warn('[jelly] 片段載入失敗，已略過', err);
      this.showNotice(`這個片段讀不了，已略過（${message}）`);
      return;
    }
    this.importing = true;
    this.applyClipState(clip)
      .catch((err: unknown) => {
        console.warn('[jelly] 片段載入失敗，已略過', err);
        this.showNotice('這個片段沒辦法載入，已略過');
      })
      .finally(() => {
        this.importing = false;
      });
  };

  /**
   * 「載入片段」整包取代場景（issue #58）：用存檔的影像位元組 + 完整 mesh 參數
   * 決定性重算 mesh（繞過 `perfMonitor` 的效能退路——存檔當下已經是實際生效的
   * 完整參數，不該再被目前裝置的降級狀態動）、貼圖依存的格式重建，走跟「重新
   * 匯入圖片」相同的收束路徑（`replaceJelly`：中斷播放／錄製、清空 Track／群組／
   * 初始 Pin，換新 `SimCore` + `JellyRenderer`，鏡頭自動框住新果凍——即「剛匯入
   * 一張圖」的鏡位，不保存存檔時的手動平移／縮放）。`replaceJelly` 成功後才把
   * `ClipState` 其餘欄位灌回：軟硬度／輕拍力道／邊界模式（同時同步面板顯示，
   * `setSoftness`/`setTapStrength`/`setBoundaryMode` 只動 sim、不動面板 DOM）、
   * 所有 Track（`hydrateClipTrack`：`groupIds` 陣列 → `Set`，`name` 同時填入
   * `customLabel`／`label`——載入後顯示的就是存檔當下的名字）、所有群組、片段
   * 初始 Pin、流水號。任何一步丟錯（壞影像位元組、mesh 建置失敗）都讓呼叫端
   * `onLoadClip` 的 catch 接住，原本的 Jelly 已經在 `replaceJelly` 成功時被換掉，
   * 但那一步失敗代表新 Jelly 根本沒建出來、舊的還在——跟 `importImage` 失敗時
   * 的行為一致。
   */
  private async applyClipState(clip: ClipState): Promise<void> {
    const mesh: SimMesh = buildSimMesh(clip.image.bytes, clip.meshParams);
    const texture = await decodeTextureImage(clip.image.bytes);
    await this.replaceJelly(mesh, texture);

    this.lastImage = clip.image;
    this.lastMeshParams = clip.meshParams;

    this.setSoftness(clip.sim.softness);
    this.controlPanel.setSoftness(clip.sim.softness);
    this.setTapStrength(clip.sim.tapStrength);
    this.controlPanel.setTapStrength(clip.sim.tapStrength);
    this.setBoundaryMode(clip.sim.boundary);
    this.controlPanel.setBoundary(clip.sim.boundary);

    this.groups = clip.groups.map((g) => ({ ...g }));
    this.tracks = clip.tracks.map(hydrateClipTrack);
    this.nextTrackNum = clip.counters.nextTrackNum;
    this.nextGroupNum = clip.counters.nextGroupNum;
    this.soloState = null;
    this.setupPins = clip.setupPins.map((p) => ({ x: p.x, y: p.y }));
    this.syncPanelTracks();
  }

  /**
   * 建好新的一套（sim + renderer + camera）成功後才拆舊的——畫面不會有空檔。
   * 新 `SimCore` 一律從 `DEFAULT_SIM_PARAMS` 起家，所以要把控制面板目前設定
   * （Softness、輕拍力道、Boundary 模式）重新套上去，面板才不會顯示跟實際物理
   * 不一致的值（Pin 模式是 `JellySandbox` 層的路由旗標，不受換 `SimCore` 影響，
   * 不用重套）。
   */
  private async replaceJelly(mesh: SimMesh, texture: HTMLImageElement): Promise<void> {
    // 換網格時的場景收束跟「停止／重設」走同一條路（issue #38）：中斷疊加播放
    // （排程中的舊座標事件不會砸進新網格）、解鎖播放鎖定的控制項、中斷仍在進行
    // 中的錄製。
    this.haltPlaybackAndRecording();
    // 「停止／重設」到此為止；重新匯入 PNG 另外**清空**整份 Track／群組清單——座標
    // 與鏡頭快照都是對著舊網格算的，套到新網格沒意義（issue #33 / #38；ADR-0007
    // 生命週期）。
    this.tracks = [];
    this.nextTrackNum = 1;
    this.setupPins = []; // 片段初始 Pin 座標是對著舊網格算的，套到新網格沒意義（issue #39）
    this.groups = [createDefaultGroup()];
    this.nextGroupNum = 1;
    this.soloState = null;
    // 「錄製目標」選擇器是按下錄製前選的 per-take 偏好、不是對著舊網格的狀態，
    // 兩條收束路徑都刻意**不動**它的選值（`haltPlaybackAndRecording` 只還原它的
    // 鎖定狀態，不改選值）。
    this.syncPanelTracks();
    const sim = new SimCore(mesh);
    sim.params.cellFrac = this.sim.params.cellFrac;
    sim.params.alphaSm = this.sim.params.alphaSm;
    sim.params.tapStrength = this.sim.params.tapStrength;
    sim.rebuildRegions();
    this.applyBoundaryMode(sim);

    const renderer = await JellyRenderer.create({
      width: this.root.clientWidth,
      height: this.root.clientHeight,
      mesh,
      positions: sim.positions,
      texture,
      background: { color: 0x1a1a1a, alpha: 1 },
    });

    this.input.destroy();
    this.cameraInput.destroy();
    this.renderer.destroy();
    this.root.appendChild(renderer.canvas); // dropHint 用 position:absolute + z-index，DOM 順序不影響疊放

    this.sim = sim;
    this.renderer = renderer;
    this.cameraState = createCameraState({ bbox: sim.bbox() }, this.canvasSize());
    this.cameraCommands = [];
    ({ input: this.input, cameraInput: this.cameraInput } = this.attachInputHandlers(
      renderer.canvas,
    ));
    this.renderer.setCamera(this.cameraState.transform);
    this.applyPinModeCursor(); // 新 canvas 是全新元素，游標樣式要重套
    this.renderer.setWireframeVisible(this.wireframeVisible); // 新 JellyRenderer 預設隱藏，要重套
    this.renderer.setWallBounds(this.wallBox); // 新 JellyRenderer 預設沒有牆框，要重套
  }

  /** `PointerInput` + `CameraInput` 都吃同一組 project／hitTest；重新匯入後換綁到新 canvas。 */
  private attachInputHandlers(canvas: HTMLCanvasElement): {
    input: PointerInput;
    cameraInput: CameraInput;
  } {
    const project = (sx: number, sy: number) =>
      screenToWorld(this.cameraState.transform, this.canvasSize(), sx, sy);
    const hitTest = (world: { x: number; y: number }) => this.sim.pick(world.x, world.y) != null;

    const input = new PointerInput(canvas, {
      screenToWorld: project,
      hitTest,
      applyInput: (event) => {
        const routed = routeForPinMode(event, this.pinModeEnabled, this.pinModeContext());
        if (routed) {
          this.sim.applyInput(routed);
          this.trackRecorder.record(routed); // no-op 除非正在錄製（issue #29）
        }
      },
    });
    const cameraInput = new CameraInput(canvas, {
      screenToWorld: project,
      hitTest,
      emit: (cmd) => this.emitCamera(cmd), // 進佇列 + no-op 除非正在錄製（issue #29 / #36）
    });
    return { input, cameraInput };
  }

  private createDropHint(): HTMLDivElement {
    const hint = document.createElement('div');
    hint.className = 'jelly-drop-hint';
    hint.textContent = '放開以匯入這張圖片';
    return hint;
  }

  /**
   * 常駐的匯入提示（issue #12 追加；issue #56 讓它本身可點）——`jelly-drop-hint`
   * 只在拖曳中才顯示，使用者不會知道「拖圖片進來可以匯入」這個功能本身存在。
   * 低調小字放在角落，拖曳時會被上面的 `jelly-drop-hint` 蓋住。點它等同按控制面板
   * 的「匯入圖片」鈕，開同一個檔案選擇器（`onImportHintClick`）。
   */
  private createImportHint(): HTMLDivElement {
    const hint = document.createElement('div');
    hint.className = 'jelly-import-hint';
    hint.textContent = '拖曳圖片到畫面上，或點這裡選檔匯入（PNG / JPEG / GIF）';
    return hint;
  }

  private onImportHintClick = (): void => {
    this.fileImportInput.open();
  };

  /**
   * 匯入被拒／失敗時的畫面提示（issue #55 檢視追加）——`console.warn` 只有開
   * DevTools 才看得到，使用者拖了不支援的檔案會不知道發生什麼事。置頂置中一行、
   * `aria-live` 讓螢幕報讀器也讀得到，幾秒後自動淡出。
   */
  private createNotice(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'jelly-notice';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    return el;
  }

  private showNotice(message: string): void {
    this.notice.textContent = message;
    this.notice.classList.add(NOTICE_VISIBLE_CLASS);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice.classList.remove(NOTICE_VISIBLE_CLASS);
      this.noticeTimer = 0;
    }, NOTICE_DURATION_MS);
  }

  private frame = (nowMs: number): void => {
    const elapsedMs = nowMs - this.lastFrameMs;
    const elapsed = elapsedMs / 1000;
    this.lastFrameMs = nowMs;

    // 暫停中（issue #34）：略過固定步迴圈、PerfMonitor 取樣與相機更新——果凍
    // 定格在當下形變、播放秒數不動、鏡頭不動、排定事件不觸發——只重畫這一格。
    // `lastFrameMs` 上面已更新，暫停期間累積的真實時間全數丟棄，按繼續時
    // `accumulator` 不會突然吐出一大批步，決定性不受影響。
    if (this.paused) {
      this.renderer.render();
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }

    // 同一個 clamp 給 camera 平滑跟 PerfMonitor 累積用：分頁切回來那一大幀不會
    // 被當成「持續超標一整秒」誤觸發降級（見 PerfMonitor 說明的 sustainSeconds）。
    const clampedElapsed = Math.min(Math.max(elapsed, 0), CAMERA_MAX_DT);

    this.perfMonitor.sample(elapsedMs, clampedElapsed);
    this.sim.params.substeps = this.perfMonitor.substeps;
    this.controlPanel.setPerfStatus(this.perfMonitor.substeps, this.perfMonitor.degraded);

    const steps = this.accumulator.advance(elapsed);
    for (let i = 0; i < steps; i++) {
      this.demoRunner.advance(
        (event) => this.sim.applyInput(event),
        (cmd) => this.cameraCommands.push(cmd),
      );
      this.sim.step(STEP_SECONDS);
      this.trackRecorder.tick(); // 跟 demoRunner 同一個 step 計數，錄下的時間戳記才能對得上重播（issue #29）
    }
    const playing = this.demoRunner.isRunning;
    this.setPlaybackLocked(playing); // 追上「Demo／Track 自己播完」這種沒有按鈕點擊觸發的狀態變化
    if (playing) {
      // 面板的「目前 X.XX 秒」讀出（issue #34）——用 DemoRunner 的全域 sim step
      // 計數換算，暫停時 step 不前進、讀出跟著定住。
      this.controlPanel.setPlaybackTime(stepToSeconds(this.demoRunner.elapsedSteps));
    }

    const cmds = this.cameraCommands;
    this.cameraCommands = [];
    this.cameraState = updateCamera(
      this.cameraState,
      { bbox: this.sim.bbox() },
      this.canvasSize(),
      cmds,
      clampedElapsed,
    );
    // 「鎖定跟隨」勾選框同步到相機實際狀態（issue #36）——相機軌播放的 `setState`
    // 硬切、錄進去的 `setFollow`，或 `playAll` 重設鏡頭都會在使用者沒點勾選框時
    // 改動 `followEnabled`，不同步就會脫鉤。`setFollowLocked` 值沒變不寫 DOM。
    this.controlPanel.setFollowLocked(!this.cameraState.followEnabled);

    this.renderer.setPositions(this.sim.positions);
    this.renderer.setCamera(this.cameraState.transform);
    this.renderer.render();

    if (this.pinsVisible) {
      const canvasSize = this.canvasSize();
      this.pinMarkers.update(
        this.sim.listPins().map((pin) => {
          const screen = worldToScreen(
            this.cameraState.transform,
            canvasSize,
            pin.point.x,
            pin.point.y,
          );
          return { id: String(pin.id), x: screen.x, y: screen.y };
        }),
      );
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  private onResize = (): void => {
    // 畫布尺寸交給 Renderer；相機下一幀的 `updateCamera` 會用新畫布尺寸重新 fit。
    this.renderer.resize(this.root.clientWidth, this.root.clientHeight);
  };

  private canvasSize(): { width: number; height: number } {
    return { width: this.root.clientWidth, height: this.root.clientHeight };
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
};
const CAMERA_TRACK_KIND_LABELS: Readonly<Record<string, string>> = {
  panBy: '平移',
  zoomBy: '縮放',
  frame: '框住',
  setFollow: '鎖定跟隨',
};

/**
 * 一段 Track 的簡短標籤（issue #33 動作軌 / issue #36 相機軌）：`<name>` 後面括號
 * 列出這條錄到哪幾類操作（依 `labels` 把 `event.type` 對成分類字、去重、保留出現
 * 順序），讓使用者在清單上一眼分得出哪條是哪條。沒有可辨識的操作就只回 `name`。
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
 * `ClipTrack`（存檔格式）→ `RecordedTrack`（記憶體格式），issue #58——`applyClipState`
 * 載入每一條 Track 時呼叫。`groupIds` 陣列還原成 `Set`；`name` 同時填入 `customLabel`
 * 與 `label`，因為存檔的 `name` 已經是 `customLabel ?? label` 攤平後的最終顯示字串、
 * 分不出原本是使用者自訂還是自動摘要——兩欄位都設成它，載入後顯示的就是存檔當下
 * 那個名字；使用者之後把名稱欄位清空仍會照 `renameTrack` 的邏輯退回這個 `label`。
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

/**
 * 深拷貝一份相機狀態當快照（欄位形狀綁死 `CameraState`：`transform` 是唯一的巢狀
 * 物件，其餘是純量）——錄製起點傳給 `TrackRecorder`，之後 `updateCamera` 每幀回傳
 * 新物件不會動到它。
 */
function cloneCameraState(state: CameraState): CameraState {
  return { ...state, transform: { ...state.transform } };
}

/**
 * 一段 Track 第一筆／最後一筆操作的 step（issue #35）——`steps` 由 `TrackRecorder`
 * 逐格 push，依 `atStep` 升冪，所以取頭尾即可。空 Track 回 0（`addTrack`
 * 只在非空時才建列，這裡只是防呆）。清單上顯示成秒數，幫使用者抓修剪起訖值。
 */
function firstEventStep(steps: Track): number {
  return steps[0]?.atStep ?? 0;
}

function lastEventStep(steps: Track): number {
  return steps[steps.length - 1]?.atStep ?? 0;
}

/**
 * 影像位元組 → `HTMLImageElement`（Renderer 的貼圖來源）。走 Blob URL，載入完即釋放。
 * Blob 的 MIME 依實際格式（png/jpeg/gif）給——瀏覽器 `<img>` 原生支援三者；動畫
 * GIF 由瀏覽器取第一幀當靜圖，跟 mesh 端 `decodeGifAlpha` 一致（issue #55）。
 */
function decodeTextureImage(imageBytes: Uint8Array): Promise<HTMLImageElement> {
  const mime = imageFormatToMime(sniffImageFormat(imageBytes));
  return new Promise((resolve, reject) => {
    const blob = new Blob([imageBytes as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片解碼失敗'));
    };
    img.src = url;
  });
}
