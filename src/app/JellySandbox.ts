/**
 * `JellySandbox`（issue #11 / T10，issue #13 / T12 接入 Camera，issue #12 / T11
 * 接入拖放匯入，issue #14 / T13 接入控制面板；issue #95 / V3 T3-2 改接多塊容器）
 * ——第一個能玩的組裝：`World`（多塊 Jelly 的模擬容器，每塊一個 `SimCore`）+
 * `JellyRenderer`（多網格算繪）+ `PointerInput`（輸入）+ `CameraInput`（相機手動輸入）
 * + 固定步主迴圈。
 *
 * **多塊 Jelly 與 Scene**（issue #95；ADR-0013）：沙盒只對一個 `World` 說話，契約與
 * `SimCore` 同形。每塊由 `spawn` 事件生成——網格由注入 `World` 的 `meshProvider`
 * （`buildSimMesh` + `scaleMeshToLongestEdge`，以參數 key memo，見 `meshFor`）給、
 * 貼圖從沙盒持有的**來源圖庫** `sources`（`src/<N>` → 位元組 + 格式 + 預先解碼的貼圖）
 * 查。啟動時 Scene = 內建預設果凍一塊（`src/1` / `jelly/1`）。**匯入 = 新增**：拖放／
 * 按鈕匯入註冊一張新來源、在相機對準處 `spawn` 一塊（`offset` = 相機中心 − 網格
 * bbox 中心），既有的塊都留著；不再清 Track／群組／片段初始 Pin。不在錄製中做的
 * 匯入／重建之後 `world.setScene(world.sceneSnapshot())` 讓 Scene 跟上；錄製中的匯入
 * 則把 `spawn` 錄進 Action Track（播到那步才出現、重設後消失）。「清空全部」
 * （`clearAll`）是唯一會把 Scene、Track、群組、初始 Pin、圖庫一起清成新片段的入口
 * （空桌面，內建預設果凍重新註冊為來源但不自動放上桌）。算繪端每幀用
 * `World.jellies()` 的 id 序列跟 `JellyRenderer` diff 同步（`syncRenderer`）。
 *
 * **Jelly 工具**（issue #97 / #98 的生成／移除／重建 Jelly；issue #124 合成一個工具＋右鍵
 * 選單，ADR-0016）：手勢判定在 `ToolRouter`／`CameraInput`，只回報世界座標。左鍵點一下
 * （`onJellyClick`）＝生成（`spawnAt`）：以點擊處為中心放下一塊（點在既有 Jelly 上也照樣
 * 生成），圖用最近一次匯入的那張（`sourceForSpawn`）、尺寸與密度用當下兩條拉霸，放不下
 * （超出 Walled 範圍／掉到 Floor 地板下，見 `fitsInBoundary`）就不生成並提示，懸停時先用
 * 禁止游標預告（`applyCanvasCursor`）。右鍵點中某塊（`openJellyMenu`）在游標處開
 * `ContextMenu` [重建｜移除]，作用在點中的那一塊：移除（`removeJelly`）連同它的
 * Pin／Grab，重建（`rebuildJelly`）換那塊的網格，跟「全部重建」按鈕共用 `rebuildJellies`。
 *
 * 生成／移除的 Scene／錄製分工跟匯入一致：不在錄製中就 `setScene(sceneSnapshot())`、
 * 錄製中則只錄事件；重建是例外——它只改 Scene、永遠不錄（ADR-0013），所以錄製中
 * 連同「全部重建」按鈕一起擋掉。
 *
 * 主迴圈用 `FixedStepAccumulator`（+ 250ms clamp）把真實時間切成 60Hz 固定步推進
 * 求解器；每幀再用**真實**幀時距（clamp 到 100ms）呼叫純函式 `updateCamera` 推進
 * 相機（平滑是視覺的、不進物理）。所有影響模擬的輸入都經 `PointerInput` →
 * `world.applyInput`；所有相機手動輸入都經 `CameraInput` → 收集成 `CameraCommand[]`
 * 每幀餵給 `updateCamera`（ADR-0005：兩條輸入流都不繞過各自的窄介面）。
 *
 * picking／算繪都吃 `cameraState.transform`——相機平移／縮放後仍命中正確的表面點。
 *
 * **拖放匯入**：`DropImportInput`（薄的接線層，對照 `PointerInput`/`CameraInput`）
 * 挑出拖放的影像檔（png/jpeg/gif）、讀成位元組後回呼 `importImage` → 解碼貼圖 →
 * 註冊來源 → `spawn`（網格在 `World` 的 `meshProvider` 裡走 `buildSimMesh` →
 * `scaleMeshToLongestEdge`，匯入尺寸拉霸 issue #88、網格密度拉霸 issue #89）。解碼／
 * 建網格失敗（非圖片、不支援格式、壞檔）一律 `console.warn` ＋ 畫面上閃一行
 * `notice` 後放棄，場上原有的塊不受影響。新塊從 `World.params` 起家，控制面板目前
 * 設定（Softness、輕拍力道、重力、Boundary）本來就在那裡，不必重套。「重建」鈕
 * （issue #90；issue #95 起對每一塊）拿各塊自己的來源＋目前兩條拉霸，同 id 同圖同
 * `offset` 地 `remove` + `spawn`，只改 Scene、Track 保留。`importHint`（issue #12 追加）
 * 是常駐在角落的低調小字，提示「可以拖圖片進來」——`dropHint` 只在拖曳中才出現，
 * 沒有這個常駐提示的話使用者無從發現這個功能本身存在。
 *
 * **控制面板**：`ControlPanel`（同樣是薄的 DOM 接線層）建 UI、回呼往外送；實際
 * 換算邏輯都在純函式模組——Softness 曲線見 `../sim/softness`，Walled 邊界範圍見
 * `./boundaryGeometry`；Pin 工具的放／拔（issue #123）由 `ToolRouter` 直接送 `pin`／
 * `unpin`，這裡原樣轉進 `World`。
 *
 * **Pin 的視覺提示**：`PinMarkers`（DOM 覆蓋層）每幀把 `world.listPins()` 的世界
 * 座標投影成螢幕座標畫成小圓點；選著 Pin 工具的拔模式時標記變紅脈動（提示可以點掉）、
 * Pin 工具下畫布游標也換成十字——兩層一起讓「現在是不是在放 Pin」不用低頭看面板就
 * 知道（見 `applyPinToolVisuals`）。「顯示 Pin」關掉時整層藏起來、`frame()` 也跳過投影
 * 計算（見 `setPinsVisible`）；`ControlPanel` 那邊會同時鎖住清除所有 Pin，所見即所得。
 *
 * **播放時隱藏提示**（issue #71 / V2 T3-7）：一個全域開關，開著時只要有 Demo／
 * Track 在播放，所有視覺提示（顯示網格、Pin 標記、風扇範圍／圖示、編隊抓取提示）
 * 一律暫時壓下，播完各自回到使用者原本的開關狀態——那些開關的值全程不被改寫，
 * 「當下實際看不看得到」由 `effectiveHints()` 現算、`applyHintVisibility()` 推給
 * 各層，所以不需要另外記一份還原快照。筆刷圓圈游標不受影響，理由見
 * `applyHintVisibility`。
 *
 * **邊界外框**（issue #9 追加；issue #92 擴成三態）：切到 Walled 邊界時，
 * `WalledBoundary.box`（世界座標常數）同步畫成 `JellyRenderer` 裡的一個外框；切到
 * Floor 時把 `FloorBoundary.floorY` 畫成一條地板線（見 `setBoundaryFrame`），撞牆／
 * 落地時看得到界線在哪，不會覺得「明明沒碰到東西卻被彈回來」。切換當下依所有塊的
 * 聯集 bbox（`World.bbox()`）展開 Walled 範圍／貼齊 Floor；空場時維持上一次的值
 * （`lastBbox`）。
 *
 * **Demo**（issue #15 / T14 追加）：`./demos` 提供純函式腳本（`DEMOS`）+
 * `DemoRunner`（依 sim-step 計數排定事件，見該檔說明）。主迴圈每跑一個固定
 * step 前先呼叫 `demoRunner.advance(...)`，把該 step 排定的 `InputEvent` 一樣
 * 經 `world.applyInput` 送進去——跟即時輸入同一條窄介面，不繞道。Demo 腳本吃
 * 場上**所有塊**串接起來的 Particle 位置（對目前 Scene 執行，spec #87 US52）。
 * 「停止／重設」按鈕（`resetSim`）先停 Demo 排程再 `world.reset()`，避免重設後殘留
 * 事件繼續觸發；匯入圖片也會中斷播放（新塊加進 Scene 的時機要乾淨，見
 * `importImage`）。播放中鎖住所有 Demo 按鈕（`setPlaybackLocked`），
 * 擋掉「疊加播放另一個 Demo」——`DemoRunner.start` 只換排程、不會回頭釋放前一個
 * Demo 已經建立的 Pin/Grab，疊加播放會留下一個沒人記得、永遠釘住的 Pin。
 *
 * **Track 錄製 + 疊加播放**（issue #29 / V2 T1a，issue #33 / V2 T1-1 依 ADR-0007
 * 改為多動作軌，issue #36 / V2 T1-4 加相機軌）：`./track` 提供 `TrackRecorder`
 * ——跟 `DemoRunner` 互補的純類別，依 sim-step 排程「錄」而非「播」事件。攔截點
 * 是 `attachInputHandlers` 裡既有的兩個派送點（`world.applyInput(routed)` 之前、
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
 * 因此在 `demoRunner.start` 之前先 `world.reset()`（場上回到 Scene、每塊回 rest，
 * 絕對世界座標才準確落在果凍上）。相機：整段沒有相機軌時，重設後推一個一次性 `frame`
 * 指令把鏡頭框回果凍靜止狀態；有相機軌時改由每條相機軌自帶的 `setState` 硬切
 * 在它的起始 step 把鏡頭瞬間設回錄製起點——兩種都是離散、決定性的瞬間對齊，
 * 確保「連按播放全部結果逐格一致」（issue #33 / #36 決定性驗收條件）不受播放前
 * 場景／相機被怎麼動過影響。
 *
 * **場景狀態整合**（issue #38 / V2 T1-6；issue #95 改）：「停止／重設」（`resetSim`）、
 * 「清空全部」（`clearAll`）與「載入片段」（`applyClipState`）共用
 * `haltPlaybackAndRecording()` 把場景收束成一致的乾淨狀態；只有後兩者會換掉整份
 * 片段（Track／群組／初始 Pin），匯入圖片不再清任何東西。錄製中與
 * 播放中互斥（`ControlPanel` 依 `setRecordingActive`／`setPlaybackControlsEnabled`
 * 互相鎖住對方的按鈕）。
 *
 * **substep 自動降級 + 網格密度退路**（issue #16 / T15；退路改成壓拉霸見
 * issue #89）：`PerfMonitor`（純狀態機，見該檔）每幀吃「這幀花了幾毫秒」，持續
 * 超標（弱裝置／背景分頁搶資源）就把 `World.params.substeps` 從 4 降到 2，讓每步
 * 花的運算變少、幀率回穩；持續回穩又升回 4。降級當下順便點亮一次性的「網格
 * 退路」旗標——舊 Jelly 拓撲已凍結沒法即時減面，只能讓**下一次**匯入的三角形
 * 變少：`frame()` 讀到旗標就把「網格密度」拉霸砍半（`halveMeshDensity`）、面板
 * 同步、畫面提示一行（`applyMeshDensityFallback`）；使用者之後可以手動拉回去。
 * substep 數經 `world.applyParams` 套到每塊。
 * `frame()` 每幀把目前 substep 數同步到 `ControlPanel.setPerfStatus`，手動用
 * DevTools CPU 節流測試時能直接看到 4→2→4 有沒有真的發生。
 */

