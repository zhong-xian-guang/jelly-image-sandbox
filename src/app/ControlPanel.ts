/**
 * `ControlPanel`（issue #14 / T13）——玩家可調 UI。
 *
 * 薄的 DOM 接線層（對照 `PointerInput`/`CameraInput`/`DropImportInput`）：建控制
 * 項、聽使用者操作、透過回呼往外送——不知道 `SimCore`/`JellySandbox` 的存在，
 * 邏輯（Softness 曲線、Walled 邊界範圍、Pin 工具轉接）都在各自的純函式模組
 * （`../sim/softness`、`./boundaryGeometry`、`../input/ToolRouter`），接線在
 * `JellySandbox`。
 *
 * **工具列**（issue #122 / V4 T1；ADR-0016，取代原本「▸ 沙盒工具」收合區塊裡的下拉）：
 * 側欄最上方每個工具一顆按鈕（圖示＋文字），目前工具高亮；正下方是目前工具的參數卡，
 * 有模式的工具（抓取、Pin）參數卡最上方是模式切換鈕。面板自己記一份高亮狀態只為了畫——
 * 真正的狀態在 `ToolRouter`，中鍵單擊輪替後由 `JellySandbox` 呼叫 `setToolMode` 灌回來
 * （跟 `setSoftness` 同一個「只動 DOM、不回呼」的慣例）。
 *
 * 「Pin」工具（issue #115；issue #123 合併撒 Pin、移除 Pin，模式為放／拔）的參數卡是
 * 模式鈕、Pin 筆刷半徑、撒 Pin 間距。選著它時 `JellySandbox` 會把畫布游標換成十字，
 * 拔模式下再把 `PinMarkers` 標記切成「可點掉」的視覺（紅色脈動）。
 *
 * 「顯示 Pin」關掉時，所見即所得：畫面上看不到 Pin 標記，「清除所有 Pin」按鈕就
 * 跟著鎖住（`disabled`）——不能對看不見的東西下手。
 *
 * 「顯示網格」是純 debug 用的三角化線框開關，接 `JellyRenderer.setWireframeVisible`。
 *
 * 「播放時隱藏提示」（issue #71）是蓋過面板上每一顆提示顯示開關的全域一列
 * （顯示網格、顯示 Pin，加上工具區塊裡的顯示風扇範圍／圖示、顯示編隊抓取提示）
 * ——播放中一律暫時隱藏、播完各自還原，實際的壓下／還原在
 * `JellySandbox.applyHintVisibility`。它自己不受播放／錄製鎖定影響（見
 * `onHideHintsDuringPlaybackChange`）。
 *
 * 「Demo」按鈕（issue #15）播放中會被 `JellySandbox` 呼叫 `setPlaybackControlsEnabled(false)`
 * 全部鎖住，理由同上——避免疊加播放兩個 Demo 留下沒人清的殘留 Pin/Grab。
 *
 * 「Track」錄製（issue #29 / V2 T1a）：一顆「開始錄製／停止錄製」切換鈕，錄製中
 * 文字變色＋脈動（`.jelly-recording-active`，樣式見
 * `style.css`）——低頭一眼就知道現在正在錄。停止後解鎖「播放 Track」按鈕重播剛
 * 錄好的那條。`setPlaybackControlsEnabled(false)` 也會一併鎖住這兩顆鈕：Track
 * 重播跟 Demo 播放共用同一個 `DemoRunner`，播放中不能再錄一次或重疊播放。
 *
 * **畫布上的控制**（issue #129 / V4 U2；spec #127「播放控制條」「相機按鈕」）：錄製、播放、
 * 暫停／繼續、停止／重設與時間讀數是畫布底部中央的 `playbackBar`；「鎖定跟隨」「框住果凍」
 * 與縮放倍率讀數是畫布右下角的 `cameraControls`（DOM 見 `./CanvasControls`）。兩者由面板
 * 建出、但不在側欄裡，`JellySandbox` 把它們掛到畫布容器上；可用狀態照舊在
 * `updateTrackControlsState` 一處算，對外的 `setRecordingActive`／`setPlaybackActive`／
 * `setPaused`／`setPlaybackTime`／`setFollowLocked` 名稱不變。
 *
 * **分區與收起**（issue #128 / V4 U1；spec #127「側欄」）：最上方是側欄標題列（「收起側欄」
 * 鈕；之後的乾淨畫面、「?」也放這裡，見 `titleBarActions`），底下工具列＋參數卡常駐，再往下
 * 是七個可收合的分區（`PANEL_SECTION_IDS`：匯入、片段、物理、檢視、Demo、錄製、開發者），
 * 點標題展開／收起。預設只有物理展開；各區展開狀態與側欄收起狀態存在 `localStorage`
 * （`./panelLayout`，讀不到就用預設）。收起側欄時整塊縮成畫面左緣的小把手，點把手再展開。
 * 分區只是換位置：每顆控制的鎖定規則（播放中、錄製中變灰）跟分區前一樣。
 *
 * **防呆與拉霸**（issue #131 / V4 U4；spec #127）：「清空全部」「全部重建」要再按一次確認
 * （3 秒內；被鎖住時取消待確認）。每條拉霸都是「拉霸＋數值」元件：旁邊顯示數值、雙擊回到
 * 預設值；`setSoftness` 等外部灌值同步數值、不回呼。兩者都在 `./panelControls`。
 *
 * 「Substep」是 issue #16 追加的唯讀 debug 讀出，`JellySandbox` 每幀呼叫
 * `setPerfStatus` 同步目前的 `PerfMonitor.substeps` / `degraded`——手動測試「節流
 * CPU 降級」時（見該 issue 驗收條件）用眼睛確認 4→2→4 有沒有真的發生，不用開
 * DevTools 斷點。`setPerfStatus` 內部比對是否真的變了才寫 DOM，值沒變的每幀呼叫
 * 不會產生多餘的 reflow（在想省效能的降級路徑上，多餘 DOM 寫入是反效果）。
 */

import {
  modesOf,
  TOOL_IDS,
  type ModalToolId,
  type ModeValueKey,
  type ToolId,
  type ToolMode,
  type ToolModeOf,
} from '../input';
import type { BoundaryMode } from '../sim';
import { TOOL_HELP_LINES } from './helpText';
import {
  browserStorage,
  loadPanelLayout,
  PANEL_SECTION_IDS,
  savePanelLayout,
  type KeyValueStorage,
  type PanelLayout,
  type PanelSectionId,
} from './panelLayout';
import { CameraControls, PlaybackBar } from './CanvasControls';
import {
  confirmOnSecondClick,
  createRangeSlider,
  setRangeSliderValue,
  type ConfirmButton,
  type RangeSlider,
} from './panelControls';
import { MODE_LABELS, TOOL_LABELS } from './toolLabels';
import type { RecordTarget } from './track';

export type { PanelSectionId } from './panelLayout';

/** 各分區標題（issue #128）。 */
const SECTION_TITLES: Record<PanelSectionId, string> = {
  import: '匯入',
  clip: '片段',
  physics: '物理',
  view: '檢視',
  demo: 'Demo',
  record: '錄製',
  dev: '開發者',
};

