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
 * 挑出拖放的 PNG 檔案、讀成位元組後回呼 `importPng` → `buildSimMesh` → 換一套新的
 * `SimCore` + `JellyRenderer`（拓撲變了、舊 Mesh geometry 沒法沿用）。新 Renderer
 * 先建好、確定成功了才拆舊的，畫面不會有空檔；解碼／建網格失敗（非圖片、壞檔）
 * 一律 `console.warn` 後放棄，不影響原本的 Jelly。匯入時把控制面板目前設定
 * （Softness、輕拍力道、Boundary 模式）重新套到新的 `SimCore`，面板不會顯示跟
 * 實際物理不一致的值。`importHint`（issue #12 追加）是常駐在角落的低調小字，
 * 提示「可以拖 PNG 進來」——`dropHint` 只在拖曳中才出現，沒有這個常駐提示的話
 * 使用者無從發現這個功能本身存在。
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
 * 改為多動作軌）：`./track` 提供 `TrackRecorder`——跟 `DemoRunner` 互補的純類別，
 * 依 sim-step 排程「錄」而非「播」事件。攔截點是 `attachInputHandlers` 裡既有的
 * 兩個派送點（`sim.applyInput(routed)` 之前、`cameraInput` 的 `emit` 推進
 * `cameraCommands` 之前）——錄製開啟時額外把同一個事件轉呼叫進
 * `trackRecorder.record()`，不新增輸入路徑（ADR-0005）。主迴圈每個固定 step
 * 呼叫一次 `trackRecorder.tick()`，讓錄下的時間戳記跟 `DemoRunner` 重播時的
 * step 計數對得上。
 *
 * 停止錄製時 `TrackRecorder.stop()` 依事件種類把錄到的內容拆成 `{ action, camera }`
 * 兩份（ADR-0007 的拆軌模型）；本票（issue #33）只消化 `action` 那一份——非空
 * 就新增一列 Action Track 到 `actionTracks` 清單，`camera` 那一份先丟棄（留給
 * 相機軌的票）。「▶ 播放全部」把清單裡所有 Action Track 依各自的 `startStep`
 * 用 `mergeTracks`（`demos/overlay.ts` 純函式）壓成一條全域時間軸——平移
 * `atStep`、每條的 `PointerId` 加軌別前綴避免跨軌 `release` 誤放別條的 Grab、
 * 依全域 `atStep` 穩定排序——交給 `demoRunner` 精準重播（Track 排程格式跟
 * `DemoStep[]` 相同，不需要另外寫播放器）。每條都是單指標錄的，疊起來等於
 * 同時多點抓取（Multi-grab）。
 *
 * **Track 座標對齊**：Grab/Tap/Pin 記的是錄製當下的絕對世界座標，`playAll`
 * 因此在 `demoRunner.start` 之前先 `sim.reset()`（場景回 rest 狀態，絕對世界
 * 座標才準確落在果凍上），再推一個一次性 `frame` 指令把鏡頭框回果凍靜止狀態
 * ——兩者都是離散、決定性的瞬間對齊，確保「連按播放全部結果逐格一致」（issue
 * #33 決定性驗收條件）不受播放前場景／相機被怎麼動過影響。相機運鏡的重播
 * 留給相機軌的票（Camera Track）。
 *
 * 換 Jelly（`replaceJelly`）會中斷錄製並**清空整份 Track 清單**，因為座標是
 * 對著舊網格算的；單純「停止／重設」（`resetSim`）**保留清單**，只中斷播放與
 * 仍在進行中的錄製。錄製中與播放中互斥（`ControlPanel` 依 `setRecordingActive`
 * ／`setPlaybackControlsEnabled` 互相鎖住對方的按鈕）。
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
import { buildSimMesh, DEFAULT_PARAMS, type SimMesh } from '../mesh';
import { JellyRenderer } from '../render';
import {
  type Bbox,
  type BoundaryMode,
  InfiniteBoundary,
  SimCore,
  softnessToParams,
  WalledBoundary,
} from '../sim';
import { ControlPanel } from './ControlPanel';
import { createDefaultJelly } from './defaultJelly';
import { DEMOS, DemoRunner, mergeTracks } from './demos';
import { DropImportInput } from './DropImportInput';
import { FixedStepAccumulator } from './FixedStepAccumulator';
import { PerfMonitor } from './PerfMonitor';
import { PinMarkers } from './PinMarkers';
import { TrackRecorder, type RecordTarget, type Track } from './track';
import { computeWalledBounds } from './walledBounds';

