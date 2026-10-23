/**
 * `ToolRouter`（issue #65 / V2 T3-1）——沙盒工具切換的地基，取代 `PointerInput`
 * 原本直接持有的 `GestureTracker`。
 *
 * **工具與模式**（issue #122 / V4 T1；ADR-0016，取代 ADR-0011／0015 的選擇器設計）：
 * 一般操作、大把抓取、編隊抓取合成「抓取」工具（`'grab'`），三者變成它的模式（單點／
 * 大把／編隊，`TOOL_MODES`）。每個工具各自記住自己的模式（`modes`），中鍵單擊
 * （`cycleMode`）或參數卡的模式鈕（`setMode`）切換。「工具＋模式」推出內部的手勢分支
 * （`Behavior`），而且是**按下當下**定下、記在 `pointerBehaviors`，`move`／`up`／`cancel`
 * 照它分派，拖曳中切工具或切模式都只影響下一次按下。
 *
 * **adapter**（issue #161 / #162；spec #158「ToolRouter」）：八個 Behavior 各是一個 adapter
 * （interface 與共用 context 見 `tools/ToolAdapter.ts`——拖曳門檻、輕拍判定與 session 起始
 * 資料只在 context 裡一份），自帶 session、右鍵、滾輪，各自的手勢說明在該檔檔頭：單點
 * （`singleAdapter`，包既有 `GestureTracker`）、大把（`handfulAdapter`）、編隊
 * （`formationAdapter`，專屬查詢由 `router.formation` 直接提供）、Pin 放（`pinPlaceAdapter`）、
 * Pin 拔（`pinRemoveAdapter`）、電風扇（`fanAdapter`）、Jelly（`jellyAdapter`）、背景圖
 * （`backdropAdapter`）。本體只留：目前工具與各工具模式、按下時選 adapter 並記住這次手勢的
 * Behavior、滾輪退路（`wheel`）。
 */

import type { FanState, PinInfo, PointerId, Point } from '../sim';
import { resolveGestureConfig, type GestureTrackerOptions } from './GestureTracker';
import { ToolParams, type ModeValueKey } from './ToolParams';
import { createToolContext, type ToolAdapter, type ToolContext } from './tools/ToolAdapter';
import { BackdropAdapter, type BackdropCommand } from './tools/backdropAdapter';
import { FanAdapter } from './tools/fanAdapter';
import { FormationAdapter, type FormationControls } from './tools/formationAdapter';
import { HandfulAdapter } from './tools/handfulAdapter';
import { JellyAdapter } from './tools/jellyAdapter';
import { PinPlaceAdapter } from './tools/pinPlaceAdapter';
import { PinRemoveAdapter } from './tools/pinRemoveAdapter';
import { SingleAdapter } from './tools/singleAdapter';

export type { BackdropCommand } from './tools/backdropAdapter';
export type {
  FormationActiveGroup,
  FormationControls,
  FormationParams,
} from './tools/formationAdapter';
export { MAX_SPRAY_PINS_PER_STROKE } from './tools/pinPlaceAdapter';
export { PIN_REMOVE_RADIUS_PX } from './tools/pinRemoveAdapter';

/**
 * 工具列上的工具（issue #122 / V4 T1；ADR-0016）。一般操作、大把抓取、編隊抓取合成
 * `'grab'`（三者變成它的模式，見 `TOOL_MODES`）；Pin、撒 Pin、移除 Pin 合成 `'pin'`
 * （issue #123，模式為放／拔）；生成、移除、重建 Jelly 合成 `'jelly'`（issue #124，沒有
 * 模式，移除與重建走右鍵選單）。工具與模式都不存檔、也不是 Track 事件，改名不影響舊片段檔。
 */
export type ToolId = 'grab' | 'pin' | 'fan' | 'jelly' | 'backdrop';

/** 工具列的順序（issue #122；issue #149 加上背景圖）——面板照這個順序排按鈕。 */
export const TOOL_IDS: readonly ToolId[] = ['grab', 'pin', 'fan', 'jelly', 'backdrop'];