/** 分區 body 的 DOM id 流水號——`aria-controls` 要指到唯一的 id，同頁可能有多個面板（測試）。 */
let nextSectionDomId = 0;

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
  /** 工具列目前工具的初始值（issue #65；issue #122 改成工具列）。 */
  activeTool: ToolId;
  /** 每個有模式的工具目前的模式（issue #122）——參數卡模式鈕的初始高亮。 */
  toolModes: { [T in ModalToolId]: ToolModeOf<T> };
  /** 「顯示游標標籤」開關的初始值（issue #122）——見 `onShowCursorLabelChange`。 */
  showCursorLabel: boolean;
  boundary: BoundaryMode;
  /** Softness 滑桿目前值，0–1（見 `../sim/softness`）。 */
  softness: number;
  tapStrength: number;
  /** 「重力」拉霸的初始值（issue #91 / V3 T2-1；ADR-0012），世界單位／s²，0 = 俯視無重力。 */
  gravity: number;
  /** Pin 標記顯示開關；關閉時「清除所有 Pin」一併鎖住。 */
  showPins: boolean;
  followLocked: boolean;
  /** 網格線框開關（debug 用）。 */
  showWireframe: boolean;
  /** 「錄製目標」選擇器的初始值（issue #33）。 */
  recordTarget: RecordTarget;
  /**
   * 電風扇「範圍」／「圖示」顯示開關（issue #66；issue #67 事後檢視拆成兩顆
   * ——原本一顆「顯示風扇提示」同時管兩者，但矩形範圍（評估推力涵蓋區）跟
   * 圖示（風扇長相）是兩種不同用途的視覺，使用者可能只想看其中一種）。
   */
  showFanRange: boolean;
  showFanIcon: boolean;
  /** 電風扇四個滑桿的初始值（issue #67）——見 `../input` 的 `DEFAULT_FAN_*`。 */
  fanWidth: number;
  fanStrength: number;
  fanFalloffExponent: number;
  fanFrequency: number;
  /** 編隊抓取形狀標記顯示開關的初始值（issue #68）。 */
  showFormationHint: boolean;
  /** Pin 筆刷半徑拉霸的初始值（issue #123）——見 `../input` 的 `DEFAULT_PIN_BRUSH_RADIUS`。 */
  pinBrushRadius: number;
  /** 撒 Pin 間距拉霸的初始值（issue #69）——見 `../input` 的 `DEFAULT_SPRAY_SPACING`。 */
  spraySpacing: number;
  /** 大把抓取半徑拉霸的初始值（issue #113）——見 `../input` 的 `DEFAULT_HANDFUL_RADIUS`。 */
  handfulRadius: number;
  /** 大把抓取範圍圈（提示）顯示開關的初始值（issue #113）。 */
  showHandfulRange: boolean;
  /** 「播放時隱藏提示」全域開關的初始值（issue #71）——見 `onHideHintsDuringPlaybackChange`。 */
  hideHintsDuringPlayback: boolean;
  /** 「匯入尺寸」拉霸的初始值（issue #88 / V3 T1-1），世界單位——見 `onImportSizeChange`。 */
  importSize: number;
  /** 「網格密度」拉霸的初始值（issue #89 / V3 T1-2），Particle 數——見 `onMeshDensityChange`。 */
  meshDensity: number;
}

/** 一個數值滑桿的範圍（issue #67 抽出——`tapStrengthRange` 與三個電風扇範圍共用同一形狀）。 */
export interface RangeSpec {
  min: number;
  max: number;
  step: number;
}

