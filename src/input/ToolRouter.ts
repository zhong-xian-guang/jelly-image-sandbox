/**
 * `ToolRouter`（issue #65 / V2 T3-1）——沙盒工具切換的地基，取代 `PointerInput`
 * 原本直接持有的 `GestureTracker`。issue #66 / V2 T3-2 加上第一個新工具：電風扇。
 * issue #68 / V2 T3-4 加上第二個：編隊抓取。
 *
 * ADR-0011：「目前工具」選擇器只涵蓋新增的沙盒工具（電風扇／編隊抓取／撒
 * Pin／移除 Pin），Grab／Pin／Tap 三個既有操作維持純手勢辨識、不進選擇器。
 * `'general'` 下 `down`/`move`/`up`/`cancel` 原封不動委派給內部持有的
 * `GestureTracker`，不修改 `GestureTracker` 本身。後續三個工具會在這裡加上
 * 對應的 `ToolId` 分支。
 *
 * **編隊抓取**（issue #68）：兩個子狀態，`beginFormationDefine()`／
 * `endFormationDefine()`（面板「開始設定形狀」／「完成設定」按鈕觸發）之間是
 * 「定義中」——這時的 `down` 只把世界座標 push 進 `formationDefinePoints`，
 * 不 emit 任何 `InputEvent`；第一個點是主點，`endFormationDefine` 把其餘點換算
 * 成相對主點的偏移量（`{x:0,y:0}`, ...），存進 `formationOffsets`，整包覆蓋前一次
 * 定義的形狀（「重新設定編隊形狀」＝再呼叫一次 begin/end）。點數為 0 時
 * `endFormationDefine` 保留舊形狀不動（沒有東西可覆蓋）。
 *
 * 定義完成後，一般狀態下的 `down` 對每個偏移量算出 `world + offset` 這個候選點，
 * 用注入的 `hitTest`（跟一般 Grab 共用同一個「有沒有落在 Jelly 上」判定，語意上
 * 等同 issue 文件說的 `pick`——這裡只需要「在不在上面」這個布林值，不需要真的
 * 拿到 `SurfacePoint`，沒必要另外注入一個新選項）過濾，落在外面的那個索引整個
 * 跳過（不 emit、不記錄），其餘落在上面的才用合成 id（`formation:<session>:<index>`）
 * 送 `grab`，記進這次手勢的 `attached` 清單。`move` 對 `attached` 清單裡每個 id
 * 送 `world + offset`（`offset` 是定義時算好的常數，不隨拖曳方向重算，位移天生
 * 不會旋轉）；`up`／`cancel` 對 `attached` 清單裡每個 id 送 `release`——`cancel`
 * 這裡跟一般 Grab 的 `cancel` 同一個道理（不是電風扇放置那種「還沒 emit 過任何
 * 東西」的狀態，已經是活著的約束，取消要真的放開，不能悄悄留著）。
 *
 * **編隊抓取的輕拍**（issue #81 / V2 T3-9）：若這次手勢是快速按放（用
 * `GestureTracker` 那支 `isTap`，與一般操作同一組門檻），`up` 會在送 `release`
 * 之前先對 `attached` 裡每個點各送一次 `tap`——整組因此是
 * `grab×N → tap×N → release×N`，跟一般操作的 `grab → tap → release` 同形
 * （#64 US23：編隊抓取就是同時操作好幾個一般的 Grab）。`tap` 打在**按下當下**
 * 的位置（`startWorld + offset`），跟 `GestureTracker` 一致。`cancel` 是例外，
 * 不送 `tap`：中斷不是完成一次輕拍。
 *
 * **撒 Pin**（issue #69 / V2 T3-5）：點一下就完成的**單次**動作——`down` 以點擊
 * 處為圓心、`sprayRadius` 為半徑撒一批 Pin，`move`／`up`／`cancel` 完全不作用
 * （不是按住持續噴）。撒點用經典的 dart throwing：用注入的 `random`（預設
 * `Math.random`——**執行期**隨機，每次撒的分佈都不一樣；重播的決定性不靠這裡，
 * 見下段）在圓內反覆生成候選點，跟「這次已接受的候選」以及「注入的 `listPins`
 * 回傳的既有 Pin」都要 ≥ `spraySpacing` 才接受，再用 `hitTest`（同編隊抓取，
 * 語意上等同 issue 文件說的 `pick`）濾掉落在果凍外的，存活的才用合成 id
 * （`spray:<counter>`，跨多次撒點遞增、不重複）送既有的 `pin` 事件——不新增
 * `InputEvent` 種類，撒出來的每顆之後就跟手動放的 Pin 完全一樣（可單獨拖曳／
 * 解除／甩不掉）。
 *
 * 重播的決定性：`pin` 事件本身帶著算好的絕對 `x`/`y`，`TrackRecorder` 錄的是
 * 那些具體座標，重播時原樣送回去，不會重算隨機分佈——所以這裡刻意不需要有
 * 種子的 PRNG。
 *
 * **生成 Jelly／移除 Jelly**（issue #97 / V3 T3-4）：兩個「點一下」工具
 * （`CLICK_TOOL_IDS`）——`down` 記下按下處，`up` 時只要途中沒拖曳（位移 ≤
 * `tapMaxDist`，跟一般操作同一把尺）就呼叫 `onClickTool(tool, world)`，帶的是
 * 按下當下的工具與世界座標。進行中的點一下手勢在 `move`／`up`／`cancel` 都**先於**
 * `activeTool` 分支處理：按住途中切走工具時，這次手勢仍算在按下時那個工具頭上。
 * 這類工具是本檔唯一**不** emit `InputEvent` 的分支：要送進 `World` 的 `spawn`
 * 需要來源圖、兩條拉霸的值與網格 bbox，`remove` 需要先 `pick` 出 `jellyId`——那些
 * 都是 `JellySandbox` 的狀態，輸入層只回報「在這個世界座標點了一下」（ADR-0005）。
 *
 * **移除 Pin**（issue #70 / V2 T3-6）：撒 Pin 的反向操作，但手勢形狀相反——它是
 * **持續**的橡皮擦：`down` 開始一次擦除、`move` 沿路繼續擦、`up`／`cancel` 結束。
 * 每次（含 `down` 當下那一次）用注入的 `listPins()` 掃一遍場上的 Pin，落在
 * 「目前指標為圓心、`eraseRadius` 為半徑」的圓內就送既有的 `unpin` 事件——不新增
 * `InputEvent` 種類，被清掉的 Pin 跟使用者自己點掉的完全一樣。半徑跟撒 Pin 的
 * 半徑是兩個各自獨立的欄位（`setEraseParams` vs. `setSprayParams`）：兩個工具在
 * 手感上是分開調的，共用一個值會讓「撒得密一點、擦得準一點」變成不可能。
 *
 * 每次手勢記一組本次已經送過 `unpin` 的 Pin id（`EraseSession.erasedPinIds`），
 * `up`／`cancel` 時連同 session 一起丟掉。真實路徑上 `emit` 是同步進
 * `sim.applyInput` 的，下一次
 * `listPins()` 本來就讀不到已經清掉的那顆——但這條保證來自呼叫端的接線方式，
 * 不是這個類別能自己看到的事；擦除又是每次 `move` 都重掃一遍的高頻迴圈，多送
 * 一次 `unpin` 在別的接線方式下（例如事件先進佇列、下一幀才套用）就會變成
 * 重複事件寫進 Track。記一組 id 是這裡自己把這件事關死。
 *
 * 只作用於 Pin：不碰 `release`，所以一般 Grab（含還跟著別的指標走的那些）完全
 * 不受影響。
 *
 * **大把抓取**（issue #113 / V3 T4-1；ADR-0014）：手勢跟一般操作同形——`down`（落在
 * Jelly 上才算，同 `hitTest`）→ `grab{handfulRadius}`、`move` → `moveGrab`、`up` →
 * 快速按放（`isTap`，同一組門檻）先送 `tap{radius}`（打在按下點）再 `release`，
 * `cancel` 只 `release`。id 直接用指標 id（`PointerInput` 每次按下都配新的），多指各自
 * 一把。半徑存在 `handfulRadius`（`setHandfulParams`，面板拉霸即時寫入），**按下
 * 當下**拍進 session——之後改半徑只影響下一把。把 N 顆展開的工作不在這裡：輸入層只
 * 送一個 `handfulRadius`，求解器依它決定性地挑出同一把（重播才一致）。進行中的 session
 * 跟「點一下」一樣先於 `activeTool` 分支處理：按住途中切走工具，這一把仍照常跟隨、放開。
 *
 * **電風扇**（issue #66；ADR-0010 v1 單一實例）：`down` 先問 `getFan` 場上目前
 * 有沒有風扇、世界座標是否落在它的矩形內（`isPointInFanRect`）——落在裡面＝
 * 「拖曳既有風扇」（`FanMoveSession`，issue #67 事後追加：使用者不必每次都
 * 重新用滑鼠定義方向／距離才能微調位置），落在外面（或本來就沒有風扇）＝
 * 「放置新風扇」（`FanPlaceSession`，原 issue #66 行為：`move` 不 emit，只
 * 更新內部預覽終點，`up` 用原點→放開點的位移算 `dirX`/`dirY`（正規化單位
 * 向量）與 `length`，連同目前的 `width`／`strength`／`falloffExponent`／
 * `frequency`——`setFanParams`，issue #67：面板四個滑桿即時寫入——送一次
 * `setFan`，取代
 * 場上既有的風扇，ADR-0010：整包覆蓋，不用先送 `clearFan`）。位移為 0（點一
 * 下沒拖曳）時退回 `(1, 0)` 當方向，避免除以 0；風扇這時 `length` 也是 0，
 * `SimCore.applyFan` 對 `length <= 0` 直接 no-op，等於沒有實際效果。
 *
 * 拖曳既有風扇（`FanMoveSession`）：`down` 當下拍下按下點與風扇原點的差
 * （`offsetX/offsetY = fan.origin − downWorld`）——**不**直接把 origin 設到
 * 指標位置，那樣不管按在矩形內哪裡，風扇中心都會瞬間跳到滑鼠下，手感很怪
 * （issue #67 事後檢視回饋）。之後 `move`／`up` 都用「目前指標世界座標 +
 * 這個 offset」算新原點，等於維持按下當下抓住的那一點跟指標的相對位置，
 * 原點跟著位移量走、不跟著指標「瞬移」；`down` 當下 `emitFanMove` 算出來的
 * 原點因此精確等於原本的 `fan.originX/Y`，風扇不會因為按下就先跳一下。三者
 * 共用 `emitFanMove`。
 *
 * `cancel`：放置中（`FanPlaceSession`）視為放棄這次放置，只清掉 `fanSessions`
 * 裡的紀錄，不 emit 任何事件（跟 `general` 底下放開一半的 Grab 不同——那邊
 * `cancel` 仍會 `release`，因為 Grab 已經是「活著」的約束；電風扇放置在 `up`
 * 之前完全沒有送出任何 `InputEvent`，沒有東西需要收回）。拖曳中
 * （`FanMoveSession`）則不同——每次 `move` 都已經即時把風扇挪過去了，`cancel`
 * 只是停止繼續跟隨指標，風扇留在目前的位置，不回捲到拖曳起點（比照 Grab 的
 * `cancel` 不回捲已經發生過的 `moveGrab`）。「移除風扇」按鈕不經過
 * `ToolRouter`——比照「清除所有 Pin」的模式，由 `JellySandbox` 直接對
 * `sim.applyInput({ type: 'clearFan' })`（見該檔 `removeFan`）。
 */

