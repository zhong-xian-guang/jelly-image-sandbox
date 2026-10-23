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
 * 相機（平滑是視覺的、不進物理）。所有影響模擬的輸入都經 `PointerInput` → `ToolRouter` →
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
 * **Demo**（issue #15 / T14 追加）：`./demos` 提供純函式腳本（`DEMOS`），算好的排程交給
 * `clip.playDemo`。主迴圈每跑一個固定 step 前先呼叫 `clip.step(dispatch)`，把該 step 排定的
 * `InputEvent` 一樣經 `world.applyInput` 送進去——跟即時輸入同一條窄介面，不繞道。Demo 腳本吃
 * 場上**所有塊**串接起來的 Particle 位置（對目前 Scene 執行，spec #87 US52）。
 * 「停止／重設」按鈕（`resetSim`）先停播放再 `world.reset()`，避免重設後殘留
 * 事件繼續觸發；匯入圖片也會中斷播放（新塊加進 Scene 的時機要乾淨，見
 * `importImage`）。播放中不能再播（`clip.allows('play')`），擋掉「疊加播放另一個 Demo」
 * ——疊加播放會留下一個沒人記得、永遠釘住的 Pin。
 *
 * **Track 錄製 + 疊加播放**（issue #29 / V2 T1a，issue #33 / V2 T1-1 依 ADR-0007
 * 改為多動作軌，issue #36 / V2 T1-4 加相機軌；issue #164 生命週期收進 `Clip`）：攔截點是
 * 兩個派送點 `dispatchInput`（所有模擬事件）與 `emitCamera`（所有相機指令）——每個事件
 * 同時交給 `clip.record()`（錄製中才真的記下），不新增輸入路徑（ADR-0005）。主迴圈每個
 * 固定 step 呼叫一次 `clip.step()`，錄下的時間戳記跟重播時的 step 計數才對得上。
 *
 * 停止錄製時 `Clip` 依事件種類把錄到的內容拆成動作軌／相機軌
 * ＋ 錄製起點鏡頭快照 `startCamera`（ADR-0007 的拆軌模型）。「錄製目標」為
 * `both` 時兩份都消化——各非空就新增一列（一條動作軌 + 一條相機軌）；單頻道
 * 只消化被選那一份，另一路的操作即時生效但不錄進去。「▶ 播放全部」把清單裡
 * 所有 Track 依各自的 `startStep`／頭尾修剪用 `mergeTracks`（`demos/overlay.ts`
 * 純函式）壓成一條全域時間軸——平移 `atStep`、動作軌 `PointerId` 加軌別前綴避免
 * 跨軌 `release` 誤放別條的 Grab、相機軌在起始 step 插 `setState` 硬切、相機軌
 * 重疊區間只認先列那條、依全域 `atStep` 穩定排序——由 `Clip` 精準重播
 * （Track 排程格式跟 `DemoStep[]` 相同，不需要另外寫播放器）。多條各自單指標的
 * 動作軌疊起來等於同時多點抓取（Multi-grab）。
 *
 * **Track 座標對齊**：Grab/Tap/Pin 記的是錄製當下的絕對世界座標，`playAll`
 * 因此在開始播放時 `world.reset()`（場上回到 Scene、每塊回 rest，
 * 絕對世界座標才準確落在果凍上）。相機（issue #156 改，見 ADR-0007 追記）：播放開始
 * **不動**相機——保留播放前的鏡位與「鎖定跟隨」，讓使用者能先擺好鏡位再播；相機軌
 * 自帶的 `setState` 照舊在它的起始 step 把鏡頭硬切到錄製起點。「停止／重設」把相機
 * 還原成播放前的狀態，所以「擺鏡位 → 播放 → 停止 → 再播」每一輪都從同一個起點出發，
 * 從同一個鏡位連按播放全部仍逐格一致（#33／#36 的決定性，起點從「固定框住果凍」改成
 * 「使用者擺好的鏡位」）。
 *
 * **場景狀態整合**（issue #38 / V2 T1-6；issue #95 改）：「停止／重設」（`resetSim`）、
 * 「清空全部」（`clearAll`）與「載入片段」（`applyClipState`）共用
 * `Clip` 的收束（`reset`／`clear`／`fromClipPart`）把錄製／播放收成一致的乾淨狀態；只有後兩者會換掉整份
 * 片段（Track／群組／初始 Pin），匯入圖片不再清任何東西。Track／群組／初始 Pin／錄製目標
 * ／兩個流水號都由 `Clip`（issue #163，見 `./Clip`）持有，沙盒只轉呼叫、把 `clip.view()`
 * 同步到側欄，存檔時把 `clip.toClipPart()` 跟自己持有的來源圖庫／Scene／物理設定拼成
 * 同一份 `ClipState`。錄製／播放是 `Clip` 的單一互斥 phase（issue #164）；「現在能不能做 X」
 * 只問 `clip.allows`——側欄依它灰按鈕（`setClipStatus`），沙盒的入口也問它。
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
  type ScreenInsets,
  createCameraState,
  fitTransform,
  screenToWorld,
  updateCamera,
  worldToScreen,
} from '../camera';
import {
  DEFAULT_TOOL,
  type GrabMode,
  type ModalToolId,
  type PinMode,
  type ToolId,
  type ToolMode,
  type ToolParamKey,
  FAN_FALLOFF_RANGE,
  FAN_FREQUENCY_RANGE,
  FAN_PARAM_KEYS,
  FAN_STRENGTH_RANGE,
  FAN_WIDTH_RANGE,
  HANDFUL_RADIUS_RANGE,
  PIN_BRUSH_RADIUS_RANGE,
  SPRAY_SPACING_RANGE,
  PointerInput,
  ToolParams,
  ToolRouter,
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
} from './clipFile';
import { Clip } from './Clip';
import { BackdropBoard, type WorldRect } from './BackdropBoard';
import { Backdrops, browserBackdropCodec } from './Backdrops';
import { BackgroundPanel } from './BackgroundPanel';
import { BackgroundStore, DEFAULT_BACKGROUND_COLOR, openIndexedDbStore } from './backgroundStore';
import { BrushCursor, type BrushVariant } from './BrushCursor';
import { CanvasHover } from './CanvasHover';
import { CleanView } from './CleanView';
import { coveredInsets, visibleRect } from './fitInsets';
import { ContextMenu, jellyMenuItems, type JellyMenuItemId } from './ContextMenu';
import { ControlPanel } from './ControlPanel';
import { CursorLabel, cursorLabelText, type FormationShapeState } from './CursorLabel';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { canvasToPng, drawDefaultTexture } from './defaultJelly';
import { DEMOS, isCameraCommand, STEP_SECONDS, stepToSeconds, type DemoEvent } from './demos';
import { DropImportInput } from './DropImportInput';
import { loadFanIconStyle, saveFanIconStyle } from './fanIconStyle';
import { clampFanIconRadiusPx, FanOverlay } from './FanOverlay';
import { FileImportInput } from './FileImportInput';
import { HiddenFileInput } from './HiddenFileInput';
import { FixedStepAccumulator } from './FixedStepAccumulator';
import { FormationDefineHint } from './FormationDefineHint';
import { FormationOverlay, type FormationOverlayGroup } from './FormationOverlay';
import { HandfulRanges, type HandfulRangeCircle } from './HandfulRanges';
import { HelpOverlay } from './HelpOverlay';
import { visibleHints, type HintKey, type HintVisibility } from './hintVisibility';
import { DEFAULT_MESH_DENSITY, halveMeshDensity, MESH_DENSITY_RANGE } from './meshDensity';
import { browserStorage } from './panelLayout';
import { PerfMonitor } from './PerfMonitor';
import { PinMarkers } from './PinMarkers';
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
 * 「匯入尺寸」拉霸的範圍與預設（issue #88 / V3 T1-1，見 GLOSSARY.md「匯入尺寸」），
 * 世界單位 = 未縮放時的 mask 像素。預設 512：一般解析度的圖進場大小跟以前差不多
 * （以前是降採樣後的像素尺寸、最長邊 ≤ 1024），超大圖不會撐滿桌面。下限 128 還
 * 看得見、上限 1024 = 以前的最大值。
 */
const IMPORT_SIZE_RANGE = { min: 128, max: 1024, step: 16 };
const DEFAULT_IMPORT_SIZE = 512;
/** 內建預設果凍在來源圖庫裡的 id（啟動時、「清空全部」後都重新註冊成它）。 */
const DEFAULT_SOURCE_ID = 'src/1';