export interface ControlPanelOptions {
  initial: ControlPanelInitial;
  tapStrengthRange: RangeSpec;
  /** 「重力」拉霸的範圍（issue #91）。 */
  gravityRange: RangeSpec;
  /** 電風扇「寬度」／「強度」／「衰減程度」／「頻率」四個滑桿各自的範圍（issue #67）。 */
  fanWidthRange: RangeSpec;
  fanStrengthRange: RangeSpec;
  fanFalloffRange: RangeSpec;
  fanFrequencyRange: RangeSpec;
  /** 「Pin 筆刷半徑」（issue #123）／「撒 Pin 間距」（issue #69）兩條拉霸各自的範圍。 */
  pinBrushRadiusRange: RangeSpec;
  spraySpacingRange: RangeSpec;
  /** 「大把抓取半徑」拉霸的範圍（issue #113）。 */
  handfulRadiusRange: RangeSpec;
  /** 「匯入尺寸」拉霸的範圍（issue #88）。 */
  importSizeRange: RangeSpec;
  /** 「網格密度」拉霸的範圍（issue #89）。 */
  meshDensityRange: RangeSpec;
  /** 「Demo」按鈕列表（issue #15），依序顯示；點下呼叫 `onRunDemo(id)`。 */
  demos: readonly DemoMenuItem[];
  /**
   * 存側欄版面（各分區展開、側欄收起）的地方（issue #128）。省略＝瀏覽器的
   * `localStorage`（拿不到就不存）；`null`＝不存。測試塞記憶體版本，避免跨測試殘留。
   */
  storage?: KeyValueStorage | null;
  /**
   * 「匯入圖片」按鈕被按（issue #56 / V2 T2-3）——開瀏覽器原生檔案選擇器，選到的圖
   * 走跟拖放匯入完全相同的後續路徑。（角落常駐提示字點擊也開同一個選擇器，但那條
   * 由 `JellySandbox` 直接接在提示字元素上，不經這個回呼。）
   */
  onImportImage: () => void;
  /**
   * 「儲存片段」按鈕被按（issue #57 / V2 T2-4）——把目前整個片段序列化成一個帶
   * 時間戳的 `.json` 下載。任何時候都可用（含還沒匯入任何圖、只有內建預設果凍時）。
   */
  onSaveClip: () => void;
  /**
   * 「載入片段」按鈕被按（issue #58 / V2 T2-5）——開檔案選擇器挑一個 `.json` 片段檔，
   * 整包取代目前場景（走跟「重新匯入圖片」相同的收束路徑）。
   */
  onLoadClip: () => void;
  /**
   * 工具列按鈕被按（issue #65；issue #122 改成工具列）——切換給 `JellySandbox` 轉發到
   * `PointerInput.setActiveTool`。
   */
  onToolChange: (tool: ToolId) => void;
  /**
   * 參數卡的模式鈕被按（issue #122）——`JellySandbox` 轉發到 `PointerInput.setMode`，
   * 並同步游標標籤與提示。跟中鍵單擊輪替走同一條路。
   */
  onModeChange: (tool: ModalToolId, mode: ToolMode) => void;
  /**
   * 「顯示游標標籤」開關（issue #122）——游標標籤不是提示（CONTEXT.md「提示」），不受
   * 「播放時隱藏提示」影響、也不被播放／錄製鎖住，只聽這一顆。
   */
  onShowCursorLabelChange: (visible: boolean) => void;
  /**
   * 「移除風扇」按鈕被按（issue #66）——動作上比照「清除所有 Pin」：一個無座標的
   * `clearFan` 經 `applyInput` 送進去，清掉場上目前的風扇（若有）。**不**跟著
   * 「顯示風扇提示」關閉而鎖住——跟 Pin 標記是「唯一」的視覺存在不同，風扇即使
   * 藏起提示，玩家仍能從果凍被持續吹動的效果看出它還在，所見即所得的理由在這裡
   * 不成立，兩顆控制項刻意保持互相獨立。
   */
  onRemoveFan: () => void;
  /**
   * 「顯示風扇範圍」／「顯示風扇圖示」兩個開關（issue #66；issue #67 事後檢視
   * 拆成兩顆，見 `ControlPanelInitial.showFanRange`／`showFanIcon`）——各自只管
   * `FanOverlay` 矩形外框／圖示其中一半的顯示／隱藏，純視覺；跟「移除風扇」
   * 按鈕的可用狀態無關（理由見 `onRemoveFan`）。
   */
  onShowFanRangeChange: (visible: boolean) => void;
  onShowFanIconChange: (visible: boolean) => void;
  /**
   * 電風扇「寬度」／「強度」／「衰減程度」／「頻率」滑桿變更（issue #67）——
   * 即時反映到場上目前的風扇（若有）與下一次放置，兩件事都交給 `JellySandbox`
   * 處理：`ControlPanel` 只負責把滑桿的新數值原封不動送出去。
   */
  onFanWidthChange: (width: number) => void;
  onFanStrengthChange: (strength: number) => void;
  onFanFalloffChange: (falloffExponent: number) => void;
  onFanFrequencyChange: (frequency: number) => void;
  /**
   * 「開始設定形狀」／「重新設定編隊形狀」按鈕被按（issue #68）——面板用同一顆
   * 按鈕依目前是否在定義中／是否已有形狀切換文字（見 `formationParams`），按下
   * 時進入定義模式；`onFormationDefineEnd` 是它在定義中被按第二次（此時文字是
   * 「完成設定」）時呼叫。
   */
  onFormationDefineStart: () => void;
  onFormationDefineEnd: () => void;
  /** 「顯示編隊抓取提示」開關（issue #68）——同 `onShowFanRangeChange` 的理由，純視覺。 */
  onShowFormationHintChange: (visible: boolean) => void;
  /**
   * 「Pin 筆刷半徑」（issue #123；撒 Pin 與橡皮擦共用）／「撒 Pin 間距」（issue #69）拉霸
   * 變更——比照四個電風扇滑桿，`ControlPanel` 只負責把新數值原封不動送出去，影響之後的
   * 撒／擦與畫布上的筆刷圓圈（已經撒出去的 Pin 是既成事實，不會回頭重排）。
   */
  onPinBrushRadiusChange: (radius: number) => void;
  onSpraySpacingChange: (spacing: number) => void;
  /**
   * 「大把抓取半徑」拉霸變更（issue #113 / V3 T4-1）——影響下一次按下（已抓住的那一把
   * 不變）與畫布上的範圍圈，兩件事都交給 `JellySandbox`。
   */
  onHandfulRadiusChange: (radius: number) => void;
  /** 「顯示大把抓取範圍」開關（issue #113）——範圍圈是提示層，同 `onShowFormationHintChange`，純視覺。 */
  onShowHandfulRangeChange: (visible: boolean) => void;
  /**
   * 「播放時隱藏提示」全域開關（issue #71 / V2 T3-7）——開啟後只要有任何 Track／
   * Demo 在播放，所有視覺提示（顯示網格／顯示 Pin／風扇範圍／風扇圖示／編隊抓取
   * 提示）一律暫時隱藏，播放結束再各自恢復原本的開關狀態；實際的壓下／還原在
   * `JellySandbox`，面板這邊只送出新值。是**全域**的一列、不屬於任何工具專屬
   * 區塊，而且刻意不被 `setPlaybackControlsEnabled`／`setRecordingActive` 鎖住
   * ——播放中臨時想看一眼提示（或反過來）隨時都能切。
   */
  onHideHintsDuringPlaybackChange: (enabled: boolean) => void;
  /**
   * 「匯入尺寸」拉霸變更（issue #88 / V3 T1-1，見 CONTEXT.md「匯入尺寸」）——
   * 只影響**下一次**匯入的果凍最長邊有多少世界單位，場上的果凍不跟著變，所以
   * 這條拉霸刻意不被 `setPlaybackControlsEnabled`／`setRecordingActive` 鎖住，
   * 也不因載入片段而被改寫（拉霸永遠代表「下一次」的意圖）。
   */
  onImportSizeChange: (size: number) => void;
  /**
   * 「網格密度」拉霸變更（issue #89 / V3 T1-2，見 CONTEXT.md「網格密度」）——下一次
   * 匯入的 `targetParticleCount`。同 `onImportSizeChange`：只管「下一次」，不鎖、不因
   * 載入片段而改寫。效能退路壓拉霸走 `setMeshDensity`（只動顯示），不會回到這裡。
   */
  onMeshDensityChange: (density: number) => void;
  /**
   * 「全部重建」按鈕被按（issue #90 / V3 T1-3，見 CONTEXT.md「重建」）——對場上
   * **每一塊**用它自己的來源圖＋目前兩條拉霸重新生成網格（位置不變、Pin 掉光）。
   * 跟兩條拉霸不同，這顆**會**被 `setPlaybackControlsEnabled`／`setRecordingActive`
   * 鎖住（比照片段初始 Pin 兩顆鈕）：重建只改 Scene、不是 Track 事件（ADR-0013），
   * 錄製中／播放中按下沒意義。issue #95 起對每一塊重建、不再清空 Track；issue #98
   * 起面板文字是「全部重建」，跟只重建一塊的「重建 Jelly」工具成對。
   */
  onRebuildAll: () => void;
  /**
   * 「清空全部」按鈕被按（issue #95 / V3 T3-2；ADR-0013）——把 Scene、Track、群組、片段
   * 初始 Pin、來源圖庫一起清成一個新片段（空桌面）。匯入／生成／移除本身不再清任何
   * 東西，這是唯一會清掉片段的入口。錄製中／播放中鎖住（比照「重建」）。
   */
  onClearAll: () => void;
  onBoundaryChange: (mode: BoundaryMode) => void;
  onSoftnessChange: (t: number) => void;
  onTapStrengthChange: (strength: number) => void;
  /**
   * 「重力」拉霸變更（issue #91 / V3 T2-1；ADR-0012）——拖動立刻套進 `sim.params.gravity`。
   * 載入片段走 `setGravity`（只動顯示），不會回到這裡。
   */
  onGravityChange: (gravity: number) => void;
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
  /**
   * 側欄標題列右側放控制鈕的容器（issue #128）——目前只有「收起側欄」；乾淨畫面（#130）
   * 與「?」操作說明（#132）的按鈕往這裡 `prepend`／`append`。
   */
  readonly titleBarActions: HTMLElement;
  /** 標題列＋可捲動的內容；收起側欄時整塊 `hidden`（issue #128）。 */
  private readonly main: HTMLElement;
  /** 收起側欄後畫面左緣的小把手，點了展開（issue #128）。 */
  private readonly handle: HTMLButtonElement;
  /** 各分區的標題鈕與內容（issue #128）——`setSectionExpanded` 切 `hidden`／`aria-expanded`。 */
  private readonly sections = new Map<
    PanelSectionId,
    { header: HTMLButtonElement; body: HTMLElement }
  >();
  /** 目前的側欄版面（issue #128）——每次變動整份寫回 `storage`。 */
  private readonly layout: PanelLayout;
  private readonly storage: KeyValueStorage | null;
  /** 播放中鎖住，避免疊加播放兩個 Demo（issue #15）——見 `setPlaybackControlsEnabled`。 */
  private readonly demoButtons: HTMLButtonElement[] = [];
  /**
   * 畫布底部中央的播放控制條（issue #129）——[● 錄製] [▶ 播放] [⏸ 暫停／繼續] [■ 停止／重設]
   * ＋時間讀數。不在側欄裡：`JellySandbox` 把它掛到畫布容器上；可用狀態仍由這裡的
   * `updateTrackControlsState` 統一算（見 `./CanvasControls`）。
   */
  readonly playbackBar: HTMLElement;
  /**
   * 畫布右下角的相機按鈕（issue #129）——「鎖定跟隨」切換鈕、「框住果凍」、縮放倍率讀數。
   * 同上，由 `JellySandbox` 掛到畫布容器上。
   */
  readonly cameraControls: HTMLElement;
  private readonly bar: PlaybackBar;
  private readonly camera: CameraControls;
  private readonly recordTargetSelect: HTMLSelectElement;
  /**
   * 「片段初始 Pin：N 個 ｜ 設為目前 Pin ｜ 清除」列（issue #39 / ADR-0007 追記）
   * ——片段層級的狀態，不受 Track 數量影響。`setSetupPinCount` 更新數字；錄製中／
   * 播放中兩顆鈕跟著 Track 清單編輯一起鎖住（見 `updateTrackControlsState`）。
   */
  private readonly setupPinsCountEl: HTMLElement;
  private readonly setupPinsSnapshotButton: HTMLButtonElement;
  private readonly setupPinsClearButton: HTMLButtonElement;
  /** 「全部重建」鈕（issue #90）——錄製中／播放中鎖住，見 `updateTrackControlsState`。 */
  private readonly rebuildAllButton: HTMLButtonElement;
  /** 「清空全部」鈕（issue #95）——同上鎖法。 */
  private readonly clearAllButton: HTMLButtonElement;
  /** 上面兩顆的「再按一次確認」（issue #131）——被鎖住時 `cancel()` 取消待確認。 */
  private readonly rebuildAllConfirm: ConfirmButton;
  private readonly clearAllConfirm: ConfirmButton;
  /** 工具列按鈕與各工具的參數卡（issue #122）——`setActiveTool` 切高亮與顯示。 */
  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private readonly toolCards = new Map<ToolId, HTMLElement>();
  /** 各有模式工具的模式鈕（issue #122）——`setToolMode` 切高亮。 */
  private readonly modeButtons = new Map<ModalToolId, Map<ToolMode, HTMLButtonElement>>();
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
  /**
   * Softness／輕拍力道／重力滑桿與邊界模式下拉——`JellySandbox.applyClipState`（issue #58）
   * 載入片段後靠 `setSoftness`／`setTapStrength`／`setGravity`／`setBoundary` 把存檔值
   * 灌回面板，不然面板顯示的滑桿位置會跟載入後實際生效的物理參數不一致。
   */
  private readonly softnessInput: HTMLInputElement;
  private readonly tapStrengthInput: HTMLInputElement;
  /** 「重力」拉霸（issue #91）——`setGravity` 連同旁邊的數值一起更新。 */
  private readonly gravityInput: HTMLInputElement;
  private readonly boundarySelect: HTMLSelectElement;
  /** 「網格密度」拉霸——效能退路 `setMeshDensity` 連同旁邊的數值一起更新（issue #89）。 */
  private readonly meshDensityInput: HTMLInputElement;
  /** 「右鍵＋滾輪」調得到的數值拉霸（issue #114；issue #122 推廣）——經 `setModeValue` 灌回。 */
  private readonly valueInputs: Record<ModeValueKey, HTMLInputElement>;

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
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    this.layout = loadPanelLayout(this.storage);

