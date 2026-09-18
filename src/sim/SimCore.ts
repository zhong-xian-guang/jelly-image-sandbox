/**
 * 模擬核心（GitHub issue #5 起）——推進柔體的求解器。
 *
 * 建構時吃 `SimMesh` + 參數；對外只有 `applyInput(event)`、`step(dt)` 與讀出
 * （`positions`、`centroid()`、`bbox()`、`stretchStats()`、`kineticEnergy()`）。
 * 無 DOM、與算繪無關、決定性（不碰 `Math.random` 或 wall-clock，見 ADR-0005）。
 * 固定時間步：accumulator 累積與 clamp 由呼叫端負責，`step(dt)` 只把 `dt` 切成
 * `substeps` 個 substep 往前推。**風扇陣風的觸發時機是唯一的例外**——它需要
 * 隨機性，但走的是 `mulberry32`（issue #67 事後檢視追加）這個有種子的決定性
 * PRNG，不是 `Math.random`：`this.rng` 在建構子與 `reset()` 都重新以固定種子
 * `rngSeed` 播種，同一段 `applyInput`／`step` 呼叫序列（含 Track 重播）永遠
 * 得到同一串陣風時機，不破壞決定性（見 `applyFan`）。
 *
 * `tap` 是一次性向內脈衝（不進 substep 迴圈，直接改速度）。每個 substep（藍本：
 * `prototypes/shape-matching-feel.prototype.html` 的 `<script id="jelly-core">`）：
 *   1. 電風扇（`this.fan`，issue #66；ADR-0010，沒有時 no-op；issue #67 事後
 *      檢視改成陣風）：以 `fan.frequency` 決定的機率擲骰，沒抽中就整段無風；
 *      抽中的話矩形涵蓋範圍內的 Particle 沿吹風方向一起吃一次瞬間速度衝量
 *      （比照 Tap 的一次性慣例，不是逐 substep 累加加速度），隨縱向距離衰減、
 *      矩形外無感（見 `applyFan`）。**必須排在預測之前**——`vel` 在步驟 7 會
 *      整個依位置差重算，排在預測之後改的話，這股力那個 substep 不會移動任何
 *      位置，馬上就被蓋掉。
 *      重力（`params.gravity`，issue #91；ADR-0012，`0` 時 no-op）也在這一步：
 *      對所有 Particle 做 `vel.y += gravity × h`（+y = 畫面下方），同樣**必須在
 *      預測之前**，理由同上。被抓／被 Pin 的 Particle 一樣照加——步驟 5 的約束
 *      會把它們拉回，不需另外特例。
 *   2. 預測：symplectic Euler（所有 Particle 一視同仁；已烤進步驟 1 的電風扇
 *      加速度與重力會在這裡被積分進位置）。
 *   3. shape-matching 脊椎：重疊方格 lattice（每格再依網格拓撲切連通分量，
 *      issue #83）的每個 Region 做 2×2 polar decomposition 取旋轉 → goal →
 *      `x += α_sm·(g − x)`。
 *   4. XPBD 細節層（`params.xpbd`，可關）：每條邊一條 distance 約束、每個三角形
 *      一條 signed-area 約束（`C = 有號面積 − 靜止有號面積`，翻面時號變、梯度
 *      翻正——不取絕對值）。compliant projection、1 iteration、`α̃ = compliance/h²`。
 *   5. Grab / Pin 位置約束：附著點（三角形 + 重心座標）→ 目標點，位置差按重心
 *      權重分回三個 Particle（ADR-0003）。Pin = 目標點凍結、β 恆 1 的 Grab
 *      （ADR-0004）。多條依序解、每 substep 一次；孤立 Pin 逐幀看幾乎不動，
 *      共用 Particle 的密集 Pin 群仍會被下一 substep 的 shape matching 微擾。
 *      陣風觸發時對已 Pin 住的 Particle 一樣會把衝量烤進 `vel`、預測也照常積分，但
 *      這一步會把位置拉回鎖定點——附著點因此仍不動，力學上不需要另外特例判斷。
 *   6. Boundary（`setBoundary`，可換）：clamp 進 Walled AABB／Floor 地板以上／Infinite no-op。
 *   7. 回推速度（被抓的 Particle 也照推 → 放開即 Fling）→ 全域阻尼。
 *
 * picking（世界座標 → 三角形 + 重心座標）暫時放在這裡（藍本 jelly-core 也是），
 * 未來 Input layer（issue #11）接手後改由它命中、只餵求解器 `{三角形, 重心座標,
 * 目標點}`——見 `docs/design/simulation-and-mesh.md` 模組邊界。
 */

import { mulberry32, type SimMesh } from '../mesh';
import { type Boundary, InfiniteBoundary } from './boundary';
import {
  DEFAULT_SIM_PARAMS,
  type AreaStats,
  type Bbox,
  type FanState,
  type InputEvent,
  type PinInfo,
  type Point,
  type PointerId,
  type SimParams,
  type StretchStats,
  type SurfacePoint,
} from './types';

/**
 * 一條作用中的位置約束（設計文件步驟 4：「Grab / Pin / Multi-grab 位置約束」）。
 * 附著點 = 三角形 `tri` 上的重心座標 `w`，每 substep 拉向 `target`。
 * `pinned` = false 是 Grab（`target` 跟指標更新、硬度用 `params.grabBeta`）；
 * `pinned` = true 是 Pin（`target` 凍結、β 恆為 1，見 ADR-0004）。
 */
interface Constraint {
  tri: readonly [number, number, number];
  w: readonly [number, number, number];
  target: Point;
  pinned: boolean;
}

/** 一個 shape-matching Region：成員 Particle 索引 + 其相對 Region 靜止質心的座標。 */
interface Region {
  members: number[];
  /** `[x0, y0, x1, y1, ...]`，相對 Region 靜止質心。長度 = 2 × members.length。 */
  q: Float64Array;
}

/** Sim mesh 的一條無向邊 + 靜止長度（`stretchStats` 用）。 */
interface Edge {
  p: number;
  q: number;
  restLen: number;
}

