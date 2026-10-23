/**
 * Pin 工具的放模式（issue #123 / V4 T2；spec #121「Pin 工具」）的 adapter（issue #162 從
 * `ToolRouter` 搬出）。
 *
 * `down` 落在 Jelly 上（`hitTest`）就在按下點放一顆（id = 指標 id）——**不再**因為點在既有 Pin
 * 附近改成拔。按在 Jelly 外仍開 session：從果凍外拖進來一樣能撒。拖曳超過 Tap 的位移門檻後
 * （`ctx.passedDragThreshold`），每次 `move` 以指標為圓心、`pinBrushRadius` 為半徑撒一輪（撒 Pin，
 * 見 `sprayAt`）。直接送 `pin`（不新增 `InputEvent` 種類），不送 `tap`——快速按放不觸發 Tap。
 *
 * 撒 Pin 用經典的 dart throwing：用注入的 `random`（預設 `Math.random`——**執行期**隨機，每次撒的
 * 分佈都不一樣）在圓內反覆生成候選點，跟「這一筆已放下的 Pin（含按下那一顆）」以及「注入的
 * `listPins` 回傳的既有 Pin」都要 ≥ `spraySpacing` 才接受，再用 `hitTest` 濾掉落在果凍外的，存活的
 * 才用合成 id（`spray:<counter>`，跨多筆遞增、不重複）送 `pin`。這一筆自己記住放過的點，而不是
 * 只靠 `listPins`：真實路徑上 `emit` 同步進 `sim.applyInput`、清單會跟著變，但那是呼叫端的接線
 * 方式，不是這個類別能自己看到的事。每一筆撒出的數量有上限（`MAX_SPRAY_PINS_PER_STROKE`），每一輪
 * 的嘗試次數也有上限，求解器與這個迴圈都不會被壓垮。
 *
 * 重播的決定性：`pin` 事件本身帶著算好的絕對 `x`/`y`，`TrackRecorder` 錄的是那些具體座標，重播時
 * 原樣送回去，不會重算隨機分佈——所以這裡刻意不需要有種子的 PRNG。
 *
 * `up` 跟 `cancel` 是同一件事——結束這一筆、丟掉 session。刻意**不**在放開當下再補撒一次：放開前
 * 瀏覽器一定送過同座標的 `move`，補的那一次只會在 Track 上多錄幾筆，還會讓 `up` 與 `cancel` 無謂地
 * 不對稱。已經放下的 Pin 是既成事實，取消不會把它們變回來。
 *
 * 筆刷半徑與撒 Pin 間距都住在 `ToolParams`（issue #160），每一輪撒讀目前值；右鍵＋滾輪調筆刷半徑由
 * `ToolRouter` 的滾輪退路處理。
 */

import type { Point, PointerId } from '../../sim';
import type { DragSession, ToolAdapter, ToolContext } from './ToolAdapter';

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
 * 進行中的一次放模式手勢：按下當下的定格 + `dragged`（拖過門檻後每次 `move` 都撒一輪），
 * `placed` 是這一筆已經放下的 Pin 座標（含按下那一顆，撒 Pin 的間距要跟它們比），`sprayed` 是
 * 這一筆撒出的數量（上限 `MAX_SPRAY_PINS_PER_STROKE`）。
 */
interface PinPlaceSession extends DragSession {
  placed: Point[];
  sprayed: number;
}

export class PinPlaceAdapter implements ToolAdapter {
  /** 進行中的放模式手勢，鍵為指標 `id`（`up`/`cancel` 後移除）。 */
  private readonly sessions = new Map<PointerId, PinPlaceSession>();
  /** 撒出的 Pin 合成 id 流水號（`spray:<n>`）——跨多筆遞增，各顆身分互不相干。 */
  private nextSprayPin = 1;

  constructor(private readonly ctx: ToolContext) {}

  down(id: PointerId, screenX: number, screenY: number, timeMs: number): void {
    const { ctx } = this;
    const session: PinPlaceSession = {
      ...ctx.gestureStart(screenX, screenY, timeMs),
      dragged: false,
      placed: [],
      sprayed: 0,
    };
    const world = session.startWorld;
    this.sessions.set(id, session);
    if (ctx.hitTest(world)) {
      session.placed.push(world);
      ctx.emit({ type: 'pin', id, x: world.x, y: world.y });
    }
  }

  move(id: PointerId, screenX: number, screenY: number): void {
    const session = this.sessions.get(id);
    if (!session || !this.ctx.passedDragThreshold(session, screenX, screenY)) return;
    this.sprayAt(this.ctx.project(screenX, screenY), session);
  }

  up(id: PointerId): void {
    this.sessions.delete(id);
  }

  cancel(id: PointerId): void {
    this.sessions.delete(id);
  }

  /**
   * 撒一輪 Pin（issue #69 的撒點規則）。Dart throwing：在以 `center` 為圓心、Pin 筆刷半徑為半徑
   * 的圓內均勻取候選點（`sqrt(u)` 才是圓內均勻，直接用 `u` 會擠在圓心），跟 `session.placed` +
   * 既有 Pin 都要 ≥ `spraySpacing`，再用 `hitTest` 濾掉落在果凍外的，存活的當場送 `pin` 事件。
   *
   * 順序刻意是「先比距離、後 `hitTest`」：距離比對只是幾個平方和，`hitTest` 要真的走一次
   * picking，先用便宜的條件淘汰掉大多數候選。被 `hitTest` 濾掉的候選**不**進 `placed`——它沒有
   * 變成 Pin，不該佔著位置擋住後續候選。
   */
  private sprayAt(center: Point, session: PinPlaceSession): void {
    if (session.sprayed >= MAX_SPRAY_PINS_PER_STROKE) return;
    const { ctx } = this;
    const radius = Math.max(0, ctx.params.get('pinBrushRadius'));
    // 間距 0（或負）會讓「還能塞幾顆」變成無限大，用一個極小正值收斂成「幾乎不限」。
    const spacing = Math.max(ctx.params.get('spraySpacing'), 1e-6);
    const existing = ctx.listPins().map((pin) => pin.point);
    const slots = (radius / spacing) ** 2;
    const attempts = Math.min(MAX_SPRAY_ATTEMPTS, Math.ceil(SPRAY_ATTEMPTS_PER_SLOT * slots));

    for (let i = 0; i < attempts && session.sprayed < MAX_SPRAY_PINS_PER_STROKE; i++) {
      const r = radius * Math.sqrt(ctx.random());
      const theta = 2 * Math.PI * ctx.random();
      const candidate = { x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) };
      if (isWithin(candidate, session.placed, spacing) || isWithin(candidate, existing, spacing))
        continue;
      if (!ctx.hitTest(candidate)) continue; // 落在果凍外——這個候選作廢
      session.placed.push(candidate);
      session.sprayed++;
      ctx.emit({ type: 'pin', id: `spray:${this.nextSprayPin++}`, x: candidate.x, y: candidate.y });
    }
  }
}

/** `point` 是否距離 `others` 裡任何一點不到 `minDistance`（撒 Pin 的間距判定）。 */
function isWithin(point: Point, others: readonly Point[], minDistance: number): boolean {
  return others.some((o) => Math.hypot(o.x - point.x, o.y - point.y) < minDistance);
}
