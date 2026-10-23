/**
 * 編隊抓取（抓取工具的編隊模式；issue #68 / V2 T3-4）的 adapter（issue #162 從 `ToolRouter`
 * 搬出）。編隊專屬的查詢與設定（`FormationControls`）由 `router.formation` 直接提供，不經
 * `ToolRouter` 轉發。
 *
 * 兩個子狀態，`beginDefine()`／`endDefine()`（面板「開始設定形狀」／「完成設定」按鈕觸發）
 * 之間是「定義中」——這時的 `down` 只把世界座標 push 進 `definePoints`，不 emit 任何
 * `InputEvent`；第一個點是主點，`endDefine` 把其餘點換算成相對主點的偏移量（`{x:0,y:0}`, ...），
 * 存進 `offsets`，整包覆蓋前一次定義的形狀（「重新設定編隊形狀」＝再呼叫一次 begin/end）。
 * 點數為 0 時 `endDefine` 保留舊形狀不動（沒有東西可覆蓋）。
 *
 * 定義完成後，一般狀態下的 `down` 對每個偏移量算出 `world + offset` 這個候選點，用注入的
 * `hitTest`（跟單點抓取共用同一個「有沒有落在 Jelly 上」判定）過濾，落在外面的那個索引整個
 * 跳過（不 emit、不記錄），其餘落在上面的才用合成 id（`formation:<session>:<index>`）送 `grab`，
 * 記進這次手勢的 `attached` 清單。`move` 對 `attached` 清單裡每個 id 送 `world + offset`
 * （`offset` 是定義時算好的常數，不隨拖曳方向重算，位移天生不會旋轉）；`up`／`cancel` 對
 * `attached` 清單裡每個 id 送 `release`——`cancel` 這裡跟單點抓取的 `cancel` 同一個道理
 * （已經是活著的約束，取消要真的放開，不能悄悄留著）。還沒定義形狀時，編隊模式下的左鍵拖曳
 * 不做任何事（spec #121）。
 *
 * **輕拍**（issue #81 / V2 T3-9）：若這次手勢是快速按放（`ctx.isTap`，與單點抓取同一組門檻），
 * `up` 會在送 `release` 之前先對 `attached` 裡每個點各送一次 `tap`——整組因此是
 * `grab×N → tap×N → release×N`，跟單點抓取的 `grab → tap → release` 同形（#64 US23：編隊抓取
 * 就是同時操作好幾個一般的 Grab；ADR-0011：快速點放與拖曳兩種手勢共存沒有歧義）。`tap` 打在
 * **按下當下**的位置（`startWorld + offset`）。落在果凍外、被跳過的偏移點不在 `attached` 裡，
 * 自然不會被拍。`cancel` 是例外，不送 `tap`：中斷不是完成一次輕拍。
 *
 * **每點大把**（issue #135；GLOSSARY.md「編隊抓取」）：`setParams` 的開關開著時，每個點的
 * `grab` 帶 `handfulRadius`（大把抓取那條半徑，同一個值）、快速按放時每個 `tap` 帶同一個
 * `radius`——其餘（id、落點過濾、順序、`move`／`release`）完全相同，不新增事件種類。開關與半徑
 * 都在按下當下拍進 session。開著時右鍵＋滾輪在編隊模式下調的就是這條半徑（`ToolRouter` 的
 * `MODE_VALUE_KEYS` 條件格，讀 `perPointHandful`）。
 */

import type { Point, PointerId } from '../../sim';
import type { GestureStart } from '../GestureTracker';
import type { ToolAdapter, ToolContext } from './ToolAdapter';

/** `setParams` 接受的部分更新（issue #135）。 */
export interface FormationParams {
  /**
   * 每點大把（GLOSSARY.md「編隊抓取」）：編隊的每個點改成一把大把抓取，半徑共用大把抓取
   * 那條（`handfulRadius`）。預設關閉。
   */
  perPointHandful: boolean;
}

/** 一個作用中的編隊抓取手勢（`FormationOverlay`、範圍圈用）。 */
export interface FormationActiveGroup {
  anchor: Point;
  points: readonly Point[];
  /** 這一抓按下當下的每點大把半徑（issue #135，範圍圈用）；單點編隊為 `null`。 */
  handfulRadius: number | null;
}