/** 三角形有號面積（shoelace／2）。CCW（y 向下）為負、CW 為正；翻面時號變。 */
function signedArea(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return 0.5 * ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

export class SimCore {
  /** signed-area 約束／`areaStats` 都跳過 `|靜止有號面積|` 小於此值的退化三角形。 */
  private static readonly MIN_REST_AREA = 1;
  /** Tap 影響半徑 = 目前 bbox 對角線 × 此係數（設計文件參數表，待實測）。 */
  private static readonly TAP_RADIUS_FRAC = 0.2;
  /**
   * 電風扇陣風觸發時機的預設 PRNG 種子（issue #67 事後檢視追加）——固定常數，
   * 不是隨機挑的，這樣不特別指定 `rngSeed` 建構的 `SimCore` 也是決定性的
   * （同一段事件流永遠得到同一串陣風時機）。任意選的常數，沒有特殊意義。
   */
  private static readonly DEFAULT_RNG_SEED = 0x9e3779b9;

  /**
   * 手感參數。可直接改欄位；改 `cellFrac` 後須呼叫 `rebuildRegions()`，
   * 其餘欄位下一次 `step` 即生效。
   */
  params: SimParams;

  private readonly n: number;
  private readonly rest: Float64Array;
  private readonly pos: Float64Array;
  private readonly prev: Float64Array;
  private readonly vel: Float64Array;
  private readonly tris: Uint32Array;
  private readonly edges: Edge[];
  /** 每個三角形的靜止有號面積（從 `rest` 座標重算，不信任呼叫端的 `mesh.restAreas`）。 */
  private readonly restAreas: Float64Array;
  /** 靜止 bbox 對角線長。Grab 框外退路的預設吸附半徑由它導出。 */
  private readonly restDiag: number;

  /** 作用中的 Grab / Pin，鍵為輸入 `id`（Grab 與 Pin 共用命名空間）。 */
  private readonly constraints = new Map<PointerId, Constraint>();
  /** 場上目前的電風扇（issue #66；ADR-0010：v1 單一實例，`null` = 沒有）。 */
  private fan: FanState | null = null;
  private regions: Region[] = [];
  /** 可替換的碰撞環境。預設無牆；`setBoundary` 可執行期替換，不需重建求解器。 */
  private boundary: Boundary = new InfiniteBoundary();
  /**
   * 電風扇陣風觸發時機的決定性 PRNG（issue #67 事後檢視追加）——`reset()` 也會
   * 重新以 `rngSeed` 播種，讓 `sim.reset()` 之後的 Track 重播（`playAll`）跟
   * 錄製當下用同一串陣風時機，見類別頂端說明。`applyFan` 是唯一的讀取點。
   */
  private rng: () => number;

  // shape-matching goal 累加器（每 substep 重用，免得每步配置）。
  private readonly goalX: Float64Array;
  private readonly goalY: Float64Array;
  private readonly goalCount: Float64Array;

  /**
   * `rngSeed`（issue #67 事後檢視追加）——電風扇陣風觸發時機的 PRNG 種子，預設
   * `DEFAULT_RNG_SEED`。目前沒有呼叫端會帶自訂種子，留這個參數主要是給測試
   * 用（用不同種子驗證陣風時機真的是「這個種子決定的」而非硬寫死一組固定
   * 結果），也讓「種子從哪裡來」保持跟 mesh pipeline 一樣可推導、非隱藏狀態
   * 的慣例（ADR-0005）。
   */
  constructor(
    mesh: SimMesh,
    params: Partial<SimParams> = {},
    private readonly rngSeed: number = SimCore.DEFAULT_RNG_SEED,
  ) {
    this.params = { ...DEFAULT_SIM_PARAMS, ...params };
    this.n = mesh.positions.length / 2;
    this.rest = Float64Array.from(mesh.positions);
    this.pos = this.rest.slice();
    this.prev = this.rest.slice();
    this.vel = new Float64Array(this.rest.length);
    this.tris = Uint32Array.from(mesh.indices);
    this.edges = this.collectEdges();
    this.restAreas = this.computeAreas(this.rest);
    this.goalX = new Float64Array(this.n);
    this.goalY = new Float64Array(this.n);
    this.goalCount = new Float64Array(this.n);
    this.restDiag = this.diag(this.bounds(this.rest));
    this.rng = mulberry32(this.rngSeed);
    this.rebuildRegions();
  }

  /** bbox 對角線長，永遠 ≥ 1（避免退化尺度讓半徑歸零）。 */
  private diag(bb: Bbox): number {
    return Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) || 1;
  }

  // ---- setup ---------------------------------------------------------------

  /** 每條 Sim mesh 邊收一次（無向、去重），記靜止長度。 */
  private collectEdges(): Edge[] {
    const seen = new Set<number>();
    const edges: Edge[] = [];
    const key = (a: number, b: number) => (a < b ? a * this.n + b : b * this.n + a);
    for (let t = 0; t < this.tris.length; t += 3) {
      const a = this.tris[t]!;
      const b = this.tris[t + 1]!;
      const c = this.tris[t + 2]!;
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const k = key(p, q);
        if (seen.has(k)) continue;
        seen.add(k);
        const dx = this.rest[2 * p]! - this.rest[2 * q]!;
        const dy = this.rest[2 * p + 1]! - this.rest[2 * q + 1]!;
        edges.push({ p, q, restLen: Math.hypot(dx, dy) || 1e-6 });
      }
    }
    return edges;
  }

  /** 每個三角形在 `buf` 座標下的有號面積。順序對齊 `tris`。建構時算一次靜止面積。 */
  private computeAreas(buf: Float64Array): Float64Array {
    const areas = new Float64Array(this.tris.length / 3);
    for (let t = 0; t < this.tris.length; t += 3) {
      const a = this.tris[t]!;
      const b = this.tris[t + 1]!;
      const c = this.tris[t + 2]!;
      areas[t / 3] = signedArea(
        buf[2 * a]!,
        buf[2 * a + 1]!,
        buf[2 * b]!,
        buf[2 * b + 1]!,
        buf[2 * c]!,
        buf[2 * c + 1]!,
      );
    }
    return areas;
  }

  /** `buf`（攤平 `[x0,y0,...]`）中所有 Particle 的軸對齊包圍盒。 */
  private bounds(buf: Float64Array): Bbox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = buf[2 * i]!;
      const y = buf[2 * i + 1]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * 在 Sim mesh 靜止 bbox 上鋪重疊方格 lattice，重建 Region 清單。
   * cell 邊長 `L = 對角線 × cellFrac`，每軸以 `L / 2` 的 stride 重疊 2×。
   *
   * 一個 cell 內的 Particle **再依網格邊切成連通分量**，每個分量各自成一個
   * Region（issue #83）：凹形物件上兩塊只隔著透明縫、網格上並不相連的部位
   * （例如相鄰的兩根尖角）會落進同一個方格，若不切開就會被當成一塊剛體擬合
   * ——拉一邊、另一邊跟著走，像有隱形桿子連著。BFS 限制在該 cell 的成員子集
   * 內，所以繞 cell 外面才相連的兩坨（馬蹄形的兩端）也會正確分開。
   *
   * 含 ≥ 4 個 Particle 的分量才是一個 Region（門檻沿用拆分前的規則：實測真實
   * 網格在預設／最硬 cellFrac 下拆分後無任何頂點失去 Region；降門檻會多出大量
   * bbox 邊緣的 2–3 點共線小 Region，經 goal 等權平均稀釋大 Region 的拉力、改變
   * 凸形物件手感，不在 issue #83 範圍）。改 `params.cellFrac` 後呼叫。
   */
  rebuildRegions(): void {
    const bb = this.bounds(this.rest);
    const { minX, minY, maxX, maxY } = bb;
    const L = Math.max(this.diag(bb) * this.params.cellFrac, 1e-3);
    const stride = L / 2;
    const adjacency = this.adjacency();
    // `cellOf[i]` = Particle i 目前所屬 cell 的序號（限制 BFS 不跨出 cell）；
    // `visited[i]` = 已被歸入某分量的 cell 序號。兩者都用 cell 序號當時間戳，免清空。
    const cellOf = new Int32Array(this.n).fill(-1);
    const visited = new Int32Array(this.n).fill(-1);
    const queue: number[] = [];
    const regions: Region[] = [];
    let cellId = 0;
    for (let gx = minX - stride; gx < maxX + stride; gx += stride) {
      for (let gy = minY - stride; gy < maxY + stride; gy += stride, cellId++) {
        const inCell: number[] = [];
        for (let i = 0; i < this.n; i++) {
          const x = this.rest[2 * i]!;
          const y = this.rest[2 * i + 1]!;
          if (x >= gx && x < gx + L && y >= gy && y < gy + L) {
            inCell.push(i);
            cellOf[i] = cellId;
          }
        }
        for (const seed of inCell) {
          if (visited[seed] === cellId) continue;
          const members: number[] = [];
          visited[seed] = cellId;
          queue.length = 0;
          queue.push(seed);
          for (let head = 0; head < queue.length; head++) {
            const i = queue[head]!;
            members.push(i);
            for (const j of adjacency[i]!) {
              if (cellOf[j] !== cellId || visited[j] === cellId) continue;
              visited[j] = cellId;
              queue.push(j);
            }
          }
          if (members.length < 4) continue;
          members.sort((a, b) => a - b);
          regions.push(this.makeRegion(members));
        }
      }
    }
    this.regions = regions;
  }

  /** 每個 Particle 的鄰接 Particle 清單（由 `edges` 建，順序決定性）。 */
  private adjacency(): number[][] {
    const adjacency: number[][] = Array.from({ length: this.n }, () => []);
    for (const e of this.edges) {
      adjacency[e.p]!.push(e.q);
      adjacency[e.q]!.push(e.p);
    }
    return adjacency;
  }

  /** 以 `members` 的靜止質心為原點記下各成員的相對座標 `q`。 */
  private makeRegion(members: number[]): Region {
    let cx = 0;
    let cy = 0;
    for (const i of members) {
      cx += this.rest[2 * i]!;
      cy += this.rest[2 * i + 1]!;
    }
    cx /= members.length;
    cy /= members.length;
    const q = new Float64Array(members.length * 2);
    for (let m = 0; m < members.length; m++) {
      q[2 * m] = this.rest[2 * members[m]!]! - cx;
      q[2 * m + 1] = this.rest[2 * members[m]! + 1]! - cy;
    }
    return { members, q };
  }

  /** 替換碰撞環境（`WalledBoundary` / `FloorBoundary` / `InfiniteBoundary`）。執行期可隨時呼叫。 */
  setBoundary(boundary: Boundary): void {
    this.boundary = boundary;
  }

  // ---- input ------------------------------------------------------------------

  /**
   * 唯一的輸入介面（ADR-0005）。支援 `grab` / `moveGrab` / `release`（T4）、
   * `pin` / `unpin` / `movePin`（T5）、`tap`（T7）、`clearPins`（issue #51）、
   * `setFan` / `clearFan`（issue #66）。詳細語意見 `InputEvent`。
   */
  applyInput(event: InputEvent): void {
    switch (event.type) {
      case 'grab':
        this.doGrab(event.id, event.x, event.y, this.grabRadius(event.radius));
        break;
      case 'moveGrab': {
        const c = this.constraints.get(event.id);
        if (c && !c.pinned) {
          c.target.x = event.x;
          c.target.y = event.y;
        }
        break;
      }
      case 'release': {
        const c = this.constraints.get(event.id);
        if (c && !c.pinned) this.constraints.delete(event.id);
        break;
      }
      case 'pin': {
        if (event.x !== undefined && event.y !== undefined) {
          // Pin-at-coordinates：picking 沒命中就是 no-op，不去動同 id 的既有約束。
          if (!this.doGrab(event.id, event.x, event.y, this.grabRadius(event.radius))) break;
        }
        const c = this.constraints.get(event.id);
        if (c && !c.pinned) {
          // 就地凍結：目標點移到目前附著點 → 不跳動。已是 Pin 則不動它。
          const a = this.weightedPoint(c);
          c.target.x = a.x;
          c.target.y = a.y;
          c.pinned = true;
        }
        break;
      }
      case 'unpin': {
        const c = this.constraints.get(event.id);
        if (c?.pinned) this.constraints.delete(event.id);
        break;
      }
      case 'movePin': {
        const c = this.constraints.get(event.id);
        if (c?.pinned) {
          c.target.x = event.x;
          c.target.y = event.y;
        }
        break;
      }
      case 'tap':
        this.doTap(event.x, event.y, event.strength ?? this.params.tapStrength);
        break;
      case 'clearPins':
        this.clearPins();
        break;
      case 'setFan':
        this.fan = {
          originX: event.originX,
          originY: event.originY,
          dirX: event.dirX,
          dirY: event.dirY,
          length: event.length,
          width: event.width,
          strength: event.strength,
          falloffExponent: event.falloffExponent,
          frequency: event.frequency,
        };
        break;
      case 'clearFan':
        this.fan = null;
        break;
    }
  }

  /** 目前作用中、未鎖定的 Grab 數。 */
  get grabCount(): number {
    return this.countConstraints(false);
  }

  /** 目前作用中的 Pin 數。 */
  get pinCount(): number {
    return this.countConstraints(true);
  }

  private countConstraints(pinned: boolean): number {
    let count = 0;
    for (const c of this.constraints.values()) if (c.pinned === pinned) count++;
    return count;
  }

  /**
   * 一次移除所有 Pin（保留 Grab）。控制面板「清除所有 Pin」用——現在經
   * `applyInput({ type: 'clearPins' })` 轉呼，好讓 `TrackRecorder` 錄得到（issue #51）。
   */
  clearPins(): void {
    for (const [id, c] of this.constraints) {
      if (c.pinned) this.constraints.delete(id);
    }
  }

  /**
   * 把 Jelly 重設回靜置狀態：位置回到 rest（初始網格）座標、速度歸零、清掉所有
   * Grab／Pin，以及場上的電風扇（issue #66；不清的話重設後下一幀又會被同一個
   * 風扇立刻吹動，不是真正的靜置）。順便把陣風 PRNG 重新播種（issue #67 事後
   * 檢視追加）——`playAll` 在 `demoRunner.start` 之前呼叫這個方法，重播才會
   * 跟錄製當下用同一串陣風時機，見類別頂端說明。控制面板「停止／重設」用。
   * 拓撲／Region 不受影響（只跟 rest 座標與 `params.cellFrac` 有關，兩者都
   * 沒變）。
   */
  reset(): void {
    this.pos.set(this.rest);
    this.prev.set(this.rest);
    this.vel.fill(0);
    this.constraints.clear();
    this.fan = null;
    this.rng = mulberry32(this.rngSeed);
  }

  /**
   * 某個 Grab／Pin 附著點目前的世界座標（隨網格變形移動），供算繪畫把手、或測試
   * 斷言收斂用。該 `id` 沒有作用中的約束時回傳 `null`。
   */
  attachPoint(id: PointerId): Point | null {
    const c = this.constraints.get(id);
    if (!c) return null;
    return this.weightedPoint(c);
  }

  /**
   * 某個 Grab／Pin 附著點在 **rest（初始網格）形狀** 下的世界座標——同一組三角形
   * ＋重心座標，但套在 `rest` 而非目前變形後的 `pos` 上，所以不隨查詢當下的變形
   * 而偏。片段初始 Pin 快照（issue #39 / ADR-0007 追記）靠它把「畫面上的 Pin」記
   * 成一組跟 `sim.reset()` 後（位置回 rest）的果凍對齊的座標——播放全部在 step 0
   * 還原這些 Pin 時才會精準落在原本的表面點。該 `id` 沒有作用中的約束時回傳 `null`。
   */
  restAttachPoint(id: PointerId): Point | null {
    const c = this.constraints.get(id);
    if (!c) return null;
    return this.weightedPoint(c, this.rest);
  }

  /**
   * 目前所有作用中的 Pin：`id` + 附著點目前世界座標（隨網格變形移動）。畫 Pin
   * 標記、或「點掉特定 Pin」需要知道每個 Pin 現在在哪裡時用。
   */
  listPins(): PinInfo[] {
    const pins: PinInfo[] = [];
    for (const [id, c] of this.constraints) {
      if (c.pinned) pins.push({ id, point: this.weightedPoint(c) });
    }
    return pins;
  }

  /**
   * 場上目前的電風扇（issue #66；ADR-0010），沒有時回傳 `null`。輸入層／算繪端
   * 讀它畫矩形視覺提示（比照 `listPins()` 給 `PinMarkers` 用的模式）。
   */
  fanState(): FanState | null {
    return this.fan;
  }

  /** Grab／Pin 框外退路的吸附半徑：呼叫端指定值，否則靜止 bbox 對角線 × 0.1。 */
  private grabRadius(explicit?: number): number {
    return explicit ?? this.restDiag * 0.1;
  }

  /**
   * 嚴格 picking：回傳包含世界座標 `(x, y)` 的三角形 + 重心座標（第一個命中的）。
   * 落在所有三角形外回 `null`。**不含**「退回最近 Particle」的吸附——那是 Grab
   * 專屬的退路。輸入層用它判定「指標是否落在 Jelly 上」（見 `docs/design/`
   * 模組邊界）。讀的是目前變形後的位置，所以相機平移／縮放不影響命中（換算在
   * 輸入層做）。
   */
  pick(x: number, y: number): SurfacePoint | null {
    for (let t = 0; t < this.tris.length; t += 3) {
      const a = this.tris[t]!;
      const b = this.tris[t + 1]!;
      const c = this.tris[t + 2]!;
      const ax = this.pos[2 * a]!;
      const ay = this.pos[2 * a + 1]!;
      const bx = this.pos[2 * b]!;
      const by = this.pos[2 * b + 1]!;
      const cx = this.pos[2 * c]!;
      const cy = this.pos[2 * c + 1]!;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-9) continue;
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) {
        return { tri: [a, b, c], w: [w0, w1, w2] };
      }
    }
    return null;
  }

  /**
   * Picking → 建立一條未鎖的 Grab。命中三角形就用它的重心座標當附著點；按下當下
   * 目標點 = 附著點 → 誤差 0 → 不會一按就動（ADR-0003）。點落在所有三角形外時，
   * 退回 `radius` 內最近的 Particle（重心權重 `(1, 0, 0)`）。回傳是否建立了約束
   * ——`pin` 事件靠它判斷 pick 是否命中。
   */
  private doGrab(id: PointerId, x: number, y: number, radius: number): boolean {
    const hit = this.pick(x, y);
    if (hit) {
      this.constraints.set(id, {
        tri: [hit.tri[0], hit.tri[1], hit.tri[2]],
        w: [hit.w[0], hit.w[1], hit.w[2]],
        target: { x, y },
        pinned: false,
      });
      return true;
    }
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < this.n; i++) {
      const dx = this.pos[2 * i]! - x;
      const dy = this.pos[2 * i + 1]! - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return false;
    this.constraints.set(id, {
      tri: [best, best, best],
      w: [1, 0, 0],
      target: { x, y },
      pinned: false,
    });
    return true;
  }

  /** 附著點世界座標＝三角形頂點的重心座標加權；`buf` 預設目前位置，傳 `rest` 得靜止形狀下的座標。 */
  private weightedPoint(g: Constraint, buf: Float64Array = this.pos): Point {
    const [i0, i1, i2] = g.tri;
    const [w0, w1, w2] = g.w;
    return {
      x: w0 * buf[2 * i0]! + w1 * buf[2 * i1]! + w2 * buf[2 * i2]!,
      y: w0 * buf[2 * i0 + 1]! + w1 * buf[2 * i1 + 1]! + w2 * buf[2 * i2 + 1]!,
    };
  }

  /**
   * Tap（輕拍）：一次性向內徑向脈衝，直接改速度、不進 substep 迴圈。半徑
   * `R = 目前 bbox 對角線 × TAP_RADIUS_FRAC` 內每個 Particle：
   * `v += 正規化(tapPoint − pos) · strength · (1 − d/R)²`。向內 → 凹陷後彈回；
   * ring-down 交給 shape matching + 阻尼。半徑內無 Particle 時整體 no-op。
   */
  private doTap(x: number, y: number, strength: number): void {
    const r = this.diag(this.bounds(this.pos)) * SimCore.TAP_RADIUS_FRAC;
    for (let i = 0; i < this.n; i++) {
      const dx = x - this.pos[2 * i]!;
      const dy = y - this.pos[2 * i + 1]!;
      const dist = Math.hypot(dx, dy);
      if (dist >= r || dist < 1e-6) continue; // 圈外／正中心（無方向）→ 不施力
      const f = 1 - dist / r;
      const s = (strength * f * f) / dist; // (dx, dy)/dist · strength · (1 − d/R)²
      this.vel[2 * i] = this.vel[2 * i]! + dx * s;
      this.vel[2 * i + 1] = this.vel[2 * i + 1]! + dy * s;
    }
  }

  /**
   * 電風扇陣風（issue #66；ADR-0010；issue #67 事後檢視從連續力場改成離散
   * 陣風——使用者回饋覺得穩定持續的風「不像電風扇」，改成擺頭掃過來一陣陣吹
   * 的手感）：這個 substep 是否吹一次陣風，由 `this.rng()`（決定性種子 PRNG，
   * 見類別頂端說明）擲一次骰決定——`rng() < frequency * h` 觸發，`frequency`
   * 是平均每秒陣風次數、`h` 是這個 substep 的秒數，即離散化的泊松過程（機率
   * 抓小成立時，每秒的期望觸發次數 ≈ `frequency`，不受 `substeps` 高低影響）。
   * 沒抽中就整個 substep 無風、`vel` 不動。
   *
   * 抽中的話：矩形涵蓋範圍——沿吹風方向（`dirX`, `dirY`，單位向量）從風扇面
   * `(originX, originY)` 量起、縱向 `[0, length]`，垂直方向（`perpX`, `perpY`
   * = 吹風方向轉 90°）`[-width/2, width/2]`——內每個 Particle 依
   * `衝量 = strength × (1 − 縱向距離/length)^falloffExponent` 沿吹風方向吃一次
   * 瞬間速度衝量（`v += dir · 衝量`，不再乘 `h`——比照 `doTap` 的一次性慣例，
   * 這是單一事件的衝量而非持續施力）。縱向距離越大衝量越小、在 `length` 處
   * 平滑趨近 0（沿用 `doTap` 的正規化距離冪次衰減慣例）；矩形外（縱向 < 0 或 >
   * length，或橫向超出半寬）完全無感。`length <= 0`（尚未真的拖出方向）整段
   * no-op，避免除以 0（且不消耗這個 substep 的 RNG 抽樣，沒有風扇矩形時陣風
   * 時機不該被無意義地推進）。
   */
  private applyFan(fan: FanState, h: number): void {
    if (!(fan.length > 0)) return;
    if (this.rng() >= fan.frequency * h) return;
    const { originX, originY, dirX, dirY, length, width, strength, falloffExponent } = fan;
    const perpX = -dirY;
    const perpY = dirX;
    const halfWidth = width / 2;
    for (let i = 0; i < this.n; i++) {
      const dx = this.pos[2 * i]! - originX;
      const dy = this.pos[2 * i + 1]! - originY;
      const along = dx * dirX + dy * dirY;
      if (along < 0 || along > length) continue;
      const across = dx * perpX + dy * perpY;
      if (Math.abs(across) > halfWidth) continue;
      const falloff = Math.pow(1 - along / length, falloffExponent);
      const impulse = strength * falloff;
      this.vel[2 * i] = this.vel[2 * i]! + dirX * impulse;
      this.vel[2 * i + 1] = this.vel[2 * i + 1]! + dirY * impulse;
    }
  }

  // ---- step ----------------------------------------------------------------

  /**
   * 推進 `dt` 秒（切成 `params.substeps` 個 substep）。`dt <= 0` 為 no-op。
   * accumulator 累積與上限 clamp 由呼叫端負責。
   */
  step(dt: number): void {
    if (!(dt > 0)) return;
    const subs = Math.max(1, Math.floor(this.params.substeps));
    const h = dt / subs;
    const alphaSm = this.params.alphaSm;
    const keep = 1 - this.params.damping;
    const keepAir = 1 - this.params.airDamping;
    const gravity = this.params.gravity;

    for (let s = 0; s < subs; s++) {
      // 1. 電風扇（沒有時 no-op）：對目前位置落在矩形內的 Particle 把它的加速度
      //    烤進 vel。**必須在預測之前**——vel 在這個 substep 尾端（步驟 7）會整個
      //    依位置差重算，這裡若排在預測之後才改 vel，這股力這一 substep 完全不會
      //    移動任何位置、下一行就被蓋掉，等於沒發生過。
      if (this.fan) this.applyFan(this.fan, h);
      //    重力同一步驟、同一理由（issue #91）：`gravity = 0` 時整段跳過，讓沒有
      //    重力的 step 每個浮點運算跟以前完全一樣（舊片段重播結果不變）。
      if (gravity !== 0) {
        const dv = gravity * h;
        for (let i = 0; i < this.n; i++) this.vel[2 * i + 1] = this.vel[2 * i + 1]! + dv;
      }
      // 2. 預測：symplectic Euler，把（可能已含電風扇／重力）的 vel 積分進
      //    pos——被抓 Particle 也照常積分。
      for (let i = 0; i < this.n; i++) {
        this.prev[2 * i] = this.pos[2 * i]!;
        this.prev[2 * i + 1] = this.pos[2 * i + 1]!;
        this.pos[2 * i] = this.pos[2 * i]! + this.vel[2 * i]! * h;
        this.pos[2 * i + 1] = this.pos[2 * i + 1]! + this.vel[2 * i + 1]! * h;
      }
      // 3. shape-matching 脊椎（有重力時開動量守恆，見方法說明）。
      this.solveShapeMatching(alphaSm, gravity !== 0);
      // 4. XPBD 細節層（疊加；補局部拉伸擠壓的彈性 + 第二道防翻面）。
      if (this.params.xpbd) this.solveXpbd(h);
      // 5. Grab / Pin 位置約束（在 shape matching 之後 → 把手直追目標、身體下一步跟上）。
      this.solveConstraints();
      // 6. Boundary：clamp 進邊界（Walled AABB／Floor 地板）、調 prev 讓回推速度不指向界外（Infinite 為 no-op）。
      this.boundary.resolveBoundary(this.pos, this.prev, this.n, h);
      // 7. 回推速度 + 阻尼。
      if (gravity === 0) {
        // 俯視：全域阻尼套在完整速度上（桌面摩擦感）。這條路徑的每個浮點運算跟
        // issue #106 之前完全一樣——舊片段重播結果不變。
        for (let i = 0; i < this.n; i++) {
          this.vel[2 * i] = ((this.pos[2 * i]! - this.prev[2 * i]!) / h) * keep;
          this.vel[2 * i + 1] = ((this.pos[2 * i + 1]! - this.prev[2 * i + 1]!) / h) * keep;
        }
      } else {
        // 側視（issue #106）：空中沒有桌面摩擦。速度拆成「質心平移」（只吃很小的
        // airDamping，落體看得到加速）+「相對質心的內部運動」（維持 damping，放手後
        // 抖動仍 1–2 s 靜止）。等權平均 = 等質量質心速度；Pin 住的 Particle 速度 0
        // 也算進去，被 Pin 住的 Jelly 質心速度自然被拉向 0。
        let sumX = 0;
        let sumY = 0;
        for (let i = 0; i < this.n; i++) {
          const vx = (this.pos[2 * i]! - this.prev[2 * i]!) / h;
          const vy = (this.pos[2 * i + 1]! - this.prev[2 * i + 1]!) / h;
          this.vel[2 * i] = vx;
          this.vel[2 * i + 1] = vy;
          sumX += vx;
          sumY += vy;
        }
        const meanX = sumX / this.n;
        const meanY = sumY / this.n;
        const airX = meanX * keepAir;
        const airY = meanY * keepAir;
        for (let i = 0; i < this.n; i++) {
          this.vel[2 * i] = airX + (this.vel[2 * i]! - meanX) * keep;
          this.vel[2 * i + 1] = airY + (this.vel[2 * i + 1]! - meanY) * keep;
        }
      }
    }
  }

  /**
   * 每 Region：目前質心 vs 靜止質心 → 最佳線性變換 `A_pq` → 2×2 polar
   * decomposition 取旋轉 `R` → 成員 goal `g = R·q + c`。Particle 最終 goal =
   * 所屬各 Region goal 的等權平均（藍本 jelly-core 即如此；設計文件寫「加權」但
   * 未定義權重，待實測有需要再加）。位置朝 goal 拉 `x += α_sm·(g − x)`。
   *
   * `conserveMomentum`（issue #91）：單一 Region 的 goal 位移總和為 0（內力不改
   * 質心），但「等權平均」跨 Region 後不再守恆——每個 substep 會漏出一小段淨平移
   * （幽靈力）。俯視無重力時它只是 Fling 軌跡上幾個百分點的差異，沒人看得出來；
   * 但有重力、Jelly 靜置在無摩擦的地板上時，這段每步都被重力壓縮重新激發、x 方向
   * 又沒有任何東西擋，會累積成一路走不停的滑動（實測 13×13 fixture 在 g = 2000
   * 下以 ~30 單位／秒橫移，關掉 XPBD 就沒有——壓縮狀態下的漏差來自兩層的交互）。
   * 開啟時把所有有 Region 的 Particle 位移扣掉它們的平均（沒有 Region 的 Particle
   * 不被拉、也不納入），讓 shape matching 這一步的淨平移精確為 0。**只在 `gravity ≠ 0` 時開**：g = 0 走原路徑，每個浮點運算跟以前
   * 完全一樣，舊片段重播結果不變（issue #91 驗收；要不要全域開啟見 issue #102）。
   */
  private solveShapeMatching(alphaSm: number, conserveMomentum: boolean): void {
    this.goalX.fill(0);
    this.goalY.fill(0);
    this.goalCount.fill(0);

    for (const region of this.regions) {
      const mem = region.members;
      const q = region.q;
      const k = mem.length;

      let cx = 0;
      let cy = 0;
      for (let m = 0; m < k; m++) {
        cx += this.pos[2 * mem[m]!]!;
        cy += this.pos[2 * mem[m]! + 1]!;
      }
      cx /= k;
      cy /= k;

      // A_pq = Σ (p − c) ⊗ q
      let a00 = 0;
      let a01 = 0;
      let a10 = 0;
      let a11 = 0;
      for (let m = 0; m < k; m++) {
        const px = this.pos[2 * mem[m]!]! - cx;
        const py = this.pos[2 * mem[m]! + 1]! - cy;
        const qx = q[2 * m]!;
        const qy = q[2 * m + 1]!;
        a00 += px * qx;
        a01 += px * qy;
        a10 += py * qx;
        a11 += py * qy;
      }
      // 2×2 polar decomposition → 最接近的旋轉。det < 0 也給正規旋轉，力會主動翻正。
      const sx = a00 + a11;
      const sy = a10 - a01;
      const d = Math.hypot(sx, sy);
      const ct = d < 1e-9 ? 1 : sx / d;
      const st = d < 1e-9 ? 0 : sy / d;

      for (let m = 0; m < k; m++) {
        const i = mem[m]!;
        const qx = q[2 * m]!;
        const qy = q[2 * m + 1]!;
        this.goalX[i] = this.goalX[i]! + (cx + ct * qx - st * qy);
        this.goalY[i] = this.goalY[i]! + (cy + st * qx + ct * qy);
        this.goalCount[i] = this.goalCount[i]! + 1;
      }
    }

    if (!conserveMomentum) {
      for (let i = 0; i < this.n; i++) {
        const count = this.goalCount[i]!;
        if (count === 0) continue;
        this.pos[2 * i] = this.pos[2 * i]! + alphaSm * (this.goalX[i]! / count - this.pos[2 * i]!);
        this.pos[2 * i + 1] =
          this.pos[2 * i + 1]! + alphaSm * (this.goalY[i]! / count - this.pos[2 * i + 1]!);
      }
      return;
    }

    // 動量守恆版（issue #91；見方法說明）：先把每個有 Region 的 Particle 位移算好，
    // 暫存回 `goalX/goalY`（這一段之後只當位移用，取別名 `dispX/dispY`），扣掉
    // 這些 Particle 的平均後才套用。沒有 Region 的 Particle 本來就不被 shape
    // matching 拉，不納入平均、也不扣。
    const dispX = this.goalX;
    const dispY = this.goalY;
    let sumDx = 0;
    let sumDy = 0;
    let moved = 0;
    for (let i = 0; i < this.n; i++) {
      const count = this.goalCount[i]!;
      if (count === 0) continue;
      const dx = alphaSm * (this.goalX[i]! / count - this.pos[2 * i]!);
      const dy = alphaSm * (this.goalY[i]! / count - this.pos[2 * i + 1]!);
      dispX[i] = dx;
      dispY[i] = dy;
      sumDx += dx;
      sumDy += dy;
      moved++;
    }
    if (moved === 0) return;
    const meanDx = sumDx / moved;
    const meanDy = sumDy / moved;
    for (let i = 0; i < this.n; i++) {
      if (this.goalCount[i] === 0) continue;
      this.pos[2 * i] = this.pos[2 * i]! + dispX[i]! - meanDx;
      this.pos[2 * i + 1] = this.pos[2 * i + 1]! + dispY[i]! - meanDy;
    }
  }

  /**
   * XPBD 細節層（藍本 jelly-core）：每條邊一條 distance 約束、每個三角形一條
   * signed-area 約束。單一 iteration、λ 不累積（Small Steps：靠多 substep 收斂）。
   * 所有 Particle 等質量（`w = 1`）。`α̃ = compliance / h²`。
   *
   * signed-area 用**有號**面積：`C = 有號面積 − 靜止有號面積`，翻面時 `C` 變號、
   * 梯度把元素翻正——不可取絕對值。`|靜止面積| < 1` 的退化三角形跳過（無梯度可用）。
   */
  private solveXpbd(h: number): void {
    const h2 = h * h;

    const alphaDist = this.params.distCompliance / h2;
    for (const e of this.edges) {
      const dx = this.pos[2 * e.p]! - this.pos[2 * e.q]!;
      const dy = this.pos[2 * e.p + 1]! - this.pos[2 * e.q + 1]!;
      const len = Math.hypot(dx, dy) || 1e-9;
      // ΔλdotN：C = len − L0，∇C = ±單位向量，w_p + w_q = 2。
      const dl = -(len - e.restLen) / (2 + alphaDist);
      const nx = (dx / len) * dl;
      const ny = (dy / len) * dl;
      this.pos[2 * e.p] = this.pos[2 * e.p]! + nx;
      this.pos[2 * e.p + 1] = this.pos[2 * e.p + 1]! + ny;
      this.pos[2 * e.q] = this.pos[2 * e.q]! - nx;
      this.pos[2 * e.q + 1] = this.pos[2 * e.q + 1]! - ny;
    }

    const alphaArea = this.params.areaCompliance / h2;
    for (let t = 0; t < this.tris.length; t += 3) {
      const a0 = this.restAreas[t / 3]!;
      if (Math.abs(a0) < SimCore.MIN_REST_AREA) continue; // 退化三角形：無可用梯度
      const ai = this.tris[t]!;
      const bi = this.tris[t + 1]!;
      const ci = this.tris[t + 2]!;
      const ax = this.pos[2 * ai]!;
      const ay = this.pos[2 * ai + 1]!;
      const bx = this.pos[2 * bi]!;
      const by = this.pos[2 * bi + 1]!;
      const cx = this.pos[2 * ci]!;
      const cy = this.pos[2 * ci + 1]!;
      const cVal = signedArea(ax, ay, bx, by, cx, cy) - a0;
      const gax = 0.5 * (by - cy);
      const gay = 0.5 * (cx - bx);
      const gbx = 0.5 * (cy - ay);
      const gby = 0.5 * (ax - cx);
      const gcx = 0.5 * (ay - by);
      const gcy = 0.5 * (bx - ax);
      // `|| 1e-12`：呼叫端可能把 areaCompliance 設成 0，加上三角形完全塌陷時分母會 → 0。
      const denom =
        gax * gax + gay * gay + gbx * gbx + gby * gby + gcx * gcx + gcy * gcy + alphaArea || 1e-12;
      const dl = -cVal / denom;
      this.pos[2 * ai] = ax + gax * dl;
      this.pos[2 * ai + 1] = ay + gay * dl;
      this.pos[2 * bi] = bx + gbx * dl;
      this.pos[2 * bi + 1] = by + gby * dl;
      this.pos[2 * ci] = cx + gcx * dl;
      this.pos[2 * ci + 1] = cy + gcy * dl;
    }
  }

  /**
   * 每條 Grab／Pin：附著點目前位置 `p = Σ wₖ·xₖ`，誤差 `e = β·(目標 − p)`，位置
   * 修正按權重分回三個 Particle `xₖ += wₖ·e / Σwⱼ²`（β = 1 時一步剛好命中）。
   * Pin（`pinned`）β 恆為 1（ADR-0004），Grab 用 `params.grabBeta`。
   * Multi-grab / 多 Pin = 依序解，天然共存（共用 Particle 的密集約束不會同一
   * substep 全部精確滿足，靠逐 substep 迭代收斂）。
   *
   * **先解全部 Grab、再解全部 Pin**（不是照 `constraints` 的插入順序）：兩條約束
   * 共用到同一個 Particle 時，同一個 substep 裡誰後解、誰的目標就贏。如果照插入
   * 順序解，一個晚建立、又剛好抓在 Pin 那個三角形上的 Grab 會在 Pin 之後執行，
   * 把 Pin 的附著點拖向 Grab 的目標——持續拖曳下 Pin 會被整個拖走，違反
   * ADR-0004「用力甩／Tap 都拔不掉」的保證。固定「Pin 永遠最後解」讓 Pin 不管
   * 建立先後、也不管有沒有其他約束疊在同一個三角形上，每個 substep 都有最後
   * 修正權——會被拉開的是 Pin 周圍的網格（可觀察的拉伸），不是 Pin 自己。
   */
  private solveConstraints(): void {
    this.solveConstraintsPass(false); // Grab 先解
    this.solveConstraintsPass(true); // Pin 後解——保證不會被同一 substep 內任何 Grab 拖走
  }

  private solveConstraintsPass(pinned: boolean): void {
    for (const g of this.constraints.values()) {
      if (g.pinned !== pinned) continue;
      const beta = g.pinned ? 1 : this.params.grabBeta;
      const [i0, i1, i2] = g.tri;
      const [w0, w1, w2] = g.w;
      const p = this.weightedPoint(g);
      const ex = (g.target.x - p.x) * beta;
      const ey = (g.target.y - p.y) * beta;
      const s2 = w0 * w0 + w1 * w1 + w2 * w2 || 1;
      this.pos[2 * i0] = this.pos[2 * i0]! + (w0 * ex) / s2;
      this.pos[2 * i0 + 1] = this.pos[2 * i0 + 1]! + (w0 * ey) / s2;
      this.pos[2 * i1] = this.pos[2 * i1]! + (w1 * ex) / s2;
      this.pos[2 * i1 + 1] = this.pos[2 * i1 + 1]! + (w1 * ey) / s2;
      this.pos[2 * i2] = this.pos[2 * i2]! + (w2 * ex) / s2;
      this.pos[2 * i2 + 1] = this.pos[2 * i2 + 1]! + (w2 * ey) / s2;
    }
  }

  // ---- readouts ----------------------------------------------------------------

  /**
   * 目前 Particle 位置，`[x0, y0, x1, y1, ...]`。回傳的是求解器內部的活動緩衝區
   * （零複製，供算繪每幀直接讀）——**不要改動**。
   */
  get positions(): Float64Array {
    return this.pos;
  }

  /** 所有 Particle 位置的平均。 */
  centroid(): Point {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < this.n; i++) {
      mx += this.pos[2 * i]!;
      my += this.pos[2 * i + 1]!;
    }
    return { x: mx / this.n, y: my / this.n };
  }

  /** 目前 Particle 位置的軸對齊包圍盒（世界座標）。 */
  bbox(): Bbox {
    return this.bounds(this.pos);
  }

  stretchStats(): StretchStats {
    let max = 0;
    let sum = 0;
    for (const e of this.edges) {
      const dx = this.pos[2 * e.p]! - this.pos[2 * e.q]!;
      const dy = this.pos[2 * e.p + 1]! - this.pos[2 * e.q + 1]!;
      const r = Math.hypot(dx, dy) / e.restLen;
      if (r > max) max = r;
      sum += r;
    }
    return { max, avg: this.edges.length ? sum / this.edges.length : 0 };
  }

  /**
   * 三角形有號面積比（目前／靜止）的 min / max，掃過所有非退化三角形。
   * `min ≤ 0` 代表有三角形翻面；靜置時 min = max = 1。
   */
  areaStats(): AreaStats {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < this.tris.length; t += 3) {
      const a0 = this.restAreas[t / 3]!;
      if (Math.abs(a0) < SimCore.MIN_REST_AREA) continue;
      const ai = this.tris[t]!;
      const bi = this.tris[t + 1]!;
      const ci = this.tris[t + 2]!;
      const r =
        signedArea(
          this.pos[2 * ai]!,
          this.pos[2 * ai + 1]!,
          this.pos[2 * bi]!,
          this.pos[2 * bi + 1]!,
          this.pos[2 * ci]!,
          this.pos[2 * ci + 1]!,
        ) / a0;
      if (r < min) min = r;
      if (r > max) max = r;
    }
    return min === Infinity ? { min: 1, max: 1 } : { min, max };
  }

  /** `0.5 · Σ |vᵢ|²`（單位質量）。收斂看這個 → 0。 */
  kineticEnergy(): number {
    let ke = 0;
    for (let i = 0; i < this.vel.length; i++) ke += this.vel[i]! * this.vel[i]!;
    return 0.5 * ke;
  }
}
