/**
 * `ToolRouter`（issue #65 / V2 T3-1）——沙盒工具切換的地基，取代 `PointerInput`
 * 原本直接持有的 `GestureTracker`。issue #66 / V2 T3-2 加上第一個新工具：電風扇。
 * issue #68 / V2 T3-4 加上第二個：編隊抓取。
 *
 * **工具與模式**（issue #122 / V4 T1；ADR-0016，取代下面 ADR-0011／0015 的選擇器設計）：
 * 一般操作、大把抓取、編隊抓取合成「抓取」工具（`'grab'`），三者變成它的模式（單點／
 * 大把／編隊，`TOOL_MODES`）。每個工具各自記住自己的模式（`modes`），中鍵單擊
 * （`cycleMode`）或參數卡的模式鈕（`setMode`）切換。「工具＋模式」推出內部的手勢分支
 * （`Behavior`）——就是原本各工具的那些分支，內容一行沒改，只換掉「目前是哪個分支」
 * 的來源；而且改成**按下當下**定下、記在 `pointerBehaviors`，`move`／`up`／`cancel`
 * 照它分派，拖曳中切工具或切模式都只影響下一次按下。下面各段提到的「一般操作」
 * ＝單點模式、「大把抓取」＝大把模式、「編隊抓取」＝編隊模式。
 *
 * 單點模式下 `down`/`move`/`up`/`cancel` 原封不動委派給內部持有的 `GestureTracker`，
 * 不修改 `GestureTracker` 本身。
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
 * **Pin 工具**（issue #123 / V4 T2；spec #121「Pin 工具」）：原本的 Pin、撒 Pin、移除 Pin
 * 三個工具合成一個，模式為 放／拔。兩個模式都直接送 `pin`／`unpin`（不新增 `InputEvent`
 * 種類），也都不送 `tap`——快速按放不觸發 Tap。以前 Pin 工具是照一般操作送 `grab`/`tap`
 * 再由呼叫端 `routeForPinTool` 轉換，丟不丟 `tap` 要看「發出事件當下」選的工具，拖曳中
 * 切走工具時那一下的 `tap` 會漏出去；現在分支在按下當下定下（`pointerBehaviors`），這個
 * 缺口跟著消失。
 *
 * - **放**（`PinPlaceSession`）：`down` 落在 Jelly 上（`hitTest`）就在按下點放一顆（id =
 *   指標 id）——**不再**因為點在既有 Pin 附近改成拔。拖曳超過 Tap 的位移門檻後，每次
 *   `move` 以指標為圓心、`pinBrushRadius` 為半徑撒一輪（撒 Pin，見 `sprayAt`）。
 * - **拔**（`PinRemoveSession`）：`down` 拔掉 `PIN_REMOVE_RADIUS_PX`（螢幕像素）內最近的
 *   一顆；拖曳超過門檻後變成橡皮擦，每次 `move` 拔掉筆刷半徑內的所有 Pin（見 `eraseAt`）。
 *   單擊不當橡皮擦：不然點一下就會清掉一整圈，「精準地拔一顆」做不到。
 *
 * 撒 Pin 與橡皮擦共用一條 Pin 筆刷半徑（`pinBrushRadius`，CONTEXT.md「Pin 筆刷半徑」），
 * 撒 Pin 間距另外一條（`spraySpacing`），都由 `setPinBrushParams` 即時寫入。
 *
 * 撒點用經典的 dart throwing：用注入的 `random`（預設 `Math.random`——**執行期**隨機，
 * 每次撒的分佈都不一樣；重播的決定性不靠這裡，見下段）在圓內反覆生成候選點，跟「這一筆
 * 已放下的 Pin（含按下那一顆）」以及「注入的 `listPins` 回傳的既有 Pin」都要 ≥
 * `spraySpacing` 才接受，再用 `hitTest`（同編隊抓取）濾掉落在果凍外的，存活的才用合成 id
 * （`spray:<counter>`，跨多筆遞增、不重複）送 `pin`。這一筆自己記住放過的點，而不是只靠
 * `listPins`：真實路徑上 `emit` 同步進 `sim.applyInput`、清單會跟著變，但那是呼叫端的
 * 接線方式，不是這個類別能自己看到的事。每一筆撒出的數量有上限
 * （`MAX_SPRAY_PINS_PER_STROKE`），每一輪的嘗試次數也有上限，求解器與這個迴圈都不會被壓垮。
 *
 * 重播的決定性：`pin` 事件本身帶著算好的絕對 `x`/`y`，`TrackRecorder` 錄的是
 * 那些具體座標，重播時原樣送回去，不會重算隨機分佈——所以這裡刻意不需要有
 * 種子的 PRNG。
 *
 * **Jelly 工具**（issue #97 / V3 T3-4 的「點一下」手勢；issue #124 / V4 T3 把生成、移除、
 * 重建三個工具合成一個、沒有模式）：左鍵——`down` 記下按下處，`up` 時只要途中沒拖曳
 * （位移 ≤ `tapMaxDist`，跟一般操作同一把尺）就呼叫 `onJellyClick(world)`（生成），帶的是
 * 按下當下的世界座標；點在既有 Jelly 上也照樣生成。分支在按下當下定下，按住途中切走工具，
 * 這次手勢仍算 Jelly 工具的。右鍵單擊（`rightClick`，判定在 `CameraInput`）點中某塊
 * Jelly（`hitTest`）→ `onJellyContextMenu(world, screen)` 開「重建／移除」選單；點在空白處
 * 什麼都不做。這個工具是本檔唯一**不** emit `InputEvent` 的分支：要送進 `World` 的 `spawn`
 * 需要來源圖、兩條拉霸的值與網格 bbox，`remove`／重建需要先 `pick` 出 `jellyId`——那些
 * 都是 `JellySandbox` 的狀態，輸入層只回報「在這個世界座標點了一下」（ADR-0005）。
 *
 * **橡皮擦**（issue #70 / V2 T3-6 的移除 Pin，issue #123 變成拔模式的拖曳）：每次
 * 用注入的 `listPins()` 掃一遍場上的 Pin，落在「目前指標為圓心、筆刷半徑為半徑」的圓內
 * 就送 `unpin`——被清掉的 Pin 跟使用者自己點掉的完全一樣。
 *
 * 每次手勢記一組本次已經送過 `unpin` 的 Pin id（`PinRemoveSession.erasedPinIds`，含按下
 * 當下點掉的那一顆），`up`／`cancel` 時連同 session 一起丟掉。真實路徑上 `emit` 是同步進
 * `sim.applyInput` 的，下一次 `listPins()` 本來就讀不到已經清掉的那顆——但這條保證來自
 * 呼叫端的接線方式；擦除又是每次 `move` 都重掃一遍的高頻迴圈，多送一次 `unpin` 在別的
 * 接線方式下（例如事件先進佇列、下一幀才套用）就會變成重複事件寫進 Track。記一組 id 是
 * 這裡自己把這件事關死。
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
 * 裡的紀錄，不 emit 任何事件（跟單點抓取放開一半的 Grab 不同——那邊
 * `cancel` 仍會 `release`，因為 Grab 已經是「活著」的約束；電風扇放置在 `up`
 * 之前完全沒有送出任何 `InputEvent`，沒有東西需要收回）。拖曳中
 * （`FanMoveSession`）則不同——每次 `move` 都已經即時把風扇挪過去了，`cancel`
 * 只是停止繼續跟隨指標，風扇留在目前的位置，不回捲到拖曳起點（比照 Grab 的
 * `cancel` 不回捲已經發生過的 `moveGrab`）。「移除風扇」按鈕不經過
 * `ToolRouter`——比照「清除所有 Pin」的模式，由 `JellySandbox` 直接對
 * `sim.applyInput({ type: 'clearFan' })`（見該檔 `removeFan`）。
 *
 * **電風扇的模式與右鍵**（issue #125 / V4 T4；spec #121「電風扇」）：模式不改左鍵——放置
 * 與搬移完全不變——而是「按住右鍵＋滾輪要調哪個參數」：寬度／強度／衰減／頻率
 * （`adjustActiveValue`，一格＝該拉霸的 step，夾在範圍內，寫進的就是 `setFanParams` 那四個
 * 欄位，所以同時是下一次放置的參數；場上風扇的即時更新照舊歸呼叫端）。右鍵單擊
 * （`rightClick`）落在場上風扇的矩形內就 emit `clearFan`——跟「移除風扇」按鈕同一個事件、
 * 經同一個 `emit`（呼叫端接到 `applyInput` + 錄製），所以錄製中照樣錄進 Track。按住右鍵
 * 期間滾過滾輪不算右鍵單擊（判定在 `CameraInput`），在風扇上調參數不會誤刪。
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
 * 工具列上的工具（issue #122 / V4 T1；ADR-0016）。一般操作、大把抓取、編隊抓取合成
 * `'grab'`（三者變成它的模式，見 `TOOL_MODES`）；Pin、撒 Pin、移除 Pin 合成 `'pin'`
 * （issue #123，模式為放／拔）；生成、移除、重建 Jelly 合成 `'jelly'`（issue #124，沒有
 * 模式，移除與重建走右鍵選單）。工具與模式都不存檔、也不是 Track 事件，改名不影響舊片段檔。
 */
