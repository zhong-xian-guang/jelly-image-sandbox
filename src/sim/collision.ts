/**
 * 跨塊碰撞（issue #96 / V3 T3-3；spec #87「跨塊碰撞」；演算法依 issue #94 prototype
 * 定案，primary source 為分支 `prototype/jelly-collision` 的
 * `prototypes/jelly-collision.core.prototype.ts` 與 #87 留言）。
 *
 * 純函式、就地改各塊的 `positions`／`prevPositions`；無 DOM、無隨機、無時鐘，同輸入
 * 同輸出（ADR-0005）。`World.step` 在每個 substep 對每塊 `solveInternal` 之後、
 * `finishSubstep` 之前呼叫一次；走訪順序 = 呼叫端給的陣列順序（`World` 依 id 排序）。
 *
 * 每個 bbox 相交的無序塊對 (A, B)：
 *  1. **A → B**：A 的每個**輪廓** Particle（內部 Particle 只在表面已深陷時才可能進別塊，
 *     不測）若落在 B 的輪廓多邊形內（even-odd 射線法，與最近輪廓邊查詢併成同一趟迴圈
 *     ——不需要每 substep 重建三角形 bbox 網格，prototype 實測那是 10 塊時 75% 的碰撞
 *     成本），沿「朝最近表面點」的方向推到最近輪廓邊上（不信任靜止繞向算的外法線：
 *     高速撞擊時 B 的表層三角形會被壓到翻面、法線反向）。修正量依 PBD 權重分：
 *     Particle `share`、邊兩端點 `(1 − share)(1 − t)`／`(1 − share) t`，分母
 *     `share + (1 − share)((1 − t)² + t²)` 讓推完後 Particle 剛好在邊上（字面的「一半
 *     一半」會留 25% 穿透）。接著 **Coulomb 位置式摩擦**：直接抵銷這個 substep A 點與
 *     邊上接觸點的**相對**切線位移，上限 `μ × depth`（Macklin 2019 小步長 PBD 摩擦）
 *     ——有靜摩擦，疊放不滑落；spec 原案的「切線速度衰減」砍不掉已發生的橫向位移。
 *  2. **B → A** 同上。
 *  3. **整體非彈性衝量**（每無序塊對一次）：兩段 pass 有任何接觸時，沿接觸平均法線把
 *     兩塊**質心**的趨近速度扣掉 `impactAbsorb`——平移全體 `prev`（依 Particle 數配重、
 *     動量守恆、只扣趨近不拉回），延後到本次呼叫結束一次套用。柔體的動量靠 shape
 *     matching 擴散太慢，沒有這步高處落下會把 B 表層壓翻、坍成一團。
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
   * 速度的這個比例。`0` = 關；`1` = 一次完全非彈性。
   */
  impactAbsorb: number;
  /** 推出修正量分給被推 Particle 的 PBD 權重（0–1）；其餘依重心權重分給邊兩端點。 */
  particleShare: number;
}