/**
 * 有模式的工具與它們的模式，依中鍵單擊輪替的順序排（issue #122；GLOSSARY.md「模式」）。
 * 第一個是預設模式。電風扇的模式是「右鍵＋滾輪要調的參數」（issue #125）。
 */
export const TOOL_MODES = {
  grab: ['single', 'handful', 'formation'],
  pin: ['place', 'remove'],
  fan: ['width', 'strength', 'falloff', 'frequency'],
  backdrop: ['scale', 'opacity'],
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
/**
 * 背景圖工具的模式（issue #150）：右鍵＋滾輪調選中（或游標下）那張 Backdrop 的縮放或透明度。
 * 左鍵不受影響。數值住在 `BackdropBoard`，不是 `ToolParams` 的數值（滾輪由背景圖 adapter 自己處理，見 `wheel`）。
 */
export type BackdropMode = ToolModeOf<'backdrop'>;

export function isModalTool(tool: ToolId): tool is ModalToolId {
  return tool in TOOL_MODES;
}

/** 這個工具的模式清單（輪替順序）；沒有模式的工具回空陣列。 */
export function modesOf(tool: ToolId): readonly ToolMode[] {
  return isModalTool(tool) ? TOOL_MODES[tool] : [];
}

/**
 * 按下當下定下的手勢分支（issue #122）——「工具＋模式」推出來的：抓取工具的三個模式各自
 * 是單點／大把／編隊，Pin 工具的兩個模式是 `pinPlace`／`pinRemove`（issue #123），其餘工具
 * 就是它自己——電風扇與背景圖有模式，但模式只決定右鍵＋滾輪調什麼，左鍵手勢不變。每個
 * Behavior 對應一個 adapter（issue #161 / #162）。
 */
type Behavior =
  'single' | 'handful' | 'formation' | 'pinPlace' | 'pinRemove' | Exclude<ToolId, 'grab' | 'pin'>;

export const DEFAULT_TOOL: ToolId = 'grab';

/**
 * 模式以外、會決定「右鍵＋滾輪有沒有數值可調」的開關（issue #135）：編隊模式的每點大把。
 * 讀值見 `ToolRouter.valueConditions`。
 */
type ModeValueCondition = 'perPointHandful';

/**
 * `MODE_VALUE_KEYS` 的一格：直接是數值，或「某個開關開著才有這個數值」（關著＝沒有數值，
 * 右鍵＋滾輪照舊縮放）。
 */
type ModeValueEntry =
  ModeValueKey | { readonly key: ModeValueKey; readonly when: ModeValueCondition };

/**
 * 每個「工具＋模式」用右鍵＋滾輪調哪個數值（issue #125 從 if 串接改成表）；沒列到的模式
 * （單點）沒有數值可調，右鍵＋滾輪照舊縮放。編隊模式只在每點大把開著時調大把抓取半徑
 * （issue #135：跟大把模式共用同一條）。
 */
const MODE_VALUE_KEYS: {
  readonly [T in ModalToolId]: Readonly<Partial<Record<ToolModeOf<T>, ModeValueEntry>>>;
} = {
  grab: {
    handful: 'handfulRadius',
    formation: { key: 'handfulRadius', when: 'perPointHandful' },
  },
  pin: { place: 'pinBrushRadius', remove: 'pinBrushRadius' },
  fan: {
    width: 'fanWidth',
    strength: 'fanStrength',
    falloff: 'fanFalloffExponent',
    frequency: 'fanFrequency',
  },
  // 背景圖工具調的是某一張 Backdrop 的值，不是工具參數——滾輪由背景圖 adapter 自己處理（見 `wheel`）。
  backdrop: {},
};

/** 目前模式的數值（issue #122）：哪一個、現在多少。 */
export interface ModeValue {
  key: ModeValueKey;
  value: number;
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
  /**
   * 背景圖工具的點選判定（issue #149）：這個世界座標上最上層、顯示中的 Backdrop id，沒有回
   * `null`。不帶這個選項等同「場上沒有 Backdrop」。
   */
  backdropHitTest?: (world: Point) => string | null;
  /** 背景圖工具的指令出口（issue #149）——獨立於 `emit`，不會進求解器也不會被錄進 Track。 */
  onBackdropCommand?: (cmd: BackdropCommand) => void;
  /**
   * 背景圖工具的游標標籤數值（issue #161）：右鍵＋滾輪此刻會調的那張 Backdrop（選中的，沒有
   * 就 `at` 游標下的）的 `property` 值顯示文字，沒有目標回 `null`。見 `cursorValue`。
   */
  backdropCursorValue?: (property: BackdropMode, at: Point | null) => string | null;
  /**
   * 工具參數（issue #160）：電風扇四個參數、Pin 筆刷半徑、撒 Pin 間距、大把抓取半徑的唯一
   * 擁有者，`ToolRouter` 只在按下（與每一輪撒／擦）時讀值、右鍵＋滾輪時 `step`。沙盒建立它
   * 傳進來；不帶就自己建一份預設值的。
   */
  params?: ToolParams;
}

export class ToolRouter {
  /** 共用 context（issue #161）——建構時組好、交給每個 adapter。 */
  private readonly ctx: ToolContext;
  private readonly single: SingleAdapter;
  private readonly formationAdapter: FormationAdapter;
  /** 每個 Behavior 的 adapter（issue #161 / #162）。 */
  private readonly adapters: Readonly<Record<Behavior, ToolAdapter>>;
  private activeTool: ToolId = DEFAULT_TOOL;
  /**
   * 每個有模式的工具各自目前的模式（issue #122）——整個 session 內記住、不存檔；切去
   * 別的工具再切回來模式不變。初值＝各工具清單裡的第一個。
   */
  private readonly modes: { [T in ModalToolId]: ToolModeOf<T> } = {
    grab: TOOL_MODES.grab[0],
    pin: TOOL_MODES.pin[0],
    fan: TOOL_MODES.fan[0],
    backdrop: TOOL_MODES.backdrop[0],
  };
  /**
   * 每個進行中的指標在**按下當下**定下的手勢分支（issue #122）——`move`／`up`／`cancel`
   * 一律照這個分派，拖曳中切工具或切模式只影響下一次按下。`up`／`cancel` 時移除。
   */
  private readonly pointerBehaviors = new Map<PointerId, Behavior>();
  /** 工具參數（issue #160）——見 `ToolRouterOptions.params`。 */
  readonly params: ToolParams;

  constructor(opts: ToolRouterOptions) {
    this.params = opts.params ?? new ToolParams();
    // 手勢門檻（issue #81）：輕拍判定與拖曳門檻在所有 adapter 與 `GestureTracker` 間是同一組
    // ——同一支 `resolveGestureConfig`、同一套預設值，不是第二套設定。
    this.ctx = createToolContext({
      project: opts.screenToWorld,
      emit: opts.emit,
      hitTest: opts.hitTest,
      params: this.params,
      random: opts.random,
      listPins: opts.listPins,
      getFan: opts.getFan,
      config: resolveGestureConfig(opts.config),
    });
    this.single = new SingleAdapter(opts);
    this.formationAdapter = new FormationAdapter(this.ctx);
    this.adapters = {
      single: this.single,
      handful: new HandfulAdapter(this.ctx),
      formation: this.formationAdapter,
      pinPlace: new PinPlaceAdapter(this.ctx),
      pinRemove: new PinRemoveAdapter(this.ctx),
      fan: new FanAdapter(this.ctx),
      jelly: new JellyAdapter(this.ctx, {
        onClick: opts.onJellyClick,
        onContextMenu: opts.onJellyContextMenu,
      }),
      backdrop: new BackdropAdapter(this.ctx, {
        hitTest: opts.backdropHitTest,
        onCommand: opts.onBackdropCommand,
        cursorValue: opts.backdropCursorValue,
        mode: () => this.modes.backdrop,
      }),
    };
  }

  /**
   * 編隊抓取專屬的查詢與設定（issue #162；spec #158 US27）：開始／結束定義形狀、形狀、預覽、
   * 作用中群組、每點大把——直接是編隊 adapter 自己的 interface，`ToolRouter` 不再轉發。
   */
  get formation(): FormationControls {
    return this.formationAdapter;
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
   * 回報新模式讓呼叫端同步參數卡與游標標籤。目前工具沒有模式、或模式被鎖住（定義編隊
   * 形狀途中，見 `writeMode`）就回 `null`、什麼都不做。
   */
  cycleMode(): ToolMode | null {
    const tool = this.activeTool;
    if (!isModalTool(tool)) return null;
    const list: readonly ToolMode[] = TOOL_MODES[tool];
    const next = list[(list.indexOf(this.modes[tool]) + 1) % list.length]!;
    return this.writeMode(tool, next) ? next : null;
  }

  /**
   * `modes` 的唯一寫入口；回報有沒有真的寫進去。呼叫端（`setMode` 的型別參數、`cycleMode`
   * 從該工具自己的清單取值）已保證模式屬於這個工具；TS 對「以聯集鍵寫入對應型別」無法
   * 收窄，所以在這裡放寬。
   *
   * 定義編隊形狀途中（issue #135 順帶修 #122 的邊角）抓取工具鎖在編隊模式：不然中鍵或
   * 模式鈕一切走，定義點的預覽跟著消失、左鍵改走抓取，面板按鈕卻還停在「完成設定」。
   * 要換模式就先按「完成設定」。
   */
  private writeMode(tool: ModalToolId, mode: ToolMode): boolean {
    if (tool === 'grab' && this.formationAdapter.isDefining && mode !== 'formation') {
      return false;
    }
    (this.modes as Record<ModalToolId, ToolMode>)[tool] = mode;
    return true;
  }

  /** 這一次按下要走的分支：抓取、Pin 工具看模式，其餘工具就是自己。 */
  private currentBehavior(): Behavior {
    const tool = this.activeTool;
    if (tool === 'grab') return this.modes.grab;
    if (tool === 'pin') return this.modes.pin === 'place' ? 'pinPlace' : 'pinRemove';
    return tool;
  }

  /** `MODE_VALUE_KEYS` 裡條件格的開關讀值（issue #135）。 */
  private readonly valueConditions: { readonly [C in ModeValueCondition]: () => boolean } = {
    perPointHandful: () => this.formationAdapter.perPointHandful,
  };

  /**
   * 目前工具＋模式用右鍵＋滾輪調的是哪一個工具參數（issue #122；issue #125 改查表；issue #135
   * 加上條件格；issue #160 公開）；沒有數值回 `null`。值本身住在 `ToolParams`。
   */
  get activeValueKey(): ModeValueKey | null {
    const tool = this.activeTool;
    if (!isModalTool(tool)) return null;
    const keys: Partial<Record<ToolMode, ModeValueEntry>> = MODE_VALUE_KEYS[tool];
    const entry = keys[this.modes[tool]];
    if (entry === undefined) return null;
    if (typeof entry === 'string') return entry;
    return this.valueConditions[entry.when]() ? entry.key : null;
  }

  /** 目前模式的數值與它現在的值（游標標籤用）；沒有數值回 `null`。 */
  get activeValue(): ModeValue | null {
    const key = this.activeValueKey;
    return key === null ? null : { key, value: this.params.get(key) };
  }

  /**
   * 「右鍵＋滾輪」調整目前模式的數值（issue #114 的調半徑，issue #122 推廣）：`steps` 格
   * （正 = 放大），每格一個拉霸 step，夾在該拉霸範圍內，回報新值讓呼叫端同步面板與
   * 圓圈。沒有數值的模式回 `null`（「不處理」——呼叫端照舊縮放相機）。跟拉霸一樣只影響
   * **下一次**按下：進行中的大把抓取 session 已經在按下時記下自己的半徑。寫進的是
   * `ToolParams`（issue #160）——同步拉霸、即時更新場上風扇由訂閱它變更通知的呼叫端負責。
   */
  adjustActiveValue(steps: number): ModeValue | null {
    const key = this.activeValueKey;
    if (key === null) return null;
    return { key, value: this.params.step(key, steps) };
  }

  /** 目前工具＋模式對應的 adapter（右鍵、滾輪、指標歸屬、游標標籤問的就是它）。 */
  private get currentAdapter(): ToolAdapter {
    return this.adapters[this.currentBehavior()];
  }

  /**
   * 按住右鍵＋滾輪 `steps` 格（issue #161：滾輪退路收進 `ToolRouter`；`CameraInput` 呼叫，
   * 帶滾輪當下的畫布座標）：目前的 adapter 自己處理（背景圖調場上那張的縮放／透明度，
   * issue #150）→ 否則依 `activeValueKey` 增減 `ToolParams`（`adjustActiveValue`）→ 都沒有
   * 回 `false`，呼叫端交還相機縮放。
   */
  wheel(steps: number, screenX: number, screenY: number): boolean {
    if (this.currentAdapter.wheel?.(steps, screenX, screenY)) return true;
    return this.adjustActiveValue(steps) !== null;
  }

  /**
   * 這個世界座標上的按下歸不歸目前工具（issue #161）——`CameraInput` 的 hitTest 除了「有沒有
   * 落在 Jelly 上」，也問這裡：歸工具的（例如背景圖工具下按在 Backdrop 上）觸控拖曳不平移相機。
   */
  ownsPointerAt(world: Point): boolean {
    return this.currentAdapter.ownsPointerAt?.(world) ?? false;
  }

  /**
   * 游標標籤上的數值（issue #161）：`screen` 是游標的畫布局部座標（不在畫布上為 `null`）。
   * 目前的 adapter 有自己的數值就問它（背景圖：右鍵＋滾輪會調的那張的縮放或透明度），否則是
   * 目前模式的工具參數值（`activeValue`）；沒有數值回 `null`。
   */
  cursorValue(screen: Point | null): number | string | null {
    const adapter = this.currentAdapter;
    if (adapter.cursorValue) {
      return adapter.cursorValue(screen ? this.ctx.project(screen.x, screen.y) : null);
    }
    return this.activeValue?.value ?? null;
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    // 按下當下就定下這次手勢的分支（issue #122），之後切工具／切模式都不影響它。
    const behavior = this.currentBehavior();
    this.pointerBehaviors.set(id, behavior);
    this.adapters[behavior].down(id, screenX, screenY, timeMs);
  }

  // `move`／`up`／`cancel` 一律照 `down` 當下定下的分支（`pointerBehaviors`）分派，不看
  // 現在選的工具與模式（issue #122）：按住途中切走工具或按中鍵切模式，這次手勢仍屬於
  // 按下時那個分支、照常跟隨與放開（issue #97 的點一下、#113 的大把抓取原本就是這條規則，
  // 現在所有分支一體適用）。
  move(id: PointerId, screenX: number, screenY: number): void {
    const behavior = this.pointerBehaviors.get(id);
    if (behavior !== undefined) this.adapters[behavior].move(id, screenX, screenY);
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const behavior = this.pointerBehaviors.get(id);
    if (behavior === undefined) return;
    this.pointerBehaviors.delete(id);
    this.adapters[behavior].up(id, screenX, screenY, timeMs);
  }

  /**
   * 畫布上的右鍵單擊（issue #124；判定在 `CameraInput`：按下到放開沒拖曳、也沒滾過滾輪），
   * 帶放開位置的世界座標與畫布局部座標，交給**目前**工具的 adapter（右鍵單擊是一瞬間的事，
   * 沒有「按下當下定下分支」的問題）：Jelly 點中某塊開選單、電風扇點在風扇上＝移除、背景圖
   * 點中某張開選單（各自見 adapter 檔頭）；其他工具忽略。
   */
  rightClick(world: Point, screenX: number, screenY: number): void {
    this.currentAdapter.rightClick?.(world, screenX, screenY);
  }

  cancel(id: PointerId): void {
    const behavior = this.pointerBehaviors.get(id);
    if (behavior === undefined) return;
    this.pointerBehaviors.delete(id);
    this.adapters[behavior].cancel(id);
  }

  /** 目前追蹤中的指標數（= 作用中的 Grab 數，單點模式限定）——比照 `GestureTracker.activeCount`。 */
  get activeCount(): number {
    return this.single.activeCount;
  }
}
