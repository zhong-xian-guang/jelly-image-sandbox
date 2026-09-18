/**
 * Jelly 互撞演算法 prototype 的純邏輯模組（issue #94 / V3 T3-1；spec #87「跨塊碰撞」）。
 *
 * **拋棄式程式**——只在 `prototype/jelly-collision` 分支、由
 * `jelly-collision.prototype.html` 載入；不進 `src/`、不進 main。本檔無 DOM、無
 * 隨機，頁面只是它的薄殼。要回答的問題：spec 草擬的「PBD 式推出 + 切線摩擦」在真實
 * `buildSimMesh` 網格上穩不穩？同時放了兩個不過關時的候選（半平面、Particle 排斥）。
 *
 * 兩個部分：
 *  1. `SplitSimCore`：把 `SimCore.step()` 的單一 substep 拆成 `integrate(h)`（步驟 1–6）
 *     與 `finishSubstep(h)`（步驟 7），讓碰撞可以插在中間。正式版拆法留給 V3 T3-3；這裡
 *     直接透過 `as any` 碰 `SimCore` 的 private 欄位（TS private 只是編譯期），並複製
 *     `step()` 迴圈主體——**與 `src/sim/SimCore.ts` 的 step() 逐步對齊**，若 main 改了
 *     step() 這裡不會自動跟上。
 *  2. `resolveCollisions(jellies, params)`：就地改每塊的 `pos`／`prev`。
 */

import type { SimMesh } from '../src/mesh';
import { SimCore, type Bbox, type SimParams } from '../src/sim';

// ---- SplitSimCore ---------------------------------------------------------------

/** 一條輪廓邊：`a → b` 的方向 + 外法線正負號（由三角形第三點在 rest 時的相對位置決定）。 */
export interface ContourEdge {
  a: number;
  b: number;
  /** 外法線 = `nsign · perp(b − a)`，`perp(x, y) = (y, −x)`（右手垂直）。 */
  nsign: 1 | -1;
}

/** 由三角形索引推出「只屬於一個三角形的邊」= 輪廓邊。同 spec `SimCore` 拆段要公開的清單。 */
export function contourEdges(indices: Uint32Array, rest: Float64Array): ContourEdge[] {
  const count = new Map<string, { a: number; b: number; c: number }>();
  const dup = new Set<string>();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!] as const;
    for (let k = 0; k < 3; k++) {
      const a = tri[k]!;
      const b = tri[(k + 1) % 3]!;
      const c = tri[(k + 2) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (count.has(key)) dup.add(key);
      else count.set(key, { a, b, c });
    }
  }
  const edges: ContourEdge[] = [];
  for (const [key, e] of count) {
    if (dup.has(key)) continue;
    const ax = rest[2 * e.a]!;
    const ay = rest[2 * e.a + 1]!;
    const dx = rest[2 * e.b]! - ax;
    const dy = rest[2 * e.b + 1]! - ay;
    // perp = (dy, −dx)；第三點 c 在內側 → 外法線要指向 c 的反方向。
    const toC = (rest[2 * e.c]! - ax) * dy + (rest[2 * e.c + 1]! - ay) * -dx;
    edges.push({ a: e.a, b: e.b, nsign: toC > 0 ? -1 : 1 });
  }
  return edges;
}

/** 三角形 bbox 均勻網格粗篩（spec：「用 B 的三角形 bbox 網格粗篩」）。每 substep 在 `integrate` 後重建。 */
export class TriGrid {
  cell = 1;
  minX = 0;
  minY = 0;
  cols = 0;
  rows = 0;
  cells: number[][] = [];

  build(pos: Float64Array, tris: Uint32Array, bbox: Bbox, cell: number): void {
    this.cell = cell;
    this.minX = bbox.minX;
    this.minY = bbox.minY;
    this.cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / cell) + 1);
    this.rows = Math.max(1, Math.ceil((bbox.maxY - bbox.minY) / cell) + 1);
    const total = this.cols * this.rows;
    if (this.cells.length !== total) this.cells = Array.from({ length: total }, () => []);
    else for (const c of this.cells) c.length = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t]!;
      const b = tris[t + 1]!;
      const c = tris[t + 2]!;
      const ax = pos[2 * a]!;
      const bx = pos[2 * b]!;
      const cx = pos[2 * c]!;
      const ay = pos[2 * a + 1]!;
      const by = pos[2 * b + 1]!;
      const cy = pos[2 * c + 1]!;
      const x0 = this.col(ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx);
      const x1 = this.col(ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx);
      const y0 = this.row(ay < by ? (ay < cy ? ay : cy) : by < cy ? by : cy);
      const y1 = this.row(ay > by ? (ay > cy ? ay : cy) : by > cy ? by : cy);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) this.cells[y * this.cols + x]!.push(t);
    }
  }

  col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
  }
  row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)));
  }
  /** 含點 (x, y) 的 cell 內的三角形起始索引清單（點在 bbox 外時回空）。 */
  at(x: number, y: number): readonly number[] {
    if (x < this.minX || y < this.minY) return EMPTY;
    const cx = Math.floor((x - this.minX) / this.cell);
    const cy = Math.floor((y - this.minY) / this.cell);
    if (cx >= this.cols || cy >= this.rows) return EMPTY;
    return this.cells[cy * this.cols + cx]!;
  }
}
const EMPTY: readonly number[] = [];

