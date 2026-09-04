/**
 * 自寫的 Ruppert 式品質細化（T3 / GitHub issue #4），跑在 `triangulate` 的 CDT 之後。
 *
 * 每一回合：
 *  1. 找出「壞」三角形——最小角 `< minAngleDeg` 或面積 `> maxArea`——算它們的外心。
 *  2. 若有任何 constrained segment 被鄰接三角形的頂點、或某個待插入的外心 encroach
 *     （落在其直徑圓內），**只**分裂那些 segment 的中點，這一回合的外心全部作廢、
 *     下一回合重算（Ruppert 的「segment 優先」規則，保證不會插入會 encroach 的點）。
 *  3. 否則把落在域內的外心當 Steiner 點插入。
 *  4. 沒有壞三角形、或再也無法推進、或撞到 `maxPasses` / `maxVertices` 上限就停。
 *
 * 每回合用 `cdt2d` 從頭重算 constrained Delaunay（批次細化）——輸入點序固定，
 * 所以整段是決定性的：相同 `(rings, interior, params)` → 相同網格（ADR-0002、ADR-0005）。
 * 收斂後 `buildSimMesh` 會再跑一次 sliver 清理收掉貼著 segment 的少數殘餘。
 */

import cdt2d from 'cdt2d';

import {
  circumcenter,
  countBadTriangles,
  encroachesSegment,
  pointInRings,
  triangleMinAngleDeg,
  triangleSignedArea,
} from './geometry';
import { buildPslg, filterCells, pointKey, type RawMesh } from './triangulate';
import type { Point } from './types';

export interface RefineParams {
  /** 最小內角下界（度）。低於此值的三角形要細化。初始 25（見設計文件步驟 8）。 */
  minAngleDeg: number;
  /** 三角形面積上界。超過此值要細化。`Infinity` 可關掉面積準則。 */
  maxArea: number;
  /** 最多回合數，終止保險（尖銳輸入角可能讓 Ruppert 不收斂）。 */
  maxPasses: number;
  /** 總頂點數上限，另一道終止保險；撞到就停，殘餘交給 sliver 清理。 */
  maxVertices: number;
}

export interface RefineResult extends RawMesh {
  /** 收斂後仍違反最小角 / 最大面積的三角形數（貼著 constrained segment 的少數例外，見 issue #4 驗收條件）。 */
  unresolvedBadTriangles: number;
  /** 實際跑的回合數；接近 `maxPasses` 代表可能未完全收斂。 */
  passes: number;
}

/** 一條 constrained subsegment，端點是 `boundary` 陣列的索引。 */
interface Seg {
  a: number;
  b: number;
}

/** 無向邊 key（用於「邊 → 對面頂點」查表）。字串，與 `pointKey` 一致，不受頂點數上限限制。 */
const edgeKey = (i: number, j: number): string => (i < j ? `${i}:${j}` : `${j}:${i}`);