const STEP_SECONDS = 1 / 60;
/** 相機平滑用的單幀時距上限（分頁切回來不會讓相機瞬移）。 */
const CAMERA_MAX_DT = 0.1;
/** 拖曳中疊在畫面上的提示層 class（樣式見 `style.css`）。 */
const DROP_HINT_ACTIVE_CLASS = 'is-active';
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
 * 一條已錄好的 Action Track（issue #33 / V2 T1-1）——`steps` 是相對自己起點的
 * 時間軸，`startStep` 是它在疊加時間軸上的起始 sim step（UI 以「秒」編輯，
 * `STEP_SECONDS` 換算），`label` 是清單上顯示的簡短標籤，`id` 兼作 `mergeTracks`
 * 的 `PointerId` 前綴來源（各條唯一）。
 */
interface RecordedActionTrack {
  id: string;
  label: string;
  startStep: number;
  steps: Track;
}

/** step 計數 → 秒（UI 顯示）。四捨五入的反向見 `secondsToStep`。 */
const stepToSeconds = (step: number): number => step * STEP_SECONDS;
/** 秒（UI 編輯）→ step 計數（內部唯一事實來源，比照 `demos/scripts.ts` 的 `at()`）。 */
const secondsToStep = (seconds: number): number => Math.max(0, Math.round(seconds / STEP_SECONDS));

export class JellySandbox {
  private sim: SimCore;
  private renderer: JellyRenderer;
  private input: PointerInput;
  private cameraInput: CameraInput;
  private readonly dropImportInput: DropImportInput;
  private readonly controlPanel: ControlPanel;
  private readonly pinMarkers: PinMarkers;
  private readonly demoRunner = new DemoRunner();
  private readonly trackRecorder = new TrackRecorder();
  private readonly accumulator = new FixedStepAccumulator(STEP_SECONDS);
  private readonly perfMonitor = new PerfMonitor();
  private readonly root: HTMLElement;
  private readonly dropHint: HTMLDivElement;
  private readonly importHint: HTMLDivElement;

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
  /** 按下錄製前選定的錄製目標（issue #33）——本票只消化 `action` 那一路，`camera` 留給相機軌的票。 */
  private recordTarget: RecordTarget = 'action';
  /** 已錄好的 Action Track 清單（issue #33）——記憶體內，重新匯入 PNG 即清空；「停止／重設」保留。 */
  private actionTracks: RecordedActionTrack[] = [];
  /** 下一條 Track 的流水號，兼作 `id`／`PointerId` 前綴（各條唯一）與預設標籤編號。 */
  private nextTrackNum = 1;

  private rafId = 0;
  private lastFrameMs = 0;