/**
 * 這幾層提示是 DOM 覆蓋層，每幀要把世界座標投影成螢幕座標才畫得出來——都看不到
 * 時 `frame()` 連投影都不必算。`wireframe` 不在此列：線框是 `JellyRenderer` 在
 * WebGL 那邊自己畫的，不經 `worldToScreen`。
 */
function needsHintProjection(hints: Readonly<HintVisibility>): boolean {
  return hints.pins || hints.fanRange || hints.fanIcon || hints.formation;
}

/** `#rrggbb` → `0xRRGGBB`（Renderer 吃數字）。 */
function colorToNumber(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}

/**
 * 來源圖庫的一筆（issue #95）：存檔用的位元組＋格式（= `ClipImage`）加上預先解碼好的
 * 貼圖——`spawn` 全程同步（Track 重播中生成不需要 async，spec #87 US65）。內建預設
 * 果凍的貼圖是 `<canvas>`，匯入的圖是 `<img>`。
 */
interface SourceImage extends ClipImage {
  texture: HTMLImageElement | HTMLCanvasElement;
}

export class JellySandbox {
  /** 多塊 Jelly 的模擬容器（issue #95）——沙盒唯一的模擬入口，契約與 `SimCore` 同形。 */
  private readonly world: World;
  private readonly renderer: JellyRenderer;
  /**
   * 工具路由（issue #159）：沙盒直接持有——目前工具、模式、參數、編隊查詢、右鍵、
   * 右鍵＋滾輪都直接對它；`input` 只是把 DOM 指標事件接進它的 adapter。
   */
  private readonly router: ToolRouter;
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
   * 大把抓取的範圍圈（issue #113；issue #135 起可多顆：編隊每點大把每個點一顆）——幾何
   * 沿用筆刷圓圈（`BrushCursor`、自己的顏色），但它是**提示**：有自己的顯示開關、受
   * 「播放時隱藏提示」壓下（見 `applyHandfulRangeVisibility`），所以不跟 Pin 工具共用
   * `brushCursor`。每幀畫哪幾顆見 `handfulRangeCircles`。
   */
  private readonly handfulRange: HandfulRanges;
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
  private readonly contextMenu: ContextMenu;
  /** 「?」操作說明浮層（issue #132）——第一次打開網頁自動出現一次，之後按側欄標題列的「?」。 */
  private readonly helpOverlay: HelpOverlay;
  /** 定義編隊形狀時畫布上方那行說明（issue #132）——是提示，見 `updateFormationDefineHint`。 */
  private readonly formationDefineHint: FormationDefineHint;
  /**
   * 乾淨畫面（issue #130）：進入時藏起側欄、播放控制條、相機按鈕、匯入提示字，提示與游標回饋
   * 由各自的出口多看一個 `cleanView.isActive`（見 `applyCleanView`）。不存檔。
   */
  private readonly cleanView: CleanView;
  /** 側欄「背景」分區的內容（issue #147）。 */
  private readonly backgroundPanel: BackgroundPanel;
  /** 背景色與 Backdrop 的儲存（issue #147；IndexedDB，不能用時只在本次有效）。 */
  private readonly backgroundStore: BackgroundStore;
  /**
   * 場上的 Backdrop（issue #148；issue #165 收成 module）：清單、貼圖、縮圖、匯入轉檔、選單
   * 指令都在裡面，沙盒每幀只拿繪製清單（`flush`）、把背景圖工具的指令轉給它。
   */
  private readonly backdrops: Backdrops<ImageBitmap>;
  /** 「匯入背景圖…」的隱藏檔案輸入（issue #148）：瀏覽器解得開的圖都收。 */
  private readonly backdropFileInput: HiddenFileInput;
  /** 鍵盤快捷鍵（issue #126）：1–5 切工具、播放中空白鍵暫停／繼續。在 window 上聽，`destroy` 要解掉。 */
  private readonly keyboardShortcuts: KeyboardShortcuts;
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
  /**
   * 畫布邊上被介面蓋住多少（issue #138）——相機 zoom-to-fit 要避開的部分，經 `canvasSize()`
   * 帶給相機。每幀開頭（還沒寫任何 DOM 前）重量一次，見 `refreshFitInsets`。
   */
  private fitInsets: ScreenInsets | undefined;
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
   * 目前工具（issue #65；issue #122 起是側欄工具列的五個工具 grab／pin／fan／jelly／backdrop，ADR-0016）
   * ——`ToolRouter` 沒有 getter，游標、筆刷、Pin 標記等視覺回饋靠這個判定。
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
   * 工具參數（issue #160）：電風扇四個參數、Pin 筆刷半徑、撒 Pin 間距、大把抓取半徑的唯一
   * 擁有者。交給 `ToolRouter`（按下時讀、右鍵＋滾輪時 `step`）；側欄拉霸寫入；筆刷圓圈、
   * 大把範圍圈每幀讀；變更通知由 `onToolParamChange` 收（更新場上風扇、同步拉霸）。
   */
  private readonly toolParams = new ToolParams();
  /**
   * 「播放時隱藏提示」全域開關（issue #71 / V2 T3-7）——開著時，播放中把所有提示
   * 一律壓下（見 `hintsSuppressed`／`applyHintVisibility`）。它跟上面那幾個
   * `*Visible` 旗標是兩層：那些是「使用者想不想看」的意圖、永遠保持使用者設定的
   * 值不被播放改寫，這個只是暫時壓下的理由，播完就自動鬆開、各自回到原本的意圖。
   */
  private hideHintsDuringPlayback = false;
  /**
   * 片段（issue #163 / #164）：Track 清單、群組與獨奏、片段初始 Pin、錄製目標、Track／群組
   * 流水號，以及錄製／播放 phase、暫停、播放前鏡位與編輯許可。每次真的變了就同步側欄與提示。
   */
  private readonly clip = new Clip({ onChange: () => this.syncClip() });

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
    /** 背景設定的儲存與啟動時從它還原的值（issue #147；`create` 先讀好再建，開頁第一格就對）。 */
    background: { store: BackgroundStore; color: string; backdrops: BackdropBoard },
  ) {
    this.root = root;
    this.renderer = renderer;
    this.backgroundStore = background.store;
    this.backdrops = new Backdrops(background.backdrops, {
      codec: browserBackdropCodec,
      notify: (message) => this.showNotice(message),
    });
    this.renderer.setBackgroundColor(colorToNumber(background.color));
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

    ({
      router: this.router,
      input: this.input,
      cameraInput: this.cameraInput,
    } = this.attachInputHandlers(renderer.canvas));

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

    // 風扇圖示外觀（issue #143）：開發者設定，上次的選擇存在 localStorage。
    const fanIconStyle = loadFanIconStyle(browserStorage());
    const fan = this.toolParams.fan();
    this.controlPanel = new ControlPanel({
      initial: {
        activeTool: this.activeTool,
        toolModes: {
          grab: this.router.modeOf('grab'),
          pin: this.router.modeOf('pin'),
          fan: this.router.modeOf('fan'),
          backdrop: this.router.modeOf('backdrop'),
        },
        showCursorLabel: this.showCursorLabel,
        boundary: this.boundaryMode,
        softness: DEFAULT_SOFTNESS,
        tapStrength: this.world.params.tapStrength,
        gravity: this.world.params.gravity,
        showPins: this.hintIntent.pins,
        followLocked: !this.cameraState.followEnabled,
        showWireframe: this.hintIntent.wireframe,
        fanIconStyle,
        recordTarget: this.clip.recordTarget,
        showFanRange: this.hintIntent.fanRange,
        showFanIcon: this.hintIntent.fanIcon,
        fanWidth: fan.width,
        fanStrength: fan.strength,
        fanFalloffExponent: fan.falloffExponent,
        fanFrequency: fan.frequency,
        showFormationHint: this.hintIntent.formation,
        pinBrushRadius: this.toolParams.get('pinBrushRadius'),
        spraySpacing: this.toolParams.get('spraySpacing'),
        handfulRadius: this.toolParams.get('handfulRadius'),
        showHandfulRange: this.hintIntent.handfulRange,
        formationPerPointHandful: this.router.formation.perPointHandful,
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
      // 工具參數拉霸（issue #160）一律寫進 `ToolParams`，後續副作用在 `onToolParamChange`。
      onToolParamChange: (key, value) => this.toolParams.set(key, value),
      onFormationDefineStart: () => this.beginFormationDefine(),
      onFormationDefineEnd: () => this.router.formation.endDefine(),
      onShowFormationHintChange: (visible) => this.setHintVisible('formation', visible),
      onShowHandfulRangeChange: (visible) => this.setHintVisible('handfulRange', visible),
      // 每點大把（issue #135）：只影響下一次按下；範圍圈與游標標籤每幀自己重算。
      onFormationPerPointHandfulChange: (enabled) =>
        this.router.formation.setParams({ perPointHandful: enabled }),
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
      onFanIconStyleChange: (style) => {
        this.fanOverlay.setIconStyle(style);
        saveFanIconStyle(browserStorage(), style);
      },
      onRecordTargetChange: (target) => {
        this.clip.recordTarget = target;
      },
      onToggleRecording: () => this.toggleRecording(),
      onPlayAll: () => this.playAll(),
      onSnapshotSetupPins: () => this.snapshotSetupPins(),
      onSetInitialPose: () => this.setInitialPose(),
      onInitialPoseConfirmPending: () =>
        this.showNotice(
          'Track 記的是絕對世界座標：果凍移走後，舊 Track 抓的那一點可能已經沒有果凍。確定的話再按一次「設為初始位置」',
        ),
      onClearSetupPins: () => this.clip.clearSetupPins(),
      onTogglePause: () => this.clip.togglePause(),
      // Track 清單與群組區的編輯直接交給 Clip（issue #163）；變了 Clip 自己回呼 `syncClip`。
      onTrackStartTimeChange: (id, seconds) => this.clip.setTrackStartTime(id, seconds),
      onTrackTrimInChange: (id, seconds) => this.clip.setTrackTrimIn(id, seconds),
      onTrackTrimOutChange: (id, seconds) => this.clip.setTrackTrimOut(id, seconds),
      onDeleteTrack: (id) => this.clip.deleteTrack(id),
      onTrackRename: (id, name) => this.clip.renameTrack(id, name),
      onAddGroup: () => this.clip.addGroup(),
      onGroupEnabledChange: (id, enabled) => this.clip.setGroupEnabled(id, enabled),
      onGroupRename: (id, name) => this.clip.renameGroup(id, name),
      onGroupSolo: (id) => this.clip.toggleGroupSolo(id),
      onDeleteGroup: (id) => this.clip.deleteGroup(id),
      onTrackGroupsChange: (trackId, groupIds) => this.clip.setTrackGroups(trackId, groupIds),
    });
    root.appendChild(this.controlPanel.element);
    // 工具參數變了（拉霸或右鍵＋滾輪，issue #160）→ 更新場上風扇、同步拉霸。
    this.toolParams.subscribe((key, value) => this.onToolParamChange(key, value));
    // 「背景」分區（issue #147）：背景色；Backdrop 匯入與清單（issue #148）。
    this.backdropFileInput = new HiddenFileInput(root.ownerDocument, 'image/*', (files) => {
      const file = files[0];
      if (file) void this.backdrops.import(file, this.visibleWorldRect());
    });
    this.backgroundPanel = new BackgroundPanel({
      initialColor: background.color,
      onColorChange: (color) => this.setBackgroundColor(color),
      onImportBackdrop: () => this.backdropFileInput.open(),
      onDeleteBackdrop: (id) => this.backdrops.remove(id),
      // 清單完整版（issue #151）：選取跟畫布上的背景圖工具共用 `BackdropBoard` 那一份。
      onBackdropVisibleChange: (id, visible) => this.backdrops.setVisible(id, visible),
      onMoveBackdropUp: (id) => this.backdrops.moveUp(id),
      onMoveBackdropDown: (id) => this.backdrops.moveDown(id),
      onSelectBackdrop: (id) => this.backdrops.select(id),
      onBackdropFieldChange: (id, field, value) => this.backdrops.setField(id, field, value),
    });
    this.controlPanel.sectionBody('background').appendChild(this.backgroundPanel.element);
    // 畫布上的播放控制條（底部中央）與相機按鈕（右下角）——issue #129；只吃自己範圍內的點擊。
    root.appendChild(this.controlPanel.playbackBar);
    root.appendChild(this.controlPanel.cameraControls);

    this.pinMarkers = new PinMarkers();
    root.appendChild(this.pinMarkers.element);
    this.fanOverlay = new FanOverlay();
    this.fanOverlay.setIconStyle(fanIconStyle);
    root.appendChild(this.fanOverlay.element);
    this.formationOverlay = new FormationOverlay();
    root.appendChild(this.formationOverlay.element);
    this.brushCursor = new BrushCursor();
    root.appendChild(this.brushCursor.element);
    this.handfulRange = new HandfulRanges();
    root.appendChild(this.handfulRange.element);
    this.canvasHover = new CanvasHover(root, {
      isCanvas: (target) => target === this.renderer.canvas,
    });
    this.cursorLabel = new CursorLabel();
    root.appendChild(this.cursorLabel.element);
    this.contextMenu = new ContextMenu({ dismissBlockTarget: this.renderer.canvas });
    root.appendChild(this.contextMenu.element);
    this.formationDefineHint = new FormationDefineHint();
    root.appendChild(this.formationDefineHint.element);
    // 操作說明（issue #132）：「?」鈕放在側欄標題列「收起側欄」左邊；第一次打開網頁自動出現。
    this.helpOverlay = new HelpOverlay({ storage: browserStorage() });
    root.appendChild(this.helpOverlay.element);
    this.controlPanel.titleBarActions.prepend(this.helpOverlay.createOpenButton());
    this.helpOverlay.showIfFirstVisit();
    // 乾淨畫面（issue #130）：進入鈕放在標題列「?」左邊；離開鈕浮在畫布左上角。
    this.cleanView = new CleanView({
      root,
      hide: [
        this.controlPanel.element,
        this.controlPanel.playbackBar,
        this.controlPanel.cameraControls,
        this.importHint,
      ],
      onChange: () => this.applyCleanView(),
      isEscapeClaimed: () => this.contextMenu.isOpen,
    });
    root.appendChild(this.cleanView.element);
    this.controlPanel.titleBarActions.prepend(this.cleanView.createEnterButton());
    this.keyboardShortcuts = new KeyboardShortcuts({
      selectTool: (tool) => this.setActiveTool(tool),
      isPlaying: () => this.clip.phase === 'playing',
      togglePause: () => this.clip.togglePause(),
    });
    this.applyToolVisuals();

    // 起始鏡位避開底部控制條、匯入提示與側欄（issue #138）：上面建相機時介面還沒掛上，
    // 量好之後重新 fit 一次，開頁第一格就是避開後的取景（不是從整張畫布的 fit 緩動過去）。
    this.refreshFitInsets();
    this.cameraState = createCameraState({ bbox: this.lastBbox }, this.canvasSize());
    this.renderer.setCamera(this.cameraState.transform);

    // 一開始就把群組區畫出來（預設群組永遠存在）——Track 清單仍空，但使用者能先
    // 看到「群組」這個概念、按「＋ 新增群組」（issue #43）。
    this.syncClip();
  }

  /**
   * 建立空的 `JellyRenderer` 並組裝好（建構子接著建 `World`、把內建預設果凍註冊成來源
   * `src/1`、`spawn` 成 `jelly/1`、拍成 Scene、鏡頭框住它）；呼叫 `start()` 開始跑。
   */
  static async create(root: HTMLElement): Promise<JellySandbox> {
    const renderer = await JellyRenderer.create({
      width: root.clientWidth,
      height: root.clientHeight,
      background: { color: colorToNumber(DEFAULT_BACKGROUND_COLOR), alpha: 1 },
    });
    root.appendChild(renderer.canvas);
    // 背景設定（issue #147）：先從 IndexedDB 讀好再建沙盒，開頁第一格就是上次的背景。
    // 儲存寫不進去時的提示要等沙盒建好才有地方顯示，所以回呼晚綁。
    let sandbox: JellySandbox | null = null;
    const store = new BackgroundStore(await openIndexedDbStore(), (message) =>
      sandbox?.showNotice(message),
    );
    const color = (await store.loadColor()) ?? DEFAULT_BACKGROUND_COLOR;
    const backdrops = await BackdropBoard.restore(store);
    sandbox = new JellySandbox(root, renderer, drawDefaultTexture(), { store, color, backdrops });
    return sandbox;
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
    this.backdropFileInput.destroy();
    this.backdrops.dispose();
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
    this.contextMenu.destroy(); // 開著時在 window 上掛了監聽
    this.helpOverlay.destroy(); // 開著時在 window 上掛了 Esc 監聽
    this.cleanView.destroy(); // 乾淨畫面中在 document／root 上掛了監聽
    this.formationDefineHint.destroy();
    this.keyboardShortcuts.destroy(); // 在 window 上掛了鍵盤監聽
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
   * 按這顆鈕不會讓畫布右下角的「鎖定跟隨」切換鈕跟實際狀態對不上。
   */
  frameJelly(): void {
    this.emitCamera({ type: 'frame' });
  }

  /**
   * 送一個相機指令：進佇列給 `updateCamera`，同時交給 `clip.record()`（錄製中才真的記下）
   * ——「框住果凍」「鎖定跟隨」按鈕的操作在錄運鏡時也要一起錄進 Camera Track（issue #36 /
   * US15）。走的還是 `CameraCommand` 窄介面（ADR-0005），不新增輸入路徑。`CameraInput` 的
   * `emit` 回呼也走這裡（見 `attachInputHandlers`）。
   */
  private emitCamera(cmd: CameraCommand): void {
    this.cameraCommands.push(cmd);
    this.clip.record(cmd);
  }

  /**
   * Demo 按鈕（issue #15）：依 `id` 找到腳本，用「目前」場上所有塊串接的 Particle 位置
   * 算出時間軸交給 `clip.playDemo`——Demo 對目前 Scene 執行（spec #87 US52）：找角、找
   * 中心都以聯集算，多塊時抓到的是整體最外圍的點。空場沒東西可示範，直接返回。錄製中、
   * 播放中不允許播放（`Clip` 忽略），不記播放前鏡位。
   */
  private runDemo(id: string): void {
    if (!this.clip.allows('play')) return;
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    const positions = this.allPositions();
    if (positions.length === 0) return;
    this.clip.playDemo(demo.build(positions));
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
   * 「開始錄製／停止錄製」切換鈕（issue #29 / issue #33 拆軌 / issue #36 加相機軌）：交給
   * `Clip`——開始時依錄製目標起錄（帶當下鏡頭的拷貝，相機軌硬切進場用），停止時它自己把
   * 錄到的內容拆成動作軌／相機軌加進清單。錄製中的事件是 `dispatchInput`／`emitCamera`
   * 順手交給 `clip.record()` 的。
   */
  private toggleRecording(): void {
    this.clip.toggleRecording(cloneCameraState(this.cameraState));
  }

  /**
   * 「設為初始位置」（issue #155）：把場上每塊 Jelly 目前的位置與角度寫回 Scene
   * （`World.captureScenePose`：質心＋最佳擬合旋轉，不含變形），之後停止／重設、開始播放都從
   * 這個姿態出發。
   *
   * 寫回之後**立刻** `world.reset()`，讓場上每塊以新姿態、rest 形狀重建——不然場上那塊仍是
   * 舊姿態建出來的，之後匯入／生成／移除後的 `setScene(sceneSnapshot())` 會把新姿態洗回去，
   * 「設為目前 Pin」拍的 rest 座標也會落在舊姿態上。重設會清掉約束與風扇，所以先記下按下前的
   * Pin（同 id、同世界座標）與風扇，重建後放回去；這幾個事件不經 `dispatchInput`——錄製中、
   * 播放中這顆鈕本來就按不了（`clip.allows`，側欄鎖住，這裡再擋一次）。
   */
  private setInitialPose(): void {
    if (!this.clip.allows('setInitialPose')) return;
    const pins = this.world.listPins();
    const fan = this.world.fanState();
    this.world.setScene(this.world.captureScenePose());
    this.world.reset();
    for (const pin of pins) {
      this.world.applyInput({ type: 'pin', id: pin.id, x: pin.point.x, y: pin.point.y });
    }
    if (fan) this.world.applyInput({ type: 'setFan', ...fan });
    this.showNotice('已把每塊果凍目前的位置與角度設為初始位置');
  }

  /**
   * 「片段初始 Pin：設為目前 Pin」（issue #39 / ADR-0007 追記）——把畫面上現在所有
   * Pin（`world.listPins()`，跨所有塊）的**rest 形狀附著座標**（`world.restAttachPoint`）
   * 拍成快照，取代上一份。存 rest 座標而非目前變形座標：`playAll` 會先 `world.reset()`，還原時
   * 這些座標才精準落在原本的表面點，也不隨拍快照當下的變形而偏。錄製中／播放中 `Clip`
   * 自己會忽略。快照本身存在 `Clip`，沙盒只負責從 World 取出 rest 座標交給它。
   */
  private snapshotSetupPins(): void {
    if (!this.clip.allows('setupPins')) return;
    this.clip.setSetupPins(
      this.world.listPins().flatMap((pin) => {
        // `restAttachPoint` 回傳全新的 `Point`；作用中的 Pin 必有約束，`null` 只是防呆。
        const rest = this.world.restAttachPoint(pin.id);
        return rest ? [rest] : [];
      }),
    );
  }

  /**
   * `Clip` 每次狀態真的變了就回呼這裡（issue #163 / #164）：把 `clip.view()`（Track 清單、群組區、
   * 可播放數、片段初始 Pin 數）與錄製／播放狀態（phase、暫停、`allows`）一次同步到
   * `ControlPanel`，再重算提示顯示——「播放時隱藏提示」（issue #71）在播放開始時壓下、播完（或
   * 按停止／重設）鬆開，各自回到使用者原本的開關狀態（見 `applyHintVisibility`）。
   */
  private syncClip(): void {
    const view = this.clip.view();
    this.controlPanel.setGroups(view.groups);
    this.controlPanel.setTracks(view.tracks);
    this.controlPanel.setPlayableTrackCount(view.playableTrackCount);
    this.controlPanel.setSetupPinCount(view.setupPinCount);
    this.controlPanel.setClipStatus({
      phase: view.phase,
      paused: view.paused,
      allows: (action) => this.clip.allows(action),
    });
    this.applyHintVisibility();
  }

  /**
   * 「▶ 播放」按鈕（issue #33；issue #36 加相機軌；issue #43 加群組過濾）：`Clip` 把開啟中
   * 群組的成員 Track（保留清單順序）連同片段初始 Pin 疊成一條全域時間軸播放，並記下播放前的
   * 鏡位（issue #156，「停止／重設」時還原，見 `resetSim`）。錄製中、已在播放中、或沒有可播放的
   * Track 時 `Clip` 忽略。
   *
   * 真的開始播放才 `world.reset()`：場上回到 Scene（錄製中生成的消失、移除的回來、每塊回
   * rest）——Track 裡 Grab/Tap/Pin 記的是錄製當下的絕對世界座標，場景回到 rest 狀態
   * 它們才會準確落在果凍上、每次疊加結果才逐格一致（issue #33 決定性驗收條件），
   * 不受「播放前場景被怎麼動過」影響。排定的事件要到下一個 sim step 才送出，重設排在開始
   * 之後也一樣。
   *
   * 相機（issue #156）：不動——保留播放前的鏡位與「鎖定跟隨」。相機軌一生效，自帶的
   * `setState` 硬切照舊接管。
   */
  private playAll(): void {
    if (this.clip.playTracks(this.cameraState)) this.world.reset();
  }

  /**
   * 「停止／重設」（issue #14；issue #15 追加停 Demo；issue #38 收束播放／錄製；
   * issue #95 回到 Scene）：`clip.reset()` 中斷播放與錄製（進行中的錄製丟棄），再
   * `world.reset()` 讓場上與 Scene 一致（錄製中生成的塊消失、每塊回 rest 座標、速度歸零、
   * 清掉所有 Grab／Pin 與風扇）。Track／群組清單與片段初始 Pin 快照（issue #39）**保留**——
   * 只有「清空全部」／載入片段才換掉。播放過的話相機回到播放前的狀態（issue #156）：`Clip`
   * 交回一次就丟掉，之後使用者重新擺的鏡位不會又被下一次重設拉回去。
   */
  private resetSim(): void {
    const cameraBeforePlayback = this.clip.reset();
    this.world.reset();
    if (cameraBeforePlayback) {
      this.cameraState = cameraBeforePlayback;
      this.cameraCommands = [];
    }
  }

  /**
   * 「清空全部」（issue #95 / V3 T3-2；ADR-0013）——唯一會把整份片段清掉的入口：中斷播放
   * ／錄製，Scene 清空、場上所有塊移除（`setScene([])` + `reset()`），Track／群組／片段
   * 初始 Pin／流水號全部歸零，來源圖庫清空後重新註冊內建預設果凍（不自動放上桌：
   * 空桌面）、網格 memo 清掉。相機不動（`lastBbox` 維持，跟隨會停在原地）；拉霸與
   * 邊界模式是使用者的設定，不動。錄製中／播放中不允許（`clip.allows`，側欄也鎖住）。
   */
  private clearAll(): void {
    if (!this.clip.allows('clearAll')) return;
    this.world.setScene([]);
    this.world.reset();
    // Track／群組／片段初始 Pin／兩個流水號，並收束錄製／播放（同步側欄由 Clip 回呼）。
    this.clip.clear();
    this.sources.clear();
    this.meshMemo.clear();
    this.spawnBboxMemo.clear();
    this.nextJellyNum = 1;
    this.nextSourceNum = 1;
    this.registerDefaultSource();
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
   *   顯示開關，選到就看得到，切走就收起來；唯一例外是乾淨畫面中一律藏起（issue #130）。
   * - 大把抓取範圍圈：只在抓取工具的大把模式（issue #122）。
   *
   * 都是純粹的回饋，不影響任何判定邏輯（判定在 `ToolRouter`）。
   */
  private applyToolVisuals(): void {
    this.applyCanvasCursor();
    this.pinMarkers.setRemovable(this.isPinMode('remove'));
    const brush = this.brushFor();
    if (brush) this.brushCursor.setVariant(brush.variant);
    // 乾淨畫面（issue #130）連游標回饋都藏，工具與模式不動。
    this.brushCursor.setActive(brush !== null && !this.cleanView.isActive);
    this.applyHandfulRangeVisibility();
    this.applyBackdropOutline();
  }

  /**
   * 選中 Backdrop 的外框（issue #149）：游標回饋，只在「背景圖」工具作用、不在乾淨畫面時畫；
   * 選取本身不受切工具影響，切回來外框就回來。選中那張被隱藏時也不畫。
   */
  private applyBackdropOutline(): void {
    const show = this.activeTool === 'backdrop' && !this.cleanView.isActive;
    this.renderer.setBackdropOutline(show ? this.backdrops.selectedRect() : null);
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
    if (this.clip.phase === 'playing') return true;
    const point = this.canvasHover.point;
    if (!point) return false;
    const world = screenToWorld(this.cameraState.transform, this.canvasSize(), point.x, point.y);
    const plan = this.spawnPlan(world);
    return plan === null || !fitsInBoundaryFrame(this.boundaryFrame, plan.bbox);
  }

  /**
   * 目前工具變更（issue #65 / V2 T3-1）——側欄工具列（`onToolChange`，issue #122 起，ADR-0016）
   * 與數字鍵 1–5（issue #126）都走這裡。交給 `ToolRouter.setActiveTool`（只影響下一次按下）；
   * `activeTool` 另外存一份，因為 `ToolRouter` 沒有 getter，游標、筆刷、Pin 標記等視覺回饋靠它
   * 判定。工具列高亮與參數卡也在這裡同步（從工具列按下時面板自己已經切過，重設一次無妨）。切工具
   * 會改變游標／標記／圓圈的視覺回饋，所以要跟著重算。
   */
  private setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
    this.router.setActiveTool(tool);
    this.controlPanel.setActiveTool(tool);
    this.contextMenu.close(); // Jelly 右鍵選單在切換工具時關閉（issue #124）
    this.applyToolVisuals();
  }

  /**
   * 某個工具的模式換了（issue #122）——參數卡模式鈕（`onModeChange`）走這裡；中鍵單擊走
   * `cycleMode`。轉給 `ToolRouter`（只影響下一次按下）、同步面板高亮，再重算跟模式有關的
   * 回饋（大把抓取範圍圈、Pin 筆刷圓圈顏色與標記脈動）。游標標籤每幀自己重算，不必在這裡推。
   */
  private setToolMode(tool: ModalToolId, mode: ToolMode): void {
    this.router.setMode(tool, mode);
    // 定義編隊形狀途中抓取工具鎖在編隊（issue #135，見 `ToolRouter.writeMode`）：模式鈕
    // 按了也切不走，面板高亮照實際的模式回填。
    this.controlPanel.setToolMode(tool, this.router.modeOf(tool));
    this.applyToolVisuals();
  }

  /**
   * 畫布上中鍵單擊（issue #122；`CameraInput` 判定）：輪替目前工具的模式。沒有模式的工具
   * `cycleMode` 回 `null`，什麼都不做。
   */
  private cycleMode(): void {
    const mode = this.router.cycleMode();
    if (mode === null) return;
    const tool = this.activeTool as ModalToolId;
    this.controlPanel.setToolMode(tool, mode);
    this.applyToolVisuals();
  }

  /** 目前是不是抓取工具的這個模式（issue #122：範圍圈與編隊提示只在各自的模式出現）。 */
  private isGrabMode(mode: GrabMode): boolean {
    return this.activeTool === 'grab' && this.router.modeOf('grab') === mode;
  }

  /** 目前是不是 Pin 工具的這個模式（issue #123：標記脈動只在拔模式、圓圈顏色隨模式）。 */
  private isPinMode(mode: PinMode): boolean {
    return this.activeTool === 'pin' && this.router.modeOf('pin') === mode;
  }

  /**
   * 「開始設定形狀」（issue #68）：設定形狀是編隊模式的事，順手把抓取工具切到編隊模式
   * （issue #122）——不然在單點模式下按了這顆鈕，點在畫布上的會被當成一般的抓取，
   * 形狀提示也不會出現。
   */
  private beginFormationDefine(): void {
    if (!this.isGrabMode('formation')) this.setToolMode('grab', 'formation');
    this.router.formation.beginDefine();
  }

  /**
   * 定義編隊形狀時畫布上方那行說明（issue #132；spec #127「操作說明」）。它是提示：「播放時
   * 隱藏提示」壓下時、乾淨畫面中（issue #130）一起藏。只在編隊模式下顯示——比照
   * 定義中的形狀標記（`formationOverlayGroups`），切去別的工具時點畫布不會加點，說明也不該在。
   */
  private updateFormationDefineHint(): void {
    this.formationDefineHint.setVisible(
      this.router.formation.isDefining &&
        this.isGrabMode('formation') &&
        !this.hintsSuppressed &&
        !this.cleanView.isActive,
    );
  }

  /**
   * 進出乾淨畫面後（issue #130）：介面元素 `CleanView` 自己藏好了，這裡把「疊在各自開關上」的
   * 東西重算一次——提示（`effectiveHints`）、編隊定義說明、筆刷圓圈、游標標籤。使用者的開關意圖
   * 一個都不動，所以離開時各自回到進入前的樣子。進入時順手關掉開著的右鍵選單。
   */
  private applyCleanView(): void {
    if (this.cleanView.isActive) this.contextMenu.close();
    this.applyHintVisibility();
    this.updateFormationDefineHint();
    this.applyToolVisuals();
    this.applyCursorLabelEnabled();
  }

  /** 「顯示游標標籤」開關（issue #122）。 */
  private setShowCursorLabel(visible: boolean): void {
    this.showCursorLabel = visible;
    this.applyCursorLabelEnabled();
  }

  /** 游標標籤實際開不開＝使用者的開關 且 不在乾淨畫面（issue #130）；開關本身不動。 */
  private applyCursorLabelEnabled(): void {
    this.cursorLabel.setEnabled(this.showCursorLabel && !this.cleanView.isActive);
  }

  /**
   * 游標標籤（issue #122）：位置取 `canvasHover`、文字由目前工具／模式／數值算出來，
   * 每幀呼叫（`setText`／`setPosition` 值沒變就不寫 DOM）。
   */
  private updateCursorLabel(): void {
    const tool = this.activeTool;
    const mode = this.router.modeOf(tool);
    const shape = this.router.formation.shape;
    const formation: FormationShapeState = this.router.formation.isDefining
      ? 'defining'
      : shape && shape.length > 0
        ? 'ready'
        : 'none';
    // 數值由目前的工具回答（issue #161）：背景圖是右鍵＋滾輪會調的那張的值，其餘是工具參數。
    const value = this.router.cursorValue(this.canvasHover.point);
    this.cursorLabel.setText(cursorLabelText({ mode, value, formation }));
    this.cursorLabel.setPosition(this.canvasHover.point);
  }

  /**
   * 大把抓取範圍圈（issue #113）整層顯示與否＝這層提示實際上可見（使用者開著、沒被播放
   * 壓下）。「切工具」「切模式」與「提示可見性變了」都呼叫這裡；目前模式該畫哪幾顆
   * （大把模式一顆、編隊每點大把每個點一顆，issue #135）由 `handfulRangeCircles` 每幀決定。
   */
  private applyHandfulRangeVisibility(): void {
    this.handfulRange.setVisible(this.effectiveHints().handfulRange);
  }

  /**
   * 目前要不要筆刷圓圈游標、要什麼顏色、半徑多大（issue #69／#70；issue #123 起是 Pin 工具
   * 兩種模式共用一條 Pin 筆刷半徑，只有顏色隨模式：放＝琥珀、拔＝紅，見 `BrushCursor`）
   * ——`null` = 不要。收成一個地方才不會「切工具／切模式」（`applyToolVisuals`）跟「每幀
   * 換算半徑」（`frame`）兩處各判斷一次、日後加別的用得到圓圈的模式時漏改其中一處。
   */
  private brushFor(): { variant: BrushVariant; radius: number } | null {
    if (this.activeTool !== 'pin') return null;
    const variant = this.router.modeOf('pin') === 'place' ? 'spray' : 'erase';
    return { variant, radius: this.toolParams.get('pinBrushRadius') };
  }

  /**
   * 背景色選擇器（issue #147）：立即換掉清畫布的顏色並存起來（拖動選色器途中連續呼叫，
   * 儲存層只留最後一個值）。背景色不是提示，乾淨畫面、播放中照常顯示。
   */
  private setBackgroundColor(color: string): void {
    this.renderer.setBackgroundColor(colorToNumber(color));
    this.backgroundStore.saveColor(color);
  }

  /** 目前畫布看得到的世界範圍（issue #148：新 Backdrop 的 cover 擺放用）。 */
  private visibleWorldRect(): WorldRect {
    const { x, y, scale } = this.cameraState.transform;
    const size = this.canvasSize();
    return { centerX: x, centerY: y, width: size.width / scale, height: size.height / scale };
  }

  /**
   * Backdrop 有變動就同步到 Renderer 與側欄清單（issue #148；issue #165 起合併與繪製清單由
   * `Backdrops` 算）——`frame()` 每幀呼叫一次，沒變動什麼都不做。
   */
  private syncBackdrops(): void {
    const out = this.backdrops.flush();
    if (!out) return;
    this.renderer.setBackdrops(out.sprites);
    this.backgroundPanel.setBackdrops(out.rows);
    this.applyBackdropOutline();
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

  /**
   * 工具參數的單一變更通知（issue #160）——拉霸與右鍵＋滾輪都走到這裡：電風扇參數即時套用到
   * 場上的風扇（若有，見 `updateLiveFan`），再把新值灌回側欄拉霸（拖拉霸時灌回的是同一個值，
   * 不會觸發回呼）。筆刷圓圈、大把範圍圈與游標標籤每幀自己讀 `ToolParams`。
   */
  private onToolParamChange(key: ToolParamKey, value: number): void {
    if (FAN_PARAM_KEYS.includes(key)) this.updateLiveFan();
    this.controlPanel.setToolParam(key, value);
  }

  /**
   * 「清除所有 Pin」按鈕（issue #14；issue #51 起改走窄介面）——跟指標事件同一條
   * 路：一個無 `id` 的「清除 Pin 事件」`InputEvent` 送進 `world.applyInput`，同時
   * `clip.record`（錄製中才真的記下）。不再直呼 `SimCore.clearPins()`，回到
   * ADR-0005「所有影響模擬的輸入都經 `applyInput`」——這樣錄製中按這顆鈕會落進
   * Action Track，重播到那個 step 清掉畫面上所有 Pin（含片段初始 Pin，刻意跨軌，
   * 見 ADR-0007 追記）。`applyInput` 不會前進錄製 step 計數，兩行順序不影響結果。
   */
  private clearPins(): void {
    this.dispatchInput({ type: 'clearPins' });
  }

  /**
   * 「移除風扇」按鈕（issue #66）——比照 `clearPins`：一個無座標的 `clearFan`
   * 事件經 `world.applyInput` 送進去，同時餵給 `clip.record`（錄製中才會真的記
   * 下來），讓錄下的「移除風扇」重播時能在正確的 step 讓風扇消失。
   */
  private removeFan(): void {
    this.dispatchInput({ type: 'clearFan' });
  }

  /**
   * 「即時反映到目前場上的風扇（若有）」（issue #67）：場上沒有風扇就什麼都不做；
   * 有的話拿它目前的原點／方向／長度，換上最新的寬度／強度／衰減程度／頻率，
   * 整包重送一次 `setFan`（ADR-0010：`setFan` 本來就是整包覆蓋，不用先 `clearFan`）。
   * 比照 `clearPins`／`removeFan`：任何直接呼叫 `world.applyInput` 的分支都同時餵
   * 給 `clip.record`（錄製中才真的記下）——錄製中途調整滑桿，重播時風扇的
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
      ...this.toolParams.fan(),
    };
    this.dispatchInput(event);
  }

  /**
   * 所有「沙盒自己發的模擬事件」的單一出口（issue #95 收攏）：送進 `world.applyInput`，
   * 同時 `clip.record`（錄製中才真的記下）——ADR-0005「所有影響模擬的輸入
   * 都經 `applyInput`」，錄製中按下的按鈕才會落進 Action Track。指標事件（`ToolRouter`
   * 的 `emit`，見 `attachInputHandlers`）也直接走這裡——issue #123 起 Pin 工具由
   * `ToolRouter` 直送，不再另經 Pin 工具轉接。
   */
  private dispatchInput(event: InputEvent): void {
    this.world.applyInput(event);
    this.clip.record(event);
  }

  /**
   * 播放中 `Clip` 排定的事件的出口（`clip.step` 的 `dispatch`）：模擬事件進 `world.applyInput`、
   * 相機指令進 `cameraCommands`——跟即時輸入同一條窄介面（ADR-0005），但不經 `clip.record`
   * （播放中本來就不能錄）。
   */
  private dispatchScheduled = (event: DemoEvent): void => {
    if (isCameraCommand(event)) this.cameraCommands.push(event);
    else this.world.applyInput(event);
  };

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
   * 在播放。「有東西在播」直接問 `clip.phase`（issue #164），不另外開第二個播放狀態旗標
   * ——兩個旗標遲早會對不上。
   */
  private get hintsSuppressed(): boolean {
    return this.hideHintsDuringPlayback && this.clip.phase === 'playing';
  }

  /**
   * 每層提示「現在實際上該不該顯示」（issue #71）——沒被壓下時就是使用者的意圖
   * 原樣；被播放（`hintsSuppressed`）或乾淨畫面（issue #130）壓下時全體隱藏（這個開關是
   * 全域的，沒有逐層的覆寫，見 issue #64 Out of Scope；規則見 `visibleHints`）。
   * `applyHintVisibility`（推給各層）與 `frame()`（決定要不要花力氣算每幀的螢幕座標投影）
   * 共用這一份，兩邊才不會各判斷一次而分岔。
   */
  private effectiveHints(): Readonly<HintVisibility> {
    return visibleHints(this.hintIntent, {
      playback: this.hintsSuppressed,
      cleanView: this.cleanView.isActive,
    });
  }

  /**
   * 把 `effectiveHints()` 推到各個提示層（issue #71）——所有「提示的顯示狀態可能
   * 變了」的路徑都收斂到這一個出口：`setHintVisible`（五顆開關）、
   * `setHideHintsDuringPlayback`、播放開始／結束（`syncClip`）、重新
   * 匯入圖片換新 Renderer（`replaceJelly`）、進出乾淨畫面（`applyCleanView`）。日後多一層提示，要動的是
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
    if (!this.clip.allows('rebuildAll')) return;
    this.rebuildJellies(this.world.sceneSnapshot(), '重建失敗，場上的果凍維持不變');
  }

  /**
   * 重建的唯一實作（issue #90 / #95 / #98，見 GLOSSARY.md「重建」）：對 `entries` 裡的
   * 每一塊，用它自己的來源圖＋目前兩條拉霸，同 id 同圖同 `offset` 地 `remove` + `spawn`
   * （新 `meshParams`／`importSize`），之後 `setScene(sceneSnapshot())`——只改 Scene、
   * 不是 Track 事件（所以走 `world.applyInput` 而不是 `dispatchInput`：這件事不該被錄），
   * Track／群組／片段初始 Pin 都保留（B 包的「換網格清空」在 ADR-0013 已廢止）。
   *
   * 先把每塊的新網格都建好（`meshFor`，任何一塊失敗就整批放棄、場上不動＋提示），
   * 確定都成功才動場上的塊：不會重建到一半留下缺塊。失敗文案由呼叫端給（單塊與
   * 全場講法不同），跟 `runImport` 同一個手法。兩個入口（「全部重建」按鈕、
   * Jelly 右鍵選單的「重建」）在錄製中／播放中分別已被 `rebuildAll` 與 `runJellyMenuItem` 問過 `clip.allows` 擋掉，
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
    this.clip.stopPlayback();
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
    if (this.clip.phase === 'playing') {
      this.showNotice('播放中不能生成果凍——先按「停止／重設」');
      return;
    }
    this.spawnAt(world);
  }

  /**
   * Jelly 工具右鍵單擊點中某塊 Jelly（`ToolRouter` 的 `onJellyContextMenu`，issue #124）：
   * 在游標處開 [重建｜移除]，作用在**點中的那一塊**（id 在開選單當下就定下，之後場上
   * 怎麼變都不會換成別塊）。暫時不能用的項目變灰附原因（`jellyMenuItems` 問 `clip.allows`：
   * 播放中兩項都不行、錄製中不能重建）；選了之後再照同一組規則擋一次（`runJellyMenuItem`），因為選單
   * 開著的期間播放／錄製狀態可能已經變了。右鍵點空白處 `ToolRouter` 就不會叫到這裡。
   */
  private openJellyMenu(world: Point, screen: Point): void {
    const hit = this.world.pick(world.x, world.y);
    if (!hit) return;
    const items = jellyMenuItems({
      allows: (action) => this.clip.allows(action),
      phase: this.clip.phase,
    });
    this.contextMenu.open(screen, items, (item) => this.runJellyMenuItem(item, hit.jellyId));
  }

  /** 選單項目的分派口（issue #124），守衛問 `clip.allows`（同 `jellyMenuItems` 的鎖法）。 */
  private runJellyMenuItem(item: JellyMenuItemId, jellyId: string): void {
    if (!this.clip.allows(item === 'rebuild' ? 'rebuildJelly' : 'removeJelly')) {
      this.showNotice(
        this.clip.phase === 'playing'
          ? '播放中不能重建或移除果凍——先按「停止／重設」'
          : '錄製中不能重建——重建換的是佈景的網格，不是可以錄的事件',
      );
      return;
    }
    if (item === 'rebuild') this.rebuildJelly(jellyId);
    else this.removeJelly(jellyId);
  }

  /**
   * 剛剛那個動作要不要變成佈景的一部分（issue #97 收攏匯入／生成／移除三處；
   * ADR-0013）：不在錄製中 → 拍成新的 Scene（`停止／重設` 後還在）；錄製中 → 不動
   * Scene，那筆事件已經由 `dispatchInput` 錄進 Action Track（播到那步才發生、重設
   * 後不存在）。
   */
  private commitSceneUnlessRecording(): void {
    if (this.clip.phase !== 'recording') this.world.setScene(this.world.sceneSnapshot());
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
   * Track／群組／片段初始 Pin 與 Track／群組流水號取 `clip.toClipPart()`（issue #163）、
   * `sim` 帶滑桿原始值、Jelly／來源流水號由沙盒自己補上。欄位順序維持原樣（檔案內容不變）。
   */
  private buildClipState(): ClipState {
    const part = this.clip.toClipPart();
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
      tracks: part.tracks,
      groups: part.groups,
      setupPins: part.setupPins,
      counters: {
        ...part.counters,
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
   * 邊界模式（同時同步面板顯示）、所有 Track、所有群組、片段初始
   * Pin、流水號。拉霸 `importSize`／`meshDensity` 刻意不動：它們代表「下一次」。
   * 「最近匯入的圖」= 最大的 `sourceId`，由 `sources` 本身決定，不另外記。
   */
  private async applyClipState(state: ClipState): Promise<void> {
    const decoded = new Map<string, SourceImage>();
    for (const [id, image] of Object.entries(state.sources)) {
      decoded.set(id, { ...image, texture: await decodeTextureImage(image.bytes) });
    }
    // 網格先建好放在暫時的 memo，確定每塊都建得出來才動狀態（同 `meshFor` 的 key 與建法）。
    const memo = new Map<string, SimMesh>();
    for (const e of state.scene) {
      const key = meshKey(e.sourceId, e.meshParams, e.importSize);
      if (memo.has(key)) continue;
      memo.set(key, buildScaledMesh(decoded.get(e.sourceId)!.bytes, e.meshParams, e.importSize));
    }

    this.clip.halt();
    this.sources.clear();
    for (const [id, source] of decoded) this.sources.set(id, source);
    this.meshMemo.clear();
    this.spawnBboxMemo.clear();
    for (const [key, mesh] of memo) this.meshMemo.set(key, mesh);
    this.world.setScene(state.scene);
    this.world.reset();
    this.syncRenderer();
    this.cameraState = createCameraState({ bbox: this.currentBbox() }, this.canvasSize());
    this.cameraCommands = [];

    this.setSoftness(state.sim.softness);
    this.controlPanel.setSoftness(state.sim.softness);
    this.setTapStrength(state.sim.tapStrength);
    this.controlPanel.setTapStrength(state.sim.tapStrength);
    this.setGravity(state.sim.gravity);
    this.controlPanel.setGravity(state.sim.gravity);
    this.setBoundaryMode(state.sim.boundary);
    this.controlPanel.setBoundary(state.sim.boundary);

    this.nextJellyNum = state.counters.nextJellyNum;
    this.nextSourceNum = state.counters.nextSourceNum;
    this.clip.fromClipPart(state); // Track／群組／片段初始 Pin／兩個流水號（同步側欄由 Clip 回呼）
  }

  /** `ToolRouter` + `CameraInput` 都吃同一組 project／hitTest（picking 走 `World.pick`，跨所有塊）。 */
  private attachInputHandlers(canvas: HTMLCanvasElement): {
    router: ToolRouter;
    input: PointerInput;
    cameraInput: CameraInput;
  } {
    const project = (sx: number, sy: number) =>
      screenToWorld(this.cameraState.transform, this.canvasSize(), sx, sy);
    const hitTest = (world: { x: number; y: number }) => this.world.pick(world.x, world.y) != null;

    const router = new ToolRouter({
      params: this.toolParams,
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
      // 背景圖工具（issue #149）：判定與指令都是 `BackdropBoard` 的事，不經 `World`，也不錄進 Track。
      backdropHitTest: (world) => this.backdrops.hitTest(world),
      onBackdropCommand: (cmd) => {
        const menu = this.backdrops.command(cmd);
        // 右鍵選單跟 Jelly 選單共用同一個 `ContextMenu`。
        if (menu) this.contextMenu.open(menu.screen, menu.items, menu.pick);
      },
      // 游標標籤：右鍵＋滾輪此刻會調的那張（選中的，沒有就游標下的）目前的縮放或透明度（issue #150）。
      backdropCursorValue: (property, at) => this.backdrops.cursorValue(property, at),
      // 進 World + no-op 除非正在錄製（issue #29）。Pin 工具直接送 pin／unpin（issue #123），
      // 不再經 `routeForPinTool` 轉換。
      emit: (event) => this.dispatchInput(event),
    });
    const input = new PointerInput(canvas, router);
    const cameraInput = new CameraInput(canvas, {
      screenToWorld: project,
      // 觸控在背景上拖曳＝平移相機；背景圖工具下按在 Backdrop 上是拖那張圖，不算背景（issue #149）。
      // 歸不歸工具由目前的 adapter 回答（issue #161）。
      hitTest: (world) => hitTest(world) || router.ownsPointerAt(world),
      emit: (cmd) => this.emitCamera(cmd), // 進佇列 + no-op 除非正在錄製（issue #29 / #36）
      // 右鍵＋滾輪的退路在 `ToolRouter.wheel`（issue #161）：工具自己處理（背景圖調場上那張）
      // → 目前模式的工具參數 → 都沒有回 false，相機照舊縮放。同步拉霸、即時更新場上風扇
      // （錄製中照樣錄進 Track）都在 `onToolParamChange`，跟拖拉霸同一條路。
      adjustModeValue: (steps, sx, sy) => router.wheel(steps, sx, sy),
      onMiddleClick: () => this.cycleMode(), // 中鍵單擊輪替模式（issue #122）
      // 右鍵單擊交給目前工具（issue #124 / #125）：Jelly 開選單、電風扇點在風扇上＝移除。
      onRightClick: (world, sx, sy) => router.rightClick(world, sx, sy),
    });
    return { router, input, cameraInput };
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

    // 先量介面蓋住畫布多少（issue #138）——排在這一幀寫任何 DOM 之前，不會逼瀏覽器同步重排。
    this.refreshFitInsets();

    // 筆刷圓圈是**游標**不是提示（issue #69／#79）：它代替滑鼠指標本身，永遠
    // 不該落後指標，所以排在暫停守衛之前——暫停中果凍定格，但滑鼠還是會動。
    // 提示層（含編隊形狀預覽）則跟著暫停一起定格，見下方那一區。
    this.updateBrushCursor();
    // 游標標籤（issue #122）同理：游標回饋，跟著指標、不跟著暫停定格。
    this.updateCursorLabel();
    // 編隊形狀定義中的說明（issue #132）：暫停中也可能正在定義，一樣排在暫停守衛之前。
    this.updateFormationDefineHint();
    // 「生成 Jelly」的禁止游標跟著指標位置與邊界每幀重算（issue #97），理由同上：
    // 游標不該落後指標，所以一樣排在暫停守衛之前。
    this.applyCanvasCursor();
    // Backdrop（issue #148）不跟著暫停：暫停中照樣可以匯入、刪除。
    this.syncBackdrops();

    // 暫停中（issue #34）：略過固定步迴圈、PerfMonitor 取樣與相機更新——果凍
    // 定格在當下形變、播放秒數不動、鏡頭不動、排定事件不觸發——只重畫這一格。
    // `lastFrameMs` 上面已更新，暫停期間累積的真實時間全數丟棄，按繼續時
    // `accumulator` 不會突然吐出一大批步，決定性不受影響。
    if (this.clip.paused) {
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
      // 播放中送出這個 step 排定的事件（不再錄一次）；錄製中讓錄製時間軸前進一格，錄下的
      // 時間戳記才能對得上重播（issue #29）。自己播完時 `Clip` 切回閒置並回呼 `syncClip`。
      this.clip.step(this.dispatchScheduled);
      this.world.step(STEP_SECONDS);
    }
    if (this.clip.phase === 'playing') {
      // 面板的「目前 X.XX 秒」讀出（issue #34）——用 DemoRunner 的全域 sim step
      // 計數換算，暫停時 step 不前進、讀出跟著定住。
      this.controlPanel.setPlaybackTime(stepToSeconds(this.clip.playbackSteps));
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
    // 「鎖定跟隨」切換鈕同步到相機實際狀態（issue #36；issue #129 搬到畫布右下角）——相機軌
    // 播放的 `setState` 硬切、錄進去的 `setFollow`，或 `playAll` 重設鏡頭都會在使用者沒按鈕時
    // 改動 `followEnabled`，不同步就會脫鉤。`setFollowLocked` 值沒變不寫 DOM。
    this.controlPanel.setFollowLocked(!this.cameraState.followEnabled);
    // 縮放倍率讀數（issue #129）：相對「框住果凍」／自動跟隨的 zoom-to-fit 錨點——
    // 框好時是 ×1.0，手動拉近兩倍是 ×2.0。
    this.controlPanel.setZoomFactor(
      this.cameraState.transform.scale / fitTransform(this.lastBbox, this.canvasSize()).scale,
    );

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
    this.handfulRange.update(this.handfulRangeCircles());
  }

  /**
   * 這一幀的大把抓取範圍圈（issue #113；issue #135 加上編隊的每點大把）：
   *
   * - **大把模式**：一顆，在游標處；拖曳中 `canvasHover` 照樣更新，圈跟著游標。
   * - **編隊拖曳中**：每個這一抓真的抓到的點各一顆，半徑是按下當下的那個
   *   （`formation.activeGroups[].handfulRadius`；單點編隊的那一抓不畫）。按下之後才切走
   *   模式或關掉開關，這一抓仍照畫到放開——跟 `formationOverlayGroups` 同一條規則。
   * - **編隊＋每點大把、沒有進行中的一抓**：定義形狀中畫在已經點下的每個點上；否則畫在
   *   游標＋各偏移的位置（跟形狀預覽同一組點）。
   *
   * 半徑是世界座標，每幀換算成目前縮放下的螢幕像素。
   */
  private handfulRangeCircles(): HandfulRangeCircle[] {
    const scale = this.cameraState.transform.scale;
    const canvasSize = this.canvasSize();
    const circleAt = (p: Point, radius: number): HandfulRangeCircle => ({
      ...worldToScreen(this.cameraState.transform, canvasSize, p.x, p.y),
      radiusPx: radius * scale,
    });
    const hover = this.canvasHover.point;
    const handfulRadius = this.toolParams.get('handfulRadius');
    const active = this.router.formation.activeGroups;
    const circles: HandfulRangeCircle[] = [];
    for (const group of active) {
      const radius = group.handfulRadius;
      if (radius !== null) for (const p of group.points) circles.push(circleAt(p, radius));
    }
    if (this.isGrabMode('handful')) {
      if (hover) circles.push({ x: hover.x, y: hover.y, radiusPx: handfulRadius * scale });
    } else if (
      this.isGrabMode('formation') &&
      this.router.formation.perPointHandful &&
      active.length === 0
    ) {
      const points = this.router.formation.isDefining
        ? this.router.formation.definePreview
        : hover
          ? this.router.formation.previewAt(
              screenToWorld(this.cameraState.transform, canvasSize, hover.x, hover.y),
            )
          : [];
      for (const p of points) circles.push(circleAt(p, handfulRadius));
    }
    return circles;
  }

  /**
   * 這一幀編隊抓取提示要畫哪幾組（issue #68；issue #79 補上閒置時的懸停預覽）
   * ——三種狀態依序優先，任一時刻只會是其中一種：
   *
   * 1. **定義形狀中**：畫已經點下的那幾個點（還在累積，尚未成為形狀）。
   * 2. **拖曳中**：畫每個作用中手勢真正抓到的點（`formation.activeGroups` 只列
   *    `attached`，落在果凍外被跳過的偏移點不畫——issue #68 原設計）。
   * 3. **閒置**：形狀已定義、指標在畫布上 → 以指標處為主點畫整組形狀，按下去
   *    之前就看得到「這一下會抓哪幾點」。少了這一段，那顆顯示開關在平常什麼
   *    都看不到（issue #79 的起因）。指標不在畫布上（移到面板、離開視窗）或
   *    還沒定義過形狀 → 空陣列，不留鬼影。
   *
   * 按下的瞬間 3 換成 2：兩者都以指標為主點、偏移量相同，視覺上是同一組點接手，
   * 不會跳位。唯一的例外是「按下時整組點**一個都沒命中**果凍」——那時
   * 編隊 adapter 根本不建立 session（沒有任何 `grab` 送出去），`formation.activeGroups`
   * 是空的，於是落回 3 繼續畫預覽跟著游標。這是刻意的：那一下什麼都沒抓到，
   * 讓形狀繼續顯示才看得出「剛才那下落在果凍外了」，畫面整個空掉反而像壞了。
   */
  private formationOverlayGroups(canvasSize: CanvasSize): FormationOverlayGroup[] {
    const project = (p: Point) => worldToScreen(this.cameraState.transform, canvasSize, p.x, p.y);
    // 進行中的編隊手勢照畫到放開為止：按下之後才切走模式，這一組仍被抓著（issue #122）。
    const active = this.router.formation.activeGroups;
    if (active.length > 0) {
      return active.map((g) => ({ points: g.points.map(project) }));
    }
    // 定義中的點與懸停預覽只在編隊模式出現（issue #122）。
    if (!this.isGrabMode('formation')) return [];
    if (this.router.formation.isDefining) {
      return [{ points: this.router.formation.definePreview.map(project) }];
    }
    const hover = this.canvasHover.point;
    if (!hover) return [];
    const anchor = screenToWorld(this.cameraState.transform, canvasSize, hover.x, hover.y);
    const preview = this.router.formation.previewAt(anchor);
    return preview.length > 0 ? [{ points: preview.map(project) }] : [];
  }

  private onResize = (): void => {
    // 畫布尺寸交給 Renderer；相機下一幀的 `updateCamera` 會用新畫布尺寸重新 fit。
    this.renderer.resize(this.root.clientWidth, this.root.clientHeight);
  };

  private canvasSize(): CanvasSize {
    return {
      width: this.root.clientWidth,
      height: this.root.clientHeight,
      fitInsets: this.fitInsets,
    };
  }

  /**
   * 量畫布邊上被介面蓋住多少（issue #138）：底部的播放控制條、相機按鈕、匯入提示，以及
   * 展開的側欄。乾淨畫面藏起來的、收起的側欄都不算（量出來是 `null`），fit 回到整張畫布。
   */
  private refreshFitInsets(): void {
    const sidebar = this.controlPanel.isSidebarCollapsed()
      ? null
      : visibleRect(this.controlPanel.element);
    this.fitInsets = coveredInsets(this.root.getBoundingClientRect(), {
      bottom: [
        visibleRect(this.controlPanel.playbackBar),
        visibleRect(this.controlPanel.cameraControls),
        visibleRect(this.importHint),
      ],
      left: [sidebar],
    });
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

/**
 * 深拷貝一份相機狀態當快照（欄位形狀綁死 `CameraState`：`transform` 是唯一的巢狀
 * 物件，其餘是純量）——錄製起點傳給 `TrackRecorder`，之後 `updateCamera` 每幀回傳
 * 新物件不會動到它。
 */
function cloneCameraState(state: CameraState): CameraState {
  return { ...state, transform: { ...state.transform } };
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