import {
  CameraInput,
  type CameraCommand,
  type CameraState,
  type CanvasSize,
  createCameraState,
  screenToWorld,
  updateCamera,
  worldToScreen,
} from '../camera';
import {
  DEFAULT_TOOL,
  type FanParams,
  type GrabMode,
  type ModalToolId,
  type PinMode,
  type ModeValueKey,
  type ToolId,
  type ToolMode,
  DEFAULT_FAN_FALLOFF_EXPONENT,
  DEFAULT_FAN_FREQUENCY,
  DEFAULT_FAN_STRENGTH,
  DEFAULT_FAN_WIDTH,
  DEFAULT_PIN_BRUSH_RADIUS,
  DEFAULT_SPRAY_SPACING,
  DEFAULT_HANDFUL_RADIUS,
  FAN_FALLOFF_RANGE,
  FAN_FREQUENCY_RANGE,
  FAN_STRENGTH_RANGE,
  FAN_WIDTH_RANGE,
  HANDFUL_RADIUS_RANGE,
  PIN_BRUSH_RADIUS_RANGE,
  PointerInput,
} from '../input';
import {
  buildSimMesh,
  DEFAULT_PARAMS,
  imageFormatToMime,
  positionsBbox,
  scaleMeshToLongestEdge,
  sniffImageFormat,
  type BuildSimMeshParams,
  type SimMesh,
} from '../mesh';
import { type BoundaryFrame, JellyRenderer } from '../render';
import {
  type Bbox,
  type BoundaryMode,
  compareJellyIds,
  type FanState,
  FloorBoundary,
  InfiniteBoundary,
  type InputEvent,
  type Point,
  type SceneEntry,
  softnessToParams,
  WalledBoundary,
  World,
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
import { BrushCursor, type BrushVariant } from './BrushCursor';
import { CanvasHover } from './CanvasHover';
import { ContextMenu, jellyMenuItems, type JellyMenuItemId } from './ContextMenu';
import { ControlPanel } from './ControlPanel';
import { CursorLabel, cursorLabelText, type FormationShapeState } from './CursorLabel';
import { canvasToPng, drawDefaultTexture } from './defaultJelly';
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
import { clampFanIconRadiusPx, FanOverlay } from './FanOverlay';
import { FileImportInput } from './FileImportInput';
import { FixedStepAccumulator } from './FixedStepAccumulator';
import { FormationOverlay, type FormationOverlayGroup } from './FormationOverlay';
import { DEFAULT_MESH_DENSITY, halveMeshDensity, MESH_DENSITY_RANGE } from './meshDensity';
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
import {
  BOUNDARY_FRICTION,
  computeFloorY,
  computeWalledBounds,
  fitsInBoundaryFrame,
  placeBboxCentered,
} from './boundaryGeometry';

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
 * 「重力」拉霸的範圍（issue #91 / V3 T2-1；ADR-0012），世界單位／s²。最左 0 =
 * `DEFAULT_SIM_PARAMS.gravity` = 俯視無重力（現況）。上限與全域阻尼一起實測
 * （數據見 `docs/design/simulation-and-mesh.md` 參數表）：阻尼 0.02／substep 不動
 * （改它舊片段重播就變），落體終端速度 ≈ `g / 4.8`，spec 初訂的上限 2000 中段
 * 只有 ~200 單位／秒、512 高的果凍要 4 秒才落到 Walled 箱底——糖漿。上限拉到
 * 10000：中段 5000 約 1 秒落地、終端速度 ≈ 2 倍身高／秒、著地壓扁到 ~0.83；
 * 拉到底壓扁到 ~0.7、靜置下陷 ~6%，仍穩定、1–2 秒內靜止。
 */
const GRAVITY_RANGE = { min: 0, max: 10000, step: 100 };
/**
 * 撒 Pin 間距滑桿的範圍（issue #69），世界座標單位。下限 12 是「撒得很密」的實用
 * 下限——再小只是讓 Pin 疊在同一批 Particle 上，手感沒有變化、求解器卻要多扛
 * 幾十個硬約束。右鍵＋滾輪調得到的拉霸（大把抓取半徑、Pin 筆刷半徑、電風扇四個參數）
 * 的範圍住在 `ToolRouter`（issue #114 / #125：右鍵＋滾輪要夾在同一個範圍內）。
 */
const SPRAY_SPACING_RANGE = { min: 12, max: 120, step: 2 };
/**
 * 「匯入尺寸」拉霸的範圍與預設（issue #88 / V3 T1-1，見 CONTEXT.md「匯入尺寸」），
 * 世界單位 = 未縮放時的 mask 像素。預設 512：一般解析度的圖進場大小跟以前差不多
 * （以前是降採樣後的像素尺寸、最長邊 ≤ 1024），超大圖不會撐滿桌面。下限 128 還
 * 看得見、上限 1024 = 以前的最大值。
 */
const IMPORT_SIZE_RANGE = { min: 128, max: 1024, step: 16 };
const DEFAULT_IMPORT_SIZE = 512;
/** 內建預設果凍在來源圖庫裡的 id（啟動時、「清空全部」後都重新註冊成它）。 */
const DEFAULT_SOURCE_ID = 'src/1';
/**
 * 會被「播放時隱藏提示」（issue #71）蓋到的提示層，每層一個 key——即面板上那六顆
 * 顯示開關（issue #113 加上大把抓取範圍圈 `handfulRange`）。Pin 工具的筆刷
 * 圓圈刻意不在此列，理由見 `JellySandbox.applyHintVisibility`。
 */
type HintKey = 'wireframe' | 'pins' | 'fanRange' | 'fanIcon' | 'formation' | 'handfulRange';
/** 各提示層的顯示狀態：可能是使用者的意圖（`hintIntent`），也可能是算完壓下之後的實際值（`effectiveHints`）。 */
type HintVisibility = Record<HintKey, boolean>;
/** 播放中被壓下時的實際狀態——全域開關沒有逐層覆寫，所以壓下就是全滅。 */
const ALL_HINTS_HIDDEN: Readonly<HintVisibility> = {
  wireframe: false,
  pins: false,
  fanRange: false,
  fanIcon: false,
  formation: false,
  handfulRange: false,
};

/**
 * 這幾層提示是 DOM 覆蓋層，每幀要把世界座標投影成螢幕座標才畫得出來——都看不到
 * 時 `frame()` 連投影都不必算。`wireframe` 不在此列：線框是 `JellyRenderer` 在
 * WebGL 那邊自己畫的，不經 `worldToScreen`。
 */
function needsHintProjection(hints: Readonly<HintVisibility>): boolean {
  return hints.pins || hints.fanRange || hints.fanIcon || hints.formation;
}

/**
 * 來源圖庫的一筆（issue #95）：存檔用的位元組＋格式（= `ClipImage`）加上預先解碼好的
 * 貼圖——`spawn` 全程同步（Track 重播中生成不需要 async，spec #87 US65）。內建預設
 * 果凍的貼圖是 `<canvas>`，匯入的圖是 `<img>`。
 */
interface SourceImage extends ClipImage {
  texture: HTMLImageElement | HTMLCanvasElement;
}

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
  /** 多塊 Jelly 的模擬容器（issue #95）——沙盒唯一的模擬入口，契約與 `SimCore` 同形。 */
  private readonly world: World;
  private readonly renderer: JellyRenderer;
  private readonly input: PointerInput;
  private readonly cameraInput: CameraInput;
  private readonly dropImportInput: DropImportInput;
  /** 「匯入圖片」按鈕與角落提示字點擊 → 原生檔案選擇器 → 與拖放相同的匯入路徑（issue #56）。 */
  private readonly fileImportInput: FileImportInput;
  /** 「載入片段」按鈕 → 原生檔案選擇器挑 `.json` → `onLoadClip`（issue #58）。 */
  private readonly clipFileInput: ClipFileInput;
  private readonly controlPanel: ControlPanel;
  private readonly pinMarkers: PinMarkers;
  /** 電風扇矩形外框提示（issue #66）——比照 `pinMarkers`，每幀由 `frame()` 投影更新。 */
  private readonly fanOverlay: FanOverlay;
  /** 編隊抓取形狀標記提示（issue #68）——同 `fanOverlay` 的模式。 */
  private readonly formationOverlay: FormationOverlay;
  /**
   * Pin 工具的筆刷圓圈游標（issue #69；issue #123 起放／拔兩種模式都顯示）——同樣是純
   * DOM overlay；這裡負責「目前是不是 Pin 工具、哪個模式（顏色）」「半徑換算成幾個螢幕
   * 像素」與每幀餵它 `canvasHover` 的位置。
   */
  private readonly brushCursor: BrushCursor;
  /**
   * 大把抓取的範圍圈（issue #113）——幾何沿用筆刷圓圈（另一顆 `BrushCursor`、自己的
   * 顏色），但它是**提示**：有自己的顯示開關、受「播放時隱藏提示」壓下（見
   * `applyHandfulRangeVisibility`），所以不跟 Pin 工具共用 `brushCursor`。
   */
  private readonly handfulRange: BrushCursor;
  /**
   * 指標在畫布上的懸停位置（issue #79 / V2 T3-8）——`PointerInput` 只追按下之後
   * 的移動，「按下去之前先讓使用者看到這一下會做什麼」的兩個預覽（筆刷圓圈、
   * 編隊形狀）都靠它。見 `CanvasHover` 說明。
   */
  private readonly canvasHover: CanvasHover;
  /**
   * 游標標籤（issue #122）——跟著指標顯示目前模式與滾輪調到的數值。游標回饋、不是提示：
   * 只聽 `showCursorLabel`，不受「播放時隱藏提示」影響（見 `CursorLabel`）。
   */
  private readonly cursorLabel: CursorLabel;
  /** 「顯示游標標籤」開關（issue #122），預設開、不存檔。 */
  private showCursorLabel = true;
  /**
   * Jelly 工具的右鍵選單（issue #124）——右鍵點中某塊 Jelly 在游標處開 [重建｜移除]，
   * 作用在點中的那一塊（見 `openJellyMenu`）。切換工具時關掉。
   */
  private readonly jellyMenu: ContextMenu;
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
  /** 目前的 Boundary 模式——`World` 沒有 getter，存檔／面板同步靠這個。 */
  private boundaryMode: BoundaryMode = 'infinite';
  /**
   * 最近一次非空的聯集 bbox（issue #95）——場上沒有任何塊時 `World.bbox()` 回 `null`，
   * 相機跟隨與 Walled／Floor 幾何改用這一份「維持上一次的值」，鏡頭停在原地、面板照常
   * 可用（spec #87 US8）。
   */
  private lastBbox: Bbox;
  /** 目前邊界的外框幾何（給 `JellyRenderer.setBoundaryFrame` 畫）：`walled` 是 AABB、`floor` 是地板 y、`infinite` 為 `null`。 */
  private boundaryFrame: BoundaryFrame | null = null;
  /**
   * 目前工具（issue #65；issue #122 起是工具列的四個工具，ADR-0016）——`PointerInput` 沒有
   * getter，游標、筆刷、Pin 標記等視覺回饋靠這個判定。
   */
  private activeTool: ToolId = DEFAULT_TOOL;
  /**
   * Jelly 工具生成（issue #97）要放的那塊網格的 rest bbox，key 同 `meshMemo`
   * ——`null` = 這組參數建不出網格。游標的「放不放得下」判定每幀都要算一次，沒有
   * 這層 memo 的話建不出來的那組會每幀重跑整條 mesh 管線（`meshFor` 只快取成功的）。
   * 跟著 `meshMemo` 一起清掉（「清空全部」／載入片段會換掉同名來源的內容）。
   */
  private readonly spawnBboxMemo = new Map<string, Bbox | null>();
  /**
   * 五個提示開關「使用者想不想看」的意圖——`wireframe` 是顯示網格（issue #14，
   * debug 線框）、`pins` 是 Pin 標記（issue #14）、`fanRange`／`fanIcon` 是風扇
   * 矩形範圍與圖示（issue #66；issue #67 事後檢視拆成兩顆，見 `ControlPanel`
   * 的說明）、`formation` 是編隊抓取形狀標記（issue #68）。
   *
   * issue #71 起收成一個 record 而非五個各自為政的欄位：它們永遠成組被讀（見
   * `effectiveHints`），而且新增一層提示時「要改哪幾處」才收斂得住。這裡存的
   * 一律是使用者的意圖，播放中被壓下時完全不動——所以播完各自還原不需要另外
   * 記一份快照。
   */
  private readonly hintIntent: HintVisibility = {
    wireframe: false,
    pins: true,
    fanRange: true,
    fanIcon: true,
    formation: true,
    handfulRange: true,
  };
  /**
   * 電風扇「寬度」／「強度」／「衰減程度」／「頻率」滑桿目前值（issue #67）
   * ——`PointerInput` 沒有 getter，這裡另存一份供：(a) 面板初始值、
   * (b) `updateLiveFan` 組出更新場上目前風扇要用的完整 `setFan` 事件（該事件
   * 是整包覆蓋，缺任何一個欄位都不行）。
   */
  private fanWidth = DEFAULT_FAN_WIDTH;
  private fanStrength = DEFAULT_FAN_STRENGTH;
  private fanFalloffExponent = DEFAULT_FAN_FALLOFF_EXPONENT;
  private fanFrequency = DEFAULT_FAN_FREQUENCY;
  /**
   * 「Pin 筆刷半徑」（issue #123）／「撒 Pin 間距」（issue #69）拉霸目前值——`PointerInput`
   * 沒有 getter，這裡另存一份供：(a) 面板初始值、(b) `frame()` 每幀把半徑換算
   * 成螢幕像素餵給筆刷圓圈游標（`BrushCursor`）。
   */
  private pinBrushRadius = DEFAULT_PIN_BRUSH_RADIUS;
  private spraySpacing = DEFAULT_SPRAY_SPACING;
  /** 「大把抓取半徑」拉霸目前值（issue #113）——用途同 `pinBrushRadius`（範圍圈的大小）。 */
  private handfulRadius = DEFAULT_HANDFUL_RADIUS;
  /**
   * 「播放時隱藏提示」全域開關（issue #71 / V2 T3-7）——開著時，播放中把所有提示
   * 一律壓下（見 `hintsSuppressed`／`applyHintVisibility`）。它跟上面那幾個
   * `*Visible` 旗標是兩層：那些是「使用者想不想看」的意圖、永遠保持使用者設定的
   * 值不被播放改寫，這個只是暫時壓下的理由，播完就自動鬆開、各自回到原本的意圖。
   */
  private hideHintsDuringPlayback = false;
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
   * 已錄好的 Track 清單（issue #33；issue #36 加相機軌）——記憶體內，「清空全部」／載入
   * 片段才換掉；「停止／重設」與匯入圖片都保留（ADR-0013）。陣列順序＝錄製順序＝清單
   * 顯示順序＝相機軌「認先列」的先後（`mergeTracks`）。
   */
  private tracks: RecordedTrack[] = [];
  /** 下一條 Track 的流水號，兼作 `id`／`PointerId` 前綴（各條唯一）與預設標籤編號。 */
  private nextTrackNum = 1;
  /**
   * 片段初始 Pin 快照（issue #39 / ADR-0007 追記）——每個元素是一個 Pin 附著點在
   * **rest 形狀**下的世界座標（`world.restAttachPoint`），獨立於任何 Track。`playAll`
   * 在 `world.reset()` 之後、`demoRunner.start` 之前，把它組成一條合成 `OverlayTrack`
   *（`setupPinsTrack`）排在 `mergeTracks` 輸入最前面，於 step 0 一次還原。生命週期
   * 比照 `tracks`：`停止／重設` 與匯入保留、「清空全部」清空。多塊時還原用帶座標的
   * `pin` 事件，命中哪塊就釘哪塊。
   */
  private setupPins: Point[] = [];
  /**
   * Track 群組清單（issue #43 / V2 T1-8，見 ADR-0008）——`groups[0]` 永遠是預設
   * 群組（`DEFAULT_GROUP_ID`、不可刪、新錄好的 Track 自動加入）。生命週期比照
   * `tracks`：`停止／重設` 與匯入保留、「清空全部」重建成只剩預設群組。
   */
  private groups: TrackGroup[] = [createDefaultGroup()];
  /** 下一個使用者新建群組的流水號（`g1`／`g2`…，兼作預設名稱編號）。 */
  private nextGroupNum = 1;
  /** 目前的「獨奏」狀態（`null` = 沒在獨奏）——狀態轉移見 `track/groups` 的 `toggleSolo`。 */
  private soloState: SoloState | null = null;

  /**
   * 軟硬度滑桿目前值本身（0–1）——`setSoftness` 收到後即轉成 `cellFrac`／`alphaSm`
   * 經 `world.applyParams` 套到每塊，滑桿原始值求解器不留，這裡記著供存檔（issue #57）。
   */
  private softness = DEFAULT_SOFTNESS;
  /**
   * 來源圖庫（issue #95）：`src/<N>` → 位元組＋格式＋預先解碼的貼圖。啟動時只有內建
   * 預設果凍（`DEFAULT_SOURCE_ID`）；每次匯入多一筆。未被任何塊引用的來源存檔時仍
   * 保留；「清空全部」清空後重新註冊預設。
   */
  private readonly sources = new Map<string, SourceImage>();
  /**
   * `meshFor` 的 memo（issue #95）：`sourceId|importSize|meshParams` → `SimMesh`。
   * `World.reset()` 會對 Scene 裡的塊重新呼叫 provider，沒有 memo 的話每次「停止／重設」
   * 都要重跑整條網格管線（幾十到幾百毫秒一塊）。「清空全部」與載入片段時清掉。
   */
  private readonly meshMemo = new Map<string, SimMesh>();
  /**
   * 算繪端目前每塊拿到的 rest 網格（issue #95）——`syncRenderer` 用它偵測「同 id 但
   * 網格換了」（重建 = 同 id `remove` + `spawn`，兩步在同一個同步呼叫裡完成，下一幀
   * 只看 id 集合會以為沒變、沿用舊幾何，`setPositions` 長度對不上）。
   */
  private readonly renderedMeshes = new Map<string, SimMesh>();
  /** 下一塊 Jelly／下一張來源圖的流水號（`jelly/<N>`／`src/<N>`），隨片段保存。 */
  private nextJellyNum = 1;
  private nextSourceNum = 1;
  /**
   * 「匯入尺寸」拉霸目前值（issue #88）——**下一次**匯入（或「重建」，issue #90）的
   * 果凍最長邊有多少世界單位。只是意圖：載入片段不改寫它（那是還原、不是重新
   * 匯入），場上的果凍也不跟著變。
   */
  private importSize = DEFAULT_IMPORT_SIZE;
  /**
   * 「網格密度」拉霸目前值（issue #89）——**下一次**匯入／重建的 `targetParticleCount`。
   * 同 `importSize`：只是意圖，載入片段不改寫、場上的果凍不跟著變。效能退路
   * （`applyMeshDensityFallback`）會直接改它並同步面板。
   */
  private meshDensity = DEFAULT_MESH_DENSITY;
  private rafId = 0;
  private lastFrameMs = 0;

  private constructor(
    root: HTMLElement,
    renderer: JellyRenderer,
    /** 內建預設果凍的貼圖畫布——啟動與「清空全部」時註冊成來源 `src/1`（issue #57 / #95）。 */
    private readonly defaultTexture: HTMLCanvasElement,
  ) {
    this.root = root;
    this.renderer = renderer;
    // `World` 的 `meshProvider` 綁到沙盒的 `meshFor`（來源圖庫 + memo），所以在這裡建。
    // 跨塊碰撞的摩擦係數沿用牆／地板的 app 層常數（issue #96；其餘碰撞參數用求解器預設）。
    this.world = new World(
      (sourceId, meshParams, importSize) => this.meshFor(sourceId, meshParams, importSize),
      {},
      { friction: BOUNDARY_FRICTION },
    );
    this.registerDefaultSource();
    this.spawnJelly(DEFAULT_SOURCE_ID, this.currentMeshParams(), DEFAULT_IMPORT_SIZE, {
      x: 0,
      y: 0,
    });
    this.world.setScene(this.world.sceneSnapshot());
    this.lastBbox = this.world.bbox()!;
    this.cameraState = createCameraState({ bbox: this.lastBbox }, this.canvasSize());

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
        activeTool: this.activeTool,
        toolModes: {
          grab: this.input.modeOf('grab'),
          pin: this.input.modeOf('pin'),
          fan: this.input.modeOf('fan'),
        },
        showCursorLabel: this.showCursorLabel,
        boundary: this.boundaryMode,
        softness: DEFAULT_SOFTNESS,
        tapStrength: this.world.params.tapStrength,
        gravity: this.world.params.gravity,
        showPins: this.hintIntent.pins,
        followLocked: !this.cameraState.followEnabled,
        showWireframe: this.hintIntent.wireframe,
        recordTarget: this.recordTarget,
        showFanRange: this.hintIntent.fanRange,
        showFanIcon: this.hintIntent.fanIcon,
        fanWidth: this.fanWidth,
        fanStrength: this.fanStrength,
        fanFalloffExponent: this.fanFalloffExponent,
        fanFrequency: this.fanFrequency,
        showFormationHint: this.hintIntent.formation,
        pinBrushRadius: this.pinBrushRadius,
        spraySpacing: this.spraySpacing,
        handfulRadius: this.handfulRadius,
        showHandfulRange: this.hintIntent.handfulRange,
        hideHintsDuringPlayback: this.hideHintsDuringPlayback,
        importSize: this.importSize,
        meshDensity: this.meshDensity,
      },
      importSizeRange: IMPORT_SIZE_RANGE,
      meshDensityRange: MESH_DENSITY_RANGE,
      tapStrengthRange: TAP_STRENGTH_RANGE,
      gravityRange: GRAVITY_RANGE,
      fanWidthRange: FAN_WIDTH_RANGE,
      fanStrengthRange: FAN_STRENGTH_RANGE,
      fanFalloffRange: FAN_FALLOFF_RANGE,
      fanFrequencyRange: FAN_FREQUENCY_RANGE,
      pinBrushRadiusRange: PIN_BRUSH_RADIUS_RANGE,
      spraySpacingRange: SPRAY_SPACING_RANGE,
      handfulRadiusRange: HANDFUL_RADIUS_RANGE,
      demos: DEMOS.map((demo) => ({ id: demo.id, label: demo.label })),
      onImportImage: () => this.fileImportInput.open(),
      onSaveClip: () => this.saveClip(),
      onLoadClip: () => this.clipFileInput.open(),
      onToolChange: (tool) => this.setActiveTool(tool),
      onModeChange: (tool, mode) => this.setToolMode(tool, mode),
      onShowCursorLabelChange: (visible) => this.setShowCursorLabel(visible),
      onRemoveFan: () => this.removeFan(),
      onShowFanRangeChange: (visible) => this.setHintVisible('fanRange', visible),
      onShowFanIconChange: (visible) => this.setHintVisible('fanIcon', visible),
      onFanWidthChange: (width) => this.setFanWidth(width),
      onFanStrengthChange: (strength) => this.setFanStrength(strength),
      onFanFalloffChange: (falloffExponent) => this.setFanFalloffExponent(falloffExponent),
      onFanFrequencyChange: (frequency) => this.setFanFrequency(frequency),
      onFormationDefineStart: () => this.beginFormationDefine(),
      onFormationDefineEnd: () => this.input.endFormationDefine(),
      onShowFormationHintChange: (visible) => this.setHintVisible('formation', visible),
      onPinBrushRadiusChange: (radius) => this.setPinBrushRadius(radius),
      onSpraySpacingChange: (spacing) => this.setSpraySpacing(spacing),
      onHandfulRadiusChange: (radius) => this.setHandfulRadius(radius),
      onShowHandfulRangeChange: (visible) => this.setHintVisible('handfulRange', visible),
      onHideHintsDuringPlaybackChange: (enabled) => this.setHideHintsDuringPlayback(enabled),
      onImportSizeChange: (size) => this.setImportSize(size),
      onMeshDensityChange: (density) => this.setMeshDensity(density),
      onRebuildAll: () => this.rebuildAll(),
      onClearAll: () => this.clearAll(),
      onBoundaryChange: (mode) => this.setBoundaryMode(mode),
      onSoftnessChange: (t) => this.setSoftness(t),
      onTapStrengthChange: (strength) => this.setTapStrength(strength),
      onGravityChange: (gravity) => this.setGravity(gravity),
      onClearPins: () => this.clearPins(),
      onShowPinsChange: (visible) => this.setHintVisible('pins', visible),
      onFollowLockChange: (locked) => this.setFollowLock(locked),
      onFrameJelly: () => this.frameJelly(),
      onRunDemo: (id) => this.runDemo(id),
      onReset: () => this.resetSim(),
      onWireframeChange: (visible) => this.setHintVisible('wireframe', visible),
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
    this.fanOverlay = new FanOverlay();
    root.appendChild(this.fanOverlay.element);
    this.formationOverlay = new FormationOverlay();
    root.appendChild(this.formationOverlay.element);
    this.brushCursor = new BrushCursor();
    root.appendChild(this.brushCursor.element);
    this.handfulRange = new BrushCursor();
    this.handfulRange.setVariant('handful');
    root.appendChild(this.handfulRange.element);
    this.canvasHover = new CanvasHover(root, {
      isCanvas: (target) => target === this.renderer.canvas,
    });
    this.cursorLabel = new CursorLabel();
    root.appendChild(this.cursorLabel.element);
    this.jellyMenu = new ContextMenu({ dismissBlockTarget: this.renderer.canvas });
    root.appendChild(this.jellyMenu.element);
    this.applyToolVisuals();

    // 一開始就把群組區畫出來（預設群組永遠存在）——Track 清單仍空，但使用者能先
    // 看到「群組」這個概念、按「＋ 新增群組」（issue #43）。
    this.syncPanelTracks();
  }

  /**
   * 建立空的 `JellyRenderer` 並組裝好（建構子接著建 `World`、把內建預設果凍註冊成來源
   * `src/1`、`spawn` 成 `jelly/1`、拍成 Scene、鏡頭框住它）；呼叫 `start()` 開始跑。
   */
  static async create(root: HTMLElement): Promise<JellySandbox> {
    const renderer = await JellyRenderer.create({
      width: root.clientWidth,
      height: root.clientHeight,
      background: { color: 0x1a1a1a, alpha: 1 },
    });
    root.appendChild(renderer.canvas);
    return new JellySandbox(root, renderer, drawDefaultTexture());
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
    this.canvasHover.destroy(); // 它在 root 上掛了指標監聽（issue #79），一定要解掉
    this.brushCursor.destroy();
    this.handfulRange.destroy();
    this.cursorLabel.destroy();
    this.jellyMenu.destroy(); // 開著時在 window 上掛了監聽
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
   * Demo 按鈕（issue #15）：依 `id` 找到腳本，用「目前」場上所有塊串接的 Particle 位置
   * 算出時間軸交給 `demoRunner`——Demo 對目前 Scene 執行（spec #87 US52）：找角、找
   * 中心都以聯集算，多塊時抓到的是整體最外圍的點。空場沒東西可示範，直接返回。已在
   * 播放中的 Demo（若有）直接被取代。
   */
  private runDemo(id: string): void {
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    const positions = this.allPositions();
    if (positions.length === 0) return;
    this.demoRunner.start(demo.build(positions));
    this.setPlaybackLocked(true); // 立即鎖住，擋掉「趁還沒進下一幀又點另一個 Demo」的疊加播放
  }

  /** 場上所有塊的 Particle 位置串成一條（依 id 順序）——Demo 腳本的輸入。 */
  private allPositions(): Float64Array {
    const views = this.world.jellies();
    let total = 0;
    for (const j of views) total += j.positions.length;
    const out = new Float64Array(total);
    let at = 0;
    for (const j of views) {
      out.set(j.positions, at);
      at += j.positions.length;
    }
    return out;
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
   * Pin（`world.listPins()`，跨所有塊）的**rest 形狀附著座標**（`world.restAttachPoint`）
   * 拍成快照，取代上一份。存 rest 座標而非目前變形座標：`playAll` 會先 `world.reset()`，還原時
   * 這些座標才精準落在原本的表面點，也不隨拍快照當下的變形而偏。`ControlPanel`
   * 那邊錄製中／播放中已把這顆鈕鎖住，這裡不用再擋。
   */
  private snapshotSetupPins(): void {
    this.setupPins = this.world.listPins().flatMap((pin) => {
      // `restAttachPoint` 回傳全新的 `Point`；作用中的 Pin 必有約束，`null` 只是防呆。
      const rest = this.world.restAttachPoint(pin.id);
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
   * 播放前先 `world.reset()`：場上回到 Scene（錄製中生成的消失、移除的回來、每塊回
   * rest）——Track 裡 Grab/Tap/Pin 記的是錄製當下的絕對世界座標，場景回到 rest 狀態
   * 它們才會準確落在果凍上、每次疊加結果才逐格一致（issue #33 決定性驗收條件），
   * 不受「播放前場景被怎麼動過」影響。
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
    this.world.reset();
    const hasCameraTrack = active.some((t) => t.kind === 'camera');
    if (hasCameraTrack) {
      this.cameraState = createCameraState({ bbox: this.currentBbox() }, this.canvasSize());
      this.cameraCommands = [];
    } else {
      this.cameraCommands.push({ type: 'frame' });
    }
    this.demoRunner.start(
      mergeTracks([
        // 片段初始 Pin 合成軌排在最前面（issue #39）：`setup/` 前綴不撞 Action Track
        // 的 `t{n}/`，一串 `atStep: 0` 的 `pin` 事件靠穩定排序落在所有軌的 step-0
        // 事件之前——`world.reset()` 後先在 step 0 還原初始 Pin，再開演。空快照時這條
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
   *
   * 同時是「播放時隱藏提示」（issue #71）的唯一觸發點：開始播放時壓下所有提示、
   * 播完（或按停止／重設）鬆開，各自回到使用者原本的開關狀態——那些開關的值全程
   * 沒被動過，所以「還原」不需要另外記一份快照（見 `applyHintVisibility`）。
   */
  private setPlaybackLocked(locked: boolean): void {
    if (this.playbackLocked === locked) return;
    this.playbackLocked = locked;
    this.controlPanel.setPlaybackControlsEnabled(!locked);
    this.controlPanel.setPlaybackActive(locked);
    this.applyHintVisibility();
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
   * 差別只在呼叫端各自接的下一步：`resetSim` 呼 `world.reset()` 但**保留** Track／
   * 群組清單；`clearAll`／`applyClipState` 連清單一起換掉（ADR-0013 生命週期：
   * `停止／重設` 與匯入保留、「清空全部」／載入片段才換）。
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
   * 「停止／重設」（issue #14；issue #15 追加停 Demo；issue #38 收束播放／錄製；
   * issue #95 回到 Scene）：先 `haltPlaybackAndRecording()`，再 `world.reset()` 讓場上
   * 與 Scene 一致（錄製中生成的塊消失、每塊回 rest 座標、速度歸零、清掉所有 Grab／
   * Pin 與風扇）。Track／群組清單與片段初始 Pin 快照（issue #39）**保留**——只有
   * 「清空全部」／載入片段才換掉。
   */
  private resetSim(): void {
    this.haltPlaybackAndRecording();
    this.world.reset();
  }

  /**
   * 「清空全部」（issue #95 / V3 T3-2；ADR-0013）——唯一會把整份片段清掉的入口：中斷播放
   * ／錄製，Scene 清空、場上所有塊移除（`setScene([])` + `reset()`），Track／群組／片段
   * 初始 Pin／流水號全部歸零，來源圖庫清空後重新註冊內建預設果凍（不自動放上桌：
   * 空桌面）、網格 memo 清掉。相機不動（`lastBbox` 維持，跟隨會停在原地）；拉霸與
   * 邊界模式是使用者的設定，不動。
   */
  private clearAll(): void {
    this.haltPlaybackAndRecording();
    this.world.setScene([]);
    this.world.reset();
    this.tracks = [];
    this.nextTrackNum = 1;
    this.setupPins = [];
    this.groups = [createDefaultGroup()];
    this.nextGroupNum = 1;
    this.soloState = null;
    this.sources.clear();
    this.meshMemo.clear();
    this.spawnBboxMemo.clear();
    this.nextJellyNum = 1;
    this.nextSourceNum = 1;
    this.registerDefaultSource();
    this.syncPanelTracks();
    this.syncRenderer();
  }

  /**
   * Boundary 切換（issue #14；issue #92 加 Floor；issue #95 依聯集）：`walled` 用場上所有
   * 塊的聯集 bbox 算一個正方形邊界範圍、`floor` 把地板貼齊聯集的最低點（都見
   * `./boundaryGeometry`）、`infinite` 換回無邊界；空場時用 `lastBbox`（維持上一次的值）。
   * 記在 `boundaryMode` 供存檔。同時把 `boundaryFrame` 套到 Renderer（issue #9 追加）：
   * 撞牆／落地時畫面上有界線可以對照，不會覺得「明明沒碰到東西卻被彈回來」。
   * Walled／Floor 都帶 app 層常數 `BOUNDARY_FRICTION`（issue #93）。
   */
  private setBoundaryMode(mode: BoundaryMode): void {
    this.boundaryMode = mode;
    const bbox = this.currentBbox();
    if (mode === 'walled') {
      const boundary = new WalledBoundary({
        ...computeWalledBounds(bbox),
        friction: BOUNDARY_FRICTION,
      });
      this.world.setBoundary(boundary);
      this.boundaryFrame = { kind: 'walled', ...boundary.box };
    } else if (mode === 'floor') {
      const boundary = new FloorBoundary({
        floorY: computeFloorY(bbox),
        friction: BOUNDARY_FRICTION,
      });
      this.world.setBoundary(boundary);
      this.boundaryFrame = { kind: 'floor', y: boundary.floorY };
    } else {
      this.world.setBoundary(new InfiniteBoundary());
      this.boundaryFrame = null;
    }
    this.renderer.setBoundaryFrame(this.boundaryFrame);
  }

  /** 場上所有塊的聯集 bbox；空場時退回最近一次非空的值（見 `lastBbox`）。 */
  private currentBbox(): Bbox {
    const bbox = this.world.bbox();
    if (bbox) this.lastBbox = bbox;
    return this.lastBbox;
  }

  /** Softness 滑桿（issue #14）：0–1 → `cellFrac` + `alphaSm`（見 `../sim/softness`），經 `applyParams` 套到每塊。滑桿原始值另記一份供存檔（issue #57）。 */
  private setSoftness(t: number): void {
    this.softness = t;
    this.world.applyParams(softnessToParams(t));
  }

  /** 輕拍力道滑桿（issue #14）——全域，套到每塊。 */
  private setTapStrength(strength: number): void {
    this.world.applyParams({ tapStrength: strength });
  }

  /**
   * 重力拉霸（issue #91 / V3 T2-1；ADR-0012）——經 `applyParams` 套到每塊，拖動立刻
   * 生效；是參數不是狀態，「停止／重設」不動它，之後 `spawn` 的新塊也從 `World.params`
   * 起家、自動吃到。
   */
  private setGravity(gravity: number): void {
    this.world.applyParams({ gravity });
  }

  /**
   * 跟「目前工具＋模式」綁在一起的游標回饋與提示（issue #123 收攏）——「切工具」
   * （`setActiveTool`）與「切模式」（`setToolMode`／`cycleMode`）都呼叫這裡，才不會某一條
   * 路漏改：
   *
   * - 畫布游標：Pin 工具兩種模式都是十字（issue #115）。
   * - Pin 標記「可點掉」的紅色脈動：只在 Pin 工具的拔模式（issue #123）。
   * - 筆刷圓圈：Pin 工具兩種模式都顯示，放＝琥珀、拔＝紅（見 `brushFor`）；不需要另外的
   *   顯示開關，選到就看得到，切走就收起來。
   * - 大把抓取範圍圈：只在抓取工具的大把模式（issue #122）。
   *
   * 都是純粹的回饋，不影響任何判定邏輯（判定在 `ToolRouter`）。
   */
  private applyToolVisuals(): void {
    this.applyCanvasCursor();
    this.pinMarkers.setRemovable(this.isPinMode('remove'));
    const brush = this.brushFor();
    if (brush) this.brushCursor.setVariant(brush.variant);
    this.brushCursor.setActive(brush !== null);
    this.applyHandfulRangeVisibility();
  }

  /**
   * 畫布游標的單一出口（issue #97 收攏）——兩個來源：Pin 工具的十字（issue #14 / #115），
   * 以及 Jelly 工具生成時在放不下的地方顯示的禁止樣式（issue #97 驗收條件）。
   * 前者是狀態、後者跟著指標位置每幀變，所以 `frame()` 每幀呼叫一次；值沒變就
   * 不寫 DOM。兩者互斥：各自只在自己的工具下出現。
   *
   * 比對的是 **DOM 上的實際值**而不是自己記一份快取：PixiJS 的事件系統滑過畫布時
   * 也會寫同一個屬性（沒有互動物件時設成 `'inherit'`），被它蓋掉之後若只信自己的
   * 快取就再也不會補回來——真瀏覽器驗證時抓到的（十字游標其實一直有這個缺口）。
   * 「沒有特別游標」也因此用 `'inherit'`（等同預設，且跟 Pixi 寫的值一致）而不是
   * 空字串，免得兩邊每幀互相覆寫。
   */
  private applyCanvasCursor(): void {
    const cursor =
      this.activeTool === 'pin'
        ? 'crosshair'
        : this.spawnBlockedAtHover()
          ? 'not-allowed'
          : 'inherit';
    const canvas = this.renderer.canvas;
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  /**
   * 「現在按下去會生不出來」嗎（issue #97）——只有選著 Jelly 工具、指標確實在畫布上
   * （`CanvasHover`，見該檔：輸入層在單純懸停時是靜默的）時才判定；放不下的原因
   * 跟 `spawnAt` 完全同一組（播放中、建不出網格、超出邊界），使用者看到禁止游標
   * 就代表按下去真的不會有東西出現。
   */
  private spawnBlockedAtHover(): boolean {
    if (this.activeTool !== 'jelly') return false;
    if (this.playbackLocked) return true;
    const point = this.canvasHover.point;
    if (!point) return false;
    const world = screenToWorld(this.cameraState.transform, this.canvasSize(), point.x, point.y);
    const plan = this.spawnPlan(world);
    return plan === null || !fitsInBoundaryFrame(this.boundaryFrame, plan.bbox);
  }

  /**
   * 工具列切換工具（issue #65；issue #122 起是工具列）——轉發給 `PointerInput.setActiveTool`，
   * 另存一份 `activeTool` 給視覺回饋判定用。切工具會改變游標／標記／圓圈的視覺回饋，所以
   * 要跟著重算。
   */
  private setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
    this.input.setActiveTool(tool);
    this.jellyMenu.close(); // Jelly 右鍵選單在切換工具時關閉（issue #124）
    this.applyToolVisuals();
  }

  /**
   * 某個工具的模式換了（issue #122）——參數卡模式鈕（`onModeChange`）走這裡；中鍵單擊走
   * `cycleMode`。轉給 `ToolRouter`（只影響下一次按下）、同步面板高亮，再重算跟模式有關的
   * 回饋（大把抓取範圍圈、Pin 筆刷圓圈顏色與標記脈動）。游標標籤每幀自己重算，不必在這裡推。
   */
  private setToolMode(tool: ModalToolId, mode: ToolMode): void {
    this.input.setMode(tool, mode);
    this.controlPanel.setToolMode(tool, mode);
    this.applyToolVisuals();
  }

  /**
   * 畫布上中鍵單擊（issue #122；`CameraInput` 判定）：輪替目前工具的模式。沒有模式的工具
   * `cycleMode` 回 `null`，什麼都不做。
   */
  private cycleMode(): void {
    const mode = this.input.cycleMode();
    if (mode === null) return;
    const tool = this.activeTool as ModalToolId;
    this.controlPanel.setToolMode(tool, mode);
    this.applyToolVisuals();
  }

  /** 目前是不是抓取工具的這個模式（issue #122：範圍圈與編隊提示只在各自的模式出現）。 */
  private isGrabMode(mode: GrabMode): boolean {
    return this.activeTool === 'grab' && this.input.modeOf('grab') === mode;
  }

  /** 目前是不是 Pin 工具的這個模式（issue #123：標記脈動只在拔模式、圓圈顏色隨模式）。 */
  private isPinMode(mode: PinMode): boolean {
    return this.activeTool === 'pin' && this.input.modeOf('pin') === mode;
  }

  /**
   * 「開始設定形狀」（issue #68）：設定形狀是編隊模式的事，順手把抓取工具切到編隊模式
   * （issue #122）——不然在單點模式下按了這顆鈕，點在畫布上的會被當成一般的抓取，
   * 形狀提示也不會出現。
   */
  private beginFormationDefine(): void {
    if (!this.isGrabMode('formation')) this.setToolMode('grab', 'formation');
    this.input.beginFormationDefine();
  }

  /** 「顯示游標標籤」開關（issue #122）。 */
  private setShowCursorLabel(visible: boolean): void {
    this.showCursorLabel = visible;
    this.cursorLabel.setEnabled(visible);
  }

  /**
   * 游標標籤（issue #122）：位置取 `canvasHover`、文字由目前工具／模式／數值算出來，
   * 每幀呼叫（`setText`／`setPosition` 值沒變就不寫 DOM）。
   */
  private updateCursorLabel(): void {
    const tool = this.activeTool;
    const mode = this.input.modeOf(tool);
    const shape = this.input.formationShape;
    const formation: FormationShapeState = this.input.isDefiningFormation
      ? 'defining'
      : shape && shape.length > 0
        ? 'ready'
        : 'none';
    this.cursorLabel.setText(
      cursorLabelText({ mode, value: this.input.activeValue?.value ?? null, formation }),
    );
    this.cursorLabel.setPosition(this.canvasHover.point);
  }

  /**
   * 大把抓取範圍圈（issue #113）顯示與否＝抓取工具的大把模式 且 這層提示實際上可見
   * （使用者開著、沒被播放壓下）。「切工具」「切模式」與「提示可見性變了」都呼叫這裡。
   */
  private applyHandfulRangeVisibility(): void {
    this.handfulRange.setActive(this.isGrabMode('handful') && this.effectiveHints().handfulRange);
  }

  /**
   * 目前要不要筆刷圓圈游標、要什麼顏色、半徑多大（issue #69／#70；issue #123 起是 Pin 工具
   * 兩種模式共用一條 Pin 筆刷半徑，只有顏色隨模式：放＝琥珀、拔＝紅，見 `BrushCursor`）
   * ——`null` = 不要。收成一個地方才不會「切工具／切模式」（`applyToolVisuals`）跟「每幀
   * 換算半徑」（`frame`）兩處各判斷一次、日後加別的用得到圓圈的模式時漏改其中一處。
   */
  private brushFor(): { variant: BrushVariant; radius: number } | null {
    if (this.activeTool !== 'pin') return null;
    const variant = this.input.modeOf('pin') === 'place' ? 'spray' : 'erase';
    return { variant, radius: this.pinBrushRadius };
  }

  /** 「匯入尺寸」拉霸（issue #88）——只記下意圖，下一次匯入才套用；場上的果凍不動。 */
  private setImportSize(size: number): void {
    this.importSize = size;
  }

  /** 「網格密度」拉霸（issue #89）——同 `setImportSize`，只記下意圖。 */
  private setMeshDensity(density: number): void {
    this.meshDensity = density;
  }

  /**
   * 效能退路（issue #89，取代 issue #16 的「下一次匯入暗中砍半」）：`PerfMonitor`
   * 降級那一幀被 `frame()` 呼叫。把「網格密度」拉霸砍半（對齊步進、不低於下限）、
   * 面板同步顯示、畫面提示一行——退路變成看得見、也拉得回去的。已在下限時沒東西
   * 可砍，就不改值也不提示（substep 讀出列仍會顯示「已降級」）。
   */
  private applyMeshDensityFallback(): void {
    const reduced = halveMeshDensity(this.meshDensity, MESH_DENSITY_RANGE);
    if (reduced === this.meshDensity) return;
    this.meshDensity = reduced;
    this.controlPanel.setMeshDensity(reduced);
    this.showNotice(`效能不足，已把網格密度降到 ${reduced}；下一次匯入／重建生效`);
  }

  /** 「Pin 筆刷半徑」拉霸（issue #123）——撒 Pin 與橡皮擦的範圍，同時是筆刷圓圈的大小。 */
  private setPinBrushRadius(radius: number): void {
    this.pinBrushRadius = radius;
    this.input.setPinBrushParams({ radius });
  }

  /** 「撒 Pin 間距」拉霸（issue #69）——越小越密，見 `ToolRouter.sprayAt`。 */
  private setSpraySpacing(spacing: number): void {
    this.spraySpacing = spacing;
    this.input.setPinBrushParams({ spacing });
  }

  /** 「大把抓取半徑」拉霸（issue #113）——下一次按下用，同時是範圍圈的大小。 */
  private setHandfulRadius(radius: number): void {
    this.handfulRadius = radius;
    this.input.setHandfulParams({ radius });
  }

  /**
   * 按住右鍵＋滾輪（issue #114，`CameraInput` 呼叫；issue #122 從「調工具半徑」推廣成
   * 「調目前模式的數值」）：目前模式有數值就由 `ToolRouter` 增減並夾在範圍內，新值走跟
   * 拉霸同一條路（`setXRadius`：沙盒狀態＝圓圈大小 + `ToolRouter`；電風扇四個參數走
   * `setFanX`，issue #125：同時即時套用到場上的風扇、錄製中照樣錄進 Track），再灌回面板拉霸。
   * 回傳 `false`（沒有數值，例如單點、編隊模式）時相機照舊縮放。
   */
  private adjustModeValue(steps: number): boolean {
    const adjusted = this.input.adjustActiveValue(steps);
    if (!adjusted) return false;
    const { key, value } = adjusted;
    const setValue: Record<ModeValueKey, (v: number) => void> = {
      pinBrushRadius: (v) => this.setPinBrushRadius(v),
      handfulRadius: (v) => this.setHandfulRadius(v),
      fanWidth: (v) => this.setFanWidth(v),
      fanStrength: (v) => this.setFanStrength(v),
      fanFalloffExponent: (v) => this.setFanFalloffExponent(v),
      fanFrequency: (v) => this.setFanFrequency(v),
    };
    setValue[key](value);
    this.controlPanel.setModeValue(key, value);
    return true;
  }

  /**
   * 「清除所有 Pin」按鈕（issue #14；issue #51 起改走窄介面）——跟指標事件同一條
   * 路：一個無 `id` 的「清除 Pin 事件」`InputEvent` 送進 `world.applyInput`，同時
   * `trackRecorder.record`（no-op 除非正在錄製）。不再直呼 `SimCore.clearPins()`，回到
   * ADR-0005「所有影響模擬的輸入都經 `applyInput`」——這樣錄製中按這顆鈕會落進
   * Action Track，重播到那個 step 清掉畫面上所有 Pin（含片段初始 Pin，刻意跨軌，
   * 見 ADR-0007 追記）。`applyInput` 不會前進錄製 step 計數，兩行順序不影響結果。
   */
  private clearPins(): void {
    this.dispatchInput({ type: 'clearPins' });
  }

  /**
   * 「移除風扇」按鈕（issue #66）——比照 `clearPins`：一個無座標的 `clearFan`
   * 事件經 `world.applyInput` 送進去，同時餵給 `trackRecorder`（錄製中才會真的記
   * 下來），讓錄下的「移除風扇」重播時能在正確的 step 讓風扇消失。
   */
  private removeFan(): void {
    this.dispatchInput({ type: 'clearFan' });
  }

  /** 「風扇寬度」滑桿（issue #67）。 */
  private setFanWidth(width: number): void {
    this.fanWidth = width;
    this.applyFanParamChange({ width });
  }

  /** 「風扇強度」滑桿（issue #67）。 */
  private setFanStrength(strength: number): void {
    this.fanStrength = strength;
    this.applyFanParamChange({ strength });
  }

  /** 「風扇衰減程度」滑桿（issue #67）。 */
  private setFanFalloffExponent(falloffExponent: number): void {
    this.fanFalloffExponent = falloffExponent;
    this.applyFanParamChange({ falloffExponent });
  }

  /** 「風扇頻率」滑桿（issue #67 事後檢視追加——平均每秒陣風次數，見 `SimCore.applyFan`）。 */
  private setFanFrequency(frequency: number): void {
    this.fanFrequency = frequency;
    this.applyFanParamChange({ frequency });
  }

  /**
   * 四個風扇滑桿共用的收尾（issue #67）——`patch` 只帶剛被改的那個欄位，先轉發給
   * `ToolRouter`（下一次放置要用，見 `setFanParams`），再呼叫 `updateLiveFan`
   * 把「目前場上的風扇（若有）」也一併更新。
   */
  private applyFanParamChange(patch: Partial<FanParams>): void {
    this.input.setFanParams(patch);
    this.updateLiveFan();
  }

  /**
   * 「即時反映到目前場上的風扇（若有）」（issue #67）：場上沒有風扇就什麼都不做；
   * 有的話拿它目前的原點／方向／長度，換上最新的寬度／強度／衰減程度／頻率，
   * 整包重送一次 `setFan`（ADR-0010：`setFan` 本來就是整包覆蓋，不用先 `clearFan`）。
   * 比照 `clearPins`／`removeFan`：任何直接呼叫 `world.applyInput` 的分支都同時餵
   * 給 `trackRecorder`（no-op 除非正在錄製）——錄製中途調整滑桿，重播時風扇的
   * 手感才跟錄製當下看到的一致，不會停留在放置那一刻的舊參數。
   */
  private updateLiveFan(): void {
    const fan = this.world.fanState();
    if (!fan) return;
    const event: InputEvent = {
      type: 'setFan',
      originX: fan.originX,
      originY: fan.originY,
      dirX: fan.dirX,
      dirY: fan.dirY,
      length: fan.length,
      width: this.fanWidth,
      strength: this.fanStrength,
      falloffExponent: this.fanFalloffExponent,
      frequency: this.fanFrequency,
    };
    this.dispatchInput(event);
  }

  /**
   * 所有「沙盒自己發的模擬事件」的單一出口（issue #95 收攏）：送進 `world.applyInput`，
   * 同時 `trackRecorder.record`（no-op 除非正在錄製）——ADR-0005「所有影響模擬的輸入
   * 都經 `applyInput`」，錄製中按下的按鈕才會落進 Action Track。指標事件另有
   * `attachInputHandlers` 裡 `PointerInput` 的 `applyInput` 也接到這裡（issue #123 起不再經
   * Pin 工具轉接）。
   */
  private dispatchInput(event: InputEvent): void {
    this.world.applyInput(event);
    this.trackRecorder.record(event);
  }

  /**
   * 面板上任何一個提示顯示開關被切換（「顯示網格」「顯示 Pin」「顯示風扇範圍」
   * 「顯示風扇圖示」「顯示編隊抓取提示」）——五顆共用這一個入口：記下使用者的
   * 意圖，實際看不看得到交給 `applyHintVisibility` 算（播放中可能被壓下）。
   */
  private setHintVisible(key: HintKey, visible: boolean): void {
    this.hintIntent[key] = visible;
    this.applyHintVisibility();
  }

  /**
   * 「播放時隱藏提示」全域開關（issue #71 / V2 T3-7）——只改「要不要在播放中壓下
   * 提示」這個意圖本身，上面那幾個 `*Visible` 旗標一律不動；當下是否真的看得到
   * 交給 `applyHintVisibility` 算。沒在播放時切它，畫面不會有任何變化（`suppressed`
   * 仍是 false），這正是驗收條件「這個開關本身不受播放狀態影響、隨時可切換」。
   */
  private setHideHintsDuringPlayback(enabled: boolean): void {
    this.hideHintsDuringPlayback = enabled;
    this.applyHintVisibility();
  }

  /**
   * 提示現在是不是被播放暫時壓下（issue #71）——開關開著 ＋ 目前有 Demo／Track
   * 在播放。「有東西在播」沿用既有的 `playbackLocked`（`frame()` 每幀用
   * `demoRunner.isRunning` 同步、`playAll`／`runDemo` 按下當幀就先鎖，見
   * `setPlaybackLocked`），不另外開第二個播放狀態旗標——兩個旗標遲早會對不上。
   */
  private get hintsSuppressed(): boolean {
    return this.hideHintsDuringPlayback && this.playbackLocked;
  }

  /**
   * 每層提示「現在實際上該不該顯示」（issue #71）——沒被壓下時就是使用者的意圖
   * 原樣；被壓下時全體隱藏（這個開關是全域的，沒有逐層的覆寫，見 issue #64
   * Out of Scope）。`applyHintVisibility`（推給各層）與 `frame()`（決定要不要花
   * 力氣算每幀的螢幕座標投影）共用這一份，兩邊才不會各判斷一次而分岔。
   */
  private effectiveHints(): Readonly<HintVisibility> {
    return this.hintsSuppressed ? ALL_HINTS_HIDDEN : this.hintIntent;
  }

  /**
   * 把 `effectiveHints()` 推到各個提示層（issue #71）——所有「提示的顯示狀態可能
   * 變了」的路徑都收斂到這一個出口：`setHintVisible`（五顆開關）、
   * `setHideHintsDuringPlayback`、播放開始／結束（`setPlaybackLocked`）、重新
   * 匯入圖片換新 Renderer（`replaceJelly`）。日後多一層提示，要動的是
   * `HintKey`／`hintIntent` 的初始值、這裡一行、以及（若它需要每幀投影）
   * `needsHintProjection`——不必回頭找散在各處的旗標。
   *
   * Pin 工具的筆刷圓圈**不在**這裡：它本來就只在選中那個工具時才出現
   * （見 `applyToolVisuals`），是「現在這個工具的作用範圍在哪」的游標而非場景提示，
   * 播放中不該跟著消失（issue #64 US36）。
   */
  private applyHintVisibility(): void {
    const hints = this.effectiveHints();
    this.renderer.setWireframeVisible(hints.wireframe);
    this.pinMarkers.setVisible(hints.pins);
    this.fanOverlay.setShowRange(hints.fanRange);
    this.fanOverlay.setShowIcon(hints.fanIcon);
    this.formationOverlay.setVisible(hints.formation);
    this.applyHandfulRangeVisibility();
  }

  /**
   * `DropImportInput`／`FileImportInput` 挑到影像位元組後的回呼——交給 `runImport`，
   * 只決定失敗時的提示文案（issue #12 / #55 驗收條件：「提示後略過、不崩」）。
   */
  private onDropImport = (imageBytes: Uint8Array): void => {
    this.runImport(imageBytes, '這張圖片沒辦法變成果凍，已略過');
  };

  /**
   * 「全部重建」按鈕（issue #90 / V3 T1-3；issue #95 起對每一塊，issue #98 改名）：
   * 場上每一塊都重建。跟 Jelly 右鍵選單的「重建」（`rebuildJelly`）只差在餵進去的清單是
   * 全部還是一塊——同一條路徑（`rebuildJellies`），行為因此保證一致。
   */
  private rebuildAll(): void {
    this.rebuildJellies(this.world.sceneSnapshot(), '重建失敗，場上的果凍維持不變');
  }

  /**
   * 重建的唯一實作（issue #90 / #95 / #98，見 CONTEXT.md「重建」）：對 `entries` 裡的
   * 每一塊，用它自己的來源圖＋目前兩條拉霸，同 id 同圖同 `offset` 地 `remove` + `spawn`
   * （新 `meshParams`／`importSize`），之後 `setScene(sceneSnapshot())`——只改 Scene、
   * 不是 Track 事件（所以走 `world.applyInput` 而不是 `dispatchInput`：這件事不該被錄），
   * Track／群組／片段初始 Pin 都保留（B 包的「換網格清空」在 ADR-0013 已廢止）。
   *
   * 先把每塊的新網格都建好（`meshFor`，任何一塊失敗就整批放棄、場上不動＋提示），
   * 確定都成功才動場上的塊：不會重建到一半留下缺塊。失敗文案由呼叫端給（單塊與
   * 全場講法不同），跟 `runImport` 同一個手法。兩個入口（「全部重建」按鈕、
   * Jelly 右鍵選單的「重建」）在錄製中／播放中分別已被面板與 `runJellyMenuItem` 擋掉，
   * 這裡不再重複判定。
   */
  private rebuildJellies(entries: readonly SceneEntry[], failureNotice: string): void {
    // 匯入／載入片段進行中就讓開（跟 `runImport` 互斥）。會提示而不是無聲放棄：
    // 選單項目不會因為匯入中變灰，靜靜沒反應會被當成壞掉（issue #98 檢視回饋）。
    if (this.importing) {
      this.showNotice('正在匯入圖片，請稍候再重建');
      return;
    }
    const meshParams = this.currentMeshParams();
    const importSize = this.importSize;
    try {
      for (const e of entries) this.meshFor(e.sourceId, meshParams, importSize);
    } catch (err: unknown) {
      console.warn('[jelly] 重建失敗，已略過', err);
      this.showNotice(failureNotice);
      return;
    }
    for (const e of entries) {
      this.world.applyInput({ type: 'remove', jellyId: e.jellyId });
      this.world.applyInput({ type: 'spawn', ...e, meshParams, importSize });
    }
    this.world.setScene(this.world.sceneSnapshot());
  }

  /**
   * 「下一次」匯入／重建／生成要餵給 `buildSimMesh` 的**解析後完整**參數（issue #57 /
   * #89）：拉霸值就是 `targetParticleCount`，其他網格參數維持預設。效能退路不在這裡
   * ——它在 `frame()` 直接壓拉霸（`applyMeshDensityFallback`），這裡讀到的已是壓過的值。
   */
  private currentMeshParams(): BuildSimMeshParams {
    return { ...DEFAULT_PARAMS, targetParticleCount: this.meshDensity };
  }

  /**
   * 拖放／按鈕匯入的外殼：`importing` 擋掉重疊呼叫（含跟載入片段互斥），`importImage`
   * 任何一步丟錯都 `console.warn` ＋ 閃一行 `notice` 後放棄，場上的塊不受影響。
   */
  private runImport(imageBytes: Uint8Array, failureNotice: string): void {
    if (this.importing) return;
    this.importing = true;
    this.importImage(imageBytes)
      .catch((err: unknown) => {
        console.warn('[jelly] 影像匯入失敗，已略過', err);
        this.showNotice(failureNotice);
      })
      .finally(() => {
        this.importing = false;
      });
  }

  /**
   * 匯入 = 在畫面中央**新增**一塊（issue #95；ADR-0013）：貼圖先解碼（之後的 `spawn`
   * 全程同步）、網格先建好（`meshFor`，失敗就在這裡丟、不註冊來源、場上不動），才
   * 註冊來源 `src/<N>`、`spawn` 成 `jelly/<N>`。`offset` = 相機目前對準的世界座標
   * （`transform.x/y` = 畫布中心的世界點）− 網格 bbox 中心，新塊一定落在畫面中央。
   * 匯入尺寸／密度拉霸的值在 `await` 之前抄下來，使用者在解碼期間再拉也不會讓「實際
   * 套用的值」跟存檔對不上。
   *
   * 播放中匯入先停掉播放（比照舊的換網格行為）：Scene 快照要拍的是使用者擺的佈景，
   * 不該把 Track 正在播、播完就會消失的塊收進去。錄製中匯入**不**中斷錄製——`spawn`
   * 經 `dispatchInput` 錄進 Action Track（播到那步才出現、重設後消失），Scene 不動。
   */
  private async importImage(imageBytes: Uint8Array): Promise<void> {
    const meshParams = this.currentMeshParams();
    const importSize = this.importSize;
    const format = sniffImageFormat(imageBytes);
    const texture = await decodeTextureImage(imageBytes);
    if (this.demoRunner.isRunning) {
      this.demoRunner.stop();
      this.setPlaybackLocked(false);
    }
    const sourceId = `src/${this.nextSourceNum}`;
    // 網格先建（`meshFor` 要從圖庫查位元組，所以先暫時登記）；建不出來就撤掉登記、
    // 丟到 runImport 的 catch——流水號不前進、來源不會被半註冊。
    this.sources.set(sourceId, { format, bytes: imageBytes, texture });
    let mesh: SimMesh;
    try {
      mesh = this.meshFor(sourceId, meshParams, importSize);
    } catch (err) {
      this.sources.delete(sourceId);
      throw err;
    }
    this.nextSourceNum++;
    const camera = this.cameraState.transform;
    const { offset } = placeBboxCentered(positionsBbox(mesh.positions), {
      x: camera.x,
      y: camera.y,
    });
    this.spawnJelly(sourceId, meshParams, importSize, offset);
    this.commitSceneUnlessRecording();
  }

  /**
   * 生成一塊（issue #95）：配一個新的 `jelly/<N>`、組 `spawn` 事件經 `dispatchInput`
   * 送進 `World`（錄製中會被錄下）。呼叫端決定要不要接著 `setScene`。回傳新塊的 id。
   */
  private spawnJelly(
    sourceId: string,
    meshParams: BuildSimMeshParams,
    importSize: number | null,
    offset: Point,
  ): string {
    const jellyId = `jelly/${this.nextJellyNum++}`;
    this.dispatchInput({ type: 'spawn', jellyId, sourceId, meshParams, importSize, offset });
    return jellyId;
  }

  /**
   * Jelly 工具左鍵點一下（`ToolRouter` 的 `onJellyClick`，issue #97 / #124）＝生成。播放中
   * 不作用：Scene 快照不該把 Track 正在播、播完就消失的塊收進去（同 `importImage` 先停
   * 播放的理由）；懸停時已經先用禁止游標預告（`spawnBlockedAtHover`）。
   */
  private onJellyClick(world: Point): void {
    if (this.playbackLocked) {
      this.showNotice('播放中不能生成果凍——先按「停止／重設」');
      return;
    }
    this.spawnAt(world);
  }

  /**
   * Jelly 工具右鍵單擊點中某塊 Jelly（`ToolRouter` 的 `onJellyContextMenu`，issue #124）：
   * 在游標處開 [重建｜移除]，作用在**點中的那一塊**（id 在開選單當下就定下，之後場上
   * 怎麼變都不會換成別塊）。暫時不能用的項目變灰附原因（`jellyMenuItems`：播放中兩項都
   * 不行、錄製中不能重建）；選了之後再照同一組規則擋一次（`runJellyMenuItem`），因為選單
   * 開著的期間播放／錄製狀態可能已經變了。右鍵點空白處 `ToolRouter` 就不會叫到這裡。
   */
  private openJellyMenu(world: Point, screen: Point): void {
    const hit = this.world.pick(world.x, world.y);
    if (!hit) return;
    const items = jellyMenuItems({
      playing: this.playbackLocked,
      recording: this.trackRecorder.isRecording,
    });
    this.jellyMenu.open(screen, items, (item) => this.runJellyMenuItem(item, hit.jellyId));
  }

  /** 選單項目的分派口（issue #124），守衛同 `jellyMenuItems` 的鎖法。 */
  private runJellyMenuItem(item: JellyMenuItemId, jellyId: string): void {
    if (this.playbackLocked) {
      this.showNotice('播放中不能重建或移除果凍——先按「停止／重設」');
      return;
    }
    if (item === 'rebuild') {
      if (this.trackRecorder.isRecording) {
        this.showNotice('錄製中不能重建——重建換的是佈景的網格，不是可以錄的事件');
        return;
      }
      this.rebuildJelly(jellyId);
    } else {
      this.removeJelly(jellyId);
    }
  }

  /**
   * 剛剛那個動作要不要變成佈景的一部分（issue #97 收攏匯入／生成／移除三處；
   * ADR-0013）：不在錄製中 → 拍成新的 Scene（`停止／重設` 後還在）；錄製中 → 不動
   * Scene，那筆事件已經由 `dispatchInput` 錄進 Action Track（播到那步才發生、重設
   * 後不存在）。
   */
  private commitSceneUnlessRecording(): void {
    if (!this.trackRecorder.isRecording) this.world.setScene(this.world.sceneSnapshot());
  }

  /**
   * Jelly 工具左鍵點一下畫布＝生成（issue #97 / V3 T3-4；ADR-0013）：以點擊處為中心
   * 放下一塊——圖 = 最近一次匯入的那張（見 `sourceForSpawn`），尺寸與密度 = 當下
   * 兩條拉霸（跟匯入走同一組「下一次」的意圖）。放不下（超出 Walled 範圍／掉到
   * Floor 地板下）就整個不生成並提示，判定與懸停時的禁止游標同一條路徑
   * （`fitsInBoundary`）。生成在既有塊上面是允許的——有碰撞（issue #96）會把它們
   * 推開，那正是這個工具好玩的地方。
   *
   * Scene 與錄製的分工（ADR-0013，同 `importImage`）：不在錄製中 → 生成後
   * `setScene(sceneSnapshot())`，這塊成為佈景的一部分、`停止／重設` 後還在；
   * 錄製中 → 只走 `dispatchInput`，`spawn` 錄進 Action Track（播到那步才出現、
   * 重設後消失），Scene 不動。播放中不生成（`onJellyClick` 擋、懸停顯示禁止游標）：
   * Scene 快照不該把 Track 正在播、播完就消失的塊收進去。
   */
  private spawnAt(world: Point): void {
    const plan = this.spawnPlan(world);
    if (!plan) {
      this.showNotice('生成失敗，這張來源圖建不出果凍');
      return;
    }
    if (!fitsInBoundaryFrame(this.boundaryFrame, plan.bbox)) {
      this.showNotice('這裡放不下——超出桌面範圍了');
      return;
    }
    this.spawnJelly(plan.sourceId, plan.meshParams, plan.importSize, plan.offset);
    this.commitSceneUnlessRecording();
  }

  /**
   * 右鍵選單的「移除」（issue #97 的移除 Jelly，issue #124 搬進選單）：移除開選單時點中的
   * 那一塊（`World.pick`，後生成的在上面先命中），連同附在它上面的 Pin／Grab 一起消失
   * （`World.remove` 連那塊的 `SimCore` 整個丟掉、路由表也清乾淨）。選單開著的期間那塊
   * 已經不在了（例如播放中的事件移除了它）就什麼都不做。Scene／錄製的分工同 `spawnAt`：
   * 錄製中照樣經 `dispatchInput` 錄成 `remove` 事件。
   */
  private removeJelly(jellyId: string): void {
    if (!this.world.jellies().some((j) => j.id === jellyId)) return;
    this.dispatchInput({ type: 'remove', jellyId });
    this.commitSceneUnlessRecording();
  }

  /**
   * 右鍵選單的「重建」（issue #98 的重建 Jelly，issue #124 搬進選單）：重建開選單時點中的
   * 那一塊。那塊在 `sceneSnapshot()` 裡一定找得到——它就是「場上每塊當初 spawn 的參數」——
   * 找不到（內部狀態對不上、或選單開著時那塊已經不在）就當沒點到。實際重建交給
   * `rebuildJellies`，跟「全部重建」按鈕同一條路徑，只差清單長度。
   */
  private rebuildJelly(jellyId: string): void {
    const entry = this.world.sceneSnapshot().find((e) => e.jellyId === jellyId);
    if (!entry) return;
    this.rebuildJellies([entry], '重建失敗，這塊果凍維持不變');
  }

  /**
   * 「在 `world` 生成一塊的話，會是什麼樣子」（issue #97）——`spawnAt` 與懸停游標
   * 共用。`offset` = 點擊世界座標 − 網格 bbox 中心（＝放下後 bbox 的中心落在點擊
   * 處，同 `importImage` 的「對準相機中心」算法），`bbox` 是套上 `offset` 之後的
   * 世界座標 bbox，邊界判定吃它。網格建不出來（來源不存在、壞參數）回 `null`。
   */
  private spawnPlan(world: Point): {
    sourceId: string;
    meshParams: BuildSimMeshParams;
    importSize: number;
    offset: Point;
    bbox: Bbox;
  } | null {
    const meshParams = this.currentMeshParams();
    const importSize = this.importSize;
    const sourceId = this.sourceForSpawn();
    const rest = this.spawnMeshBbox(sourceId, meshParams, importSize);
    if (!rest) return null;
    return { sourceId, meshParams, importSize, ...placeBboxCentered(rest, world) };
  }

  /** 這組生成參數的 rest 網格 bbox（issue #97）；建不出來記 `null`，見 `spawnBboxMemo`。 */
  private spawnMeshBbox(
    sourceId: string,
    meshParams: BuildSimMeshParams,
    importSize: number,
  ): Bbox | null {
    const key = meshKey(sourceId, meshParams, importSize);
    const cached = this.spawnBboxMemo.get(key);
    if (cached !== undefined) return cached;
    let bbox: Bbox | null = null;
    try {
      bbox = positionsBbox(this.meshFor(sourceId, meshParams, importSize).positions);
    } catch (err: unknown) {
      console.warn('[jelly] 生成用的網格建不出來，已略過', err);
    }
    this.spawnBboxMemo.set(key, bbox);
    return bbox;
  }

  /**
   * 生成要用哪張圖（issue #97；ADR-0010 精神：不另外給選圖 UI）——最近一次匯入的
   * 那張，也就是流水號最大的 `sourceId`（`compareJellyIds` 同一套「前綴 + 數字」
   * 比法，`src/2` < `src/10`）。圖庫空的（載入了一份沒有任何來源的片段）就把內建
   * 預設果凍重新註冊進去，讓這個工具永遠有東西可放。
   */
  private sourceForSpawn(): string {
    let latest: string | null = null;
    for (const id of this.sources.keys()) {
      if (latest === null || compareJellyIds(latest, id) < 0) latest = id;
    }
    if (latest !== null) return latest;
    this.registerDefaultSource();
    return DEFAULT_SOURCE_ID;
  }

  /**
   * `World` 的 `meshProvider`（issue #95）：來源圖庫查位元組 → `buildSimMesh`（決定性，
   * ADR-0005）→ 匯入尺寸縮放（`scaleMeshToLongestEdge`，`null` = 不縮放、舊片段遷移的塊）。
   * 以參數 key memo：`reset()`／重建／載入片段對同一組參數不會重跑整條管線。來源不存在
   * 時丟錯（載入片段在 `parseClipFile` 就擋掉了引用不存在的來源，這裡是最後防線）。
   */
  private meshFor(
    sourceId: string,
    meshParams: BuildSimMeshParams,
    importSize: number | null,
  ): SimMesh {
    const key = meshKey(sourceId, meshParams, importSize);
    const cached = this.meshMemo.get(key);
    if (cached) return cached;
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`來源圖「${sourceId}」不存在`);
    const mesh = buildScaledMesh(source.bytes, meshParams, importSize);
    this.meshMemo.set(key, mesh);
    return mesh;
  }

  /** 把內建預設果凍註冊成來源 `src/1`（啟動與「清空全部」）；流水號跳到 2。 */
  private registerDefaultSource(): void {
    this.sources.set(DEFAULT_SOURCE_ID, {
      format: 'png',
      bytes: canvasToPng(this.defaultTexture),
      texture: this.defaultTexture,
    });
    this.nextSourceNum = 2;
  }

  /**
   * 每幀把算繪端的塊集合同步成 `World.jellies()`（issue #95）：新塊（或同 id 但網格換了
   * 的塊，見 `renderedMeshes`）`addJelly`（貼圖從來源圖庫查）、消失的 `removeJelly`、
   * 順序依 id（後生成在上）。id 序列沒變時跳過重排；位置上傳在 `frame()` 另外做。
   */
  private syncRenderer(): void {
    const views = this.world.jellies();
    const live = new Set<string>();
    for (const j of views) {
      live.add(j.id);
      if (this.renderedMeshes.get(j.id) === j.mesh) continue;
      const source = this.sources.get(j.sourceId);
      if (!source) throw new Error(`來源圖「${j.sourceId}」不存在`);
      this.renderer.removeJelly(j.id); // 同 id 換網格時先拆舊的；不存在時 no-op
      this.renderer.addJelly(j.id, j.mesh, j.positions, source.texture);
      this.renderedMeshes.set(j.id, j.mesh);
    }
    for (const id of this.renderer.jellyIds()) {
      if (live.has(id)) continue;
      this.renderer.removeJelly(id);
      this.renderedMeshes.delete(id);
    }
    const order = views.map((j) => j.id);
    const current = this.renderer.jellyIds();
    if (order.some((id, i) => id !== current[i])) this.renderer.setJellyOrder(order);
  }

  /**
   * 「儲存片段」按鈕（issue #57 / V2 T2-4）——把目前整個片段序列化成一個帶時間戳
   * 的 `.json` 下載（`jelly-sandbox-<YYYYMMDD-HHMMSS>.json`，多版本不互相覆蓋）。
   * 任何時候都可用（空桌面也能存：Scene 為空、來源只有內建預設）。
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
   * 蒐集目前記憶體狀態成 `ClipState`（issue #57；issue #95 升 v2）——來源圖庫攤成
   * `sources`（每張只存一份，貼圖不進檔）、Scene 直接取 `world.sceneSnapshot()`、
   * `RecordedTrack` 攤成 `ClipTrack`（`groupIds` 的 `Set` → 陣列、`customLabel ?? label` →
   * `name`）、`setupPins` 拷成純 `{ x, y }`、`sim` 帶滑桿原始值、四個流水號。
   */
  private buildClipState(): ClipState {
    const sources: Record<string, ClipImage> = {};
    for (const [id, source] of this.sources) {
      sources[id] = { format: source.format, bytes: source.bytes };
    }
    return {
      sources,
      scene: this.world.sceneSnapshot(),
      sim: {
        softness: this.softness,
        tapStrength: this.world.params.tapStrength,
        boundary: this.boundaryMode,
        gravity: this.world.params.gravity,
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
      counters: {
        nextTrackNum: this.nextTrackNum,
        nextGroupNum: this.nextGroupNum,
        nextJellyNum: this.nextJellyNum,
        nextSourceNum: this.nextSourceNum,
      },
    };
  }

  /**
   * `ClipFileInput` 選到 `.json` 檔讀出文字後的回呼（issue #58）：`parseClipFile`
   * 解析／驗證失敗（非 JSON／版本不符／欄位缺或型別錯）就在這裡接住、顯示提示、
   * 目前場景**完全不動**（不進 `applyClipState`，不觸碰任何既有狀態）。解析成功
   * 才交給 `applyClipState` 走場景整包取代；`importing` 擋掉跟拖放／按鈕匯入圖片
   * 重疊的呼叫。
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
   * 「載入片段」整包取代場景（issue #58；issue #95 升 v2）：先把所有來源圖的貼圖解碼、
   * Scene 每塊的網格用存檔的完整 mesh 參數＋匯入尺寸決定性重算（不套目前的拉霸——
   * 存檔當下已經是實際生效的值，不該被目前拉霸或裝置的降級狀態動）——這些都在
   * 觸碰任何狀態**之前**做完，任何一步丟錯（壞影像位元組、mesh 建置失敗）都讓呼叫端
   * `onLoadClip` 的 catch 接住、場上完全不動。都成功了才：中斷播放／錄製、換掉來源
   * 圖庫與 memo、`setScene` + `reset()` 把場上換成片段的 Scene、鏡頭框住聯集（即「剛匯入」
   * 的鏡位，不保存存檔時的手動平移／縮放）、其餘欄位灌回：軟硬度／輕拍力道／重力／
   * 邊界模式（同時同步面板顯示）、所有 Track（`hydrateClipTrack`）、所有群組、片段初始
   * Pin、流水號。拉霸 `importSize`／`meshDensity` 刻意不動：它們代表「下一次」。
   * 「最近匯入的圖」= 最大的 `sourceId`，由 `sources` 本身決定，不另外記。
   */
  private async applyClipState(clip: ClipState): Promise<void> {
    const decoded = new Map<string, SourceImage>();
    for (const [id, image] of Object.entries(clip.sources)) {
      decoded.set(id, { ...image, texture: await decodeTextureImage(image.bytes) });
    }
    // 網格先建好放在暫時的 memo，確定每塊都建得出來才動狀態（同 `meshFor` 的 key 與建法）。
    const memo = new Map<string, SimMesh>();
    for (const e of clip.scene) {
      const key = meshKey(e.sourceId, e.meshParams, e.importSize);
      if (memo.has(key)) continue;
      memo.set(key, buildScaledMesh(decoded.get(e.sourceId)!.bytes, e.meshParams, e.importSize));
    }

    this.haltPlaybackAndRecording();
    this.sources.clear();
    for (const [id, source] of decoded) this.sources.set(id, source);
    this.meshMemo.clear();
    this.spawnBboxMemo.clear();
    for (const [key, mesh] of memo) this.meshMemo.set(key, mesh);
    this.world.setScene(clip.scene);
    this.world.reset();
    this.syncRenderer();
    this.cameraState = createCameraState({ bbox: this.currentBbox() }, this.canvasSize());
    this.cameraCommands = [];

    this.setSoftness(clip.sim.softness);
    this.controlPanel.setSoftness(clip.sim.softness);
    this.setTapStrength(clip.sim.tapStrength);
    this.controlPanel.setTapStrength(clip.sim.tapStrength);
    this.setGravity(clip.sim.gravity);
    this.controlPanel.setGravity(clip.sim.gravity);
    this.setBoundaryMode(clip.sim.boundary);
    this.controlPanel.setBoundary(clip.sim.boundary);

    this.groups = clip.groups.map((g) => ({ ...g }));
    this.tracks = clip.tracks.map(hydrateClipTrack);
    this.nextTrackNum = clip.counters.nextTrackNum;
    this.nextGroupNum = clip.counters.nextGroupNum;
    this.nextJellyNum = clip.counters.nextJellyNum;
    this.nextSourceNum = clip.counters.nextSourceNum;
    this.soloState = null;
    this.setupPins = clip.setupPins.map((p) => ({ x: p.x, y: p.y }));
    this.syncPanelTracks();
  }

  /** `PointerInput` + `CameraInput` 都吃同一組 project／hitTest（picking 走 `World.pick`，跨所有塊）。 */
  private attachInputHandlers(canvas: HTMLCanvasElement): {
    input: PointerInput;
    cameraInput: CameraInput;
  } {
    const project = (sx: number, sy: number) =>
      screenToWorld(this.cameraState.transform, this.canvasSize(), sx, sy);
    const hitTest = (world: { x: number; y: number }) => this.world.pick(world.x, world.y) != null;

    const input = new PointerInput(canvas, {
      screenToWorld: project,
      hitTest,
      getFan: () => this.world.fanState(),
      // 撒 Pin 的間距判定要跟場上既有的 Pin 也比一次（issue #69），不然在撒過的
      // 地方再撒一次會疊成一坨；拔模式（issue #123）從這份清單挑要拔的。
      listPins: () => this.world.listPins(),
      // Jelly 工具（issue #97 / #124）只回報「在這裡點了一下／右鍵點了一下」，該放哪張圖、
      // 選單作用在哪一塊由沙盒自己決定（見 `spawnAt`／`openJellyMenu`）。
      onJellyClick: (world) => this.onJellyClick(world),
      onJellyContextMenu: (world, screen) => this.openJellyMenu(world, screen),
      // 進 World + no-op 除非正在錄製（issue #29）。Pin 工具直接送 pin／unpin（issue #123），
      // 不再經 `routeForPinTool` 轉換。
      applyInput: (event) => this.dispatchInput(event),
    });
    const cameraInput = new CameraInput(canvas, {
      screenToWorld: project,
      hitTest,
      emit: (cmd) => this.emitCamera(cmd), // 進佇列 + no-op 除非正在錄製（issue #29 / #36）
      adjustModeValue: (steps) => this.adjustModeValue(steps),
      onMiddleClick: () => this.cycleMode(), // 中鍵單擊輪替模式（issue #122）
      // 右鍵單擊交給目前工具（issue #124 / #125）：Jelly 開選單、電風扇點在風扇上＝移除。
      onRightClick: (world, sx, sy) => input.rightClick(world, sx, sy),
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

    // 筆刷圓圈是**游標**不是提示（issue #69／#79）：它代替滑鼠指標本身，永遠
    // 不該落後指標，所以排在暫停守衛之前——暫停中果凍定格，但滑鼠還是會動。
    // 提示層（含編隊形狀預覽）則跟著暫停一起定格，見下方那一區。
    this.updateBrushCursor();
    // 游標標籤（issue #122）同理：游標回饋，跟著指標、不跟著暫停定格。
    this.updateCursorLabel();
    // 「生成 Jelly」的禁止游標跟著指標位置與邊界每幀重算（issue #97），理由同上：
    // 游標不該落後指標，所以一樣排在暫停守衛之前。
    this.applyCanvasCursor();

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
    if (this.world.params.substeps !== this.perfMonitor.substeps) {
      this.world.applyParams({ substeps: this.perfMonitor.substeps });
    }
    this.controlPanel.setPerfStatus(this.perfMonitor.substeps, this.perfMonitor.degraded);
    // 降級發生的那一幀把「網格密度」拉霸砍半（issue #89）——旗標一次性，不會每幀重砍。
    if (this.perfMonitor.consumeMeshFallbackPending()) this.applyMeshDensityFallback();

    const steps = this.accumulator.advance(elapsed);
    for (let i = 0; i < steps; i++) {
      this.demoRunner.advance(
        (event) => this.world.applyInput(event),
        (cmd) => this.cameraCommands.push(cmd),
      );
      this.world.step(STEP_SECONDS);
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
    // 相機跟隨吃所有塊的聯集 bbox（issue #95）。空場（`World.bbox()` 為 `null`）時鏡頭
    // 不動：沒有手動指令就整個跳過 `updateCamera`（連閒置回歸的計時都不前進，不會飄回
    // 舊 bbox）；有手動平移／縮放／框住時才跑一次，目標用上一次的 bbox。
    const bbox = this.world.bbox();
    if (bbox) this.lastBbox = bbox;
    if (bbox || cmds.length > 0) {
      this.cameraState = updateCamera(
        this.cameraState,
        { bbox: this.lastBbox },
        this.canvasSize(),
        cmds,
        clampedElapsed,
      );
    }
    // 「鎖定跟隨」勾選框同步到相機實際狀態（issue #36）——相機軌播放的 `setState`
    // 硬切、錄進去的 `setFollow`，或 `playAll` 重設鏡頭都會在使用者沒點勾選框時
    // 改動 `followEnabled`，不同步就會脫鉤。`setFollowLocked` 值沒變不寫 DOM。
    this.controlPanel.setFollowLocked(!this.cameraState.followEnabled);

    // 算繪端跟 World 的塊集合同步（新增／移除／順序），再逐塊上傳位置（issue #95）。
    this.syncRenderer();
    for (const j of this.world.jellies()) this.renderer.setPositions(j.id, j.positions);
    this.renderer.setCamera(this.cameraState.transform);
    this.renderer.render();

    // 每幀的螢幕座標投影只對「實際看得到」的提示做（issue #71 把播放中被壓下的
    // 也算進來：藏起來的那一幀本來就不必算）。
    const hints = this.effectiveHints();
    if (needsHintProjection(hints)) {
      const canvasSize = this.canvasSize();
      if (hints.pins) {
        this.pinMarkers.update(
          this.world.listPins().map((pin) => {
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
      if (hints.fanRange || hints.fanIcon) {
        const fan = this.world.fanState();
        this.fanOverlay.update(
          fan && {
            corners: fanRectCorners(fan).map((c) =>
              worldToScreen(this.cameraState.transform, canvasSize, c.x, c.y),
            ),
            // 世界／螢幕座標同向、等比縮放，角度不用另外經相機轉換（見 `FanOverlay` 說明）。
            icon: {
              ...worldToScreen(this.cameraState.transform, canvasSize, fan.originX, fan.originY),
              angleRad: Math.atan2(fan.dirY, fan.dirX),
              // 護罩半徑＝世界寬度的一半換算成目前縮放下的螢幕像素，夾在圖示可視範圍內
              // （見 `FanOverlay.clampFanIconRadiusPx`），讓圖示大小如實反映 width 滑桿。
              radiusPx: clampFanIconRadiusPx((fan.width / 2) * this.cameraState.transform.scale),
            },
          },
        );
      }
      if (hints.formation) {
        this.formationOverlay.update(this.formationOverlayGroups(canvasSize));
      }
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  /**
   * 筆刷圓圈游標（issue #69／#70）：位置直接取 `canvasHover`（指標不在畫布上時
   * 是 `null`，圓圈跟著收起來）；半徑是世界座標，每幀換算成目前縮放下的螢幕
   * 像素——縮放改變時圓圈大小才跟著對。用不到圓圈的工具不必算半徑（那時這層
   * 是隱藏的，`setRadiusPx` 值沒變本來也不寫 DOM）。
   */
  private updateBrushCursor(): void {
    this.brushCursor.setPosition(this.canvasHover.point);
    const brush = this.brushFor();
    if (brush) {
      this.brushCursor.setRadiusPx(brush.radius * this.cameraState.transform.scale);
    }
    // 大把抓取範圍圈（issue #113）：同一套幾何；拖曳中 `canvasHover` 照樣更新，圈跟著游標。
    if (this.isGrabMode('handful')) {
      this.handfulRange.setPosition(this.canvasHover.point);
      this.handfulRange.setRadiusPx(this.handfulRadius * this.cameraState.transform.scale);
    }
  }

  /**
   * 這一幀編隊抓取提示要畫哪幾組（issue #68；issue #79 補上閒置時的懸停預覽）
   * ——三種狀態依序優先，任一時刻只會是其中一種：
   *
   * 1. **定義形狀中**：畫已經點下的那幾個點（還在累積，尚未成為形狀）。
   * 2. **拖曳中**：畫每個作用中手勢真正抓到的點（`formationActiveGroups` 只列
   *    `attached`，落在果凍外被跳過的偏移點不畫——issue #68 原設計）。
   * 3. **閒置**：形狀已定義、指標在畫布上 → 以指標處為主點畫整組形狀，按下去
   *    之前就看得到「這一下會抓哪幾點」。少了這一段，那顆顯示開關在平常什麼
   *    都看不到（issue #79 的起因）。指標不在畫布上（移到面板、離開視窗）或
   *    還沒定義過形狀 → 空陣列，不留鬼影。
   *
   * 按下的瞬間 3 換成 2：兩者都以指標為主點、偏移量相同，視覺上是同一組點接手，
   * 不會跳位。唯一的例外是「按下時整組點**一個都沒命中**果凍」——那時
   * `ToolRouter` 根本不建立 session（沒有任何 `grab` 送出去），`formationActiveGroups`
   * 是空的，於是落回 3 繼續畫預覽跟著游標。這是刻意的：那一下什麼都沒抓到，
   * 讓形狀繼續顯示才看得出「剛才那下落在果凍外了」，畫面整個空掉反而像壞了。
   */
  private formationOverlayGroups(canvasSize: CanvasSize): FormationOverlayGroup[] {
    const project = (p: Point) => worldToScreen(this.cameraState.transform, canvasSize, p.x, p.y);
    // 進行中的編隊手勢照畫到放開為止：按下之後才切走模式，這一組仍被抓著（issue #122）。
    const active = this.input.formationActiveGroups;
    if (active.length > 0) {
      return active.map((g) => ({ points: g.points.map(project) }));
    }
    // 定義中的點與懸停預覽只在編隊模式出現（issue #122）。
    if (!this.isGrabMode('formation')) return [];
    if (this.input.isDefiningFormation) {
      return [{ points: this.input.formationDefinePreview.map(project) }];
    }
    const hover = this.canvasHover.point;
    if (!hover) return [];
    const anchor = screenToWorld(this.cameraState.transform, canvasSize, hover.x, hover.y);
    const preview = this.input.formationPreviewAt(anchor);
    return preview.length > 0 ? [{ points: preview.map(project) }] : [];
  }

  private onResize = (): void => {
    // 畫布尺寸交給 Renderer；相機下一幀的 `updateCamera` 會用新畫布尺寸重新 fit。
    this.renderer.resize(this.root.clientWidth, this.root.clientHeight);
  };

  private canvasSize(): CanvasSize {
    return { width: this.root.clientWidth, height: this.root.clientHeight };
  }
}

/**
 * 電風扇矩形四個角的世界座標（issue #66）：以 `dirX`/`dirY` 為縱軸、轉 90° 為橫軸，
 * 縱向 `[0, length]`、橫向 `[-width/2, width/2]`，依序繞一圈（風扇面兩端 → 矩形
 * 遠端兩端）——`frame()` 每幀拿它的結果各自投影成螢幕座標餵給 `FanOverlay`。
 */
function fanRectCorners(fan: FanState): [Point, Point, Point, Point] {
  const { originX, originY, dirX, dirY, length, width } = fan;
  const perpX = -dirY;
  const perpY = dirX;
  const halfWidth = width / 2;
  const nearLeft = { x: originX + perpX * halfWidth, y: originY + perpY * halfWidth };
  const nearRight = { x: originX - perpX * halfWidth, y: originY - perpY * halfWidth };
  const farLeft = {
    x: originX + dirX * length + perpX * halfWidth,
    y: originY + dirY * length + perpY * halfWidth,
  };
  const farRight = {
    x: originX + dirX * length - perpX * halfWidth,
    y: originY + dirY * length - perpY * halfWidth,
  };
  return [nearLeft, farLeft, farRight, nearRight];
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

/** `meshFor` memo 的 key：來源 + 匯入尺寸 + 完整網格參數（同 key ⇒ 決定性同一張網格）。 */
function meshKey(
  sourceId: string,
  meshParams: BuildSimMeshParams,
  importSize: number | null,
): string {
  return `${sourceId}|${importSize}|${JSON.stringify(meshParams)}`;
}

/** 影像位元組 → `buildSimMesh`（決定性，ADR-0005）→ 匯入尺寸縮放（`null` = 不縮放，舊片段遷移的塊）。 */
function buildScaledMesh(
  bytes: Uint8Array,
  meshParams: BuildSimMeshParams,
  importSize: number | null,
): SimMesh {
  const raw = buildSimMesh(bytes, meshParams);
  return importSize === null ? raw : scaleMeshToLongestEdge(raw, importSize);
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
