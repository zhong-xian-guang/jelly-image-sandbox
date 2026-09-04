/**
 * 模擬核心（GitHub issue #5 起）——推進柔體的求解器。
 *
 * 建構時吃 `SimMesh` + 參數；對外只有 `applyInput(event)`、`step(dt)` 與讀出
 * （`positions`、`centroid()`、`bbox()`、`stretchStats()`、`kineticEnergy()`）。
 * 無 DOM、與算繪無關、決定性（不碰 `Math.random` 或 wall-clock，見 ADR-0005）。
 * 固定時間步：accumulator 累積與 clamp 由呼叫端負責，`step(dt)` 只把 `dt` 切成
 * `substeps` 個 substep 往前推。
 *
 * 每個 substep（藍本：`prototypes/shape-matching-feel.prototype.html` 的
 * `<script id="jelly-core">`；XPBD 細節層屬 issue #7、Tap 屬 #8、Boundary 屬 #9，
 * 尚未實作）：
 *   1. 預測：symplectic Euler、無重力、無外力（所有 Particle 一視同仁）。
 *   2. shape-matching 脊椎：重疊方格 lattice 的每個 Region 做 2×2 polar
 *      decomposition 取旋轉 → goal → `x += α_sm·(g − x)`。
 *   3. Grab / Pin 位置約束：附著點（三角形 + 重心座標）→ 目標點，位置差按重心
 *      權重分回三個 Particle（ADR-0003）。Pin = 目標點凍結、β 恆 1 的 Grab
 *      （ADR-0004）。多條依序解，天然共存。放在 shape matching 之後。
 *   4. 回推速度（被抓的 Particle 也照推 → 放開即 Fling）→ 全域阻尼。
 *
 * picking（世界座標 → 三角形 + 重心座標）暫時放在這裡（藍本 jelly-core 也是），
 * 未來 Input layer（issue #11）接手後改由它命中、只餵求解器 `{三角形, 重心座標,
 * 目標點}`——見 `docs/design/simulation-and-mesh.md` 模組邊界。
 */

import type { SimMesh } from '../mesh';
import {
  DEFAULT_SIM_PARAMS,
  type Bbox,
  type InputEvent,
  type Point,
  type PointerId,
  type SimParams,
  type StretchStats,
} from './types';

/**
 * 一條作用中的位置約束。附著點 = 三角形 `tri` 上的重心座標 `w`，追向 `target`。
 * `locked` = false 是 Grab（`target` 跟指標更新、硬度用 `params.grabBeta`）；
 * `locked` = true 是 Pin（`target` 凍結、β 恆為 1 絕對硬鎖，見 ADR-0004）。
 */
interface Grab {
  tri: readonly [number, number, number];
  w: readonly [number, number, number];
  target: Point;
  locked: boolean;
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

export class SimCore {
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
  /** 靜止 bbox 對角線長。Grab 框外退路的預設吸附半徑由它導出。 */
  private readonly restDiag: number;

  private readonly grabs = new Map<PointerId, Grab>();
  private regions: Region[] = [];

  // shape-matching goal 累加器（每 substep 重用，免得每步配置）。
  private readonly goalX: Float64Array;
  private readonly goalY: Float64Array;
  private readonly goalCount: Float64Array;