/** `router.formation`：編隊專屬的查詢與設定（面板按鈕、`FormationOverlay`、範圍圈、游標標籤）。 */
export interface FormationControls {
  /** 「開始設定形狀」按鈕（issue #68）——之後的 `down` 只記點，不 emit。 */
  beginDefine(): void;
  /**
   * 「完成設定」按鈕（issue #68）——把定義中記下的點換算成偏移量，整包覆蓋形狀。一個點都
   * 沒記到（沒呼叫過 `beginDefine`，或呼叫了但沒有任何 `down`）就直接結束定義，不動舊形狀。
   */
  endDefine(): void;
  /** 目前是否在「定義形狀」中——`FormationOverlay` 用來決定要不要畫定義中的點。 */
  readonly isDefining: boolean;
  /** 定義中已經記下的點（世界座標）——`FormationOverlay` 每幀讀。 */
  readonly definePreview: readonly Point[];
  /** 已定義的編隊形狀（相對主點的偏移量），還沒定義過則 `null`。 */
  readonly shape: readonly Point[] | null;
  /**
   * 「如果現在在 `anchor` 按下去，會抓到哪幾個點」的世界座標（issue #79 / V2 T3-8）——
   * `FormationOverlay` 拿它畫閒置時跟著游標走的形狀預覽。還沒定義過形狀就回空陣列。
   *
   * 刻意**不**用 `hitTest` 過濾掉落在果凍外的點：預覽畫的是「形狀」，命中與否按下去那一刻
   * 才算——先幫使用者把點藏起來，反而看不出整組形狀擺在哪、也沒辦法瞄準。
   */
  previewAt(anchor: Point): readonly Point[];
  /**
   * 目前作用中的編隊抓取手勢——`FormationOverlay` 每幀讀，畫出各點目前的世界座標 + 連回主點
   * 的線。只列 `attached`（真的落在 Jelly 上、已經送出 `grab` 的點）——`down` 時被 `hitTest`
   * 跳過的偏移點沒有對應的約束，提示不該把它畫成「也被抓住了」。
   */
  readonly activeGroups: readonly FormationActiveGroup[];
  /** 面板「每個點用大把抓」開關的即時寫入口（issue #135）——只影響**下一次**按下。 */
  setParams(params: Partial<FormationParams>): void;
  /** 每點大把開關目前的狀態（issue #135）——範圍圈與游標標籤用。 */
  readonly perPointHandful: boolean;
}

/**
 * 進行中的一次編隊抓取手勢：`attached` 是這次手勢裡真的落在 Jelly 上、已經送出 `grab` 的
 * 偏移量 + 對應合成 id（落在外面的索引完全不進這個清單，`move`/`up`/`cancel` 因此天然只作用於
 * 真的抓到的那幾點）。
 */
interface FormationSession extends GestureStart {
  /**
   * 指標**目前**的世界座標（`move` 每次整顆重新指派）。跟 `startWorld` 分得很清楚：拖曳讀
   * 這個，輕拍讀那個（issue #81）——`down` 當下兩者的值相同，但存的是各自的物件。
   */
  lastWorld: Point;
  attached: readonly { offset: Point; id: string }[];
  /**
   * 每點大把（issue #135）：按下當下開著就記下當時的大把抓取半徑，每個點的 `grab` 與可能的
   * `tap` 都帶它；關著為 `null`（單點編隊）。之後切開關、改半徑都不影響這一抓。
   */
  handfulRadius: number | null;
}

export class FormationAdapter implements ToolAdapter, FormationControls {
  /** 「定義形狀」進行中時的暫存點（世界座標，第一個是主點）——非 `null` 代表正在定義中。 */
  private definePoints: Point[] | null = null;
  /** 已定義好的編隊形狀：相對主點的偏移量，索引 0 固定是 `{x:0,y:0}`。 */
  private offsets: Point[] | null = null;
  /** 進行中的編隊抓取手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, FormationSession>();
  private nextSession = 1;
  /** 每點大把開關（issue #135）——面板開關即時寫入，按下當下拍進 session。 */
  private perPointHandfulOn = false;

  constructor(private readonly ctx: ToolContext) {}

  beginDefine(): void {
    this.definePoints = [];
  }