/** Particle 均勻網格（候選 C：Particle 對 Particle 排斥用）。 */
export class PointGrid {
  cell = 1;
  minX = 0;
  minY = 0;
  cols = 0;
  rows = 0;
  cells: number[][] = [];

  build(pos: Float64Array, n: number, bbox: Bbox, cell: number): void {
    this.cell = cell;
    this.minX = bbox.minX;
    this.minY = bbox.minY;
    this.cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / cell) + 1);
    this.rows = Math.max(1, Math.ceil((bbox.maxY - bbox.minY) / cell) + 1);
    const total = this.cols * this.rows;
    if (this.cells.length !== total) this.cells = Array.from({ length: total }, () => []);
    else for (const c of this.cells) c.length = 0;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((pos[2 * i]! - this.minX) / cell);
      const cy = Math.floor((pos[2 * i + 1]! - this.minY) / cell);
      this.cells[cy * this.cols + cx]!.push(i);
    }
  }
  /** 走訪 (x, y) 周圍 3×3 cell 的 Particle。 */
  forNear(x: number, y: number, fn: (i: number) => void): void {
    const cx = Math.floor((x - this.minX) / this.cell);
    const cy = Math.floor((y - this.minY) / this.cell);
    for (let yy = cy - 1; yy <= cy + 1; yy++) {
      if (yy < 0 || yy >= this.rows) continue;
      for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (xx < 0 || xx >= this.cols) continue;
        for (const i of this.cells[yy * this.cols + xx]!) fn(i);
      }
    }
  }
}

/**
 * `SimCore` + 拆段的 substep + 碰撞需要的讀出。`id` 由頁面給（生成順序），
 * 碰撞塊對的迭代順序依 id 排序（決定性）。
 */
export class SplitSimCore extends SimCore {
  readonly contour: ContourEdge[];
  /** 輪廓上的 Particle 索引（去重）。`surfaceOnly` 時只有這些會被拿去對別塊測試。 */
  readonly surface: Uint32Array;
  /** 靜止時平均邊長——粗篩格大小、Particle 半徑、skin 都以它為單位。 */
  readonly avgEdge: number;
  readonly triGrid = new TriGrid();
  readonly pointGrid = new PointGrid();
  /** 這個 substep 的 bbox 快取（`integrate` 後由碰撞端 `refreshBounds` 更新）。 */
  bb: Bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  /** 本 substep 的質心位移（pos − prev 平均）快取 + 待套用到全體 `prev` 的平移（候選 C）。 */
  meanDx = 0;
  meanDy = 0;
  meanValid = false;
  shiftX = 0;
  shiftY = 0;
  triGridBuilt = false;
  pointGridBuilt = false;

