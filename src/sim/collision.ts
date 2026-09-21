/**
 * 跨塊碰撞（issue #96 / V3 T3-3；spec #87「跨塊碰撞」；演算法依 issue #94 prototype
 * 定案，primary source 為分支 `prototype/jelly-collision` 的
 * `prototypes/jelly-collision.core.prototype.ts` 與 #87 留言）。
 *
 * 就地改各塊的 `positions`／`prevPositions`，除此之外沒有隱藏輸入或輸出：無 DOM、無隨機、
 * 無時鐘，同輸入同輸出（ADR-0005）。模組層級的 `CONTACTS`／`NEAREST`／`PASS`／`IMPACT` 只是
 * 免配置的暫存，每次呼叫從頭重設（單執行緒、不可重入）。`World.step` 在每個 substep 對
 * 每塊 `solveInternal` 之後、`finishSubstep` 之前呼叫一次；走訪順序 = 呼叫端給的陣列順序
 * （`World` 依 id 排序）。
 *
 * 每個 bbox 相交的無序塊對 (A, B) 分三段：
 *  1. **偵測**（A → B、B → A 各一趟，只記錄不動位置）：A 的每個**輪廓** Particle（內部
 *     Particle 只在表面已深陷時才可能進別塊，不測）若落在 B 的輪廓多邊形內（even-odd
 *     射線法，與最近輪廓邊查詢併成同一趟迴圈——不需要每 substep 重建三角形 bbox 網格，
 *     prototype 實測那是 10 塊時 75% 的碰撞成本），記下「哪顆、B 的哪條邊、朝最近表面點
 *     的方向」，並把方向 × 深度累加成這對的接觸平均法線（A 視角）。
 *  2. **整體非彈性衝量**（每無序塊對一次）：有接觸時，沿接觸平均法線算兩塊**質心**的
 *     趨近速度（以 `pos − prev` 表示），把它的 `impactAbsorb` 比例當作剛體式的位置分離
 *     ——A 全體 `pos` 沿法線退 `Δ_A`、B 退 `Δ_B`（依 Particle 數配重、動量守恆、只扣趨近
 *     不拉回）。**在表面推出之前**做：柔體的動量靠 shape matching 擴散太慢，高速撞擊時
 *     這個 substep 的穿透量若全靠表層變形吃掉，表層三角形會被壓到零厚度甚至翻面
 *     （撞速 ≈ 每 substep 一個網格邊長就會發生；#94 prototype 的「推出後平移 `prev`」
 *     版本在降級到 2 substep 時 10 塊堆疊會坍成一團）；先剛體式退開，表層只剩殘餘要
 *     處理。速度變化跟平移 `prev` 的版本一樣（`v = (pos − prev) / h`），差在位置也真的
 *     分開了。靜置級的微小趨近（`< separationThreshold × 輪廓邊長`）仍走平移 `prev`、
 *     且排在推出**之後**（#94 prototype 的順序）——位置分離在疊放靜置時會讓底塊每
 *     substep 被推進地板一點點再彈回，微震不停；先平移 `prev` 再推出也停不下來。
 *     趨近 ≤ 0 → 這段不做。
 *  3. **推出**：對每筆接觸重算目前深度（分離或前面的推出後可能已在外面 → 跳過），沿
 *     「朝最近表面點」的方向推到輪廓邊上（不信任靜止繞向算的外法線：表層翻面時它會
 *     反向）。撞擊級沿偵測時記下的邊與方向、靜置級重跑最近邊查詢（理由見 `applyContacts`）。
 *     修正量依 PBD 權重分：Particle `share`、邊兩端點 `(1 − share)(1 − t)`／
 *     `(1 − share) t`，分母 `share + (1 − share)((1 − t)² + t²)` 讓推完後 Particle 剛好在
 *     邊上（字面的「一半一半」會留 25% 穿透）。接著 **Coulomb 位置式摩擦**：直接抵銷這個
 *     substep A 點與邊上接觸點的**相對**切線位移，上限 `μ × depth`（Macklin 2019 小步長
 *     PBD 摩擦）——有靜摩擦，疊放不滑落；spec 原案的「切線速度衰減」砍不掉已發生的橫向
 *     位移。接觸依偵測順序逐筆套用（Gauss–Seidel，後面的看得到前面的修正）。
 *
 * 一個 substep 一輪；Small Steps 靠多 substep 收斂。skin = 0：只推「在裡面」的
 * Particle。沒有自碰撞。
 */