  endDefine(): void {
    const points = this.definePoints;
    this.definePoints = null;
    if (!points) return;
    const primary = points[0];
    if (!primary) return;
    this.offsets = points.map((p) => ({ x: p.x - primary.x, y: p.y - primary.y }));
  }

  get isDefining(): boolean {
    return this.definePoints !== null;
  }

  get definePreview(): readonly Point[] {
    return this.definePoints ?? [];
  }

  get shape(): readonly Point[] | null {
    return this.offsets;
  }

  previewAt(anchor: Point): readonly Point[] {
    const offsets = this.offsets;
    if (!offsets) return [];
    return offsets.map((o) => ({ x: anchor.x + o.x, y: anchor.y + o.y }));
  }

  get activeGroups(): readonly FormationActiveGroup[] {
    return [...this.sessions.values()].map((s) => ({
      anchor: s.lastWorld,
      points: s.attached.map(({ offset }) => ({
        x: s.lastWorld.x + offset.x,
        y: s.lastWorld.y + offset.y,
      })),
      handfulRadius: s.handfulRadius,
    }));
  }

  setParams(params: Partial<FormationParams>): void {
    if (params.perPointHandful !== undefined) this.perPointHandfulOn = params.perPointHandful;
  }

  get perPointHandful(): boolean {
    return this.perPointHandfulOn;
  }

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const { ctx } = this;
    const start = ctx.gestureStart(screenX, screenY, timeMs);
    const world = start.startWorld;
    if (this.definePoints) {
      this.definePoints.push(world);
      return;
    }
    // 還沒定義形狀：編隊模式下的左鍵拖曳不做任何事（spec #121）。
    if (!this.offsets || this.offsets.length === 0) return;
    const session = this.nextSession++;
    // 每點大把（issue #135）：開關與半徑在按下當下定下；每個點的 `grab` 帶同一個
    // `handfulRadius`（沿用大把抓取的欄位，不新增事件種類），各自只抓落點那塊 Jelly。
    const handfulRadius = this.perPointHandfulOn ? ctx.params.get('handfulRadius') : null;
    const attached: { offset: Point; id: string }[] = [];
    this.offsets.forEach((offset, index) => {
      const point = { x: world.x + offset.x, y: world.y + offset.y };
      if (!ctx.hitTest(point)) return; // 落在果凍外——跳過這一點，其餘照常
      const formationId = `formation:${session}:${index}`;
      attached.push({ offset, id: formationId });
      ctx.emit(
        handfulRadius === null
          ? { type: 'grab', id: formationId, x: point.x, y: point.y }
          : { type: 'grab', id: formationId, x: point.x, y: point.y, handfulRadius },
      );
    });
    if (attached.length > 0) {
      this.sessions.set(id, {
        ...start,
        lastWorld: { x: world.x, y: world.y },
        attached,
        handfulRadius,
      });
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    if (this.definePoints) return; // 定義中：只有 down 記點，move 不理會
    const session = this.sessions.get(id);
    if (!session) return;
    const world = this.ctx.project(screenX, screenY);
    session.lastWorld = world;
    for (const { offset, id: formationId } of session.attached) {
      this.ctx.emit({
        type: 'moveGrab',
        id: formationId,
        x: world.x + offset.x,
        y: world.y + offset.y,
      });
    }
  }

  up(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    if (this.definePoints) return; // 定義中：down 才算數
    const session = this.sessions.get(id);
    if (session && this.ctx.isTap(session, screenX, screenY, timeMs)) {
      const radius = session.handfulRadius;
      for (const { offset } of session.attached) {
        const x = session.startWorld.x + offset.x;
        const y = session.startWorld.y + offset.y;
        // 每點大把（issue #135）：每個點各打一次範圍 Tap，半徑＝按下當下那把的半徑。
        this.ctx.emit(radius === null ? { type: 'tap', x, y } : { type: 'tap', x, y, radius });
      }
    }
    this.release(id);
  }

  cancel(id: PointerId): void {
    // 已經是活著的約束（`down` 就 emit 過 grab）：真的要放開，不送 tap（見檔頭說明）。
    this.release(id);
  }

  /** `up`／`cancel` 共用：對這次手勢裡每個已附著的點送 `release`，清掉 session。 */
  private release(id: PointerId): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    for (const { id: formationId } of session.attached) {
      this.ctx.emit({ type: 'release', id: formationId });
    }
  }
}