import { isPointInFanRect, type FanState, type PinInfo, type PointerId, type Point } from '../sim';
import {
  GestureTracker,
  isTap,
  movedFromStart,
  resolveGestureConfig,
  type GestureConfig,
  type GestureStart,
  type GestureTrackerOptions,
} from './GestureTracker';

/**
 * `'fan'`（issue #66）、`'formation'`（issue #68）、`'spray'`（issue #69）、
 * `'erase'`（issue #70，＝「移除 Pin」）、`'spawn'`／`'removeJelly'`（issue #97）、
 * `'rebuildJelly'`（issue #98）、`'handfulGrab'`（issue #113）加進 ADR-0011 選擇器；
 * `'general'` 維持既有 Grab/Pin/Tap 手勢。
 */
export type ToolId =
  | 'general'
  | 'handfulGrab'
  | 'fan'
  | 'formation'
  | 'spray'
  | 'erase'
  | 'spawn'
  | 'removeJelly'
  | 'rebuildJelly';

/**
 * 「點一下就完成」的那幾個工具（issue #97）——`down`→`up` 無拖曳才作用，見
 * `ClickSession`。三個工具共用同一條手勢，所以清單在這裡集中一份：輸入層這邊加新的
 * 點一下工具只要加進這個陣列與 `ToolId`，手勢本身完全不必動；工具真正上線還要在
 * `ControlPanel` 的選項表補一列（含它的鎖法）、在 `JellySandbox.runClickTool` 補一條
 * 分派（issue #98 的「重建 Jelly」就是這樣加的）。
 */