export type ToolId = 'grab' | 'pin' | 'fan' | 'jelly';

/** 工具列的順序（issue #122）——面板照這個順序排按鈕。 */
export const TOOL_IDS: readonly ToolId[] = ['grab', 'pin', 'fan', 'jelly'];

/**
 * 有模式的工具與它們的模式，依中鍵單擊輪替的順序排（issue #122；CONTEXT.md「模式」）。
 * 第一個是預設模式。電風扇的模式是「右鍵＋滾輪要調的參數」（issue #125）。
 */
export const TOOL_MODES = {
  grab: ['single', 'handful', 'formation'],
  pin: ['place', 'remove'],
  fan: ['width', 'strength', 'falloff', 'frequency'],
} as const satisfies Partial<Record<ToolId, readonly string[]>>;

/** 有模式的工具。 */
export type ModalToolId = keyof typeof TOOL_MODES;
/** 某個工具的模式。 */
export type ToolModeOf<T extends ModalToolId> = (typeof TOOL_MODES)[T][number];
/** 任一工具的模式。 */
export type ToolMode = ToolModeOf<ModalToolId>;
/** 抓取工具的模式：單點（原一般操作）／大把（原大把抓取）／編隊（原編隊抓取）。 */
export type GrabMode = ToolModeOf<'grab'>;
/** Pin 工具的模式：放（單擊放一顆、拖曳撒 Pin）／拔（單擊拔最近一顆、拖曳當橡皮擦）。 */
export type PinMode = ToolModeOf<'pin'>;
/** 電風扇的模式（issue #125）：右鍵＋滾輪調的參數——寬度／強度／衰減／頻率。左鍵不受影響。 */
export type FanMode = ToolModeOf<'fan'>;

export function isModalTool(tool: ToolId): tool is ModalToolId {
  return tool in TOOL_MODES;
}

/** 這個工具的模式清單（輪替順序）；沒有模式的工具回空陣列。 */
export function modesOf(tool: ToolId): readonly ToolMode[] {
  return isModalTool(tool) ? TOOL_MODES[tool] : [];
}

/**
 * 按下當下定下的手勢分支（issue #122）——「工具＋模式」推出來的，`ToolRouter` 內既有的
 * 各分支原樣沿用，只換掉「目前是哪個分支」的來源：抓取工具的三個模式各自對應原本的
 * 一般操作／大把抓取／編隊抓取，Pin 工具的兩個模式是 `pinPlace`／`pinRemove`（issue #123），
 * 其餘工具就是它自己——電風扇有模式，但模式只決定滾輪調哪個參數，左鍵手勢都是 `'fan'`
 * （issue #125）。
 */