    this.perfStatus = this.perfStatusRow();

    // 畫布上的播放控制條與相機按鈕（issue #129）——不進任何分區。
    this.bar = new PlaybackBar({
      onToggleRecording: opts.onToggleRecording,
      onPlayAll: opts.onPlayAll,
      onTogglePause: opts.onTogglePause,
      onReset: opts.onReset,
    });
    this.playbackBar = this.bar.element;
    this.camera = new CameraControls({
      followLocked: opts.initial.followLocked,
      onFollowLockChange: opts.onFollowLockChange,
      onFrameJelly: opts.onFrameJelly,
    });
    this.cameraControls = this.camera.element;

    const pinRows = this.pinRows(opts.initial.showPins, opts.onClearPins, opts.onShowPinsChange);

    const boundary = this.boundaryRow(opts.initial.boundary, opts.onBoundaryChange);
    this.boundarySelect = boundary.select;
    const softness = this.rangeRow(
      '軟硬度',
      0,
      1,
      0.01,
      opts.initial.softness,
      opts.onSoftnessChange,
    );
    this.softnessInput = softness.input;
    const tapStrength = this.rangeRow(
      '輕拍力道',
      opts.tapStrengthRange.min,
      opts.tapStrengthRange.max,
      opts.tapStrengthRange.step,
      opts.initial.tapStrength,
      opts.onTapStrengthChange,
    );
    this.tapStrengthInput = tapStrength.input;
    const gravity = createRangeSlider(
      '重力',
      opts.gravityRange,
      opts.initial.gravity,
      opts.onGravityChange,
    );
    this.gravityInput = gravity.input;
    const importSize = createRangeSlider(
      '匯入尺寸',
      opts.importSizeRange,
      opts.initial.importSize,
      opts.onImportSizeChange,
    );
    const meshDensity = createRangeSlider(
      '網格密度',
      opts.meshDensityRange,
      opts.initial.meshDensity,
      opts.onMeshDensityChange,
    );
    this.meshDensityInput = meshDensity.input;

    const fanWidth = this.rangeRow(
      '風扇寬度',
      opts.fanWidthRange.min,
      opts.fanWidthRange.max,
      opts.fanWidthRange.step,
      opts.initial.fanWidth,
      opts.onFanWidthChange,
    );
    const fanStrength = this.rangeRow(
      '風扇強度',
      opts.fanStrengthRange.min,
      opts.fanStrengthRange.max,
      opts.fanStrengthRange.step,
      opts.initial.fanStrength,
      opts.onFanStrengthChange,
    );
    const fanFalloff = this.rangeRow(
      '風扇衰減程度',
      opts.fanFalloffRange.min,
      opts.fanFalloffRange.max,
      opts.fanFalloffRange.step,
      opts.initial.fanFalloffExponent,
      opts.onFanFalloffChange,
    );
    const fanFrequency = this.rangeRow(
      '風扇頻率',
      opts.fanFrequencyRange.min,
      opts.fanFrequencyRange.max,
      opts.fanFrequencyRange.step,
      opts.initial.fanFrequency,
      opts.onFanFrequencyChange,
    );