  constructor(mesh: SimMesh, params: Partial<SimParams> = {}) {
    this.params = { ...DEFAULT_SIM_PARAMS, ...params };
    this.n = mesh.positions.length / 2;
    this.rest = Float64Array.from(mesh.positions);
    this.pos = this.rest.slice();
    this.prev = this.rest.slice();
    this.vel = new Float64Array(this.rest.length);
    this.tris = Uint32Array.from(mesh.indices);
    this.edges = this.collectEdges();
    this.goalX = new Float64Array(this.n);
    this.goalY = new Float64Array(this.n);
    this.goalCount = new Float64Array(this.n);
    const rb = this.bounds(this.rest);
    this.restDiag = Math.hypot(rb.maxX - rb.minX, rb.maxY - rb.minY) || 1;
    this.rebuildRegions();
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
   * 含 ≥ 4 個 Particle 的 cell 才是一個 Region。改 `params.cellFrac` 後呼叫。
   */
  rebuildRegions(): void {
    const { minX, minY, maxX, maxY } = this.bounds(this.rest);
    const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
    const L = Math.max(diag * this.params.cellFrac, 1e-3);
    const stride = L / 2;
    const regions: Region[] = [];
    for (let gx = minX - stride; gx < maxX + stride; gx += stride) {
      for (let gy = minY - stride; gy < maxY + stride; gy += stride) {
        const members: number[] = [];
        for (let i = 0; i < this.n; i++) {
          const x = this.rest[2 * i]!;
          const y = this.rest[2 * i + 1]!;
          if (x >= gx && x < gx + L && y >= gy && y < gy + L) members.push(i);
        }
        if (members.length < 4) continue;
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
        regions.push({ members, q });
      }
    }
    this.regions = regions;
  }

  // ---- input ------------------------------------------------------------------

  /**
   * 唯一的輸入介面（ADR-0005）。支援 `grab` / `moveGrab` / `release`（T4）與
   * `pin` / `unpin` / `movePin`（T5）。
   *
   * - `pin` 帶 `(x, y)`：在該世界座標 picking 出附著點、直接建立硬鎖約束。
   * - `pin` 不帶座標：把該 `id` 既有的 Grab 就地凍結成 Pin（目標點移到目前附著點
   *   → 不跳動）。該 `id` 沒有 Grab 時 no-op。
   * - `release` 只解除未鎖的 Grab；Pin 要用 `unpin`（用力甩、Tap 都拔不掉）。
   * - `moveGrab` 不影響已鎖的 Pin。
   */
  applyInput(event: InputEvent): void {
    switch (event.type) {
      case 'grab':
        this.doGrab(event.id, event.x, event.y, event.radius ?? this.restDiag * 0.1);
        break;
      case 'moveGrab': {
        const g = this.grabs.get(event.id);
        if (g && !g.locked) {
          g.target.x = event.x;
          g.target.y = event.y;
        }
        break;
      }
      case 'release': {
        const g = this.grabs.get(event.id);
        if (g && !g.locked) this.grabs.delete(event.id);
        break;
      }
      case 'pin': {
        if (event.x !== undefined && event.y !== undefined) {
          this.doGrab(event.id, event.x, event.y, event.radius ?? this.restDiag * 0.1);
        }
        const g = this.grabs.get(event.id);
        if (g) {
          const a = this.weightedPoint(g);
          g.target.x = a.x;
          g.target.y = a.y;
          g.locked = true;
        }
        break;
      }
      case 'unpin': {
        const g = this.grabs.get(event.id);
        if (g?.locked) this.grabs.delete(event.id);
        break;
      }
      case 'movePin': {
        const g = this.grabs.get(event.id);
        if (g?.locked) {
          g.target.x = event.x;
          g.target.y = event.y;
        }
        break;
      }
    }
  }

  /** 目前作用中、未鎖定的 Grab 數。 */
  get grabCount(): number {
    let count = 0;
    for (const g of this.grabs.values()) if (!g.locked) count++;
    return count;
  }

  /** 目前作用中的 Pin（已鎖定 Grab）數。 */
  get pinCount(): number {
    let count = 0;
    for (const g of this.grabs.values()) if (g.locked) count++;
    return count;
  }

  /**
   * 某個 Grab／Pin 附著點目前的世界座標（隨網格變形移動），供算繪畫把手、或測試
   * 斷言收斂用。該 `id` 沒有作用中的約束時回傳 `null`。
   */
  attachPoint(id: PointerId): Point | null {
    const g = this.grabs.get(id);
    if (!g) return null;
    return this.weightedPoint(g);
  }

  /**
   * Picking：找出包含 `(x, y)` 的三角形，記重心座標當附著點，建立一條未鎖的
   * Grab。按下當下 目標點 = 附著點 → 誤差 0 → 不會一按就動（ADR-0003）。點落在
   * 所有三角形外時，退回 `radius` 內最近的 Particle（重心權重 `(1, 0, 0)`）。
   * 都沒有則 no-op。`pin` 事件借用它建點、再把 `locked` 翻成 true。
   */
  private doGrab(id: PointerId, x: number, y: number, radius: number): void {
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
        this.grabs.set(id, { tri: [a, b, c], w: [w0, w1, w2], target: { x, y }, locked: false });
        return;
      }
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
    if (best >= 0) {
      this.grabs.set(id, {
        tri: [best, best, best],
        w: [1, 0, 0],
        target: { x, y },
        locked: false,
      });
    }
  }