  constructor(
    readonly id: number,
    mesh: SimMesh,
    params: Partial<SimParams> = {},
  ) {
    super(mesh, params);
    const rest = Float64Array.from(mesh.positions);
    this.contour = contourEdges(Uint32Array.from(mesh.indices), rest);
    this.surface = Uint32Array.from(new Set(this.contour.flatMap((e) => [e.a, e.b])));
    let sum = 0;
    let cnt = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.indices[t + k]!;
        const b = mesh.indices[t + ((k + 1) % 3)]!;
        sum += Math.hypot(rest[2 * a]! - rest[2 * b]!, rest[2 * a + 1]! - rest[2 * b + 1]!);
        cnt++;
      }
    }
    this.avgEdge = cnt ? sum / cnt : 1;
  }

  // private 欄位透過 any 讀（拋棄式）。
  private get s(): any {
    return this as any;
  }
  get count(): number {
    return this.s.n as number;
  }
  get prevPositions(): Float64Array {
    return this.s.prev as Float64Array;
  }
  get triangles(): Uint32Array {
    return this.s.tris as Uint32Array;
  }

  /** = `SimCore.step()` 的步驟 1–2（電風扇／重力烤進 vel → symplectic Euler 預測）。 */
  predict(h: number): void {
    const s = this.s;
    const n = this.count;
    const vel = s.vel as Float64Array;
    const pos = this.positions;
    const prev = this.prevPositions;
    const gravity = this.params.gravity;
    if (s.fan) s.applyFan(s.fan, h);
    if (gravity !== 0) {
      const dv = gravity * h;
      for (let i = 0; i < n; i++) vel[2 * i + 1] = vel[2 * i + 1]! + dv;
    }
    for (let i = 0; i < n; i++) {
      prev[2 * i] = pos[2 * i]!;
      prev[2 * i + 1] = pos[2 * i + 1]!;
      pos[2 * i] = pos[2 * i]! + vel[2 * i]! * h;
      pos[2 * i + 1] = pos[2 * i + 1]! + vel[2 * i + 1]! * h;
    }
    this.triGridBuilt = false;
    this.pointGridBuilt = false;
  }

  /** = `SimCore.step()` 的步驟 3–6（shape matching → XPBD → Grab/Pin → Boundary）。 */
  solveInternal(h: number): void {
    const s = this.s;
    const gravity = this.params.gravity;
    s.solveShapeMatching(this.params.alphaSm, gravity !== 0);
    if (this.params.xpbd) s.solveXpbd(h);
    s.solveConstraints();
    s.boundary.resolveBoundary(this.positions, this.prevPositions, this.count, h);
    this.triGridBuilt = false;
    this.pointGridBuilt = false;
  }

  /** = `SimCore.step()` 的步驟 1–6 = `predict` + `solveInternal`（spec 拆法）。 */
  integrate(h: number): void {
    this.predict(h);
    this.solveInternal(h);
  }

  /** = `SimCore.step()` 的步驟 7（回推速度 + 阻尼，含 issue #106 的側視拆法）。 */
  finishSubstep(h: number): void {
    const s = this.s;
    const n = this.count;
    const vel = s.vel as Float64Array;
    const pos = this.positions;
    const prev = this.prevPositions;
    const keep = 1 - this.params.damping;
    const keepAir = 1 - this.params.airDamping;
    if (this.params.gravity === 0) {
      for (let i = 0; i < n; i++) {
        vel[2 * i] = ((pos[2 * i]! - prev[2 * i]!) / h) * keep;
        vel[2 * i + 1] = ((pos[2 * i + 1]! - prev[2 * i + 1]!) / h) * keep;
      }
    } else {
      let sumX = 0;
      let sumY = 0;
      for (let i = 0; i < n; i++) {
        const vx = (pos[2 * i]! - prev[2 * i]!) / h;
        const vy = (pos[2 * i + 1]! - prev[2 * i + 1]!) / h;
        vel[2 * i] = vx;
        vel[2 * i + 1] = vy;
        sumX += vx;
        sumY += vy;
      }
      const meanX = sumX / n;
      const meanY = sumY / n;
      const airX = meanX * keepAir;
      const airY = meanY * keepAir;
      for (let i = 0; i < n; i++) {
        vel[2 * i] = airX + (vel[2 * i]! - meanX) * keep;
        vel[2 * i + 1] = airY + (vel[2 * i + 1]! - meanY) * keep;
      }
    }
  }

  refreshBounds(): void {
    this.bb = this.bbox();
    this.meanValid = false;
  }

  ensureMean(): void {
    if (this.meanValid) return;
    const pos = this.positions;
    const prev = this.prevPositions;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < this.count; i++) {
      sx += pos[2 * i]! - prev[2 * i]!;
      sy += pos[2 * i + 1]! - prev[2 * i + 1]!;
    }
    this.meanDx = sx / this.count;
    this.meanDy = sy / this.count;
    this.meanValid = true;
  }

  /** 把累積的整體 `prev` 平移一次套用（每 substep 碰撞結束時呼叫）。 */
  flushShift(): void {
    if (this.shiftX === 0 && this.shiftY === 0) return;
    const prev = this.prevPositions;
    for (let i = 0; i < this.count; i++) {
      prev[2 * i] = prev[2 * i]! + this.shiftX;
      prev[2 * i + 1] = prev[2 * i + 1]! + this.shiftY;
    }
    this.shiftX = 0;
    this.shiftY = 0;
  }

  /** 對外用：這塊哪些 Particle 現在落在別塊的三角形內（診斷「殘餘穿透」，只在畫面更新時算）。 */
  penetrating(others: readonly SplitSimCore[], out: number[]): void {
    for (const o of others) {
      if (o === this || !overlaps(this.bb, o.bb, 0)) continue;
      o.triGridBuilt = false; // 診斷用，不沿用碰撞那次（cell 可能不同）的網格。
      ensureTriGrid(o, o.avgEdge * 2);
      for (let i = 0; i < this.count; i++) {
        if (findContainingTri(o, this.positions[2 * i]!, this.positions[2 * i + 1]!) >= 0) out.push(i);
      }
    }
  }
}

// ---- 碰撞 -------------------------------------------------------------------------

export type Algorithm = 'pbd-tri' | 'pbd-contour' | 'halfplane' | 'particle';

