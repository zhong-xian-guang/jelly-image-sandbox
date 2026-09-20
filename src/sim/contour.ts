/**
 * 輪廓邊（issue #95 / V3 T3-2；spec #87「`SimCore` 的 substep 拆段」）——從三角形
 * 索引推出「只屬於一個三角形的邊」。純函式、決定性（邊的順序依第一次出現的三角形
 * 順序），`SimCore` 建構時算一次公開成 `contour`／`surfaceParticles`，跨塊碰撞
 * （V3 T3-3）拿它做「Particle 是否在別塊裡面」與「最近表面點」的查詢。
 */

/**
 * 一條輪廓邊：`a → b` 沿三角形繞向，`nsign` 讓 `nsign · perp(b − a)`（`perp(x, y) =
 * (y, −x)`）指向網格**外側**——由該邊所屬三角形的第三點在 rest 時落在哪一側決定。
 * 碰撞 prototype（#94）驗證後推出方向已改用「朝最近表面點」，`nsign` 只當繞向
 * 提示保留。
 */
export interface ContourEdge {
  a: number;
  b: number;
  nsign: 1 | -1;
}

/** `indices` 每 3 個一組；`rest` 是攤平的靜止座標 `[x0, y0, ...]`。 */
export function contourEdges(indices: ArrayLike<number>, rest: ArrayLike<number>): ContourEdge[] {
  const first = new Map<number, { a: number; b: number; c: number }>();
  const shared = new Set<number>();
  const n = rest.length / 2;
  const key = (p: number, q: number) => (p < q ? p * n + q : q * n + p);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!;
      const b = indices[t + ((k + 1) % 3)]!;
      const c = indices[t + ((k + 2) % 3)]!;
      const kk = key(a, b);
      if (first.has(kk)) shared.add(kk);
      else first.set(kk, { a, b, c });
    }
  }
  const edges: ContourEdge[] = [];
  for (const [kk, e] of first) {
    if (shared.has(kk)) continue;
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

/** 輪廓上所有 Particle 的索引（去重、依第一次出現順序）。 */
export function surfaceParticles(contour: readonly ContourEdge[]): Uint32Array {
  const seen = new Set<number>();
  for (const e of contour) {
    seen.add(e.a);
    seen.add(e.b);
  }
  return Uint32Array.from(seen);
}