type Behavior =
  'single' | 'handful' | 'formation' | 'pinPlace' | 'pinRemove' | Exclude<ToolId, 'grab' | 'pin'>;

export const DEFAULT_TOOL: ToolId = 'grab';

/** 手勢直接交給 `GestureTracker` 的分支——只有單點抓取（見類別頂端說明）。 */
function usesGestureTracker(behavior: Behavior): boolean {
  return behavior === 'single';
}

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

/**
 * Pin 筆刷半徑的預設值（issue #123；撒 Pin 與橡皮擦共用，CONTEXT.md「Pin 筆刷半徑」），
 * 世界單位——`setPinBrushParams` 可在執行期間覆寫。先取 120，試手感後再調（spec #121）。
 */
export const DEFAULT_PIN_BRUSH_RADIUS = 120;
/** 撒 Pin 最小間距的預設值（issue #69）——`setPinBrushParams` 可在執行期間覆寫。 */
export const DEFAULT_SPRAY_SPACING = 36;

/**
 * 拔模式單擊「點掉最近一顆」的判定半徑，**螢幕像素**（issue #14 的點掉特定 Pin，issue #123
 * 從 `JellySandbox` 搬進來）——跟 `.jelly-pin-marker` 的 CSS 直徑（16px）同數量級。換算
 * 回世界座標要看目前相機縮放（見 `worldRadiusAt`），判定範圍才不會隨縮放忽大忽小。
 */
export const PIN_REMOVE_RADIUS_PX = 16;

/**
 * 撒 Pin 每一輪最多嘗試幾個候選點、每一筆最多真的撒幾顆（issue #69；issue #123 從「點一下
 * 一次」改成「一筆」）——dart throwing 的嘗試次數依「半徑 / 間距」的平方估算（範圍內大約
 * 塞得下幾顆 × 每顆多試幾次），兩個上限只是把最壞情況的成本與 Pin 數量框住：間距調到很小、
 * 半徑調到很大時，不會一筆撒進幾百顆 Pin 把求解器壓垮，也不會讓每次 `move` 的迴圈跑到掉幀。
 */
const SPRAY_ATTEMPTS_PER_SLOT = 12;
const MAX_SPRAY_ATTEMPTS = 1500;
export const MAX_SPRAY_PINS_PER_STROKE = 200;

/**
 * 拉霸的範圍（issue #114 起的半徑拉霸；issue #125 加上電風扇四個參數）——面板拉霸與
 * 「右鍵＋滾輪調目前模式的數值」共用同一份。
 */
export interface ValueRange {
  min: number;
  max: number;
  step: number;
}

/**
 * 電風扇四個拉霸的範圍（issue #67；issue #125 從 `JellySandbox` 搬進來，右鍵＋滾輪要夾在
 * 同一個範圍內）。事後檢視把推力模型從連續力場改成陣風——見 `SimCore.applyFan`：
 * `strength` 從「每秒加速度」變成「單次陣風的瞬間速度衝量」，範圍跟著重新校準。
 * `frequency` 是平均每秒陣風次數；下限 0.2（約 5 秒一陣，稀疏陣風）、上限 10（幾乎連續的
 * 密集陣風，配合高 `strength` 就是颶風）。寬度／衰減程度中點對應 `DEFAULT_FAN_WIDTH`／
 * `DEFAULT_FAN_FALLOFF_EXPONENT`，拉霸沒被動過時中點顯示的值要跟實際生效的一致。衰減程度
 * 下限 0.2（避免趨近 0 次方讓衰減幾乎消失、矩形內外力道落差過於突兀）、上限 5（明顯集中在
 * 風扇正前方）。
 */
export const FAN_WIDTH_RANGE: ValueRange = { min: 20, max: 280, step: 5 };
export const FAN_STRENGTH_RANGE: ValueRange = { min: 200, max: 60000, step: 200 };
export const FAN_FALLOFF_RANGE: ValueRange = { min: 0.2, max: 5, step: 0.1 };
export const FAN_FREQUENCY_RANGE: ValueRange = { min: 0.2, max: 10, step: 0.1 };

/**
 * Pin 筆刷半徑拉霸的範圍（issue #123；沿用原本撒 Pin／移除 Pin 半徑的範圍），世界座標
 * 單位。上限 400 ≈ 一般匯入果凍的尺度，一下蓋住整隻。
 */
export const PIN_BRUSH_RADIUS_RANGE: ValueRange = { min: 20, max: 400, step: 10 };

/** `setPinBrushParams` 接受的部分更新（issue #123）——兩個欄位皆可選。 */
export interface PinBrushParams {
  /** Pin 筆刷半徑：撒 Pin 與橡皮擦的世界座標作用半徑（圓心 = 指標目前位置）。 */
  radius: number;
  /** 撒 Pin 時任兩顆 Pin（含場上既有的）之間的最小世界座標距離——越小越密。 */
  spacing: number;
}

/**
 * 大把抓取半徑的預設值（issue #113；世界單位）——`setHandfulParams` 可在執行期間覆寫。
 * 跟撒 Pin 同一個預設，拉霸範圍也相同（spec #112）。
 */
export const DEFAULT_HANDFUL_RADIUS = 140;

/** 大把抓取半徑拉霸的範圍（issue #113），世界單位——跟撒 Pin 一致（spec #112）。 */
export const HANDFUL_RADIUS_RANGE: ValueRange = { min: 20, max: 400, step: 10 };

/**
 * 「按住右鍵＋滾輪」能調的數值（issue #114 的「工具半徑」由 issue #122 推廣成「目前模式
 * 的數值」）：抓取／大把的大把抓取半徑、Pin 工具兩個模式共用的 Pin 筆刷半徑（issue #123）、
 * 電風扇四個模式各自的參數（issue #125）。
 */