    // 電風扇專屬參數（issue #67 事後檢視拆成兩顆顯示開關；「顯示風扇提示」→
    // 「顯示風扇範圍」／「顯示風扇圖示」，見 `ControlPanelInitial.showFanRange`
    // ／`showFanIcon` 的說明）。這整包只在目前工具是電風扇時才需要看到
    // （見下方 `toolbarSection`），先組起來、`hidden` 依目前工具切換。issue #125：最上方
    // 加模式鈕（右鍵＋滾輪要調哪個參數），順序照 spec #121「側欄」——模式鈕、四條拉霸、
    // 兩個顯示開關、移除風扇。
    const fanParams = this.toolParams('電風扇', [
      this.modeRow('fan', opts.initial.toolModes.fan, opts.onModeChange),
      fanWidth.row,
      fanStrength.row,
      fanFalloff.row,
      fanFrequency.row,
      this.checkboxRow('顯示風扇範圍', opts.initial.showFanRange, opts.onShowFanRangeChange),
      this.checkboxRow('顯示風扇圖示', opts.initial.showFanIcon, opts.onShowFanIconChange),
      this.buttonRow('移除風扇', opts.onRemoveFan),
    ]);

    // Pin 工具的參數卡（issue #123：Pin、撒 Pin、移除 Pin 合成 Pin 工具）——模式鈕、Pin 筆刷
    // 半徑（撒 Pin 與橡皮擦共用，同時是畫布上那圈筆刷游標的大小，見 `BrushCursor`，所以
    // 調半徑是所見即所得）、撒 Pin 間距。
    const pinBrushRadiusRow = this.rangeRow(
      'Pin 筆刷半徑',
      opts.pinBrushRadiusRange.min,
      opts.pinBrushRadiusRange.max,
      opts.pinBrushRadiusRange.step,
      opts.initial.pinBrushRadius,
      opts.onPinBrushRadiusChange,
    );
    const pinParams = this.toolParams('Pin', [
      this.modeRow('pin', opts.initial.toolModes.pin, opts.onModeChange),
      pinBrushRadiusRow.row,
      this.rangeRow(
        '撒 Pin 間距（越小越密）',
        opts.spraySpacingRange.min,
        opts.spraySpacingRange.max,
        opts.spraySpacingRange.step,
        opts.initial.spraySpacing,
        opts.onSpraySpacingChange,
      ).row,
    ]);

    // 抓取工具的參數卡（issue #122：一般操作／大把抓取／編隊抓取合成抓取工具）——模式鈕、
    // 大把抓取半徑（issue #113）、兩顆提示開關、編隊形狀的設定按鈕（issue #68）。
    const handfulRadiusRow = this.rangeRow(
      '大把抓取半徑',
      opts.handfulRadiusRange.min,
      opts.handfulRadiusRange.max,
      opts.handfulRadiusRange.step,
      opts.initial.handfulRadius,
      opts.onHandfulRadiusChange,
    );
    const grabParams = this.toolParams('抓取', [
      this.modeRow('grab', opts.initial.toolModes.grab, opts.onModeChange),
      handfulRadiusRow.row,
      this.checkboxRow(
        '顯示大把抓取範圍',
        opts.initial.showHandfulRange,
        opts.onShowHandfulRangeChange,
      ),
      this.checkboxRow(
        '顯示編隊抓取提示',
        opts.initial.showFormationHint,
        opts.onShowFormationHintChange,
      ),
      this.formationDefineRow(opts.onFormationDefineStart, opts.onFormationDefineEnd),
    ]);

    this.valueInputs = {
      pinBrushRadius: pinBrushRadiusRow.input,
      handfulRadius: handfulRadiusRow.input,
      fanWidth: fanWidth.input,
      fanStrength: fanStrength.input,
      fanFalloffExponent: fanFalloff.input,
      fanFrequency: fanFrequency.input,
    };

    // Jelly 工具的參數卡（issue #124：生成、移除、重建 Jelly 合成 Jelly 工具）——沒有模式也
    // 沒有參數，只有每張卡底下共用的那行操作說明（issue #132，見 `toolbarSection`）：移除與
    // 重建藏在畫布上的右鍵選單，不寫出來沒人會發現。
    const jellyParams = this.toolParams('Jelly', []);

    const toolbarSection = this.toolbarSection(
      opts.initial.activeTool,
      { grab: grabParams, pin: pinParams, fan: fanParams, jelly: jellyParams },
      opts.onToolChange,
    );

    // 「全部重建」鈕（issue #90）放在「匯入」區最後：拉完拉霸按一下就看到效果。
    const rebuildAll = this.rebuildAllRow();
    this.rebuildAllButton = rebuildAll.button;
    // 「清空全部」「全部重建」都要再按一次確認（issue #131；spec #127「防呆」）：一次誤觸
    // 就會丟掉整個片段／讓 Pin 掉光。
    this.rebuildAllConfirm = confirmOnSecondClick(rebuildAll.button, opts.onRebuildAll);
    // 「清空全部」（issue #95）跟儲存／載入片段排成一列（issue #128）：它是「新片段」的入口，
    // 跟「載入片段」同一組語意（整份片段換掉），放一起最直覺。
    const clearAllButton = this.button('清空全部');
    clearAllButton.title = '清掉桌上所有果凍、Track、群組與片段初始 Pin，從空桌面重新開始';
    this.clearAllButton = clearAllButton;
    this.clearAllConfirm = confirmOnSecondClick(clearAllButton, opts.onClearAll);
    const clipRow = document.createElement('div');
    clipRow.className = 'jelly-control-row jelly-clip-row';
    clipRow.append(
      this.button('儲存片段', opts.onSaveClip),
      this.button('載入片段…', opts.onLoadClip),
      clearAllButton,
    );

    const target = this.recordTargetRow(opts.initial.recordTarget, opts.onRecordTargetChange);
    this.recordTargetSelect = target.select;
    const setupPins = this.setupPinsRow(opts.onSnapshotSetupPins, opts.onClearSetupPins);
    this.setupPinsCountEl = setupPins.countEl;
    this.setupPinsSnapshotButton = setupPins.snapshotButton;
    this.setupPinsClearButton = setupPins.clearButton;

    // 依群組分區的 Track 清單（issue #43）——群組標頭 + 底下該群組的成員卡片。
    this.groupedTracksEl = document.createElement('div');
    this.groupedTracksEl.className = 'jelly-grouped-tracks';
    const addGroup = this.addGroupRow(() => this.onAddGroup());
    this.addGroupButton = addGroup.button;

    // 各分區內容（issue #128；spec #127「側欄」的表格）。
    const sectionRows: Record<PanelSectionId, HTMLElement[]> = {
      import: [
        this.buttonRow('匯入圖片…', opts.onImportImage),
        // 「匯入尺寸」「網格密度」（issue #88、#89）只管「下一次」匯入，場上的果凍不受影響。
        importSize.row,
        meshDensity.row,
        rebuildAll.row,
      ],
      clip: [clipRow],
      physics: [boundary.row, softness.row, tapStrength.row, gravity.row],
      view: [
        ...pinRows,
        // 全域一列（issue #71）：蓋掉的是所有提示，所以放在工具卡外面，切工具不會讓它消失。
        this.checkboxRow(
          '播放時隱藏提示',
          opts.initial.hideHintsDuringPlayback,
          opts.onHideHintsDuringPlaybackChange,
        ),
        // 游標標籤（issue #122）是游標回饋、不是提示，開關跟顯示類開關放一起。
        this.checkboxRow(
          '顯示游標標籤',
          opts.initial.showCursorLabel,
          opts.onShowCursorLabelChange,
        ),
      ],
      demo: opts.demos.map((demo) => this.demoButtonRow(demo.label, () => opts.onRunDemo(demo.id))),
      // 錄製、播放、暫停、停止／重設在畫布上的播放控制條（issue #129），這裡只留設定與清單。
      record: [target.row, setupPins.row, this.groupedTracksEl, addGroup.row],
      dev: [
        this.perfStatus,
        this.checkboxRow('顯示網格', opts.initial.showWireframe, opts.onWireframeChange),
      ],
    };

