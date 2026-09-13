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

import { isPointInFanRect, type FanState, type PointerId, type Point } from '../sim';
import { GestureTracker, type GestureTrackerOptions } from './GestureTracker';

/**
 * `'fan'`（issue #66）、`'formation'`（issue #68）加進 ADR-0011 選擇器；
 * `'general'` 維持既有 Grab/Pin/Tap 手勢。
 */
export type ToolId = 'general' | 'fan' | 'formation';

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

export interface ToolRouterOptions extends GestureTrackerOptions {
  /**
   * 場上目前的電風扇幾何（issue #67 追加）——`down` 落在既有風扇矩形內時，
   * 用它判斷該把這次手勢當「拖曳既有風扇」而非「放置新風扇」。不帶這個選項
   * （或回傳 `null`）等同「場上永遠沒有風扇」，一律走放置新風扇的既有行為
   * ——現有呼叫端／測試不用跟著改。
   */
  getFan?: () => FanState | null;
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
interface FormationSession {
  lastWorld: Point;
  attached: readonly { offset: Point; id: string }[];
}

export class ToolRouter {
  private readonly gestureTracker: GestureTracker;
  private readonly screenToWorld: (x: number, y: number) => Point;
  private readonly emit: ToolRouterOptions['emit'];
  private readonly hitTest: ((world: Point) => boolean) | undefined;
  private readonly getFan: (() => FanState | null) | undefined;
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

  constructor(opts: ToolRouterOptions) {
    this.gestureTracker = new GestureTracker(opts);
    this.screenToWorld = opts.screenToWorld;
    this.emit = opts.emit;
    this.hitTest = opts.hitTest;
    this.getFan = opts.getFan;
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

  get currentTool(): ToolId {
    return this.activeTool;
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.activeTool === 'general') {
      this.gestureTracker.down(id, screenX, screenY, timeMs);
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
      if (attached.length > 0) this.formationSessions.set(id, { lastWorld: world, attached });
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
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
    }
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
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
      this.releaseFormationSession(id);
    }
  }

  cancel(id: PointerId): void {
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