export const CLICK_TOOL_IDS = ['spawn', 'removeJelly', 'rebuildJelly'] as const;

export type ClickToolId = (typeof CLICK_TOOL_IDS)[number];

function isClickTool(tool: ToolId): tool is ClickToolId {
  return (CLICK_TOOL_IDS as readonly ToolId[]).includes(tool);
}

export const DEFAULT_TOOL: ToolId = 'general';

/** 電風扇矩形的初始預設值（issue #66）——`setFanParams`（issue #67）可在執行期間覆寫。 */
export const DEFAULT_FAN_WIDTH = 150;
export const DEFAULT_FAN_STRENGTH = 4000;
/** 沿用 `SimCore.doTap` 既有的正規化距離冪次衰減慣例（`(1 − d/R)²`）。 */
export const DEFAULT_FAN_FALLOFF_EXPONENT = 2;
/** 平均每秒陣風次數（issue #67 事後檢視追加，見 `SimCore.applyFan`）。 */
export const DEFAULT_FAN_FREQUENCY = 2;

/** `setFanParams` 接受的部分更新——四個欄位皆可選，只覆寫有帶到的欄位。 */
export interface FanParams {
  width: number;
  strength: number;
  falloffExponent: number;
  frequency: number;
}

/** 撒 Pin 的初始預設值（issue #69）——`setSprayParams` 可在執行期間覆寫。 */
export const DEFAULT_SPRAY_RADIUS = 140;
export const DEFAULT_SPRAY_SPACING = 36;

/**
 * 一次撒點最多嘗試幾個候選點、最多真的撒幾顆（issue #69）——dart throwing 的
 * 嘗試次數依「半徑 / 間距」的平方估算（範圍內大約塞得下幾顆 × 每顆多試幾次），
 * 兩個上限只是把最壞情況的成本與 Pin 數量框住：間距調到很小、半徑調到很大時，
 * 不會一次撒進幾百顆 Pin 把求解器壓垮，也不會讓這個迴圈跑到掉幀。
 */
const SPRAY_ATTEMPTS_PER_SLOT = 12;
const MAX_SPRAY_ATTEMPTS = 1500;
const MAX_SPRAY_PINS = 200;

/** 半徑拉霸的範圍（issue #114）——面板拉霸與「右鍵＋滾輪調半徑」共用同一份。 */
export interface RadiusRange {
  min: number;
  max: number;
  step: number;
}

/**
 * 撒 Pin 半徑拉霸的範圍（issue #69），世界座標單位。上限 400 ≈ 一般匯入果凍的
 * 尺度，一下蓋住整隻。
 */
export const SPRAY_RADIUS_RANGE: RadiusRange = { min: 20, max: 400, step: 10 };

/** `setSprayParams` 接受的部分更新（issue #69）——兩個欄位皆可選。 */
export interface SprayParams {
  /** 撒點範圍的世界座標半徑（圓心 = 點擊處）。 */
  radius: number;
  /** 任兩顆 Pin（含場上既有的）之間的最小世界座標距離——越小越密。 */
  spacing: number;
}

/**
 * 移除 Pin 的橡皮擦半徑預設值（issue #70）——`setEraseParams` 可在執行期間覆寫。
 * 刻意跟 `DEFAULT_SPRAY_RADIUS` 是兩個各自獨立的常數（見類別頂端說明）。
 */
export const DEFAULT_ERASE_RADIUS = 100;

/**
 * 移除 Pin 的橡皮擦半徑範圍（issue #70）——沿用 `SPRAY_RADIUS_RANGE` 的上下限（兩者
 * 都是「以指標為圓心的作用範圍」，尺度一樣由果凍大小決定），但刻意是**另一條**
 * 滑桿、另一個狀態：撒的時候常常想撒一大片，擦的時候多半想擦得精準一點，共用一個
 * 值會逼使用者每次切工具都重調。
 */
export const ERASE_RADIUS_RANGE: RadiusRange = { min: 20, max: 400, step: 10 };

/** `setEraseParams` 接受的部分更新（issue #70）——目前只有半徑一個欄位。 */
export interface EraseParams {
  /** 橡皮擦的世界座標半徑（圓心 = 指標目前位置）。 */
  radius: number;
}

/**
 * 大把抓取半徑的預設值（issue #113；世界單位）——`setHandfulParams` 可在執行期間覆寫。
 * 跟撒 Pin 同一個預設，拉霸範圍也相同（spec #112）。
 */
export const DEFAULT_HANDFUL_RADIUS = 140;

/** 大把抓取半徑拉霸的範圍（issue #113），世界單位——跟撒 Pin 一致（spec #112）。 */
export const HANDFUL_RADIUS_RANGE: RadiusRange = { min: 20, max: 400, step: 10 };

/** 有半徑、能用「右鍵＋滾輪」調整的工具（issue #114）。 */
export type RadiusToolId = 'spray' | 'erase' | 'handfulGrab';

/** `setHandfulParams` 接受的部分更新（issue #113）——目前只有半徑一個欄位。 */
export interface HandfulParams {
  /** 抓取範圍的世界座標半徑（圓心 = 按下處）。 */
  radius: number;
}