  private weightedPoint(g: Grab): Point {
    const [i0, i1, i2] = g.tri;
    const [w0, w1, w2] = g.w;
    return {
      x: w0 * this.pos[2 * i0]! + w1 * this.pos[2 * i1]! + w2 * this.pos[2 * i2]!,
      y: w0 * this.pos[2 * i0 + 1]! + w1 * this.pos[2 * i1 + 1]! + w2 * this.pos[2 * i2 + 1]!,
    };
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

    for (let s = 0; s < subs; s++) {
      // 1. 預測（無重力、無外力）——被抓 Particle 也照常積分。
      for (let i = 0; i < this.n; i++) {
        this.prev[2 * i] = this.pos[2 * i]!;
        this.prev[2 * i + 1] = this.pos[2 * i + 1]!;
        this.pos[2 * i] = this.pos[2 * i]! + this.vel[2 * i]! * h;
        this.pos[2 * i + 1] = this.pos[2 * i + 1]! + this.vel[2 * i + 1]! * h;
      }
      // 2. shape-matching 脊椎。
      this.solveShapeMatching(alphaSm);
      // 3. Grab 位置約束（在 shape matching 之後 → 把手直追目標、身體下一步跟上）。
      this.solveGrabs();
      // 4. 回推速度 + 全域阻尼。
      for (let i = 0; i < this.n; i++) {
        this.vel[2 * i] = ((this.pos[2 * i]! - this.prev[2 * i]!) / h) * keep;
        this.vel[2 * i + 1] = ((this.pos[2 * i + 1]! - this.prev[2 * i + 1]!) / h) * keep;
      }
    }
  }

  /**
   * 每 Region：目前質心 vs 靜止質心 → 最佳線性變換 `A_pq` → 2×2 polar
   * decomposition 取旋轉 `R` → 成員 goal `g = R·q + c`。Particle 最終 goal =
   * 所屬各 Region goal 的等權平均（藍本 jelly-core 即如此；設計文件寫「加權」但
   * 未定義權重，待實測有需要再加）。位置朝 goal 拉 `x += α_sm·(g − x)`。
   */
  private solveShapeMatching(alphaSm: number): void {
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

    for (let i = 0; i < this.n; i++) {
      const count = this.goalCount[i]!;
      if (count === 0) continue;
      this.pos[2 * i] = this.pos[2 * i]! + alphaSm * (this.goalX[i]! / count - this.pos[2 * i]!);
      this.pos[2 * i + 1] =
        this.pos[2 * i + 1]! + alphaSm * (this.goalY[i]! / count - this.pos[2 * i + 1]!);
    }
  }

  /**
   * 每條 Grab／Pin：附著點目前位置 `p = Σ wₖ·xₖ`，誤差 `e = β·(目標 − p)`，位置
   * 修正按權重分回三個 Particle `xₖ += wₖ·e / Σwⱼ²`（β = 1 時一步剛好命中）。
   * Pin（`locked`）β 恆為 1（絕對硬鎖，ADR-0004），Grab 用 `params.grabBeta`。
   * Multi-grab / 多 Pin = 依序解，天然共存。
   */
  private solveGrabs(): void {
    for (const g of this.grabs.values()) {
      const beta = g.locked ? 1 : this.params.grabBeta;
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

  /** `0.5 · Σ |vᵢ|²`（單位質量）。收斂看這個 → 0。 */
  kineticEnergy(): number {
    let ke = 0;
    for (let i = 0; i < this.vel.length; i++) ke += this.vel[i]! * this.vel[i]!;
    return 0.5 * ke;
  }
}