import type { ContourEdge } from './contour';
import type { Bbox } from './types';

/** 碰撞需要讀寫的一塊。`SimCore` 結構上就滿足它（`World` 直接把各塊的 core 傳進來）。 */
export interface CollisionBody {
  /** 目前位置 `[x0, y0, ...]`，就地修改。 */
  readonly positions: Float64Array;
  /** 上一個 substep 的位置（回推速度用），就地修改（摩擦、整體衝量）。 */
  readonly prevPositions: Float64Array;
  readonly particleCount: number;
  /** 輪廓邊（`SimCore.contour`）。 */
  readonly contour: readonly ContourEdge[];
  /** 輪廓 Particle 索引（`SimCore.surfaceParticles`）。 */
  readonly surfaceParticles: Uint32Array;
}

export interface CollisionParams {
  /**
   * Coulomb 摩擦係數 `μ`（0–1）：一次接觸最多抵銷 `μ × depth` 的相對切線位移。沙盒傳
   * app 層常數 `BOUNDARY_FRICTION`（與牆／地板同值，issue #93）；`0` = 無摩擦。
   */
  friction: number;
  /**
   * 整體非彈性衝量比例（0–1）：每個有接觸的無序塊對，沿接觸平均法線扣掉兩塊質心趨近
   * 速度的這個比例（以剛體式位置分離實現，見檔頭第 2 段）。`0` = 關；`1` = 一次完全
   * 非彈性。
   */
  impactAbsorb: number;
  /** 推出修正量分給被推 Particle 的 PBD 權重（0–1）；其餘依重心權重分給邊兩端點。 */
  particleShare: number;
  /**
   * 整體衝量改用「位置分離」的門檻，單位 = 這對塊中較細那塊的輪廓平均邊長：一次要扣的
   * 趨近位移 ≥ 門檻 × 邊長（撞擊級）→ 平移全體 `pos`（位置真的退開，表層不會被壓翻）；
   * 小於門檻（靜置級，疊放時每 substep 只有 `g·h²` 那麼一點）→ 平移全體 `prev`（只改速度，
   * #94 prototype 原案）。靜置時若也平移位置，會把底塊每 substep 往地板推一小段、地板再
   * 彈回，變成不會停的微震（實測 KE 停在 ~4e3 而非 0）。
   */
  separationThreshold: number;
}

/**
 * issue #94 prototype 四情境實測定案的組合（見 `docs/design/simulation-and-mesh.md` 參數表）。
 * `friction` 與 app 層 `BOUNDARY_FRICTION` 同值——`sim` 不能反向依賴 `app`，沙盒建 `World`
 * 時明確傳入該常數，這裡的預設只給測試與獨立使用；兩邊改值要同步。
 */
export const DEFAULT_COLLISION_PARAMS: CollisionParams = {
  friction: 0.3,
  impactAbsorb: 0.75,
  particleShare: 0.5,
  separationThreshold: 0.1,
};

/** `resolveCollisions` 的統計讀出（診斷／測試用；不影響模擬）。 */
export interface CollisionStats {
  /** bbox 相交的無序塊對數。 */
  pairs: number;
  /** 實際被推出的接觸數（兩段 pass 合計）。 */
  contacts: number;
  /** 單一接觸最大推出深度。 */
  maxDepth: number;
}