export interface CollisionParams {
  /**
   * `pbd-tri`（spec 草案）：A 的 Particle 落在 B 三角形內（三角形 bbox 網格粗篩）→ 投影到 B 最近輪廓邊推出。
   * `pbd-contour`：同上，但內外判定改用 B 的**輪廓**射線法（even-odd），與最近邊查詢合併成同一趟
   *   迴圈——不需要每 substep 重建三角形網格（實測那是 10 塊時 75% 的碰撞成本）。
   * `halfplane`（候選 A）：不做三角形測試，A 的 Particle 對 B 最近輪廓邊的外法線做半平面約束。
   * `particle`（候選 B）：A、B 的 Particle 兩兩維持最小距離 `2 × particleRadius`。
   */
  algorithm: Algorithm;
  /** 每 substep 跑幾輪（spec 預設 1，Small Steps 靠多 substep 收斂）。 */
  rounds: number;
  /** 修正量分給被推出 Particle 的比例（spec 預設 0.5 = 對分；邊兩端點依重心權重分剩下的）。 */
  particleShare: number;
  /** 切線摩擦 0–1（沿用 A 包地板／牆常數 0.3）。以 Particle 對邊接觸點的**相對**切線速度衰減。 */
  friction: number;
  /** skin（單位 = 該塊平均邊長）：推到輪廓外側這麼遠而非剛好邊上；0 = spec 原案。 */
  skin: number;
  /** 三角形粗篩格大小（單位 = 平均邊長）。 */
  gridCell: number;
  /** 候選 B 的 Particle 半徑（單位 = 平均邊長）。 */
  particleRadius: number;
  /** 只拿 A 的輪廓 Particle 去測 B（內部 Particle 只有在表面已深陷時才可能進入別塊）。 */
  surfaceOnly: boolean;
  /** 摩擦形式：`velocity` = 切線速度衰減（spec 原案）；`coulomb` = 位置式靜／動摩擦。 */
  frictionMode: 'velocity' | 'coulomb';
  /** 實驗：`both` = A→B 與 B→A 都跑（spec）；`oneway` = 只跑 id 小 → id 大。 */
  passes: 'both' | 'oneway';
  /**
   * 碰撞在 substep 內的位置：`after` = 內部約束之後（spec 草案：integrate → 碰撞 → 回推）；
   * `before` = 預測之後、內部約束之前（碰撞 → shape matching／XPBD 收尾，substep 結尾
   * 身體完整、可能殘留穿透）；`both` = 前後各一次。
   */
  order: 'after' | 'before' | 'both';
  /** 推出方向：`winding` = 靜止繞向算的邊外法線；`toward-surface` = 朝最近表面點的方向（翻面時仍正確）。 */
  normalMode: 'winding' | 'toward-surface';
  /**
   * 候選 C「整體衝量」：一個 substep 內某塊對有接觸時，沿接觸平均法線把兩塊**質心**的
   * 趨近速度扣掉這個比例（0 = 關；1 = 一次完全非彈性）。對全體 Particle 平移 `prev`
   * 實作，動量守恆（依 Particle 數配重）、只扣趨近、不拉回。位置推出照舊。
   */
  impactAbsorb: number;
}

/**
 * 頁面預設 = 本 prototype 實測後的**推薦組合**（見 issue #87 留言）。spec 原案是
 * `algorithm: 'pbd-tri'`、`frictionMode: 'velocity'`、`normalMode: 'winding'`、`impactAbsorb: 0`。
 */
export const DEFAULT_COLLISION: CollisionParams = {
  algorithm: 'pbd-contour',
  rounds: 1,
  particleShare: 0.5,
  friction: 0.3,
  skin: 0,
  gridCell: 2,
  particleRadius: 0.5,
  surfaceOnly: true,
  frictionMode: 'coulomb',
  passes: 'both',
  order: 'after',
  normalMode: 'toward-surface',
  impactAbsorb: 0.75,
};

export interface CollisionStats {
  /** bbox 相交的有序塊對數。 */
  pairs: number;
  /** 做了三角形／邊測試的 Particle 數。 */
  tests: number;
  /** 實際被推出的接觸數。 */
  contacts: number;
  /** 本次呼叫耗時（ms，含粗篩重建）。 */
  ms: number;
  /** 診斷：套在 A 的修正向量的 |x|、|y| 總和（看側向漏力）。 */
  corrX: number;
  corrY: number;
  /** 診斷：單一接觸最大推出深度。 */
  maxDepth: number;
  /** 診斷：耗時拆解（ms）——bbox 重算、粗篩重建、塊對 pass。 */
  tBounds: number;
  tGrid: number;
  tPairs: number;
}

function overlaps(a: Bbox, b: Bbox, pad: number): boolean {
  return (
    a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY
  );
}

let T_GRID = 0;
function ensureTriGrid(b: SplitSimCore, cell: number): void {
  if (b.triGridBuilt) return;
  const t0 = performance.now();
  b.triGrid.build(b.positions, b.triangles, b.bb, cell);
  b.triGridBuilt = true;
  T_GRID += performance.now() - t0;
}