export type ModeValueKey =
  | 'handfulRadius'
  | 'pinBrushRadius'
  | 'fanWidth'
  | 'fanStrength'
  | 'fanFalloffExponent'
  | 'fanFrequency';

/** 各數值的拉霸範圍——面板拉霸與「右鍵＋滾輪」共用同一份。 */
export const MODE_VALUE_RANGES: Readonly<Record<ModeValueKey, ValueRange>> = {
  handfulRadius: HANDFUL_RADIUS_RANGE,
  pinBrushRadius: PIN_BRUSH_RADIUS_RANGE,
  fanWidth: FAN_WIDTH_RANGE,
  fanStrength: FAN_STRENGTH_RANGE,
  fanFalloffExponent: FAN_FALLOFF_RANGE,
  fanFrequency: FAN_FREQUENCY_RANGE,
};

/**
 * 每個「工具＋模式」用右鍵＋滾輪調哪個數值（issue #125 從 if 串接改成表）；沒列到的模式
 * （單點、編隊）沒有數值可調，右鍵＋滾輪照舊縮放。
 */
const MODE_VALUE_KEYS: {
  readonly [T in ModalToolId]: Readonly<Partial<Record<ToolModeOf<T>, ModeValueKey>>>;
} = {
  grab: { handful: 'handfulRadius' },
  pin: { place: 'pinBrushRadius', remove: 'pinBrushRadius' },
  fan: {
    width: 'fanWidth',
    strength: 'fanStrength',
    falloff: 'fanFalloffExponent',
    frequency: 'fanFrequency',
  },
};

/** 一個可用右鍵＋滾輪調的數值：範圍＋讀寫 `ToolRouter` 內那一個欄位。 */
interface ModeValueSlot {
  readonly range: ValueRange;
  get(): number;
  set(value: number): void;
}

/** 目前模式的數值（issue #122）：哪一個、現在多少。 */
export interface ModeValue {
  key: ModeValueKey;
  value: number;
}

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
   * 一坨；拔模式（issue #70 / #123）更是完全靠它——要拔掉哪幾顆，就是從這份清單裡
   * 挑出落在點擊半徑或橡皮擦圓內的。不帶這個選項等同「場上沒有任何 Pin」：撒 Pin 只跟
   * 這一筆放下的互斥，拔模式則永遠沒有東西可拔。
   */
  listPins?: () => readonly PinInfo[];
  /**
   * 撒 Pin 的隨機數來源（issue #69），預設 `Math.random`——**執行期**隨機，每次
   * 撒出來的分佈都不一樣（重播的決定性由事件本身帶的具體座標保證，見類別頂端
   * 說明）。測試注入有種子的 PRNG 才能逐次一致。
   */
  random?: () => number;
  /**
   * Jelly 工具左鍵點一下（生成）的回呼（issue #97 的「點一下」手勢；issue #124 起只剩
   * Jelly 工具用）——參數是**按下當下**的世界座標。刻意不是 `InputEvent`：真正要送進
   * `World` 的 `spawn` 事件得知道用哪張來源圖、目前兩條拉霸的值、`offset` 要減掉網格
   * bbox 中心——那些是 `JellySandbox` 的狀態，輸入層不該認識（ADR-0005：輸入層只回報
   * 手勢）。不帶這個選項等同「沒接線」：點下去什麼都不會發生。
   */
  onJellyClick?: (world: Point) => void;
  /**
   * Jelly 工具右鍵單擊點中某塊 Jelly（issue #124）——`JellySandbox` 在 `screen`（畫布局部
   * 座標）開「重建／移除」選單，作用在 `world` 點中的那一塊（`pick` 由它做，理由同上）。
   * 點在空白處（`hitTest` 沒命中）不呼叫。
   */
  onJellyContextMenu?: (world: Point, screen: Point) => void;
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
 * 進行中的一次 Pin 放模式手勢（issue #123）：按下當下的定格（拖曳判定用）、`dragged`
 * （位移超過 Tap 門檻後設起來、不再放下——之後每次 `move` 都撒一輪），`placed` 是這一筆
 * 已經放下的 Pin 座標（含按下那一顆，撒 Pin 的間距要跟它們比），`sprayed` 是這一筆撒出
 * 的數量（上限 `MAX_SPRAY_PINS_PER_STROKE`）。
 */
interface PinPlaceSession extends GestureStart {
  dragged: boolean;
  placed: Point[];
  sprayed: number;
}

/**
 * 進行中的一次 Pin 拔模式手勢（issue #123；橡皮擦沿用 issue #70）：`dragged` 同放模式，
 * 設起來後才當橡皮擦。`erasedPinIds` 是這次手勢裡已經送過 `unpin` 的 **Pin** id
 * （`PinInfo.id`，跟 `pinRemoveSessions` 那層的鍵——指標 id——是兩回事，只是在這個專案
 * 裡兩者共用 `PointerId` 這個型別），避免同一顆被重複送（見類別頂端說明）。`up`／`cancel`
 * 連同整個 session 一起丟掉，下一次按下就是乾淨的一組。
 */
interface PinRemoveSession extends GestureStart {
  dragged: boolean;
  erasedPinIds: Set<PointerId>;
}

/**
 * 進行中的一次 Jelly 工具左鍵「點一下」手勢（issue #97）：`startWorld` 是**按下當下**的
 * 世界座標（回呼拿的就是它，跟輕拍「打在按下點」同一條規則），`dragged` 一旦在 `move`
 * 途中被設起來就不會再放下——拖出去又拖回原點仍然不算點一下，使用者中途已經看到自己
 * 在拖了。
 *
 * 刻意**只**看位移、不看按住多久（跟 `isTap` 不同）：生成是「放在這裡」而不是「輕拍
 * 一下」，瞄準位置多按了一秒再放開仍該生成，不然會變成「按太久就沒反應」的謎樣失敗。
 */