/** 每塊在一次呼叫內的暫存：bbox、質心位移（`pos − prev` 平均）快取、輪廓平均邊長快取。 */
interface Scratch {
  bb: Bbox;
  meanDx: number;
  meanDy: number;
  meanValid: boolean;
  /** 目前位置下的輪廓平均邊長；`< 0` = 尚未算。 */
  edgeLen: number;
}

/**
 * 這對塊在偵測段記下的接觸（模組層級可增長的平行陣列，重用免配置；單執行緒）：
 * `side` 0 = A 的 Particle 在 B 裡、1 = B 的在 A 裡；`i` Particle 索引；`edge` 對方
 * 輪廓邊索引；`nx/ny` 偵測當下朝最近表面點的單位方向；`depth` 偵測當下的深度
 * （撞擊級推出沿記下的邊、摩擦上限用記下的深度；靜置級重查）。
 */
const CONTACTS = {
  count: 0,
  side: new Int8Array(256),
  i: new Int32Array(256),
  edge: new Int32Array(256),
  nx: new Float64Array(256),
  ny: new Float64Array(256),
  depth: new Float64Array(256),
};

function pushContact(side: number, i: number, near: Nearest): void {
  const c = CONTACTS;
  if (c.count === c.side.length) {
    const n = c.side.length * 2;
    c.side = copyInto(c.side, new Int8Array(n));
    c.i = copyInto(c.i, new Int32Array(n));
    c.edge = copyInto(c.edge, new Int32Array(n));
    c.nx = copyInto(c.nx, new Float64Array(n));
    c.ny = copyInto(c.ny, new Float64Array(n));
    c.depth = copyInto(c.depth, new Float64Array(n));
  }
  c.side[c.count] = side;
  c.i[c.count] = i;
  c.edge[c.count] = near.edge;
  c.nx[c.count] = near.nx;
  c.ny[c.count] = near.ny;
  c.depth[c.count] = near.dist;
  c.count++;
}

function copyInto<T extends Int8Array | Int32Array | Float64Array>(from: T, to: T): T {
  to.set(from as never);
  return to;
}

/** 最近輪廓邊查詢結果（模組層級重用，免配置；單執行緒）。 */
interface Nearest {
  edge: number;
  /** 投影點在邊上的參數 t ∈ [0, 1]。 */
  t: number;
  qx: number;
  qy: number;
  /** 推出方向（單位向量，指向 A 外側 = 把 A 的 Particle 推離 B 的方向）。 */
  nx: number;
  ny: number;
  dist: number;
}
const NEAREST: Nearest = { edge: -1, t: 0, qx: 0, qy: 0, nx: 0, ny: 0, dist: Infinity };

/** 這段 pass 累積的接觸法線（A 視角、長度 = Σ depth），給整體衝量用。 */
const PASS = { nx: 0, ny: 0, count: 0 };

/** `projectToEdge` 的結果（模組層級重用）：投影參數 `t`、最近點 `q`、距離平方 `d2`。 */
const PROJ = { t: 0, qx: 0, qy: 0, d2: 0 };

/** 點 (x, y) 投影到輪廓邊 `e`（端點取自 `pos`）的線段上，結果放 `PROJ`。 */
function projectToEdge(pos: Float64Array, e: ContourEdge, x: number, y: number): void {
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
  PROJ.t = t;
  PROJ.qx = qx;
  PROJ.qy = qy;
  PROJ.d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
}

function bounds(b: CollisionBody): Bbox {
  const pos = b.positions;
  const out: Bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < b.particleCount; i++) {
    const x = pos[2 * i]!;
    const y = pos[2 * i + 1]!;
    if (x < out.minX) out.minX = x;
    if (x > out.maxX) out.maxX = x;
    if (y < out.minY) out.minY = y;
    if (y > out.maxY) out.maxY = y;
  }
  return out;
}