/** 回傳含點的三角形起始索引，沒有回 −1。 */
function findContainingTri(b: SplitSimCore, x: number, y: number): number {
  const pos = b.positions;
  const tris = b.triangles;
  for (const t of b.triGrid.at(x, y)) {
    const a = tris[t]!;
    const bb = tris[t + 1]!;
    const c = tris[t + 2]!;
    const ax = pos[2 * a]!;
    const ay = pos[2 * a + 1]!;
    const bx = pos[2 * bb]!;
    const by = pos[2 * bb + 1]!;
    const cx = pos[2 * c]!;
    const cy = pos[2 * c + 1]!;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
    const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
    const w2 = 1 - w0 - w1;
    if (w0 >= 0 && w1 >= 0 && w2 >= 0) return t;
  }
  return -1;
}

/** 最近輪廓邊查詢結果（重用同一物件，免配置）。 */
interface Nearest {
  edge: number;
  /** 投影點在邊上的參數 t ∈ [0, 1]。 */
  t: number;
  qx: number;
  qy: number;
  /** 外法線（單位向量）。 */
  nx: number;
  ny: number;
  dist: number;
}
const NEAREST: Nearest = { edge: -1, t: 0, qx: 0, qy: 0, nx: 0, ny: 0, dist: Infinity };

/**
 * 同 `nearestContourEdge`，同一趟迴圈順便做 even-odd 射線法（往 +x 射）判定 (x, y) 在不在
 * 輪廓多邊形內。回傳 inside；最近邊結果在 `NEAREST`。
 */
function nearestContourEdgeAndInside(b: SplitSimCore, x: number, y: number): boolean {
  const pos = b.positions;
  const out = NEAREST;
  out.dist = Infinity;
  out.edge = -1;
  let inside = false;
  const es = b.contour;
  for (let k = 0; k < es.length; k++) {
    const e = es[k]!;
    const ax = pos[2 * e.a]!;
    const ay = pos[2 * e.a + 1]!;
    const bx = pos[2 * e.b]!;
    const by = pos[2 * e.b + 1]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (d < out.dist) {
      out.dist = d;
      out.edge = k;
      out.t = t;
      out.qx = qx;
      out.qy = qy;
      const len = Math.sqrt(len2) || 1;
      out.nx = (e.nsign * dy) / len;
      out.ny = (e.nsign * -dx) / len;
    }
  }
  out.dist = Math.sqrt(out.dist);
  return inside;
}