interface ClickSession extends GestureStart {
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
  private readonly onJellyClick: ((world: Point) => void) | undefined;
  private readonly onJellyContextMenu: ((world: Point, screen: Point) => void) | undefined;
  private activeTool: ToolId = DEFAULT_TOOL;
  /**
   * 每個有模式的工具各自目前的模式（issue #122）——整個 session 內記住、不存檔；切去
   * 別的工具再切回來模式不變。初值＝各工具清單裡的第一個。
   */
  private readonly modes: { [T in ModalToolId]: ToolModeOf<T> } = {
    grab: TOOL_MODES.grab[0],
    pin: TOOL_MODES.pin[0],
    fan: TOOL_MODES.fan[0],
  };
  /**
   * 每個進行中的指標在**按下當下**定下的手勢分支（issue #122）——`move`／`up`／`cancel`
   * 一律照這個分派，拖曳中切工具或切模式只影響下一次按下。`up`／`cancel` 時移除。
   */
  private readonly pointerBehaviors = new Map<PointerId, Behavior>();
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
  /**
   * Pin 筆刷半徑（撒 Pin 與橡皮擦共用）與撒 Pin 最小間距（issue #123）——面板兩條拉霸與
   * 右鍵＋滾輪即時寫入，每一輪撒／擦都讀目前值（拖曳途中調也立刻反映在還沒走到的那段）。
   */
  private pinBrushRadius = DEFAULT_PIN_BRUSH_RADIUS;
  private spraySpacing = DEFAULT_SPRAY_SPACING;
  /** 撒出的 Pin 合成 id 流水號（`spray:<n>`）——跨多筆遞增，各顆身分互不相干。 */
  private nextSprayPin = 1;
  /** 進行中的 Pin 放／拔手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly pinPlaceSessions = new Map<PointerId, PinPlaceSession>();
  private readonly pinRemoveSessions = new Map<PointerId, PinRemoveSession>();
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
    this.onJellyClick = opts.onJellyClick;
    this.onJellyContextMenu = opts.onJellyContextMenu;
    this.config = resolveGestureConfig(opts.config);
  }

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
  }

  get currentTool(): ToolId {
    return this.activeTool;
  }

  /** 某個工具目前的模式（issue #122）；沒有模式的工具回 `null`。 */
  modeOf<T extends ModalToolId>(tool: T): ToolModeOf<T>;
  modeOf(tool: ToolId): ToolMode | null;
  modeOf(tool: ToolId): ToolMode | null {
    return isModalTool(tool) ? this.modes[tool] : null;
  }

  /** 目前工具的模式；沒有模式回 `null`。 */
  get currentMode(): ToolMode | null {
    return this.modeOf(this.activeTool);
  }

  /** 設定某個工具的模式（參數卡的模式鈕）——只影響下一次按下。 */
  setMode<T extends ModalToolId>(tool: T, mode: ToolModeOf<T>): void {
    this.writeMode(tool, mode);
  }

  /**
   * 中鍵單擊（issue #122）：目前工具的模式換成清單裡的下一個（最後一個繞回第一個），
   * 回報新模式讓呼叫端同步參數卡與游標標籤。目前工具沒有模式就回 `null`、什麼都不做。
   */
  cycleMode(): ToolMode | null {
    const tool = this.activeTool;
    if (!isModalTool(tool)) return null;
    const list: readonly ToolMode[] = TOOL_MODES[tool];
    const next = list[(list.indexOf(this.modes[tool]) + 1) % list.length]!;
    this.writeMode(tool, next);
    return next;
  }

  /**
   * `modes` 的唯一寫入口。呼叫端（`setMode` 的型別參數、`cycleMode` 從該工具自己的清單
   * 取值）已保證模式屬於這個工具；TS 對「以聯集鍵寫入對應型別」無法收窄，所以在這裡放寬。
   */
  private writeMode(tool: ModalToolId, mode: ToolMode): void {
    (this.modes as Record<ModalToolId, ToolMode>)[tool] = mode;
  }