function overlaps(a: Bbox, b: Bbox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * 同一趟走 B 的所有輪廓邊：even-odd 射線法（往 +x 射）判定 (x, y) 在不在輪廓多邊形內，
 * 順便找最近邊（結果在 `NEAREST`，法線先填靜止繞向的外法線）。回傳 inside。
 */
function nearestContourEdgeAndInside(b: CollisionBody, x: number, y: number): boolean {
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
    projectToEdge(pos, e, x, y);
    if (PROJ.d2 < out.dist) {
      out.dist = PROJ.d2;
      out.edge = k;
      out.t = PROJ.t;
      out.qx = PROJ.qx;
      out.qy = PROJ.qy;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      out.nx = (e.nsign * dy) / len;
      out.ny = (e.nsign * -dx) / len;
    }
  }
  out.dist = Math.sqrt(out.dist);
  return inside;
}

/**
 * 沿方向 `(dx, dy)` 把量 `k` 依 PBD 權重分掉：A 的 Particle `i` 走 `+k·wp`、B 邊 `e` 的
 * 兩端點各走 `−k·wa`／`−k·wb`。推出與摩擦都用這一式。
 */
function applyWeighted(
  ap: Float64Array,
  i: number,
  bp: Float64Array,
  e: ContourEdge,
  dx: number,
  dy: number,
  k: number,
  wp: number,
  wa: number,
  wb: number,
): void {
  ap[2 * i] = ap[2 * i]! + dx * k * wp;
  ap[2 * i + 1] = ap[2 * i + 1]! + dy * k * wp;
  bp[2 * e.a] = bp[2 * e.a]! - dx * k * wa;
  bp[2 * e.a + 1] = bp[2 * e.a + 1]! - dy * k * wa;
  bp[2 * e.b] = bp[2 * e.b]! - dx * k * wb;
  bp[2 * e.b + 1] = bp[2 * e.b + 1]! - dy * k * wb;
}

/**
 * 把 A 的 Particle `i` 沿 `near` 的方向推出 `depth`（`0` = 不推，只套摩擦），修正量依
 * PBD 權重分給 Particle 與 B 邊的兩端點；再套 Coulomb 位置式摩擦，上限 `μ × frictionDepth`
 * （撞擊級傳偵測時的深度——剛體分離後殘餘深度可能很小甚至 0，切向阻力不該跟著消失；
 * 靜置級 = `depth`）。
 */
function pushOut(
  a: CollisionBody,
  i: number,
  b: CollisionBody,
  near: Nearest,
  depth: number,
  frictionDepth: number,
  p: CollisionParams,
  stats: CollisionStats,
): void {
  const e = b.contour[near.edge]!;
  const share = p.particleShare;
  const t = near.t;
  const wp = share;
  const wa = (1 - share) * (1 - t);
  const wb = (1 - share) * t;
  const denom = wp + wa * (1 - t) + wb * t;
  const nx = near.nx;
  const ny = near.ny;
  const ap = a.positions;
  const bp = b.positions;
  if (depth > 0) {
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    stats.contacts++;
    applyWeighted(ap, i, bp, e, nx, ny, depth / denom, wp, wa, wb);
  }

  if (p.friction <= 0 || frictionDepth <= 0) return;
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
  const mag = Math.abs(rel);
  if (mag === 0) return;
  // Coulomb：抵銷相對切線位移本身（改 pos），最多 μ·depth；超過就是動摩擦（只抵銷 μ·depth）。
  const corr = Math.min(mag, p.friction * frictionDepth) * Math.sign(rel);
  applyWeighted(ap, i, bp, e, tx, ty, -corr / denom, wp, wa, wb);
}

/**
 * 偵測段：有序塊對 (A, B)，A 的輪廓 Particle 對 B——落在 B 裡的記進 `CONTACTS`
 * （`side` 0 = 這是 A→B、1 = B→A），方向 × 深度累加進 `PASS`（B→A 的方向翻到 A 視角）。
 * 不動位置。
 */