export interface ToolRouterOptions extends GestureTrackerOptions {
  /**
   * 場上目前的電風扇幾何（issue #67 追加）——`down` 落在既有風扇矩形內時，
   * 用它判斷該把這次手勢當「拖曳既有風扇」而非「放置新風扇」。不帶這個選項
   * （或回傳 `null`）等同「場上永遠沒有風扇」，一律走放置新風扇的既有行為
   * ——現有呼叫端／測試不用跟著改。
   */
  getFan?: () => FanState | null;
  /**
   * 場上目前的 Pin 清單（issue #69，接 `SimCore.listPins()`）——撒 Pin 時新的
   * 候選點跟既有 Pin 也要保持 ≥ 間距，不然在已經撒過的地方再撒一次會疊成
   * 一坨；移除 Pin（issue #70）更是完全靠它——要擦掉哪幾顆，就是從這份清單裡
   * 挑出落在橡皮擦圓內的。不帶這個選項等同「場上沒有任何 Pin」：撒 Pin 只跟
   * 這次撒出的候選互斥，移除 Pin 則永遠沒有東西可擦。
   */
  listPins?: () => readonly PinInfo[];
  /**
   * 撒 Pin 的隨機數來源（issue #69），預設 `Math.random`——**執行期**隨機，每次
   * 撒出來的分佈都不一樣（重播的決定性由事件本身帶的具體座標保證，見類別頂端
   * 說明）。測試注入有種子的 PRNG 才能逐次一致。
   */
  random?: () => number;
  /**
   * 「點一下」工具（`CLICK_TOOL_IDS`）完成一次點擊的回呼（issue #97 / V3 T3-4）
   * ——參數是按下當下選的那個工具，以及**按下當下**的世界座標。刻意不是
   * `InputEvent`：真正要送進 `World` 的 `spawn` 事件得知道用哪張來源圖、目前兩條
   * 拉霸的值、`offset` 要減掉網格 bbox 中心，`remove` 得先 `pick` 出 `jellyId`
   * ——那些是 `JellySandbox` 的狀態，輸入層不該認識（ADR-0005：輸入層只回報
   * 手勢）。也刻意是**一個**回呼而不是每個工具一個：這條手勢本身沒有分支，
   * 分派是呼叫端的事，多一個工具不必在輸入層多開一條路。不帶這個選項等同
   * 「這些工具沒接線」：點下去什麼都不會發生。
   */
  onClickTool?: (tool: ClickToolId, world: Point) => void;
}

/** 放置新風扇進行中的狀態：世界座標原點 + 目前（拖曳中或放開時）的終點。 */
interface FanPlaceSession {
  mode: 'place';
  origin: Point;
  current: Point;
}

/**
 * 拖曳既有風扇進行中的狀態：`down` 當下拍下原風扇除了 `originX/originY` 以外
 * 的幾何／參數快照，以及按下點跟原點的相對位移 `offsetX/offsetY`——拖曳全程
 * 原點 = 目前指標世界座標 + 這個 offset，維持按下當下抓住的那一點跟著指標
 * 走，而不是原點瞬間貼到指標上（見類別頂端說明）。
 */
interface FanMoveSession {
  mode: 'move';
  offsetX: number;
  offsetY: number;
  dirX: number;
  dirY: number;
  length: number;
  width: number;
  strength: number;
  falloffExponent: number;
  frequency: number;
}

type FanSession = FanPlaceSession | FanMoveSession;

/**
 * 進行中的一次編隊抓取手勢（issue #68）：`lastWorld` 是指標目前的世界座標
 * （`down`/`move` 都更新），`attached` 是這次手勢裡真的落在 Jelly 上、已經送出
 * `grab` 的偏移量索引 + 對應合成 id（落在外面的索引被過濾掉、完全不進這個
 * 清單，`move`/`up`/`cancel` 因此天然只作用於真的抓到的那幾點）。
 */
interface FormationSession extends GestureStart {
  /**
   * 指標**目前**的世界座標（`move` 每次整顆重新指派）。跟 `GestureStart.startWorld`
   * 分得很清楚：拖曳讀這個，輕拍讀那個（issue #81）——`down` 當下兩者的值相同，
   * 但存的是各自的物件，之後誰也不會被對方帶著跑。
   */
  lastWorld: Point;
  attached: readonly { offset: Point; id: string }[];
}

/**
 * 進行中的一次擦除手勢（issue #70）：`erasedPinIds` 是這次手勢裡已經送過 `unpin`
 * 的 **Pin** id（`PinInfo.id`，跟 `eraseSessions` 那層的鍵——指標 id——是兩回事，
 * 只是在這個專案裡兩者共用 `PointerId` 這個型別），避免同一顆在拖曳途中被重複送
 * （見類別頂端說明）。`up`／`cancel` 連同整個 session 一起丟掉，下一次按下就是
 * 乾淨的一組。
 */
interface EraseSession {
  erasedPinIds: Set<PointerId>;
}

/**
 * 進行中的一次「點一下」手勢（issue #97，生成 Jelly／移除 Jelly 共用）：`world` 是
 * **按下當下**的世界座標（回呼拿的就是它，跟輕拍「打在按下點」同一條規則），
 * `dragged` 一旦在 `move` 途中被設起來就不會再放下——拖出去又拖回原點仍然不算
 * 點一下，使用者中途已經看到自己在拖了。
 *
 * 刻意**只**看位移、不看按住多久（跟 `isTap` 不同）：這兩個工具是「放在這裡」
 * 而不是「輕拍一下」，瞄準位置多按了一秒再放開仍該生成，不然會變成「按太久
 * 就沒反應」的謎樣失敗。
 *
 * `tool` 是按下當下選的那個工具——按住途中切換選擇器（觸控裝置做得到）時，
 * 這次手勢仍算在按下時那個工具頭上。
 */
interface ClickSession extends GestureStart {
  tool: ClickToolId;
  dragged: boolean;
}

/**
 * 進行中的一次大把抓取手勢（issue #113）：按下當下的定格（輕拍判定與 `tap` 座標用）
 * + 按下當下的半徑（這一把的 `grab` 與可能的 `tap` 都用它，之後改拉霸不影響）。
 */
interface HandfulSession extends GestureStart {
  radius: number;
}