  /** 這一次按下要走的分支：抓取、Pin 工具看模式，其餘工具就是自己。 */
  private currentBehavior(): Behavior {
    const tool = this.activeTool;
    if (tool === 'grab') return this.modes.grab;
    if (tool === 'pin') return this.modes.pin === 'place' ? 'pinPlace' : 'pinRemove';
    return tool;
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
   * 面板「Pin 筆刷半徑」「撒 Pin 間距」兩條拉霸的即時寫入口（issue #123）——只覆寫有帶到
   * 的欄位。每一輪撒（`sprayAt`）／擦（`eraseAt`）都讀目前值，所以拖曳途中調也會立刻
   * 反映在還沒走到的那段路徑上。比照 `setFanParams`。
   */
  setPinBrushParams(params: Partial<PinBrushParams>): void {
    if (params.radius !== undefined) this.pinBrushRadius = params.radius;
    if (params.spacing !== undefined) this.spraySpacing = params.spacing;
  }

  /** 面板「大把抓取半徑」拉霸的即時寫入口（issue #113）——只影響**下一次**按下。 */
  setHandfulParams(params: Partial<HandfulParams>): void {
    if (params.radius !== undefined) this.handfulRadius = params.radius;
  }

  /**
   * 每個數值的範圍與讀寫口（issue #125：取代原本 `activeValueKey`／`adjustActiveValue`／
   * `valueOf` 三處 if 串接）——加新的可調數值只要在 `ModeValueKey`、`MODE_VALUE_RANGES`、
   * `MODE_VALUE_KEYS` 與這張表各補一行。寫入的就是面板拉霸（`setXParams`）寫的同一個欄位。
   */
  private readonly modeValues: { readonly [K in ModeValueKey]: ModeValueSlot } = {
    handfulRadius: this.slot(
      'handfulRadius',
      () => this.handfulRadius,
      (v) => (this.handfulRadius = v),
    ),
    pinBrushRadius: this.slot(
      'pinBrushRadius',
      () => this.pinBrushRadius,
      (v) => (this.pinBrushRadius = v),
    ),
    fanWidth: this.slot(
      'fanWidth',
      () => this.fanWidth,
      (v) => (this.fanWidth = v),
    ),
    fanStrength: this.slot(
      'fanStrength',
      () => this.fanStrength,
      (v) => (this.fanStrength = v),
    ),
    fanFalloffExponent: this.slot(
      'fanFalloffExponent',
      () => this.fanFalloffExponent,
      (v) => (this.fanFalloffExponent = v),
    ),
    fanFrequency: this.slot(
      'fanFrequency',
      () => this.fanFrequency,
      (v) => (this.fanFrequency = v),
    ),
  };

  private slot(key: ModeValueKey, get: () => number, set: (value: number) => void): ModeValueSlot {
    return { range: MODE_VALUE_RANGES[key], get, set };
  }

  /** 目前工具＋模式的數值是哪一個（issue #122；issue #125 改查表）；沒有數值回 `null`。 */
  private activeValueKey(): ModeValueKey | null {
    const tool = this.activeTool;
    if (!isModalTool(tool)) return null;
    const keys: Partial<Record<ToolMode, ModeValueKey>> = MODE_VALUE_KEYS[tool];
    return keys[this.modes[tool]] ?? null;
  }

  /** 目前模式的數值與它現在的值（游標標籤用）；沒有數值回 `null`。 */
  get activeValue(): ModeValue | null {
    const key = this.activeValueKey();
    return key === null ? null : { key, value: this.modeValues[key].get() };
  }

  /**
   * 「右鍵＋滾輪」調整目前模式的數值（issue #114 的調半徑，issue #122 推廣）：`steps` 格
   * （正 = 放大），每格一個拉霸 step，夾在該拉霸範圍內，回報新值讓呼叫端同步面板與
   * 圓圈。沒有數值的模式回 `null`（「不處理」——呼叫端照舊縮放相機）。跟拉霸一樣只影響
   * **下一次**按下：進行中的大把抓取 session 已經在按下時記下自己的半徑。電風扇的參數
   * （issue #125）同理只寫進下一次放置用的欄位；場上風扇的即時更新歸呼叫端（同 `setFanParams`）。
   */
  adjustActiveValue(steps: number): ModeValue | null {
    const key = this.activeValueKey();
    if (key === null) return null;
    const slot = this.modeValues[key];
    const value = stepValue(slot.get(), steps, slot.range);
    slot.set(value);
    return { key, value };
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    // 按下當下就定下這次手勢的分支（issue #122），之後切工具／切模式都不影響它。
    const behavior = this.currentBehavior();
    this.pointerBehaviors.set(id, behavior);
    if (usesGestureTracker(behavior)) {
      this.gestureTracker.down(id, screenX, screenY, timeMs);
      return;
    }
    if (behavior === 'handful') {
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
    if (behavior === 'fan') {
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
    if (behavior === 'formation') {
      const world = this.screenToWorld(screenX, screenY);
      if (this.formationDefinePoints) {
        this.formationDefinePoints.push(world);
        return;
      }
      // 還沒定義形狀：編隊模式下的左鍵拖曳不做任何事（spec #121）。
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
    if (behavior === 'pinPlace') {
      // 按下當下就放一顆（落在 Jelly 上才算）；點在既有 Pin 附近也照樣放（issue #123）。
      // 按在 Jelly 外仍開 session：從果凍外拖進來一樣能撒。
      const world = this.screenToWorld(screenX, screenY);
      const session: PinPlaceSession = {
        startX: screenX,
        startY: screenY,
        startT: timeMs,
        startWorld: world,
        dragged: false,
        placed: [],
        sprayed: 0,
      };
      this.pinPlaceSessions.set(id, session);
      if (!this.hitTest || this.hitTest(world)) {
        session.placed.push(world);
        this.emit({ type: 'pin', id, x: world.x, y: world.y });
      }
      return;
    }
    if (behavior === 'pinRemove') {
      // 按下當下只拔點擊半徑（螢幕像素）內最近的一顆；拖曳開始後才當橡皮擦（issue #123）。
      const world = this.screenToWorld(screenX, screenY);
      const session: PinRemoveSession = {
        startX: screenX,
        startY: screenY,
        startT: timeMs,
        startWorld: world,
        dragged: false,
        erasedPinIds: new Set(),
      };
      this.pinRemoveSessions.set(id, session);
      const radius = this.worldRadiusAt(screenX, screenY, PIN_REMOVE_RADIUS_PX);
      const hit = nearestPinWithin(this.listPins?.() ?? [], world, radius);
      if (hit) {
        session.erasedPinIds.add(hit.id);
        this.emit({ type: 'unpin', id: hit.id });
      }
      return;
    }
    if (behavior === 'jelly') {
      // 生成要等 `up` 才算數（issue #97）——按下當下先記位置，拖曳與否由 `move` 判定。
      // 刻意不在 `down` 就動手：按錯地方時還能拖開取消。
      this.clickSessions.set(id, {
        startX: screenX,
        startY: screenY,
        startT: timeMs,
        startWorld: this.screenToWorld(screenX, screenY),
        dragged: false,
      });
    }
  }

  // `move`／`up`／`cancel` 一律照 `down` 當下定下的分支（`pointerBehaviors`）分派，不看
  // 現在選的工具與模式（issue #122）：按住途中切走工具或按中鍵切模式，這次手勢仍屬於
  // 按下時那個分支、照常跟隨與放開（issue #97 的點一下、#113 的大把抓取原本就是這條規則，
  // 現在所有分支一體適用）。
  move(id: PointerId, screenX: number, screenY: number): void {
    const behavior = this.pointerBehaviors.get(id);
    if (behavior === undefined) return;
    if (usesGestureTracker(behavior)) {
      this.gestureTracker.move(id, screenX, screenY);
      return;
    }
    if (behavior === 'handful') {
      if (!this.handfulSessions.has(id)) return;
      const world = this.screenToWorld(screenX, screenY);
      this.emit({ type: 'moveGrab', id, x: world.x, y: world.y });
      return;
    }
    if (behavior === 'fan') {
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
    if (behavior === 'formation') {
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
    if (behavior === 'pinPlace') {
      const session = this.pinPlaceSessions.get(id);
      if (!session || !this.passedDragThreshold(session, screenX, screenY)) return;
      this.sprayAt(this.screenToWorld(screenX, screenY), session);
      return;
    }
    if (behavior === 'pinRemove') {
      // 沒有進行中的手勢就不作用——橡皮擦是「按住拖過去才擦」，不是滑過就擦。
      const session = this.pinRemoveSessions.get(id);
      if (!session || !this.passedDragThreshold(session, screenX, screenY)) return;
      this.eraseAt(this.screenToWorld(screenX, screenY), session);
      return;
    }
    if (behavior === 'jelly') {
      const click = this.clickSessions.get(id);
      // 超過輕拍的位移門檻（跟一般操作同一把尺）就不再是「點一下」。
      if (
        click &&
        !click.dragged &&
        movedFromStart(click, screenX, screenY) > this.config.tapMaxDist
      ) {
        click.dragged = true;
      }
    }
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const behavior = this.pointerBehaviors.get(id);
    if (behavior === undefined) return;
    this.pointerBehaviors.delete(id);
    if (usesGestureTracker(behavior)) {
      this.gestureTracker.up(id, screenX, screenY, timeMs);
      return;
    }
    if (behavior === 'handful') {
      const handful = this.handfulSessions.get(id);
      if (!handful) return;
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
    if (behavior === 'fan') {
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
    if (behavior === 'formation') {
      if (this.formationDefinePoints) return; // 定義中：down 才算數
      this.emitFormationTapIfAny(id, screenX, screenY, timeMs);
      this.releaseFormationSession(id);
      return;
    }
    if (behavior === 'pinPlace' || behavior === 'pinRemove') {
      // `up` 跟 `cancel` 在這裡是同一件事：結束這一筆、丟掉 session。不送 `tap`（Pin 工具
      // 快速按放不觸發 Tap），也刻意**不**在放開當下再補撒／補擦一次——放開前瀏覽器一定
      // 送過同座標的 `move`，補的那一次只會在 Track 上多錄幾筆，還會讓 `up` 與 `cancel`
      // 無謂地不對稱。
      this.endPinSession(id);
      return;
    }
    if (behavior === 'jelly') {
      const click = this.clickSessions.get(id);
      if (!click) return;
      this.clickSessions.delete(id);
      if (!click.dragged) this.onJellyClick?.(click.startWorld);
    }
  }

  /**
   * 畫布上的右鍵單擊（issue #124；判定在 `CameraInput`：按下到放開沒拖曳、也沒滾過滾輪），
   * 帶放開位置的世界座標與畫布局部座標，交給**目前**工具（右鍵單擊是一瞬間的事，沒有
   * 「按下當下定下分支」的問題）：
   *
   * - Jelly：點中某塊（`hitTest`）→ `onJellyContextMenu` 開選單；點空白不開。
   * - 電風扇（issue #125）：落在場上風扇的矩形內（`getFan` + `isPointInFanRect`，跟左鍵
   *   「拖曳既有風扇」同一個判定）→ emit `clearFan`，跟「移除風扇」按鈕同一個事件；點在
   *   風扇外、或場上沒有風扇，什麼都不做。
   * - 其他工具忽略。
   */
  rightClick(world: Point, screenX: number, screenY: number): void {
    if (this.activeTool === 'jelly') {
      if (this.hitTest && !this.hitTest(world)) return;
      this.onJellyContextMenu?.(world, { x: screenX, y: screenY });
      return;
    }
    if (this.activeTool === 'fan') {
      const fan = this.getFan?.() ?? null;
      if (fan && isPointInFanRect(fan, world)) this.emit({ type: 'clearFan' });
    }
  }

  cancel(id: PointerId): void {
    const behavior = this.pointerBehaviors.get(id);
    if (behavior === undefined) return;
    this.pointerBehaviors.delete(id);
    if (usesGestureTracker(behavior)) {
      this.gestureTracker.cancel(id);
      return;
    }
    if (behavior === 'handful') {
      // 大把抓取已經是活著的約束：中斷要真的放開（同一般 Grab），不送 tap。
      if (this.handfulSessions.delete(id)) this.emit({ type: 'release', id });
      return;
    }
    if (behavior === 'fan') {
      // 放置中：放棄這次放置，不 emit 任何事件。拖曳中：`move` 已經即時把風扇挪
      // 過去了，這裡只是停止跟隨指標，風扇留在目前位置（見類別頂端說明）。
      this.fanSessions.delete(id);
      return;
    }
    if (behavior === 'formation') {
      // 已經是活著的約束（`down` 就 emit 過 grab），跟一般 Grab 的 cancel 同一個
      // 道理：真的要放開，不能悄悄留著（見類別頂端說明）。
      this.releaseFormationSession(id);
      return;
    }
    if (behavior === 'pinPlace' || behavior === 'pinRemove') {
      // 已經放下／拔掉的 Pin 是既成事實，取消不會把它們變回來（比照拖曳風扇的 cancel
      // 不回捲）——這裡只是停止繼續跟著指標撒／擦。
      this.endPinSession(id);
      return;
    }
    // 生成還沒發生（要等 `up`），中斷就是整個作廢，不留痕跡（issue #97）。
    this.clickSessions.delete(id);
  }

  /**
   * 這一筆是否已經拖曳超過 Tap 的位移門檻（跟一般操作同一把尺）——一旦超過就記在
   * `session.dragged`、不再放下（拖出去又拖回原點仍算在拖）。
   */
  private passedDragThreshold(
    session: GestureStart & { dragged: boolean },
    screenX: number,
    screenY: number,
  ): boolean {
    if (!session.dragged && movedFromStart(session, screenX, screenY) > this.config.tapMaxDist) {
      session.dragged = true;
    }
    return session.dragged;
  }

  /**
   * 螢幕上 `px` 像素在 `(screenX, screenY)` 這裡等於多少世界單位（issue #123：拔模式的點擊
   * 半徑是螢幕像素）。相機只有平移＋等比縮放，所以量水平方向一段就夠了；這樣不必另外注入
   * 相機縮放，`screenToWorld` 本身就帶著它。
   */
  private worldRadiusAt(screenX: number, screenY: number, px: number): number {
    const a = this.screenToWorld(screenX, screenY);
    const b = this.screenToWorld(screenX + px, screenY);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** `up`／`cancel` 共用：結束這一筆 Pin 放／拔手勢。 */
  private endPinSession(id: PointerId): void {
    this.pinPlaceSessions.delete(id);
    this.pinRemoveSessions.delete(id);
  }

  /**
   * 撒一輪 Pin（issue #69 的撒點規則；issue #123 起是放模式拖曳中每次 `move` 撒一輪）。
   * Dart throwing：在以 `center` 為圓心、Pin 筆刷半徑為半徑的圓內均勻取候選點（`sqrt(u)`
   * 才是圓內均勻，直接用 `u` 會擠在圓心），跟這一筆已放下的（`session.placed`，含按下那
   * 一顆）+ 既有 Pin（`listPins`）都要 ≥ `spraySpacing`，再用 `hitTest` 濾掉落在果凍外的，
   * 存活的當場送 `pin` 事件。這一筆撒滿 `MAX_SPRAY_PINS_PER_STROKE` 顆就不再撒。
   *
   * 順序刻意是「先比距離、後 `hitTest`」：距離比對只是幾個平方和，`hitTest` 要
   * 真的走一次 picking，先用便宜的條件淘汰掉大多數候選。被 `hitTest` 濾掉的候選
   * **不**進 `placed`——它沒有變成 Pin，不該佔著位置擋住後續候選（果凍邊緣外
   * 的空白區不會在圓內留下一塊莫名其妙的空洞）。
   */
  private sprayAt(center: Point, session: PinPlaceSession): void {
    if (session.sprayed >= MAX_SPRAY_PINS_PER_STROKE) return;
    const radius = Math.max(0, this.pinBrushRadius);
    // 間距 0（或負）會讓「還能塞幾顆」變成無限大，用一個極小正值收斂成「幾乎不限」。
    const spacing = Math.max(this.spraySpacing, 1e-6);
    const existing = (this.listPins?.() ?? []).map((pin) => pin.point);
    const slots = (radius / spacing) ** 2;
    const attempts = Math.min(MAX_SPRAY_ATTEMPTS, Math.ceil(SPRAY_ATTEMPTS_PER_SLOT * slots));

    for (let i = 0; i < attempts && session.sprayed < MAX_SPRAY_PINS_PER_STROKE; i++) {
      const r = radius * Math.sqrt(this.random());
      const theta = 2 * Math.PI * this.random();
      const candidate = { x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) };
      if (isWithin(candidate, session.placed, spacing) || isWithin(candidate, existing, spacing))
        continue;
      if (this.hitTest && !this.hitTest(candidate)) continue; // 落在果凍外——這個候選作廢
      session.placed.push(candidate);
      session.sprayed++;
      this.emit({
        type: 'pin',
        id: `spray:${this.nextSprayPin++}`,
        x: candidate.x,
        y: candidate.y,
      });
    }
  }

  /**
   * 擦一次（issue #70 的橡皮擦；issue #123 起是拔模式拖曳中每次 `move` 擦一次）。掃一遍
   * `listPins()`，凡是落在以 `center` 為圓心、Pin 筆刷半徑為半徑的圓內、且本次手勢還沒
   * 處理過的 Pin，就送一次 `unpin` 並記進 `session.erasedPinIds`。
   *
   * 邊界用 `<=`：半徑滑桿上的數字就是「這一圈裡面的都會被擦掉」，剛好壓在圈上
   * 的那顆算在裡面才符合圓圈視覺提示給人的預期。
   *
   * 刻意分兩段（先挑出 id、再逐一 emit）：呼叫端的 `emit` 通常是同步進
   * `sim.applyInput`，也就是第一顆 `unpin` 送出去的當下，場上的 Pin 清單就已經
   * 變了。邊走邊 emit 的話，如果 `listPins()` 回傳的是內部那份清單本身（而不是
   * 每次都新配的快照），迴圈就會邊跑邊被抽掉元素、漏掉後面幾顆。
   */
  private eraseAt(center: Point, session: PinRemoveSession): void {
    const radius = Math.max(0, this.pinBrushRadius);
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

/**
 * `pins` 裡距離 `point` 最近、且落在 `radius` 內（含邊界）的那一個；沒有就回 `undefined`
 * （拔模式單擊，issue #123；原本在 `routeForPinTool`）。
 */
function nearestPinWithin(
  pins: readonly PinInfo[],
  point: Point,
  radius: number,
): PinInfo | undefined {
  let best: PinInfo | undefined;
  let bestDist = radius;
  for (const pin of pins) {
    const d = Math.hypot(pin.point.x - point.x, pin.point.y - point.y);
    if (d <= bestDist) {
      best = pin;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 數值往上／下走 `steps` 格拉霸 step，夾在範圍內（issue #114 的調半徑；issue #125 推廣）。
 * 結果對齊拉霸的格點（`min + k·step`）並捨到 step 的小數位數：電風扇衰減／頻率的 step 是
 * 0.1，連續相加會累積浮點誤差（0.2 + 0.1 = 0.30000000000000004），游標標籤會顯示出來、
 * 也會跟拉霸自己對齊後的值對不上。
 */
function stepValue(value: number, steps: number, range: ValueRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value + steps * range.step));
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  const rounded = Number(snapped.toFixed(decimalsOf(range.step)));
  return Math.min(range.max, Math.max(range.min, rounded));
}

/** `step` 的小數位數（`0.1` → 1、`10` → 0）。 */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}