    const scroll = document.createElement('div');
    scroll.className = 'jelly-panel-scroll';
    // 工具列＋參數卡常駐在分區之上（issue #122；spec #121「側欄」），不收合。
    scroll.append(
      toolbarSection,
      ...PANEL_SECTION_IDS.map((id) => this.sectionEl(id, sectionRows[id])),
    );

    const titleBar = this.titleBarEl();
    this.titleBarActions = titleBar.actions;

    this.main = document.createElement('div');
    this.main.className = 'jelly-panel-main';
    this.main.append(titleBar.bar, scroll);

    this.handle = this.button('»', () => this.setSidebarCollapsed(false));
    this.handle.className = 'jelly-sidebar-handle';
    this.handle.title = '展開側欄';
    this.handle.setAttribute('aria-label', '展開側欄');

    const panel = document.createElement('div');
    panel.className = 'jelly-control-panel';
    panel.append(this.main, this.handle);
    this.element = panel;

    this.applySidebarCollapsed();
    this.updateTrackControlsState();
  }

  /** 某分區的內容容器（issue #128）——之後的票要往某區加控制時從這裡拿。 */
  sectionBody(id: PanelSectionId): HTMLElement {
    return this.sections.get(id)!.body;
  }

  isSectionExpanded(id: PanelSectionId): boolean {
    return this.layout.expanded[id];
  }

  /** 展開／收起某分區並記住（issue #128）——點標題走這裡，程式也可以直接呼叫。 */
  setSectionExpanded(id: PanelSectionId, expanded: boolean): void {
    this.layout.expanded[id] = expanded;
    this.applySectionExpanded(id);
    savePanelLayout(this.storage, this.layout);
  }

  isSidebarCollapsed(): boolean {
    return this.layout.sidebarCollapsed;
  }

  /**
   * 收起／展開整個側欄並記住（issue #128）——收起時標題列與內容整塊藏起來、只剩左緣的
   * 小把手。只動顯示：控制項的狀態與鎖定都不變，畫布操作也不受影響。
   */
  setSidebarCollapsed(collapsed: boolean): void {
    this.layout.sidebarCollapsed = collapsed;
    this.applySidebarCollapsed();
    savePanelLayout(this.storage, this.layout);
  }

  private applySidebarCollapsed(): void {
    const collapsed = this.layout.sidebarCollapsed;
    this.element.classList.toggle('is-collapsed', collapsed);
    this.main.hidden = collapsed;
    this.handle.hidden = !collapsed;
  }

  private applySectionExpanded(id: PanelSectionId): void {
    const { header, body } = this.sections.get(id)!;
    const expanded = this.layout.expanded[id];
    header.setAttribute('aria-expanded', String(expanded));
    body.hidden = !expanded;
  }

  /**
   * 一個可收合分區（issue #128）：整列可點的標題鈕（▸／▾＋標題）＋內容。不用 `<details>`：
   * 展開狀態要由面板自己掌握（讀存檔、程式化展開、寫回），用按鈕＋`hidden` 最直接。
   */
  private sectionEl(id: PanelSectionId, rows: readonly HTMLElement[]): HTMLElement {
    const section = document.createElement('section');
    section.className = 'jelly-panel-section';
    section.dataset.section = id;

    const body = document.createElement('div');
    body.className = 'jelly-panel-section-body';
    body.id = `jelly-panel-section-${id}-${nextSectionDomId++}`;
    body.append(...rows);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'jelly-panel-section-header';
    header.setAttribute('aria-controls', body.id);
    const chevron = document.createElement('span');
    chevron.className = 'jelly-panel-section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'jelly-panel-section-title';
    title.textContent = SECTION_TITLES[id];
    header.append(chevron, title);
    header.addEventListener('click', () => this.setSectionExpanded(id, !this.layout.expanded[id]));

    section.append(header, body);
    this.sections.set(id, { header, body });
    this.applySectionExpanded(id);
    return section;
  }

  /** 側欄標題列（issue #128）：名稱＋右側控制鈕（目前是「收起側欄」）。 */
  private titleBarEl(): { bar: HTMLElement; actions: HTMLElement } {
    const bar = document.createElement('div');
    bar.className = 'jelly-panel-titlebar';

    const title = document.createElement('span');
    title.className = 'jelly-panel-title';
    title.textContent = '果凍圖片沙盒';

    const actions = document.createElement('div');
    actions.className = 'jelly-panel-titlebar-actions';
    const collapse = this.button('«', () => this.setSidebarCollapsed(true));
    collapse.className = 'jelly-sidebar-collapse';
    collapse.title = '收起側欄';
    collapse.setAttribute('aria-label', '收起側欄');
    actions.append(collapse);

    bar.append(title, actions);
    return { bar, actions };
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
   * 錄製中／已停止的視覺切換（issue #29）——按鈕文字變色
   * 加粗＋脈動（`.jelly-recording-active`，樣式見 `style.css`），低頭一眼就知道
   * 現在正在錄。錄製中「▶ 播放全部」與清單編輯一併鎖住（錄製／播放互斥，issue #33）。
   */
  setRecordingActive(active: boolean): void {
    this.recording = active;
    this.bar.setRecording(active);
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
    this.bar.setEnabled('record', !this.playbackLocked);
    this.recordTargetSelect.disabled = busy;
    // 片段初始 Pin 的兩顆鈕比照 Track 清單編輯：錄製中／播放中鎖住（issue #39）。
    this.setupPinsSnapshotButton.disabled = busy;
    this.setupPinsClearButton.disabled = busy;
    // 「全部重建」鈕（issue #90）錄製中／播放中鎖住：重建只改 Scene、不是事件（ADR-0013）。
    this.rebuildAllButton.disabled = busy;
    // 「清空全部」（issue #95）同理：它會清掉正在錄／正在播的片段本身。
    this.clearAllButton.disabled = busy;
    // 被鎖住時一併取消待確認（issue #131），解鎖後要重新按兩下。
    if (busy) {
      this.rebuildAllConfirm.cancel();
      this.clearAllConfirm.cancel();
    }
    // 工具列按鈕永遠可按（issue #124）：Jelly 工具的播放中／錄製中限制改在畫布上的右鍵
    // 選單各項變灰（`ContextMenu`），生成則由 `JellySandbox` 用禁止游標＋提示擋。
    // 「▶ 播放」：沒有任何 Track、或開啟中群組成員聯集為空時變灰（issue #43）。
    this.bar.setEnabled('play', !busy && this.trackCount > 0 && this.playableTrackCount > 0);
    this.addGroupButton.disabled = busy;
    // 分區清單裡的群組標頭控制項 + Track 卡片欄位 + `群組 ▾` 一起鎖住（issue #43）。
    for (const el of this.groupedTracksEl.querySelectorAll('input, button, select')) {
      (el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = busy;
    }
  }

  /**
   * 播放中／未播放的切換（issue #34）——`JellySandbox` 在 Demo／Track 播放開始
   * 與結束時各呼叫一次。issue #129 起控制條常駐：播放中「⏸ 暫停／▶ 繼續」鈕才可按，
   * 開始與結束時都把時間讀數歸零、暫停鈕文字重設回「⏸ 暫停」。
   */
  setPlaybackActive(active: boolean): void {
    this.bar.setPlaying(active);
  }

  /**
   * `JellySandbox` 每幀同步一次目前的播放秒數（issue #34）——由 `DemoRunner`
   * 的全域 sim step 計數換算而來，暫停時 step 不前進、這個讀出跟著定住。只在
   * 秒數字串真的變了才寫 DOM（同 `setPerfStatus`）。
   */
  setPlaybackTime(seconds: number): void {
    this.bar.setTime(seconds);
  }

  /**
   * 「⏸ 暫停／▶ 繼續」鈕的視覺狀態（issue #34）——`JellySandbox` 切換暫停旗標
   * 時呼叫；暫停中按鈕變成「▶ 繼續」並加上 `.jelly-paused-active` 提示色。
   */
  setPaused(paused: boolean): void {
    this.bar.setPaused(paused);
  }

  /**
   * `JellySandbox` 每幀同步一次畫布右下角的「鎖定跟隨」切換鈕到相機實際的鎖定狀態
   * （issue #36；issue #129 從側欄勾選框搬成切換鈕）——相機軌播放（`setState` 硬切、錄進去
   * 的 `setFollow`）或 `playAll` 重設鏡頭會在使用者沒按鈕的情況下改動 `followEnabled`，
   * 同步後不會脫鉤。值沒變就不寫 DOM、不回呼。
   */
  setFollowLocked(locked: boolean): void {
    this.camera.setFollowLocked(locked);
  }

  /**
   * `JellySandbox` 每幀同步一次畫布右下角的縮放倍率讀數（issue #129）——相對 zoom-to-fit
   * （「框住果凍」／自動跟隨的錨點）的倍率，例如 1.5 顯示成「×1.5」。文字沒變不寫 DOM。
   */
  setZoomFactor(factor: number): void {
    this.camera.setZoomFactor(factor);
  }

  /**
   * 載入片段後（issue #58）把 Softness 滑桿位置灌回面板——`JellySandbox.applyClipState`
   * 呼叫，跟 `setSoftness` 本身觸發的 sim 端變更分開（這裡只管顯示，不觸發 `input`
   * 事件、不會呼叫 `onSoftnessChange` 造成迴圈）。
   */
  setSoftness(value: number): void {
    setRangeSliderValue(this.softnessInput, value);
  }

  /** 載入片段後把輕拍力道滑桿位置灌回面板（issue #58）。同 `setSoftness` 的理由。 */
  setTapStrength(value: number): void {
    setRangeSliderValue(this.tapStrengthInput, value);
  }

  /**
   * 載入片段後把重力拉霸位置與數值顯示灌回面板（issue #91）。同 `setSoftness` 的理由
   * ——只動 DOM、不觸發 `input` 事件、不呼叫 `onGravityChange`。
   */
  setGravity(value: number): void {
    setRangeSliderValue(this.gravityInput, value);
  }

  /** 載入片段後把邊界模式下拉灌回面板（issue #58）。同 `setSoftness` 的理由。 */
  setBoundary(mode: BoundaryMode): void {
    if (this.boundarySelect.value !== mode) this.boundarySelect.value = mode;
  }

  /**
   * 效能退路壓拉霸（issue #89）——`JellySandbox` 在 `PerfMonitor` 降級那一幀把「網格
   * 密度」砍半後灌回面板。只動拉霸與旁邊的數值、不觸發 `input` 事件、不呼叫
   * `onMeshDensityChange`（沙盒端自己已經改了狀態，再回呼會繞一圈）。
   */
  setMeshDensity(value: number): void {
    setRangeSliderValue(this.meshDensityInput, value);
  }

  /**
   * 「按住右鍵＋滾輪」調過數值後把新值灌回對應的拉霸（issue #114；issue #122 推廣）。
   * 同 `setSoftness` 的理由——只動 DOM、不觸發 `input` 事件、不回呼 `onXChange`。
   */
  setModeValue(key: ModeValueKey, value: number): void {
    setRangeSliderValue(this.valueInputs[key], value);
  }

  /**
   * 目前工具換了、但不是從工具列按的（issue #122；之後 #126 的數字鍵快捷鍵也走這裡）——
   * 只動高亮與參數卡顯示，不回呼 `onToolChange`。
   */
  setActiveTool(tool: ToolId): void {
    for (const [id, button] of this.toolButtons) {
      const active = id === tool;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const [id, card] of this.toolCards) card.hidden = id !== tool;
  }

  /**
   * 某個工具的模式換了、但不是從模式鈕按的（issue #122：畫布上中鍵單擊輪替、或
   * 「開始設定形狀」順手切到編隊）——只動模式鈕高亮，不回呼 `onModeChange`。
   */
  setToolMode(tool: ModalToolId, mode: ToolMode): void {
    for (const [m, button] of this.modeButtons.get(tool) ?? []) {
      const active = m === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
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
    this.playbackBar.remove();
    this.cameraControls.remove();
  }

  /**
   * 工具列＋參數卡（issue #122 / V4 T1；ADR-0016，取代 issue #65 的「目前工具」下拉與
   * issue #67 的「▸ 沙盒工具」收合區塊）。每個工具一顆按鈕（圖示＋文字，照 `TOOL_IDS`
   * 的順序），目前工具高亮（`.is-active` + `aria-pressed`）；按鈕下方是參數卡，只顯示
   * 目前工具那一組（`toolParams`）。
   */
  private toolbarSection(
    initialTool: ToolId,
    toolParams: Record<ToolId, HTMLElement>,
    onChange: (tool: ToolId) => void,
  ): HTMLElement {
    const section = document.createElement('div');
    section.className = 'jelly-tool-section';

    const toolbar = document.createElement('div');
    toolbar.className = 'jelly-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '工具');
    for (const tool of TOOL_IDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jelly-tool-button';
      button.dataset.tool = tool;
      const label = TOOL_LABELS[tool];
      const icon = document.createElement('span');
      icon.className = 'jelly-tool-button-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = label.icon;
      const text = document.createElement('span');
      text.className = 'jelly-tool-button-text';
      text.textContent = label.text;
      button.append(icon, text);
      button.addEventListener('click', () => {
        this.setActiveTool(tool);
        onChange(tool);
      });
      this.toolButtons.set(tool, button);
      toolbar.appendChild(button);
    }

    const card = document.createElement('div');
    card.className = 'jelly-tool-card';
    for (const tool of TOOL_IDS) {
      const params = toolParams[tool];
      // 每張卡最底下一行固定的滑鼠操作說明（issue #132；文字集中在 `./helpText`）。
      const help = document.createElement('div');
      help.className = 'jelly-control-row jelly-tool-help';
      help.textContent = TOOL_HELP_LINES[tool];
      params.appendChild(help);
      this.toolCards.set(tool, params);
      card.appendChild(params);
    }

    section.append(toolbar, card);
    this.setActiveTool(initialTool);
    return section;
  }

  /**
   * 參數卡最上方的模式切換鈕（issue #122）——一排分段按鈕，目前模式高亮。按下只影響
   * 下一次按下（進行中的手勢已經在按下時定下，見 `ToolRouter`）；畫布上中鍵單擊輪替後
   * 由 `setToolMode` 同步回來。
   */
  private modeRow(
    tool: ModalToolId,
    initial: ToolMode,
    onChange: (tool: ModalToolId, mode: ToolMode) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jelly-control-row jelly-mode-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', '模式');
    row.dataset.tool = tool;
    const buttons = new Map<ToolMode, HTMLButtonElement>();
    for (const mode of modesOf(tool)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jelly-mode-button';
      button.dataset.mode = mode;
      button.textContent = MODE_LABELS[mode];
      button.addEventListener('click', () => {
        this.setToolMode(tool, mode);
        onChange(tool, mode);
      });
      buttons.set(mode, button);
      row.appendChild(button);
    }
    this.modeButtons.set(tool, buttons);
    this.setToolMode(tool, initial);
    return row;
  }

  /**
   * 一組工具專屬參數的外框（issue #68 事後檢視追加）——標題 + 內容列，外觀
   * （左側色條、淡背景、`[hidden]` 真的隱藏）見 `style.css` 的
   * `.jelly-tool-params`。原本每個工具各自裸建一個 `div.jelly-tool-params`，
   * 兩個工具上線後在面板上看起來像同一串混在一起的參數（使用者事後檢視
   * 回報），所以統一收進這裡、每組都帶自己的標題。
   */
  private toolParams(title: string, rows: readonly HTMLElement[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'jelly-tool-params';

    const heading = document.createElement('div');
    heading.className = 'jelly-tool-params-title';
    heading.textContent = title;

    box.append(heading, ...rows);
    return box;
  }

  /**
   * 編隊抓取「開始設定形狀」／「完成設定」／「重新設定編隊形狀」按鈕（issue #68）
   * ——同一顆按鈕依內部狀態換文字，不是三顆各自獨立的按鈕：還沒定義過形狀時
   * 顯示「開始設定形狀」；按下後進入定義中，文字換成「完成設定」；再按一次結束
   * 定義（`onFormationDefineEnd`），這之後（已經有形狀）按鈕文字變成「重新設定
   * 編隊形狀」，再按一次等同重新開始定義、覆蓋掉舊形狀——功能上跟「開始設定
   * 形狀」完全一樣，只是文字反映「這次是覆蓋，不是從零開始」。
   */
  private formationDefineRow(onStart: () => void, onEnd: () => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';

    const button = document.createElement('button');
    button.type = 'button';
    let defining = false;
    let hasShape = false;
    const updateText = (): void => {
      button.textContent = defining ? '完成設定' : hasShape ? '重新設定編隊形狀' : '開始設定形狀';
    };
    updateText();

    button.addEventListener('click', () => {
      if (defining) {
        onEnd();
        defining = false;
        hasShape = true;
      } else {
        onStart();
        defining = true;
      }
      updateText();
    });

    row.append(button);
    return row;
  }

  private boundaryRow(
    initial: BoundaryMode,
    onChange: (mode: BoundaryMode) => void,
  ): { row: HTMLElement; select: HTMLSelectElement } {
    const row = document.createElement('label');
    row.className = 'jelly-control-row';

    const select = document.createElement('select');
    for (const [value, text] of [
      ['infinite', '無限'],
      ['walled', '有牆'],
      ['floor', '僅地板'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === initial;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value as BoundaryMode));

    row.append('邊界', select);
    return { row, select };
  }

  /**
   * 一條拉霸列——一律是「拉霸＋數值」元件（issue #131；issue #88 起的帶數值拉霸推廣到
   * 全部）：旁邊顯示數值、雙擊回到 `value`（建立時的值＝預設值），見 `./panelControls`。
   */
  private rangeRow(
    labelText: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (n: number) => void,
  ): RangeSlider {
    return createRangeSlider(labelText, { min, max, step }, value, onChange);
  }

  /**
   * 「全部重建」按鈕列（issue #90；issue #95 起對每一塊，issue #98 改用這個名字）
   * ——回傳按鈕本身讓建構子記進 `rebuildAllButton`，`updateTrackControlsState` 才管得到
   * 它的 `disabled`。點擊由建構子接成「再按一次確認」（issue #131）。
   */
  private rebuildAllRow(): { row: HTMLElement; button: HTMLButtonElement } {
    const result = this.buttonRowEl('全部重建');
    result.button.title =
      '用各塊的來源圖＋目前的匯入尺寸／網格密度，重新生成桌上每一塊果凍（位置不變、Pin 掉光；Track 保留）';
    return result;
  }

  /**
   * 兩排：「顯示 Pin」開關 + 「清除所有 Pin」。「顯示 Pin」關掉時清除鈕跟著鎖住——
   * 所見即所得，見類別頂端說明。放 Pin 本身是工具選擇器裡的「Pin」工具（issue #115）。
   */
  private pinRows(
    initialShowPins: boolean,
    onClearPins: () => void,
    onShowPinsChange: (visible: boolean) => void,
  ): HTMLElement[] {
    const clearRow = document.createElement('div');
    clearRow.className = 'jelly-control-row';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = '清除所有 Pin';
    clearButton.disabled = !initialShowPins;
    clearButton.addEventListener('click', onClearPins);
    clearRow.append(clearButton);

    const showRow = this.checkboxRow('顯示 Pin', initialShowPins, (visible) => {
      onShowPinsChange(visible);
      clearButton.disabled = !visible;
    });

    return [showRow, clearRow];
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
    return this.buttonRowEl(labelText, onClick).row;
  }

  /**
   * `buttonRow` 的底層：一列一顆鈕，同時回傳按鈕本身給需要之後再管它狀態的呼叫端
   * （Demo 鈕、「重建」鈕）——不必事後用 `querySelector` 反查。
   */
  private buttonRowEl(
    labelText: string,
    onClick?: () => void,
  ): { row: HTMLElement; button: HTMLButtonElement } {
    const row = document.createElement('div');
    row.className = 'jelly-control-row';
    const button = this.button(labelText, onClick);
    row.appendChild(button);
    return { row, button };
  }

  /**
   * 一顆 `type="button"` 的按鈕（不包列）——片段區三顆橫排、標題列控制鈕共用。省略
   * `onClick` 時由呼叫端自己接（例如「再按一次確認」，issue #131）。
   */
  private button(labelText: string, onClick?: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    if (onClick) button.addEventListener('click', onClick);
    return button;
  }

  /** 同 `buttonRow`，另外把按鈕記進 `demoButtons`，讓 `setDemoButtonsEnabled` 管得到。 */
  private demoButtonRow(labelText: string, onClick: () => void): HTMLElement {
    const { row, button } = this.buttonRowEl(labelText, onClick);
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