/** issue #94 prototype 四情境實測定案的組合（見 `docs/design/simulation-and-mesh.md` 參數表）。 */
export const DEFAULT_COLLISION_PARAMS: CollisionParams = {
  friction: 0.3,
  impactAbsorb: 0.75,
  particleShare: 0.5,
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

/** 每塊在一次呼叫內的暫存：bbox、質心位移快取、待套用的整體 `prev` 平移。 */
interface Scratch {
  bb: Bbox;
  meanDx: number;
  meanDy: number;
  meanValid: boolean;
  shiftX: number;
  shiftY: number;
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

/**
 * 把 A 的 Particle `i` 沿 `near` 的方向推出 `depth`（> 0），修正量依 PBD 權重分給
 * Particle 與 B 邊的兩端點；再套 Coulomb 位置式摩擦（見檔頭）。
 */
function pushOut(
  a: CollisionBody,
  i: number,
  b: CollisionBody,
  near: Nearest,
  depth: number,
  p: CollisionParams,
  stats: CollisionStats,
): void {
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
  const mag = Math.abs(rel);
  if (mag === 0) return;
  // Coulomb：抵銷相對切線位移本身（改 pos），最多 μ·depth；超過就是動摩擦（只抵銷 μ·depth）。
  const corr = Math.min(mag, p.friction * depth) * Math.sign(rel);
  const k = corr / denom;
  ap[2 * i] = ap[2 * i]! - tx * k * wp;
  ap[2 * i + 1] = ap[2 * i + 1]! - ty * k * wp;
  bp[2 * e.a] = bp[2 * e.a]! + tx * k * wa;
  bp[2 * e.a + 1] = bp[2 * e.a + 1]! + ty * k * wa;
  bp[2 * e.b] = bp[2 * e.b]! + tx * k * wb;
  bp[2 * e.b + 1] = bp[2 * e.b + 1]! + ty * k * wb;
}

/** 有序塊對 (A, B)：A 的輪廓 Particle 對 B。接觸法線累加進 `PASS`。 */
function solvePair(
  a: CollisionBody,
  b: CollisionBody,
  bb: Bbox,
  p: CollisionParams,
  stats: CollisionStats,
): void {
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
    pushOut(a, i, b, near, near.dist, p, stats);
    stats.contacts++;
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

/**
 * 塊對 (A, B) 沿接觸平均法線 `n`（指向 A 外側 = 把 A 推離 B）做一次整體非彈性衝量。
 * 質心速度以 `pos − prev` 表示；趨近速度 `s = (v_B − v_A)·n`（> 0 才處理）。A 全體
 * `prev −= n·Δ_A`（速度沿 n 增加 Δ_A/h）、B 全體 `prev += n·Δ_B`，`Δ_A·N_A = Δ_B·N_B`。
 * 平移延後到 `flushShift` 一次套用；快取的質心位移立即更新（之後的塊對看得到）。
 */
function absorbImpact(
  a: CollisionBody,
  sa: Scratch,
  b: CollisionBody,
  sb: Scratch,
  absorb: number,
): void {
  const len = Math.hypot(PASS.nx, PASS.ny);
  if (len === 0 || absorb <= 0) return;
  const nx = PASS.nx / len;
  const ny = PASS.ny / len;
  ensureMean(a, sa);
  ensureMean(b, sb);
  const approach = (sb.meanDx - sa.meanDx) * nx + (sb.meanDy - sa.meanDy) * ny;
  if (approach <= 0) return;
  const total = approach * absorb;
  const na = a.particleCount;
  const nb = b.particleCount;
  const dA = (total * nb) / (na + nb);
  const dB = (total * na) / (na + nb);
  sa.shiftX -= nx * dA;
  sa.shiftY -= ny * dA;
  sa.meanDx += nx * dA;
  sa.meanDy += ny * dA;
  sb.shiftX += nx * dB;
  sb.shiftY += ny * dB;
  sb.meanDx -= nx * dB;
  sb.meanDy -= ny * dB;
}

function flushShift(b: CollisionBody, s: Scratch): void {
  if (s.shiftX === 0 && s.shiftY === 0) return;
  const prev = b.prevPositions;
  for (let i = 0; i < b.particleCount; i++) {
    prev[2 * i] = prev[2 * i]! + s.shiftX;
    prev[2 * i + 1] = prev[2 * i + 1]! + s.shiftY;
  }
}

/**
 * 一個 substep 的跨塊碰撞：就地改各塊的 `positions`／`prevPositions`。呼叫前每塊都已
 * `solveInternal(h)`。塊對依 `jellies` 的順序走訪（呼叫端負責決定性排序）；每個 bbox
 * 相交的無序塊對跑 A→B、B→A 各一段，再做一次整體衝量。少於兩塊為 no-op。
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
      shiftX: 0,
      shiftY: 0,
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
      solvePair(a, b, sb.bb, p, stats);
      // B→A 的接觸法線指向 B 外側；翻到 A 視角累加。
      const axSum = PASS.nx;
      const aySum = PASS.ny;
      PASS.nx = 0;
      PASS.ny = 0;
      solvePair(b, a, sa.bb, p, stats);
      PASS.nx = axSum - PASS.nx;
      PASS.ny = aySum - PASS.ny;
      if (PASS.count > 0) absorbImpact(a, sa, b, sb, p.impactAbsorb);
    }
  }
  for (let i = 0; i < n; i++) flushShift(jellies[i]!, scratch[i]!);
  return stats;
}