export class ToolRouter {
  private readonly gestureTracker: GestureTracker;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly emit: ToolRouterOptions['emit'];
  private readonly hitTest: ((world: Point) => boolean) | undefined;
  private readonly getFan: (() => FanState | null) | undefined;
  private readonly listPins: (() => readonly PinInfo[]) | undefined;
  private readonly random: () => number;
  private readonly onClickTool: ((tool: ClickToolId, world: Point) => void) | undefined;
  private activeTool: ToolId = DEFAULT_TOOL;
  /** 進行中的電風扇手勢（放置或拖曳），鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly fanSessions = new Map<PointerId, FanSession>();
  /**
   * 編隊抓取「定義形狀」進行中時的暫存點（世界座標，第一個是主點）——非
   * `null` 代表正在定義中（`beginFormationDefine`/`endFormationDefine` 之間）。
   */
  private formationDefinePoints: Point[] | null = null;
  /** 已定義好的編隊形狀：相對主點的偏移量，索引 0 固定是 `{x:0,y:0}`（issue #68）。 */
  private formationOffsets: Point[] | null = null;
  /** 進行中的編隊抓取手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly formationSessions = new Map<PointerId, FormationSession>();
  private nextFormationSession = 1;
  /**
   * 下一次電風扇放置要用的寬度／強度／衰減冪次（issue #67）——`setFanParams`
   * 由面板滑桿即時寫入；`emitFan` 每次 `up` 讀目前值，不需要等下一次 `setActiveTool`。
   */
  private fanWidth = DEFAULT_FAN_WIDTH;
  private fanStrength = DEFAULT_FAN_STRENGTH;
  private fanFalloffExponent = DEFAULT_FAN_FALLOFF_EXPONENT;
  private fanFrequency = DEFAULT_FAN_FREQUENCY;
  /** 下一次撒點要用的半徑／最小間距（issue #69）——面板兩個滑桿即時寫入。 */
  private sprayRadius = DEFAULT_SPRAY_RADIUS;
  private spraySpacing = DEFAULT_SPRAY_SPACING;
  /** 撒出的 Pin 合成 id 流水號（`spray:<n>`）——跨多次撒點遞增，各顆身分互不相干。 */
  private nextSprayPin = 1;
  /** 橡皮擦半徑（issue #70）——面板滑桿即時寫入，跟 `sprayRadius` 各自獨立。 */
  private eraseRadius = DEFAULT_ERASE_RADIUS;
  /** 進行中的擦除手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly eraseSessions = new Map<PointerId, EraseSession>();
  /** 大把抓取半徑（issue #113）——面板拉霸即時寫入，按下當下拍進 session。 */
  private handfulRadius = DEFAULT_HANDFUL_RADIUS;
  /** 進行中的大把抓取手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly handfulSessions = new Map<PointerId, HandfulSession>();
  /** 進行中的「點一下」手勢（issue #97），鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly clickSessions = new Map<PointerId, ClickSession>();
  /**
   * 解析後的手勢門檻（issue #81）——編隊抓取的輕拍判定要跟一般操作**同一組**
   * 數值，否則同一個使用者在兩個模式下「怎樣算快速按放」會前後矛盾。`opts` 原本
   * 只轉給 `GestureTracker`，這裡用同一支 `resolveGestureConfig` 另存一份自己用
   * （同一個來源與同一套預設值，不是第二套設定）。
   */
  private readonly config: GestureConfig;