function collectContacts(a: CollisionBody, b: CollisionBody, bb: Bbox, side: 0 | 1): void {
  const sign = side === 0 ? 1 : -1;
  const ap = a.positions;
  const list = a.surfaceParticles;
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!;
    const x = ap[2 * i]!;
    const y = ap[2 * i + 1]!;
    if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
    if (!nearestContourEdgeAndInside(b, x, y)) continue;
    const near = NEAREST;
    if (near.edge < 0) continue;
    if (near.dist > 1e-9) {
      // 在裡面 → 朝最近表面點 Q 推（Q − P）；不信任繞向法線（表層翻面時會反向）。
      near.nx = (near.qx - x) / near.dist;
      near.ny = (near.qy - y) / near.dist;
    }
    PASS.nx += sign * near.nx * near.dist;
    PASS.ny += sign * near.ny * near.dist;
    PASS.count++;
    pushContact(side, i, near);
  }
}

/**
 * 推出段：對偵測段記下的每筆接觸重算目前的深度再 `pushOut`（前面的接觸或整體衝量已把它
 * 推到外面 → 跳過）。兩種語意，各自只在被驗證過的情境用：
 * - `recorded = false`（靜置級）：以目前位置重跑完整的最近邊＋內外查詢——前面的推出移動了
 *   對方的邊、最近邊可能換一條（Gauss–Seidel，跟 #94 prototype 一樣）。用記下的邊在角落會
 *   把 Particle 沿舊方向推，疊放靜置在某些落點會變成停不下來的微震（實測 KE 停在 ~2e3）。
 * - `recorded = true`（撞擊級）：沿偵測時記下的那條邊與方向重算——剛體分離與前面的推出
 *   改變幾何後，「最近邊」可能翻到另一側，把深陷的 Particle 推向相反方向而互相卡住
 *   （實測 10 塊 g = 8000 落箱：重查會留下數百顆永久穿透，記錄邊恢復到 < 0.5%）。
 */
function applyContacts(
  a: CollisionBody,
  b: CollisionBody,
  p: CollisionParams,
  stats: CollisionStats,
  recorded: boolean,
): void {
  const c = CONTACTS;
  const near = NEAREST;
  for (let k = 0; k < c.count; k++) {
    const from = c.side[k] === 0 ? a : b;
    const into = c.side[k] === 0 ? b : a;
    const i = c.i[k]!;
    const x = from.positions[2 * i]!;
    const y = from.positions[2 * i + 1]!;
    if (recorded) {
      const e = into.contour[c.edge[k]!]!;
      projectToEdge(into.positions, e, x, y);
      const d = Math.sqrt(PROJ.d2);
      near.edge = c.edge[k]!;
      near.t = PROJ.t;
      near.qx = PROJ.qx;
      near.qy = PROJ.qy;
      near.dist = d;
      // 仍在偵測時那個方向的內側才算還在裡面（`(Q − P)·n_偵測 > 0`）→ 推出殘餘深度；
      // 已被剛體分離推到外面 → 只套摩擦（這次撞擊的切向阻力不該因為分離得快就消失），
      // 接觸點與切線仍取自記下的那條邊。
      const inside = d > 1e-9 && (PROJ.qx - x) * c.nx[k]! + (PROJ.qy - y) * c.ny[k]! > 0;
      if (d > 1e-9) {
        near.nx = (PROJ.qx - x) / d;
        near.ny = (PROJ.qy - y) / d;
      } else {
        near.nx = c.nx[k]!;
        near.ny = c.ny[k]!;
      }
      pushOut(from, i, into, near, inside ? d : 0, c.depth[k]!, p, stats);
    } else {
      if (!nearestContourEdgeAndInside(into, x, y)) continue;
      if (near.edge < 0 || near.dist <= 1e-9) continue;
      near.nx = (near.qx - x) / near.dist;
      near.ny = (near.qy - y) / near.dist;
      pushOut(from, i, into, near, near.dist, near.dist, p, stats);
    }
  }
}