  private constructor(
    root: HTMLElement,
    sim: SimCore,
    renderer: JellyRenderer,
    cameraState: CameraState,
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
    this.dropImportInput = new DropImportInput(root, {
      onImport: this.onDropImport,
      onDragActiveChange: (active) =>
        this.dropHint.classList.toggle(DROP_HINT_ACTIVE_CLASS, active),
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
      onBoundaryChange: (mode) => this.setBoundaryMode(mode),
      onSoftnessChange: (t) => this.setSoftness(t),
      onTapStrengthChange: (strength) => this.setTapStrength(strength),
      onPinModeChange: (enabled) => this.setPinMode(enabled),
      onClearPins: () => this.sim.clearPins(),
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
      onTrackStartTimeChange: (id, seconds) => this.setTrackStartTime(id, seconds),
      onDeleteTrack: (id) => this.deleteTrack(id),
    });
    root.appendChild(this.controlPanel.element);

    this.pinMarkers = new PinMarkers();
    root.appendChild(this.pinMarkers.element);
    this.applyPinModeCursor();
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
      { centroid: sim.centroid(), bbox: sim.bbox() },
      {
        width: root.clientWidth,
        height: root.clientHeight,
      },
    );
    return new JellySandbox(root, sim, renderer, cameraState);
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
    this.dropHint.remove();
    this.importHint.remove();
    this.controlPanel.destroy();
    this.pinMarkers.destroy();
    this.input.destroy();
    this.cameraInput.destroy();
    this.renderer.destroy();
  }

  /** 「鎖定跟隨」開關（issue #14 控制面板接這裡）——關掉自動跟隨，手動仍可動。 */
  setFollowLock(locked: boolean): void {
    this.cameraCommands.push({ type: 'setFollow', enabled: !locked });
  }

  /**
   * 「框住果凍」按鈕（issue #14）——一次性緩動 fit 當前 bbox。純一次性動作，
   * 不碰「鎖定跟隨」狀態（`updateCamera` 的 `frame` 指令不改 `followEnabled`），
   * 按這顆鈕不會讓控制面板的「鎖定跟隨」勾選框跟實際狀態對不上。
   */
  frameJelly(): void {
    this.cameraCommands.push({ type: 'frame' });
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
   * 「開始錄製／停止錄製」切換鈕（issue #29 / issue #33 拆軌）：開始時依目前的
   * 「錄製目標」`this.recordTarget` 起錄；停止時取回 `TrackRecorder.stop()` 拆好
   * 的 `action` 那一份，非空就新增一列 Action Track 到清單（`camera` 那一份本票
   * 先丟棄，留給相機軌的票）。錄製中的事件本身不是在這裡送出的——是
   * `attachInputHandlers` 的兩個既有派送點在錄製旗標開著時順手轉呼叫
   * `trackRecorder.record()`。
   *
   * `ControlPanel` 那邊：`setRecordingActive` 會在錄製中把「▶ 播放全部」與清單
   * 編輯一併鎖住（錄製／播放互斥，issue #33），不用在這裡另外處理。
   */
  private toggleRecording(): void {
    if (this.trackRecorder.isRecording) {
      const { action } = this.trackRecorder.stop();
      this.controlPanel.setRecordingActive(false);
      if (action.length > 0) this.addActionTrack(action);
    } else {
      this.trackRecorder.start(this.recordTarget);
      this.controlPanel.setRecordingActive(true);
    }
  }

  /** 把剛錄好的一段 Action Track 加進清單（預設起始 0 秒），並同步到面板。 */
  private addActionTrack(steps: Track): void {
    const num = this.nextTrackNum++;
    this.actionTracks.push({
      id: `t${num}`,
      label: summarizeActionTrack(num, steps),
      startStep: 0,
      steps,
    });
    this.syncTrackList();
  }

  private setTrackStartTime(id: string, seconds: number): void {
    const track = this.actionTracks.find((t) => t.id === id);
    if (track) track.startStep = secondsToStep(seconds);
  }

  private deleteTrack(id: string): void {
    this.actionTracks = this.actionTracks.filter((t) => t.id !== id);
    this.syncTrackList();
  }

  private syncTrackList(): void {
    this.controlPanel.setTracks(
      this.actionTracks.map((t) => ({
        id: t.id,
        kind: 'action' as const,
        label: t.label,
        startSeconds: stepToSeconds(t.startStep),
      })),
    );
  }

  /**
   * 「▶ 播放全部」按鈕（issue #33）：把所有 Action Track 依各自的 `startStep`
   * 疊加成一條全域時間軸（`mergeTracks` 純函式——平移 `atStep`、每條的
   * `PointerId` 加軌別前綴避免跨軌碰撞、依全域 `atStep` 穩定排序），交給
   * `demoRunner` 精準重播。
   *
   * 播放前先 `sim.reset()`：Track 裡 Grab/Tap/Pin 記的是錄製當下的絕對世界座標，
   * 場景回到 rest 狀態它們才會準確落在果凍上、每次疊加結果才逐格一致（issue #33
   * 決定性驗收條件），不受「播放前場景被怎麼動過」影響。相機沒有 Camera Track
   * 時（本票都還沒有），重設後推一個一次性 `frame` 指令把鏡頭框回果凍靜止狀態，
   * 不停在上一次亂動到的位置（相機軌的票會接手這段）。
   */
  private playAll(): void {
    if (this.actionTracks.length === 0) return;
    this.sim.reset();
    this.cameraCommands.push({ type: 'frame' });
    this.demoRunner.start(
      mergeTracks(
        this.actionTracks.map((t) => ({
          startStep: t.startStep,
          idPrefix: `${t.id}/`,
          steps: t.steps,
        })),
      ),
    );
    this.setPlaybackLocked(true); // 立即鎖住，理由同 runDemo
  }

  /** 集中處理鎖定狀態變化，`frame()` 每幀同步一次時才不會對沒變的按鈕重複寫 `disabled`。 */
  private setPlaybackLocked(locked: boolean): void {
    if (this.playbackLocked === locked) return;
    this.playbackLocked = locked;
    this.controlPanel.setPlaybackControlsEnabled(!locked);
  }

  /**
   * 「停止／重設」（issue #14；issue #15 追加停 Demo）：先停掉排程中的 Demo
   * 事件（否則 `sim.reset()` 後、還沒播完的排程繼續把事件砸進去，看起來像
   * 「重設沒生效」），再重設 Jelly 本身。
   */
  private resetSim(): void {
    this.demoRunner.stop();
    this.setPlaybackLocked(false);
    if (this.trackRecorder.isRecording) {
      // 中斷仍在進行中的錄製；已經錄好、存在 `actionTracks` 清單裡的 Track 不受影響
      // （拓撲沒變，還能疊加播放）——「停止／重設」保留清單，只有重新匯入 PNG 才清空。
      this.trackRecorder.stop();
      this.controlPanel.setRecordingActive(false);
    }
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

  /** Softness 滑桿（issue #14）：0–1 → `cellFrac` + `alphaSm`（見 `../sim/softness`）。 */
  private setSoftness(t: number): void {
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
   * `DropImportInput` 挑到 PNG 位元組後的回呼：`buildSimMesh` → 解碼貼圖 →
   * 換掉整套 `SimCore` + `JellyRenderer`。任何一步失敗（非圖片、壞檔、貼圖
   * 解碼失敗）都在這個共用 try/catch 裡 `console.warn` 後放棄，原本的 Jelly
   * 不受影響（issue #12 驗收條件：「忽略、不崩」）。`importing` 擋掉重疊呼叫。
   */
  private onDropImport = (pngBytes: Uint8Array): void => {
    if (this.importing) return;
    this.importing = true;
    this.importPng(pngBytes)
      .catch((err: unknown) => console.warn('[jelly] PNG 匯入失敗，已略過', err))
      .finally(() => {
        this.importing = false;
      });
  };

  private async importPng(pngBytes: Uint8Array): Promise<void> {
    // 網格解析度退路（issue #16）：上次 substep 降級以來還沒消化過，這次匯入改用
    // 較低的 targetParticleCount（見 REDUCED_TARGET_PARTICLE_COUNT、PerfMonitor）。
    const meshParams = this.perfMonitor.consumeMeshFallbackPending()
      ? { targetParticleCount: REDUCED_TARGET_PARTICLE_COUNT }
      : {};
    const mesh: SimMesh = buildSimMesh(pngBytes, meshParams);
    const texture = await decodeTextureImage(pngBytes);
    await this.replaceJelly(mesh, texture);
  }

  /**
   * 建好新的一套（sim + renderer + camera）成功後才拆舊的——畫面不會有空檔。
   * 新 `SimCore` 一律從 `DEFAULT_SIM_PARAMS` 起家，所以要把控制面板目前設定
   * （Softness、輕拍力道、Boundary 模式）重新套上去，面板才不會顯示跟實際物理
   * 不一致的值（Pin 模式是 `JellySandbox` 層的路由旗標，不受換 `SimCore` 影響，
   * 不用重套）。
   */
  private async replaceJelly(mesh: SimMesh, texture: HTMLImageElement): Promise<void> {
    this.demoRunner.stop(); // 舊 Jelly 的座標對新網格沒意義，換 Jelly 時中斷排程中的 Demo
    this.setPlaybackLocked(false);
    // 同樣理由：錄製中／已錄好的 Track 座標都是對著舊 Jelly 算的，換 Jelly 時一併中斷並清空整份清單（issue #33）。
    if (this.trackRecorder.isRecording) this.trackRecorder.stop();
    this.actionTracks = [];
    this.nextTrackNum = 1;
    this.controlPanel.setRecordingActive(false);
    this.syncTrackList();
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
    this.cameraState = createCameraState(
      { centroid: sim.centroid(), bbox: sim.bbox() },
      this.canvasSize(),
    );
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
      emit: (cmd) => {
        this.cameraCommands.push(cmd);
        this.trackRecorder.record(cmd); // no-op 除非正在錄製（issue #29）
      },
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
   * 常駐的匯入提示（issue #12 追加）——`jelly-drop-hint` 只在拖曳中才顯示，
   * 使用者不會知道「拖 PNG 進來可以匯入」這個功能本身存在。低調小字放在角落，
   * 不擋任何操作、拖曳時會被上面的 `jelly-drop-hint` 蓋住。
   */
  private createImportHint(): HTMLDivElement {
    const hint = document.createElement('div');
    hint.className = 'jelly-import-hint';
    hint.textContent = '拖曳一張帶透明背景的 PNG 到畫面上以匯入';
    return hint;
  }

  private frame = (nowMs: number): void => {
    const elapsedMs = nowMs - this.lastFrameMs;
    const elapsed = elapsedMs / 1000;
    this.lastFrameMs = nowMs;
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
    this.setPlaybackLocked(this.demoRunner.isRunning); // 追上「Demo／Track 自己播完」這種沒有按鈕點擊觸發的狀態變化

    const cmds = this.cameraCommands;
    this.cameraCommands = [];
    this.cameraState = updateCamera(
      this.cameraState,
      { centroid: this.sim.centroid(), bbox: this.sim.bbox() },
      this.canvasSize(),
      cmds,
      clampedElapsed,
    );

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

/**
 * 一段 Action Track 的簡短標籤（issue #33）：`動作軌 N` 後面括號列出這條錄到
 * 哪幾類操作（拖曳／輕拍／Pin），讓使用者在清單上一眼分得出哪條是哪條。
 */
function summarizeActionTrack(num: number, steps: Track): string {
  const kinds = new Set<string>();
  for (const { event } of steps) {
    if (event.type === 'grab' || event.type === 'moveGrab' || event.type === 'release') {
      kinds.add('拖曳');
    } else if (event.type === 'tap') {
      kinds.add('輕拍');
    } else if (event.type === 'pin' || event.type === 'movePin' || event.type === 'unpin') {
      kinds.add('Pin');
    }
  }
  return kinds.size > 0 ? `動作軌 ${num}（${[...kinds].join(' · ')}）` : `動作軌 ${num}`;
}

/** PNG 位元組 → `HTMLImageElement`（Renderer 的貼圖來源）。走 Blob URL，載入完即釋放。 */
function decodeTextureImage(pngBytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
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