/** 暴力掃 B 的所有輪廓邊找離 (x, y) 最近的一條（輪廓 ~ 60–120 條，只對命中粗篩的 Particle 做）。 */
function nearestContourEdge(b: SplitSimCore, x: number, y: number): Nearest {
  const pos = b.positions;
  const out = NEAREST;
  out.dist = Infinity;
  out.edge = -1;
  const es = b.contour;
  for (let k = 0; k < es.length; k++) {
    const e = es[k]!;
    const ax = pos[2 * e.a]!;
    const ay = pos[2 * e.a + 1]!;
    const dx = pos[2 * e.b]! - ax;
    const dy = pos[2 * e.b + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (d < out.dist) {
      out.dist = d;
      out.edge = k;
      out.t = t;
      out.qx = qx;
      out.qy = qy;
      const len = Math.sqrt(len2) || 1;
      out.nx = (e.nsign * dy) / len;
      out.ny = (e.nsign * -dx) / len;
    }
  }
  out.dist = Math.sqrt(out.dist);
  return out;
}

/**
 * 把 A 的 Particle `i` 沿 B 邊 `near` 的外法線推出 `depth`（> 0）。PBD 權重：Particle 權重
 * `share`、邊兩端點各 `(1 − share)(1 − t)`、`(1 − share) t`；分母 `share + (1 − share)((1 − t)² + t²)`
 * 讓推完後 Particle 到邊的距離**剛好**是 `depth`（單純「一半一半」會留 25% 穿透）。
 * 之後做切線摩擦：`velocity` = 相對切線速度乘 `(1 − f)`（spec 原案、A 包公式）；
 * `coulomb` = 直接抵銷這個 substep 的相對切線**位移**，上限 `μ × depth`（靜摩擦，
 * Macklin 2019 小步長 PBD 摩擦）。
 */
function pushOut(
  a: SplitSimCore,
  i: number,
  b: SplitSimCore,
  near: Nearest,
  depth: number,
  p: CollisionParams,
  stats: CollisionStats,
): void {
  stats.corrX += Math.abs(near.nx * depth);
  stats.corrY += Math.abs(near.ny * depth);
  if (depth > stats.maxDepth) stats.maxDepth = depth;
  PASS.nx += near.nx * depth;
  PASS.ny += near.ny * depth;
  PASS.count++;
  const e = b.contour[near.edge]!;
  const share = p.particleShare;
  const t = near.t;
  const wp = share;
  const wa = (1 - share) * (1 - t);
  const wb = (1 - share) * t;
  const denom = wp + wa * (1 - t) + wb * t;
  const s = depth / denom;
  const nx = near.nx;
  const ny = near.ny;
  const ap = a.positions;
  const bp = b.positions;
  ap[2 * i] = ap[2 * i]! + nx * s * wp;
  ap[2 * i + 1] = ap[2 * i + 1]! + ny * s * wp;
  bp[2 * e.a] = bp[2 * e.a]! - nx * s * wa;
  bp[2 * e.a + 1] = bp[2 * e.a + 1]! - ny * s * wa;
  bp[2 * e.b] = bp[2 * e.b]! - nx * s * wb;
  bp[2 * e.b + 1] = bp[2 * e.b + 1]! - ny * s * wb;

  if (p.friction <= 0) return;
  // 切線 = 法線轉 90°。相對切線位移（= 相對速度 × h）= A 點 − 邊上接觸點（端點依 t 內插）。
  const tx = -ny;
  const ty = nx;
  const apr = a.prevPositions;
  const bpr = b.prevPositions;
  const relAx = ap[2 * i]! - apr[2 * i]!;
  const relAy = ap[2 * i + 1]! - apr[2 * i + 1]!;
  const relBx = (bp[2 * e.a]! - bpr[2 * e.a]!) * (1 - t) + (bp[2 * e.b]! - bpr[2 * e.b]!) * t;
  const relBy =
    (bp[2 * e.a + 1]! - bpr[2 * e.a + 1]!) * (1 - t) + (bp[2 * e.b + 1]! - bpr[2 * e.b + 1]!) * t;
  const rel = (relAx - relBx) * tx + (relAy - relBy) * ty;
  if (p.frictionMode === 'velocity') {
    // 把 A 的 prev 往 pos 靠（減少切線位移）、B 端點反向——各自吃掉一部分相對切線速度。
    const k = (rel * p.friction) / denom;
    apr[2 * i] = apr[2 * i]! + tx * k * wp;
    apr[2 * i + 1] = apr[2 * i + 1]! + ty * k * wp;
    bpr[2 * e.a] = bpr[2 * e.a]! - tx * k * wa;
    bpr[2 * e.a + 1] = bpr[2 * e.a + 1]! - ty * k * wa;
    bpr[2 * e.b] = bpr[2 * e.b]! - tx * k * wb;
    bpr[2 * e.b + 1] = bpr[2 * e.b + 1]! - ty * k * wb;
  } else {
    // Coulomb：抵銷相對切線位移本身（改 pos），最多 μ·depth；超過就是動摩擦（只抵銷 μ·depth）。
    const mag = Math.abs(rel);
    if (mag === 0) return;
    const cap = p.friction * depth;
    const corr = Math.min(mag, cap) * Math.sign(rel);
    const k = corr / denom;
    ap[2 * i] = ap[2 * i]! - tx * k * wp;
    ap[2 * i + 1] = ap[2 * i + 1]! - ty * k * wp;
    bp[2 * e.a] = bp[2 * e.a]! + tx * k * wa;
    bp[2 * e.a + 1] = bp[2 * e.a + 1]! + ty * k * wa;
    bp[2 * e.b] = bp[2 * e.b]! + tx * k * wb;
    bp[2 * e.b + 1] = bp[2 * e.b + 1]! + ty * k * wb;
  }
}

/** 這次 pass 累積的接觸法線（A 視角，長度 = Σ depth）與接觸數，給整體衝量用。 */
const PASS = { nx: 0, ny: 0, count: 0 };

/**
 * 候選 C：塊對 (A, B) 沿接觸平均法線 `n`（指向 A 外側＝把 A 推離 B）做一次整體非彈性衝量。
 * 質心速度以 `pos − prev` 表示；趨近速度 `s = (vB − vA)·n`（> 0 才處理）。A 全體
 * `prev -= n·Δ_A`（速度 +Δ_A/h 沿 n）、B 全體 `prev += n·Δ_B`，`Δ_A·N_A = Δ_B·N_B`。
 */
function absorbImpact(a: SplitSimCore, b: SplitSimCore, absorb: number): void {
  const len = Math.hypot(PASS.nx, PASS.ny);
  if (len === 0 || absorb <= 0) return;
  const nx = PASS.nx / len;
  const ny = PASS.ny / len;
  a.ensureMean();
  b.ensureMean();
  // n 指向 A 外側（B 朝 A 推的方向）；A 往 −n 走、B 往 +n 走就是互相趨近。
  const approach = (b.meanDx - a.meanDx) * nx + (b.meanDy - a.meanDy) * ny;
  if (approach <= 0) return;
  const total = approach * absorb;
  const na = a.count;
  const nb = b.count;
  const dA = (total * nb) / (na + nb);
  const dB = (total * na) / (na + nb);
  // 平移 prev 延後到 flushShift 一次套用；快取的質心位移立即更新（之後的塊對看得到）。
  a.shiftX -= nx * dA;
  a.shiftY -= ny * dA;
  a.meanDx += nx * dA;
  a.meanDy += ny * dA;
  b.shiftX += nx * dB;
  b.shiftY += ny * dB;
  b.meanDx -= nx * dB;
  b.meanDy -= ny * dB;
}

/** 有序塊對 (A, B)：A 的 Particle 對 B。tests／contacts 累加進 `stats`。 */
function solvePairEdges(
  a: SplitSimCore,
  b: SplitSimCore,
  p: CollisionParams,
  stats: CollisionStats,
): void {
  const skin = p.skin * b.avgEdge;
  const pad = skin;
  const bb = b.bb;
  const ap = a.positions;
  const useTri = p.algorithm === 'pbd-tri';
  const useContour = p.algorithm === 'pbd-contour';
  if (useTri) ensureTriGrid(b, p.gridCell * b.avgEdge);
  const list = p.surfaceOnly ? a.surface : null;
  const total = list ? list.length : a.count;
  for (let k = 0; k < total; k++) {
    const i = list ? list[k]! : k;
    const x = ap[2 * i]!;
    const y = ap[2 * i + 1]!;
    if (x < bb.minX - pad || x > bb.maxX + pad || y < bb.minY - pad || y > bb.maxY + pad) continue;
    stats.tests++;
    if (useTri || useContour) {
      let inside: boolean;
      let near: Nearest;
      if (useContour) {
        inside = nearestContourEdgeAndInside(b, x, y);
        near = NEAREST;
      } else {
        inside = findContainingTri(b, x, y) >= 0;
        // 在裡面 → 推到最近邊外 skin 處；不在裡面但有 skin → 離最近邊不到 skin 也推。
        if (!inside && skin <= 0) continue;
        near = nearestContourEdge(b, x, y);
      }
      if (near.edge < 0) continue;
      const signed = inside ? -near.dist : near.dist;
      if (signed >= skin) continue;
      if (p.normalMode === 'toward-surface' && near.dist > 1e-9) {
        // 在裡面 → 朝 Q 推（Q − P）；在外面 skin 內 → 背向 Q（P − Q）。不信任繞向法線。
        const sgn = inside ? 1 : -1;
        near.nx = (sgn * (near.qx - x)) / near.dist;
        near.ny = (sgn * (near.qy - y)) / near.dist;
      }
      pushOut(a, i, b, near, skin - signed, p, stats);
      stats.contacts++;
    } else {
      // halfplane：只信最近邊的外法線，正負由 (P − Q)·n 決定。
      const near = nearestContourEdge(b, x, y);
      if (near.edge < 0) continue;
      const signed = (x - near.qx) * near.nx + (y - near.qy) * near.ny;
      if (signed >= skin) continue;
      pushOut(a, i, b, near, skin - signed, p, stats);
      stats.contacts++;
    }
  }
}

/** 候選 B：Particle 對 Particle 最小距離（對稱，一次處理無序塊對）。 */
function solvePairParticles(
  a: SplitSimCore,
  b: SplitSimCore,
  p: CollisionParams,
  stats: CollisionStats,
): void {
  const ra = p.particleRadius * a.avgEdge;
  const rb = p.particleRadius * b.avgEdge;
  const minD = ra + rb;
  if (!b.pointGridBuilt) {
    b.pointGrid.build(b.positions, b.count, b.bb, Math.max(minD, 1));
    b.pointGridBuilt = true;
  }
  const ap = a.positions;
  const bp = b.positions;
  const apr = a.prevPositions;
  const bpr = b.prevPositions;
  const bb = b.bb;
  for (let i = 0; i < a.count; i++) {
    const x = ap[2 * i]!;
    const y = ap[2 * i + 1]!;
    if (x < bb.minX - minD || x > bb.maxX + minD || y < bb.minY - minD || y > bb.maxY + minD)
      continue;
    stats.tests++;
    b.pointGrid.forNear(x, y, (j) => {
      const dx = ap[2 * i]! - bp[2 * j]!;
      const dy = ap[2 * i + 1]! - bp[2 * j + 1]!;
      const d = Math.hypot(dx, dy);
      if (d >= minD || d === 0) return;
      const nx = dx / d;
      const ny = dy / d;
      const depth = (minD - d) * 0.5;
      ap[2 * i] = ap[2 * i]! + nx * depth;
      ap[2 * i + 1] = ap[2 * i + 1]! + ny * depth;
      bp[2 * j] = bp[2 * j]! - nx * depth;
      bp[2 * j + 1] = bp[2 * j + 1]! - ny * depth;
      stats.contacts++;
      if (p.friction <= 0) return;
      const tx = -ny;
      const ty = nx;
      const rel =
        (ap[2 * i]! - apr[2 * i]! - (bp[2 * j]! - bpr[2 * j]!)) * tx +
        (ap[2 * i + 1]! - apr[2 * i + 1]! - (bp[2 * j + 1]! - bpr[2 * j + 1]!)) * ty;
      const s = rel * p.friction * 0.5;
      apr[2 * i] = apr[2 * i]! + tx * s;
      apr[2 * i + 1] = apr[2 * i + 1]! + ty * s;
      bpr[2 * j] = bpr[2 * j]! - tx * s;
      bpr[2 * j + 1] = bpr[2 * j + 1]! - ty * s;
    });
  }
}

/**
 * 一個 substep 的跨塊碰撞。呼叫前每塊都已 `integrate(h)`；本函式就地改 `pos`／`prev`。
 * 塊對依 id 排序後的順序走訪（決定性）；`pbd-tri`／`halfplane` 對每個 bbox 相交的
 * **有序**塊對各跑一次（A→B、B→A），`particle` 對每個無序塊對跑一次。
 */
export function resolveCollisions(
  jellies: readonly SplitSimCore[],
  p: CollisionParams,
): CollisionStats {
  const t0 = performance.now();
  const stats: CollisionStats = { pairs: 0, tests: 0, contacts: 0, ms: 0, corrX: 0, corrY: 0, maxDepth: 0, tBounds: 0, tGrid: 0, tPairs: 0 };
  const sorted = [...jellies].sort((x, y) => x.id - y.id); // 依 id 走訪（決定性），不信任呼叫端順序。
  for (const b of sorted) {
    b.refreshBounds();
    b.triGridBuilt = false;
    b.pointGridBuilt = false;
  }
  stats.tBounds += performance.now() - t0;
  T_GRID = 0;
  const pad = p.algorithm === 'particle' ? p.particleRadius * 2 : p.skin;
  for (let r = 0; r < Math.max(1, p.rounds); r++) {
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const a = sorted[i]!;
        const b = sorted[j]!;
        if ((p.algorithm === 'particle' || p.passes === 'oneway') && j < i) continue;
        if (!overlaps(a.bb, b.bb, pad * Math.max(a.avgEdge, b.avgEdge))) continue;
        stats.pairs++;
        if (p.algorithm === 'particle') solvePairParticles(a, b, p, stats);
        else {
          PASS.nx = 0;
          PASS.ny = 0;
          PASS.count = 0;
          solvePairEdges(a, b, p, stats);
          // 整體衝量每個**無序**塊對只做一次（否則 A→B、B→A 各吸一次，實效 1 − (1 − k)²）。
          if (PASS.count > 0 && (p.passes === 'oneway' || j > i)) absorbImpact(a, b, p.impactAbsorb);
        }
      }
    }
    for (const b of sorted) b.flushShift();
    // 多輪時位置已變，第二輪重建粗篩與 bbox。
    if (r + 1 < p.rounds) {
      for (const b of sorted) {
        b.refreshBounds();
        b.triGridBuilt = false;
        b.pointGridBuilt = false;
      }
    }
  }
  stats.ms = performance.now() - t0;
  stats.tGrid = T_GRID;
  stats.tPairs = stats.ms - stats.tBounds - stats.tGrid;
  return stats;
}