export function refineRuppert(
  rings: readonly Point[][],
  interior: readonly Point[],
  params: RefineParams,
): RefineResult {
  const { minAngleDeg, maxArea, maxPasses, maxVertices } = params;

  // --- PSLG：共用 triangulate 的 `buildPslg`（同一套量化去重）。boundary 點
  //     （在 constrained segment 上）永遠排在 interior 點之前；細化只往兩端各自 append。
  const pslg = buildPslg(rings, interior);
  const boundary: Array<[number, number]> = pslg.points
    .slice(0, pslg.boundaryCount)
    .map((p) => [p[0]!, p[1]!]);
  const interiorPts: Array<[number, number]> = pslg.points
    .slice(pslg.boundaryCount)
    .map((p) => [p[0]!, p[1]!]);
  const segments: Seg[] = pslg.edges.map(([a, b]) => ({ a: a!, b: b! }));

  const boundaryKey = new Map<string, number>();
  const usedKeys = new Set<string>();
  boundary.forEach(([x, y], i) => {
    const key = pointKey(x, y);
    boundaryKey.set(key, i);
    usedKeys.add(key);
  });
  for (const [x, y] of interiorPts) usedKeys.add(pointKey(x, y));

  const totalVerts = (): number => boundary.length + interiorPts.length;

  /**
   * 分裂 `segIdx` 指的那些 segment：加中點、原 segment 縮到前半、後半推到尾端。
   * 最多加到 `budget` 個新點就停。回傳新增的點數。
   */
  const splitSegments = (segIdx: readonly number[], budget: number): number => {
    let added = 0;
    for (const si of segIdx) {
      if (added >= budget) break;
      const s = segments[si]!;
      const [ax, ay] = boundary[s.a]!;
      const [bx, by] = boundary[s.b]!;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const key = pointKey(mx, my);
      let m = boundaryKey.get(key);
      if (m === undefined) {
        m = boundary.length;
        boundary.push([mx, my]);
        boundaryKey.set(key, m);
        usedKeys.add(key);
        added++;
      }
      if (m === s.a || m === s.b) continue; // 太短、量化後與端點重合：無法再分
      const b = s.b;
      segments[si] = { a: s.a, b: m };
      segments.push({ a: m, b });
    }
    return added;
  };

  let passes = 0;
  for (; passes < maxPasses; passes++) {
    if (totalVerts() >= maxVertices) break;
    const points: number[][] = [...boundary, ...interiorPts];
    const edges = segments.map((s) => [s.a, s.b]);
    const cells = cdt2d(points, edges, { exterior: false });

    // 每條無向邊 → 對面頂點（≤2）。Ruppert：CDT 裡若有頂點 encroach 某 subsegment，
    // 其鄰接三角形的對面頂點必然也 encroach，所以正常只要檢查這些即可。
    const apex = new Map<string, number[]>();
    for (const cell of cells) {
      const i0 = cell[0]!;
      const i1 = cell[1]!;
      const i2 = cell[2]!;
      const push = (u: number, v: number, w: number): void => {
        const k = edgeKey(u, v);
        const list = apex.get(k);
        if (list) list.push(w);
        else apex.set(k, [w]);
      };
      push(i0, i1, i2);
      push(i1, i2, i0);
      push(i2, i0, i1);
    }

    // 1. 壞三角形 → 候選外心（帶「是否在域內」旗標；出域的仍要參與 encroachment 判定）。
    //    批次插入必須防兩個相近的外心同回合插進去 → 反而生 sliver → 越補越糟：
    //    以 cell 固定順序處理，若某候選離「本回合已接受的候選」小於兩者外接半徑
    //    較小者的一半，就跳過（下一回合三角形變了會重算）。
    const candidates: Array<{ x: number; y: number; r: number; inDomain: boolean }> = [];
    const candidateKeys = new Set<string>();
    for (const cell of cells) {
      const ia = cell[0]!;
      const ib = cell[1]!;
      const ic = cell[2]!;
      const [ax, ay] = points[ia] as [number, number];
      const [bx, by] = points[ib] as [number, number];
      const [cx, cy] = points[ic] as [number, number];
      if (!pointInRings(rings, (ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
      const area = Math.abs(triangleSignedArea(ax, ay, bx, by, cx, cy));
      if (area === 0) continue;
      const bad = triangleMinAngleDeg(ax, ay, bx, by, cx, cy) < minAngleDeg || area > maxArea;
      if (!bad) continue;
      const cc = circumcenter(ax, ay, bx, by, cx, cy);
      if (cc === null) continue;
      const key = pointKey(cc.x, cc.y);
      if (usedKeys.has(key) || candidateKeys.has(key)) continue;
      const r = Math.hypot(cc.x - ax, cc.y - ay);
      let tooClose = false;
      for (const other of candidates) {
        if (Math.hypot(cc.x - other.x, cc.y - other.y) < 0.5 * Math.min(r, other.r)) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      candidateKeys.add(key);
      candidates.push({ x: cc.x, y: cc.y, r, inDomain: pointInRings(rings, cc.x, cc.y) });
    }

    if (candidates.length === 0) break; // 沒有壞三角形 → 收斂

    // 2. 被 encroach 的 segment：對面頂點、或任一候選外心，落在其直徑圓內。
    //    分裂那些 segment，同一回合也插入「不 encroach 任何 segment」的外心
    //    （合併兩件事，比純 segment 優先少跑一半回合，仍不會插入會 encroach 的點）。
    const toSplit: number[] = [];
    const candidateEncroaches = new Uint8Array(candidates.length);
    for (let si = 0; si < segments.length; si++) {
      const s = segments[si]!;
      const [ax, ay] = boundary[s.a]!;
      const [bx, by] = boundary[s.b]!;
      let hit = false;
      // 正常路徑：只看鄰接三角形的對面頂點。若這條 segment 不在目前三角化的邊表裡
      // （退化輸入下 cdt2d 可能丟邊），退回掃全部頂點，別漏判 encroachment。
      const opp = apex.get(edgeKey(s.a, s.b)) ?? points.map((_, i) => i);
      for (const w of opp) {
        if (w === s.a || w === s.b) continue;
        const p = points[w]!;
        if (encroachesSegment(p[0]!, p[1]!, ax, ay, bx, by)) {
          hit = true;
          break;
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!;
        if (encroachesSegment(c.x, c.y, ax, ay, bx, by)) {
          candidateEncroaches[i] = 1;
          hit = true;
        }
      }
      if (hit) toSplit.push(si);
    }

    let progressed = false;
    if (toSplit.length > 0) {
      if (splitSegments(toSplit, maxVertices - totalVerts()) > 0) progressed = true;
    }

    const room = maxVertices - totalVerts();
    let inserted = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (inserted >= room) break;
      const c = candidates[i]!;
      if (candidateEncroaches[i] || !c.inDomain) continue;
      const key = pointKey(c.x, c.y);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      interiorPts.push([c.x, c.y]);
      inserted++;
      progressed = true;
    }

    if (!progressed) break; // segment 太短無法分、外心都 encroach 或出域 → 交給 sliver 清理
  }

  // --- 最終三角化 + 記錄殘餘壞三角形（貼著 constrained segment、補不動的少數例外） ---
  const points: number[][] = [...boundary, ...interiorPts];
  const cells = cdt2d(
    points,
    segments.map((s) => [s.a, s.b]),
    { exterior: false },
  );
  const indices = filterCells(points, cells, rings);
  const positions: number[] = [];
  for (const p of points) positions.push(p[0]!, p[1]!);

  const unresolvedBadTriangles = countBadTriangles(positions, indices, minAngleDeg, maxArea);
  return { positions, indices, boundaryCount: boundary.length, unresolvedBadTriangles, passes };
}