function ensureMean(b: CollisionBody, s: Scratch): void {
  if (s.meanValid) return;
  const pos = b.positions;
  const prev = b.prevPositions;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < b.particleCount; i++) {
    sx += pos[2 * i]! - prev[2 * i]!;
    sy += pos[2 * i + 1]! - prev[2 * i + 1]!;
  }
  s.meanDx = sx / b.particleCount;
  s.meanDy = sy / b.particleCount;
  s.meanValid = true;
}

function contourEdgeLen(b: CollisionBody, s: Scratch): number {
  if (s.edgeLen >= 0) return s.edgeLen;
  const pos = b.positions;
  let sum = 0;
  for (const e of b.contour) {
    sum += Math.hypot(pos[2 * e.b]! - pos[2 * e.a]!, pos[2 * e.b + 1]! - pos[2 * e.a + 1]!);
  }
  s.edgeLen = b.contour.length ? sum / b.contour.length : 0;
  return s.edgeLen;
}

/** 這對塊要做的整體衝量（`planImpact` 算好、模組層級重用）：法線、兩塊各退多少、撞擊級與否。 */
const IMPACT = { active: false, rigid: false, nx: 0, ny: 0, dA: 0, dB: 0 };

/**
 * 塊對 (A, B) 沿接觸平均法線 `n`（指向 A 外側 = 把 A 推離 B）規劃一次整體非彈性衝量，
 * 結果放 `IMPACT`。質心速度以 `pos − prev` 表示；趨近速度 `s = (v_B − v_A)·n`（> 0 才
 * 處理）；要扣的位移 `Δ_A·N_A = Δ_B·N_B`。`rigid` = 撞擊級（≥ `separationThreshold` ×
 * 輪廓邊長）。快取的質心位移在這裡就更新（之後的塊對看得到）。
 */
function planImpact(
  a: CollisionBody,
  sa: Scratch,
  b: CollisionBody,
  sb: Scratch,
  p: CollisionParams,
): void {
  IMPACT.active = false;
  const len = Math.hypot(PASS.nx, PASS.ny);
  if (len === 0 || p.impactAbsorb <= 0) return;
  const nx = PASS.nx / len;
  const ny = PASS.ny / len;
  ensureMean(a, sa);
  ensureMean(b, sb);
  const approach = (sb.meanDx - sa.meanDx) * nx + (sb.meanDy - sa.meanDy) * ny;
  if (approach <= 0) return;
  const total = approach * p.impactAbsorb;
  const na = a.particleCount;
  const nb = b.particleCount;
  const dA = (total * nb) / (na + nb);
  const dB = (total * na) / (na + nb);
  const edge = Math.min(contourEdgeLen(a, sa), contourEdgeLen(b, sb));
  IMPACT.active = true;
  IMPACT.rigid = total >= p.separationThreshold * edge;
  IMPACT.nx = nx;
  IMPACT.ny = ny;
  IMPACT.dA = dA;
  IMPACT.dB = dB;
  sa.meanDx += nx * dA;
  sa.meanDy += ny * dA;
  sb.meanDx -= nx * dB;
  sb.meanDy -= ny * dB;
}

/**
 * 套用 `IMPACT`：撞擊級平移全體 `pos`（A `+= n·Δ_A`、B `−= n·Δ_B`：速度沿 n 各增 Δ/h、
 * 位置也退開；快取的 bbox 跟著平移，之後的塊對粗篩才看得到）；靜置級平移全體 `prev`
 * （A `−= n·Δ_A`、B `+= n·Δ_B`：速度變化一樣、位置不動）。呼叫時機見 `resolveCollisions`。
 * 兩種都是「全體」——被 Grab／Pin 住的 Particle、剛被 Boundary clamp 住的 Particle 也
 * 一起動，下一個 substep 的約束／邊界會把它們拉回（Pin 塊被撞質心實測不動，見設計文件）。
 */