/**
 * 整個 World 一幀：切 substep；每個 substep 對每塊 `integrate` → 一次跨塊碰撞 → 每塊
 * `finishSubstep`（spec `World.step` 的形狀）。回傳這幀碰撞統計的加總。
 */
export function stepWorld(
  jellies: readonly SplitSimCore[],
  dt: number,
  substeps: number,
  p: CollisionParams,
  enabled: boolean,
): CollisionStats {
  const total: CollisionStats = { pairs: 0, tests: 0, contacts: 0, ms: 0, corrX: 0, corrY: 0, maxDepth: 0, tBounds: 0, tGrid: 0, tPairs: 0 };
  if (!(dt > 0) || jellies.length === 0) return total;
  const subs = Math.max(1, Math.floor(substeps));
  const h = dt / subs;
  const collide = () => {
    if (enabled && jellies.length > 1) {
      const st = resolveCollisions(jellies, p);
      total.pairs += st.pairs;
      total.tests += st.tests;
      total.contacts += st.contacts;
      total.ms += st.ms;
      total.corrX += st.corrX;
      total.corrY += st.corrY;
      if (st.maxDepth > total.maxDepth) total.maxDepth = st.maxDepth;
      total.tBounds += st.tBounds;
      total.tGrid += st.tGrid;
      total.tPairs += st.tPairs;
    } else {
      for (const b of jellies) b.refreshBounds();
    }
  };
  for (let s = 0; s < subs; s++) {
    for (const b of jellies) b.predict(h);
    if (p.order !== 'after') collide();
    for (const b of jellies) b.solveInternal(h);
    if (p.order !== 'before') collide();
    for (const b of jellies) b.finishSubstep(h);
  }
  return total;
}