  constructor(opts: ToolRouterOptions) {
    this.gestureTracker = new GestureTracker(opts);
    this.screenToWorld = opts.screenToWorld;
    this.emit = opts.emit;
    this.hitTest = opts.hitTest;
    this.getFan = opts.getFan;
    this.listPins = opts.listPins;
    this.random = opts.random ?? Math.random;
    this.onClickTool = opts.onClickTool;
    this.config = resolveGestureConfig(opts.config);
  }

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
  }

  /** 「開始設定形狀」按鈕（issue #68）——之後的 `down` 只記點，不 emit。 */
  beginFormationDefine(): void {
    this.formationDefinePoints = [];
  }

  /**
   * 「完成設定」按鈕（issue #68）——把定義中記下的點換算成偏移量，整包覆蓋
   * `formationOffsets`（「重新設定編隊形狀」＝再呼叫一次 begin/end）。一個點都
   * 沒記到（沒呼叫過 `beginFormationDefine`，或呼叫了但沒有任何 `down`）就直接
   * 結束定義模式，不動舊形狀。
   */
  endFormationDefine(): void {
    const points = this.formationDefinePoints;
    this.formationDefinePoints = null;
    if (!points) return;
    const primary = points[0];
    if (!primary) return;
    this.formationOffsets = points.map((p) => ({ x: p.x - primary.x, y: p.y - primary.y }));
  }

  /** 目前是否在「定義形狀」中（issue #68）——`FormationOverlay` 用來決定要不要畫定義中的點。 */
  get isDefiningFormation(): boolean {
    return this.formationDefinePoints !== null;
  }

  /** 定義中已經記下的點（世界座標，issue #68）——`FormationOverlay` 每幀讀。 */
  get formationDefinePreview(): readonly Point[] {
    return this.formationDefinePoints ?? [];
  }

  /** 已定義的編隊形狀（相對主點的偏移量），還沒定義過則 `null`（issue #68）。 */
  get formationShape(): readonly Point[] | null {
    return this.formationOffsets;
  }

  /**
   * 「如果現在在 `anchor` 按下去，會抓到哪幾個點」的世界座標（issue #79 / V2 T3-8）
   * ——`FormationOverlay` 拿它畫閒置時跟著游標走的形狀預覽。還沒定義過形狀就回
   * 空陣列（沒有東西可預覽）。
   *
   * 刻意**不**用 `hitTest` 過濾掉落在果凍外的點：預覽畫的是「形狀」，命中與否
   * 按下去那一刻才算（見 `down` 的編隊分支）——先幫使用者把點藏起來，反而看不出
   * 整組形狀擺在哪、也沒辦法瞄準。
   */
  formationPreviewAt(anchor: Point): readonly Point[] {
    const offsets = this.formationOffsets;
    if (!offsets) return [];
    return offsets.map((o) => ({ x: anchor.x + o.x, y: anchor.y + o.y }));
  }

  /**
   * 目前作用中的編隊抓取手勢（issue #68）——`FormationOverlay` 每幀讀，畫出
   * 各點目前的世界座標 + 連回主點的線。只列 `attached`（這次手勢裡真的落在
   * Jelly 上、已經送出 `grab` 的點）——`down` 時被 `hitTest` 跳過的偏移點沒有
   * 對應的約束，提示不該把它畫成「也被抓住了」。
   */
  get formationActiveGroups(): ReadonlyArray<{ anchor: Point; points: readonly Point[] }> {
    return [...this.formationSessions.values()].map((s) => ({
      anchor: s.lastWorld,
      points: s.attached.map(({ offset }) => ({
        x: s.lastWorld.x + offset.x,
        y: s.lastWorld.y + offset.y,
      })),
    }));
  }

  /**
   * 面板三個電風扇滑桿的即時寫入口（issue #67）——只覆寫有帶到的欄位。影響
   * **下一次**放置（`emitFan` 讀這幾個欄位）；「即時反映到場上目前的風扇」
   * 由呼叫端（`JellySandbox`）另外對 `sim.applyInput` 補送一次帶新參數、原幾何
   * 不變的 `setFan`——`ToolRouter` 不知道場上是否已有風扇，這件事不歸它管。
   */
  setFanParams(params: Partial<FanParams>): void {
    if (params.width !== undefined) this.fanWidth = params.width;
    if (params.strength !== undefined) this.fanStrength = params.strength;
    if (params.falloffExponent !== undefined) this.fanFalloffExponent = params.falloffExponent;
    if (params.frequency !== undefined) this.fanFrequency = params.frequency;
  }

  /**
   * 面板兩個撒 Pin 滑桿的即時寫入口（issue #69）——只覆寫有帶到的欄位，影響
   * **下一次**撒點（`sprayOnce` 每次讀目前值）。比照 `setFanParams`。
   */
  setSprayParams(params: Partial<SprayParams>): void {
    if (params.radius !== undefined) this.sprayRadius = params.radius;
    if (params.spacing !== undefined) this.spraySpacing = params.spacing;
  }

  /**
   * 面板「移除 Pin 範圍半徑」滑桿的即時寫入口（issue #70）——比照
   * `setSprayParams`，影響**下一次**擦除掃描（`eraseAt` 每次讀目前值），所以
   * 拖曳途中調滑桿也會立刻反映在還沒擦到的那段路徑上。
   */
  setEraseParams(params: Partial<EraseParams>): void {
    if (params.radius !== undefined) this.eraseRadius = params.radius;
  }

  /** 面板「大把抓取半徑」拉霸的即時寫入口（issue #113）——只影響**下一次**按下。 */
  setHandfulParams(params: Partial<HandfulParams>): void {
    if (params.radius !== undefined) this.handfulRadius = params.radius;
  }

  /**
   * 「右鍵＋滾輪」調整目前工具的半徑（issue #114）：`steps` 格（正 = 放大），每格一個
   * 拉霸 step，夾在該拉霸範圍內，回報新值讓呼叫端同步面板與圓圈。目前工具沒有半徑
   * 就回 `null`（「不處理」——呼叫端照舊縮放相機）。跟拉霸一樣只影響**下一次**按下：
   * 進行中的大把抓取 session 已經在按下時記下自己的半徑。
   */
  adjustActiveRadius(steps: number): { tool: RadiusToolId; radius: number } | null {
    const tool = this.activeTool;
    if (tool === 'spray') {
      this.sprayRadius = stepRadius(this.sprayRadius, steps, SPRAY_RADIUS_RANGE);
      return { tool, radius: this.sprayRadius };
    }
    if (tool === 'erase') {
      this.eraseRadius = stepRadius(this.eraseRadius, steps, ERASE_RADIUS_RANGE);
      return { tool, radius: this.eraseRadius };
    }
    if (tool === 'handfulGrab') {
      this.handfulRadius = stepRadius(this.handfulRadius, steps, HANDFUL_RADIUS_RANGE);
      return { tool, radius: this.handfulRadius };
    }
    return null;
  }

  get currentTool(): ToolId {
    return this.activeTool;
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.down(id, screenX, screenY, timeMs);
      return;
    }
    if (this.activeTool === 'handfulGrab') {
      const world = this.screenToWorld(screenX, screenY);
      if (this.hitTest && !this.hitTest(world)) return; // 背景拖曳 → 不歸求解器
      const radius = this.handfulRadius;
      this.handfulSessions.set(id, {
        startX: screenX,
        startY: screenY,
        startT: timeMs,
        startWorld: world,
        radius,
      });
      this.emit({ type: 'grab', id, x: world.x, y: world.y, handfulRadius: radius });
      return;
    }
    if (this.activeTool === 'fan') {
      const world = this.screenToWorld(screenX, screenY);
      const fan = this.getFan?.() ?? null;
      if (fan && isPointInFanRect(fan, world)) {
        const session: FanMoveSession = {
          mode: 'move',
          offsetX: fan.originX - world.x,
          offsetY: fan.originY - world.y,
          dirX: fan.dirX,
          dirY: fan.dirY,
          length: fan.length,
          width: fan.width,
          strength: fan.strength,
          falloffExponent: fan.falloffExponent,
          frequency: fan.frequency,
        };
        this.fanSessions.set(id, session);
        this.emitFanMove(world, session);
      } else {
        this.fanSessions.set(id, { mode: 'place', origin: world, current: world });
      }
      return;
    }
    if (this.activeTool === 'formation') {
      const world = this.screenToWorld(screenX, screenY);
      if (this.formationDefinePoints) {
        this.formationDefinePoints.push(world);
        return;
      }
      if (!this.formationOffsets || this.formationOffsets.length === 0) return;
      const session = this.nextFormationSession++;
      const attached: { offset: Point; id: string }[] = [];
      this.formationOffsets.forEach((offset, index) => {
        const point = { x: world.x + offset.x, y: world.y + offset.y };
        if (this.hitTest && !this.hitTest(point)) return; // 落在果凍外——跳過這一點，其餘照常
        const formationId = `formation:${session}:${index}`;
        attached.push({ offset, id: formationId });
        this.emit({ type: 'grab', id: formationId, x: point.x, y: point.y });
      });
      if (attached.length > 0) {
        this.formationSessions.set(id, {
          lastWorld: { x: world.x, y: world.y },
          attached,
          startX: screenX,
          startY: screenY,
          startT: timeMs,
          startWorld: world,
        });
      }
      return;
    }
    if (this.activeTool === 'spray') {
      // 撒 Pin 只有 `down` 有事做——點一下就完成，`move`/`up`/`cancel` 那三個
      // 方法因此沒有對應的分支（見類別頂端說明）。
      this.sprayOnce(this.screenToWorld(screenX, screenY));
      return;
    }
    if (this.activeTool === 'erase') {
      // 按下當下就擦一次——不必等到 move，點一下也該能清掉腳下那幾顆。
      const session: EraseSession = { erasedPinIds: new Set() };
      this.eraseSessions.set(id, session);
      this.eraseAt(this.screenToWorld(screenX, screenY), session);
      return;
    }
    if (isClickTool(this.activeTool)) {
      // 生成／移除都要等 `up` 才算數（issue #97）——按下當下先記位置，拖曳與否
      // 由 `move` 判定。刻意不在 `down` 就動手：按錯地方時還能拖開取消。
      this.clickSessions.set(id, {
        tool: this.activeTool,
        startX: screenX,
        startY: screenY,
        startT: timeMs,
        startWorld: this.screenToWorld(screenX, screenY),
        dragged: false,
      });
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    // 「點一下」的進行中手勢先攔（issue #97）：session 只有那幾個工具建得出來，
    // 但按住途中可能被切到別的工具——照 `activeTool` 分支會把它漏掉，見 `up`。
    const click = this.clickSessions.get(id);
    if (click) {
      // 超過輕拍的位移門檻（跟一般操作同一把尺）就不再是「點一下」。
      if (!click.dragged && movedFromStart(click, screenX, screenY) > this.config.tapMaxDist) {
        click.dragged = true;
      }
      return;
    }
    // 大把抓取同理：這一把屬於按下當下的工具（issue #113）。
    if (this.handfulSessions.has(id)) {
      const world = this.screenToWorld(screenX, screenY);
      this.emit({ type: 'moveGrab', id, x: world.x, y: world.y });
      return;
    }
    if (this.activeTool === 'general') {
      this.gestureTracker.move(id, screenX, screenY);
      return;
    }
    if (this.activeTool === 'fan') {
      const session = this.fanSessions.get(id);
      if (!session) return;
      const world = this.screenToWorld(screenX, screenY);
      if (session.mode === 'move') {
        this.emitFanMove(world, session);
      } else {
        session.current = world;
      }
      return;
    }
    if (this.activeTool === 'formation') {
      if (this.formationDefinePoints) return; // 定義中：只有 down 記點，move 不理會
      const session = this.formationSessions.get(id);
      if (!session) return;
      const world = this.screenToWorld(screenX, screenY);
      session.lastWorld = world;
      for (const { offset, id: formationId } of session.attached) {
        this.emit({
          type: 'moveGrab',
          id: formationId,
          x: world.x + offset.x,
          y: world.y + offset.y,
        });
      }
      return;
    }
    if (this.activeTool === 'erase') {
      // 沒有進行中的手勢就不作用——橡皮擦是「按住拖過去才擦」，不是滑過就擦。
      const session = this.eraseSessions.get(id);
      if (!session) return;
      this.eraseAt(this.screenToWorld(screenX, screenY), session);
    }
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    // 「點一下」的進行中手勢先結（issue #97）：按住途中切走工具（觸控裝置做得
    // 到）時，照 `activeTool` 分支會在別的工具那裡先 `return`，這次點擊就永遠
    // 不會完成、session 也留在表上。手勢屬於按下當下那個工具，跟現在選什麼無關。
    const click = this.clickSessions.get(id);
    if (click) {
      this.clickSessions.delete(id);
      if (!click.dragged) this.onClickTool?.(click.tool, click.startWorld);
      return;
    }
    const handful = this.handfulSessions.get(id);
    if (handful) {
      this.handfulSessions.delete(id);
      // 快速按放＝以同一個半徑對按下點 Tap（ADR-0014），跟一般操作的 grab → tap → release 同形。
      if (isTap(handful, screenX, screenY, timeMs, this.config)) {
        this.emit({
          type: 'tap',
          x: handful.startWorld.x,
          y: handful.startWorld.y,
          radius: handful.radius,
        });
      }
      this.emit({ type: 'release', id });
      return;
    }
    if (this.activeTool === 'general') {
      this.gestureTracker.up(id, screenX, screenY, timeMs);
      return;
    }
    if (this.activeTool === 'fan') {
      const session = this.fanSessions.get(id);
      if (!session) return;
      this.fanSessions.delete(id);
      const world = this.screenToWorld(screenX, screenY);
      if (session.mode === 'move') {
        this.emitFanMove(world, session);
      } else {
        this.emitFanPlace(session.origin, world);
      }
      return;
    }
    if (this.activeTool === 'formation') {
      if (this.formationDefinePoints) return; // 定義中：down 才算數
      this.emitFormationTapIfAny(id, screenX, screenY, timeMs);
      this.releaseFormationSession(id);
      return;
    }
    if (this.activeTool === 'erase') {
      // `up` 跟 `cancel` 在這裡是同一件事：結束這次擦除、丟掉已處理集合。刻意
      // **不**在放開當下再補擦一次——放開前瀏覽器一定送過同座標的 `move`，補的
      // 那一次只會在 Track 上多錄一筆一模一樣的 `unpin`，還會讓 `up` 與 `cancel`
      // 無謂地不對稱。
      this.eraseSessions.delete(id);
    }
  }

  cancel(id: PointerId): void {
    // 生成／移除都還沒發生（要等 `up`），中斷就是整個作廢，不留痕跡（issue #97）。
    // 先攔的理由同 `up`：手勢屬於按下當下那個工具。
    if (this.clickSessions.delete(id)) return;
    // 大把抓取已經是活著的約束：中斷要真的放開（同一般 Grab），不送 tap。
    if (this.handfulSessions.delete(id)) {
      this.emit({ type: 'release', id });
      return;
    }
    if (this.activeTool === 'general') {
      this.gestureTracker.cancel(id);
      return;
    }
    if (this.activeTool === 'fan') {
      // 放置中：放棄這次放置，不 emit 任何事件。拖曳中：`move` 已經即時把風扇挪
      // 過去了，這裡只是停止跟隨指標，風扇留在目前位置（見類別頂端說明）。
      this.fanSessions.delete(id);
      return;
    }
    if (this.activeTool === 'formation') {
      // 已經是活著的約束（`down` 就 emit 過 grab），跟一般 Grab 的 cancel 同一個
      // 道理：真的要放開，不能悄悄留著（見類別頂端說明）。
      this.releaseFormationSession(id);
      return;
    }
    if (this.activeTool === 'erase') {
      // 已經擦掉的 Pin 是既成事實，取消不會把它們變回來（比照拖曳風扇的 cancel
      // 不回捲）——這裡只是停止繼續跟著指標擦。
      this.eraseSessions.delete(id);
    }
  }

  /**
   * 撒一次 Pin（issue #69）——`down` 唯一的呼叫處，點一下就完成（`move`／`up`／
   * `cancel` 對撒 Pin 都不作用）。Dart throwing：在以 `center` 為圓心、`sprayRadius`
   * 為半徑的圓內均勻取候選點（`sqrt(u)` 才是圓內均勻，直接用 `u` 會擠在圓心），
   * 跟這次已接受的候選 + 既有 Pin（`listPins`）都要 ≥ `spraySpacing`，再用
   * `hitTest` 濾掉落在果凍外的，存活的當場送 `pin` 事件。
   *
   * 順序刻意是「先比距離、後 `hitTest`」：距離比對只是幾個平方和，`hitTest` 要
   * 真的走一次 picking，先用便宜的條件淘汰掉大多數候選。被 `hitTest` 濾掉的候選
   * **不**進 `accepted`——它沒有變成 Pin，不該佔著位置擋住後續候選（果凍邊緣外
   * 的空白區不會在圓內留下一塊莫名其妙的空洞）。
   */
  private sprayOnce(center: Point): void {
    const radius = Math.max(0, this.sprayRadius);
    // 間距 0（或負）會讓「還能塞幾顆」變成無限大，用一個極小正值收斂成「幾乎不限」。
    const spacing = Math.max(this.spraySpacing, 1e-6);
    const existing = (this.listPins?.() ?? []).map((pin) => pin.point);
    const accepted: Point[] = [];
    const slots = (radius / spacing) ** 2;
    const attempts = Math.min(MAX_SPRAY_ATTEMPTS, Math.ceil(SPRAY_ATTEMPTS_PER_SLOT * slots));

    for (let i = 0; i < attempts && accepted.length < MAX_SPRAY_PINS; i++) {
      const r = radius * Math.sqrt(this.random());
      const theta = 2 * Math.PI * this.random();
      const candidate = { x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) };
      if (isWithin(candidate, accepted, spacing) || isWithin(candidate, existing, spacing))
        continue;
      if (this.hitTest && !this.hitTest(candidate)) continue; // 落在果凍外——這個候選作廢
      accepted.push(candidate);
      this.emit({
        type: 'pin',
        id: `spray:${this.nextSprayPin++}`,
        x: candidate.x,
        y: candidate.y,
      });
    }
  }

  /**
   * 擦一次（issue #70）——`down`／`move` 共用。掃一遍 `listPins()`，凡是
   * 落在以 `center` 為圓心、`eraseRadius` 為半徑的圓內、且本次手勢還沒處理過的
   * Pin，就送一次 `unpin` 並記進 `session.erasedPinIds`。
   *
   * 邊界用 `<=`：半徑滑桿上的數字就是「這一圈裡面的都會被擦掉」，剛好壓在圈上
   * 的那顆算在裡面才符合圓圈視覺提示給人的預期。
   *
   * 刻意分兩段（先挑出 id、再逐一 emit）：呼叫端的 `emit` 通常是同步進
   * `sim.applyInput`，也就是第一顆 `unpin` 送出去的當下，場上的 Pin 清單就已經
   * 變了。邊走邊 emit 的話，如果 `listPins()` 回傳的是內部那份清單本身（而不是
   * 每次都新配的快照），迴圈就會邊跑邊被抽掉元素、漏掉後面幾顆。
   */
  private eraseAt(center: Point, session: EraseSession): void {
    const radius = Math.max(0, this.eraseRadius);
    const hitPinIds: PointerId[] = [];
    for (const pin of this.listPins?.() ?? []) {
      if (session.erasedPinIds.has(pin.id)) continue;
      if (Math.hypot(pin.point.x - center.x, pin.point.y - center.y) > radius) continue;
      session.erasedPinIds.add(pin.id);
      hitPinIds.push(pin.id);
    }
    for (const pinId of hitPinIds) this.emit({ type: 'unpin', id: pinId });
  }

  /**
   * 這次編隊手勢如果是「快速按放」（issue #81 / V2 T3-9），對每個已附著的點各送
   * 一次 `tap`——由 `up` 在 `releaseFormationSession` 之前呼叫，湊出跟一般操作
   * 同形的 `grab×N → tap×N → release×N`。
   *
   * 為什麼編隊也要有輕拍：#64 US23 說「編隊抓取用起來就是同時操作好幾個一般的
   * Grab」，那麼快速按放理當拍出一整組；ADR-0011 也指出快速點放與拖曳本來就是
   * 兩種不衝突的手勢，共存沒有歧義。判定直接用 `GestureTracker` 那支 `isTap`，
   * 座標同樣取 `startWorld`（**按下當下**的位置）——兩個模式的輕拍是同一回事，
   * 共用同一份判定才不會日後各自漂移。
   *
   * 落在果凍外、`down` 時被跳過的偏移點不在 `attached` 裡，自然不會被拍——跟
   * `grab`／`release` 的處理一致。`cancel` 刻意不走這裡：中斷不是完成一次輕拍。
   */
  private emitFormationTapIfAny(
    id: PointerId,
    screenX: number,
    screenY: number,
    timeMs: number,
  ): void {
    const session = this.formationSessions.get(id);
    if (!session) return;
    if (!isTap(session, screenX, screenY, timeMs, this.config)) return;
    for (const { offset } of session.attached) {
      this.emit({
        type: 'tap',
        x: session.startWorld.x + offset.x,
        y: session.startWorld.y + offset.y,
      });
    }
  }

  /** `up`／`cancel` 共用：對這次手勢裡每個已附著的點送 `release`，清掉 session。 */
  private releaseFormationSession(id: PointerId): void {
    const session = this.formationSessions.get(id);
    if (!session) return;
    this.formationSessions.delete(id);
    for (const { id: formationId } of session.attached) {
      this.emit({ type: 'release', id: formationId });
    }
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數，一般操作限定）——比照 `GestureTracker.activeCount`。 */
  get activeCount(): number {
    return this.gestureTracker.activeCount;
  }

  private emitFanPlace(origin: Point, current: Point): void {
    const dx = current.x - origin.x;
    const dy = current.y - origin.y;
    const length = Math.hypot(dx, dy);
    const [dirX, dirY] = length > 1e-9 ? [dx / length, dy / length] : [1, 0];
    this.emit({
      type: 'setFan',
      originX: origin.x,
      originY: origin.y,
      dirX,
      dirY,
      length,
      width: this.fanWidth,
      strength: this.fanStrength,
      falloffExponent: this.fanFalloffExponent,
      frequency: this.fanFrequency,
    });
  }

  /**
   * 拖曳既有風扇：原點 = 目前指標世界座標 `pointer` + `down` 當下拍下的
   * `offsetX/offsetY`（維持相對位移，見 `FanMoveSession` 說明），其餘沿用
   * `down` 當下拍下的快照。
   */
  private emitFanMove(pointer: Point, session: FanMoveSession): void {
    this.emit({
      type: 'setFan',
      originX: pointer.x + session.offsetX,
      originY: pointer.y + session.offsetY,
      dirX: session.dirX,
      dirY: session.dirY,
      length: session.length,
      width: session.width,
      strength: session.strength,
      falloffExponent: session.falloffExponent,
      frequency: session.frequency,
    });
  }
}

/** `point` 是否距離 `others` 裡任何一點不到 `minDistance`（撒 Pin 的間距判定）。 */
function isWithin(point: Point, others: readonly Point[], minDistance: number): boolean {
  return others.some((o) => Math.hypot(o.x - point.x, o.y - point.y) < minDistance);
}

/** 半徑往上／下走 `steps` 格拉霸 step，夾在範圍內（issue #114）。 */
function stepRadius(radius: number, steps: number, range: RadiusRange): number {
  return Math.min(range.max, Math.max(range.min, radius + steps * range.step));
}