function applyImpact(a: CollisionBody, sa: Scratch, b: CollisionBody, sb: Scratch): void {
  const { nx, ny, dA, dB } = IMPACT;
  if (IMPACT.rigid) {
    translate(a.positions, a.particleCount, nx * dA, ny * dA);
    shiftBbox(sa.bb, nx * dA, ny * dA);
    translate(b.positions, b.particleCount, -nx * dB, -ny * dB);
    shiftBbox(sb.bb, -nx * dB, -ny * dB);
  } else {
    translate(a.prevPositions, a.particleCount, -nx * dA, -ny * dA);
    translate(b.prevPositions, b.particleCount, nx * dB, ny * dB);
  }
}

function shiftBbox(bb: Bbox, dx: number, dy: number): void {
  bb.minX += dx;
  bb.maxX += dx;
  bb.minY += dy;
  bb.maxY += dy;
}

function translate(buf: Float64Array, count: number, dx: number, dy: number): void {
  for (let i = 0; i < count; i++) {
    buf[2 * i] = buf[2 * i]! + dx;
    buf[2 * i + 1] = buf[2 * i + 1]! + dy;
  }
}

/**
 * 一個 substep 的跨塊碰撞：就地改各塊的 `positions`／`prevPositions`。呼叫前每塊都已
 * `solveInternal(h)`。塊對依 `jellies` 的順序走訪（呼叫端負責決定性排序）；每個 bbox
 * 相交的無序塊對：偵測（A→B、B→A）→ 整體衝量 → 推出（見檔頭）。少於兩塊為 no-op。
 * bbox 在呼叫開始時算一次，撞擊級的剛體平移會同步平移它（推出的表面變形不重算）。
 */
export function resolveCollisions(
  jellies: readonly CollisionBody[],
  p: CollisionParams,
): CollisionStats {
  const stats: CollisionStats = { pairs: 0, contacts: 0, maxDepth: 0 };
  const n = jellies.length;
  if (n < 2) return stats;
  const scratch: Scratch[] = [];
  for (let i = 0; i < n; i++) {
    scratch.push({
      bb: bounds(jellies[i]!),
      meanDx: 0,
      meanDy: 0,
      meanValid: false,
      edgeLen: -1,
    });
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = jellies[i]!;
      const b = jellies[j]!;
      const sa = scratch[i]!;
      const sb = scratch[j]!;
      if (!overlaps(sa.bb, sb.bb)) continue;
      stats.pairs++;
      PASS.nx = 0;
      PASS.ny = 0;
      PASS.count = 0;
      CONTACTS.count = 0;
      collectContacts(a, b, sb.bb, 0);
      collectContacts(b, a, sa.bb, 1);
      if (PASS.count === 0) continue;
      planImpact(a, sa, b, sb, p);
      if (IMPACT.active && IMPACT.rigid) {
        // 撞擊級：先剛體式分開位置，再推出殘餘穿透。
        applyImpact(a, sa, b, sb);
        applyContacts(a, b, p, stats, true);
      } else {
        // 靜置級：先推出，再以推出**後**的質心位移重算趨近、平移 `prev`（#94 prototype 的
        // 順序）。用推出前的趨近會在疊放靜置時落入「每 substep 互踢 0.04 單位」的極限環
        // （KE 停在 2e4、質心不動）；推出後重算則趨近 ≤ 0、不啟動，靜置 KE 歸零。
        applyContacts(a, b, p, stats, false);
        sa.meanValid = false;
        sb.meanValid = false;
        planImpact(a, sa, b, sb, p);
        if (IMPACT.active && !IMPACT.rigid) applyImpact(a, sa, b, sb);
      }
    }
  }
  return stats;
}
