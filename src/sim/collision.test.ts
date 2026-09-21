import { describe, expect, it } from 'vitest';

import {
  type CollisionBody,
  type CollisionParams,
  DEFAULT_COLLISION_PARAMS,
  resolveCollisions,
} from './collision';
import { contourEdges, surfaceParticles } from './contour';
import { gridMesh } from './testFixtures';

/**
 * 手搭一個碰撞用的小塊：`rest` 是攤平的靜止座標（也是輪廓繞向的依據）、`pos`／`prev`
 * 可各自覆寫（預設 = rest，即靜止）。
 */
function body(
  rest: number[],
  indices: number[],
  pos: number[] = rest,
  prev: number[] = pos,
): CollisionBody {
  const contour = contourEdges(indices, rest);
  return {
    positions: Float64Array.from(pos),
    prevPositions: Float64Array.from(prev),
    particleCount: rest.length / 2,
    contour,
    surfaceParticles: surfaceParticles(contour),
  };
}

/** B：邊長 10 的正方形，左下 (0, 0)，兩個三角形（CCW、y 向下）。 */
function square(): CollisionBody {
  return body([0, 0, 10, 0, 10, 10, 0, 10], [0, 1, 2, 0, 2, 3]);
}

/** A：三角形，第 0 個 Particle 放在 `tip`、另外兩個在左邊遠處。 */
function probe(tip: [number, number], prevTip: [number, number] = tip): CollisionBody {
  const rest = [-10, 5, -20, 0, -20, 10];
  const pos = [tip[0], tip[1], -20, 0, -20, 10];
  const prev = [prevTip[0], prevTip[1], -20, 0, -20, 10];
  return body(rest, [0, 1, 2], pos, prev);
}

function snapshot(b: CollisionBody): { pos: number[]; prev: number[] } {
  return { pos: Array.from(b.positions), prev: Array.from(b.prevPositions) };
}

const P: CollisionParams = { ...DEFAULT_COLLISION_PARAMS };

describe('resolveCollisions — 不重疊', () => {
  it('bbox 不相交 → pos／prev 位元不變、無接觸', () => {
    const a = probe([-15, 5]);
    const b = square();
    const before = [snapshot(a), snapshot(b)];
    const stats = resolveCollisions([a, b], P);
    expect([snapshot(a), snapshot(b)]).toEqual(before);
    expect(stats.contacts).toBe(0);
  });

  it('bbox 相交但 Particle 都在輪廓外 → 位元不變', () => {
    const a = probe([-1, 5]); // A 的 bbox 與 B 相接，但 tip 在 B 左邊外側
    const b = square();
    const before = [snapshot(a), snapshot(b)];
    resolveCollisions([a, b], P);
    expect([snapshot(a), snapshot(b)]).toEqual(before);
  });
});

describe('resolveCollisions — 推出', () => {
  it('A 的 Particle 進到 B 內 → 推到最近輪廓邊上、邊端點反向微移、總修正量守恆', () => {
    // tip (2, 5)：離 B 左邊 x = 0 最近（深度 2、t = 0.5）。
    const a = probe([2, 5]);
    const b = square();
    const stats = resolveCollisions([a, b], P);
    expect(stats).toMatchObject({ pairs: 1, contacts: 1 });
    expect(stats.maxDepth).toBeCloseTo(2, 12);
    // share 0.5、t 0.5 → 分母 0.75、Particle 移 2/3 深度、兩端點各 1/3。
    expect(a.positions[0]).toBeCloseTo(2 - 4 / 3, 12);
    expect(a.positions[1]).toBeCloseTo(5, 12);
    expect(b.positions[0]).toBeCloseTo(2 / 3, 12); // (0, 0) → 往 +x
    expect(b.positions[6]).toBeCloseTo(2 / 3, 12); // (0, 10) → 往 +x
    expect(b.positions[2]).toBe(10); // 右側兩點不動
    expect(b.positions[4]).toBe(10);
    // 推完後 Particle 剛好在（移動後的）邊上。
    expect(a.positions[0]).toBeCloseTo(b.positions[0]!, 12);
    // 總修正量守恆：兩塊所有 Particle 的位移向量和為 0。
    const sumDx = a.positions[0]! - 2 + (b.positions[0]! - 0) + (b.positions[6]! - 0);
    expect(sumDx).toBeCloseTo(0, 12);
    // 靜止相撞（prev = pos）→ 推開後兩塊互相遠離，整體衝量不介入：prev 不變。
    expect(Array.from(a.prevPositions)).toEqual([2, 5, -20, 0, -20, 10]);
    expect(Array.from(b.prevPositions)).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  });

  it('A／B 順序互換結果相同（只有 A 的 Particle 在 B 內）', () => {
    const a1 = probe([2, 5], [-1, 5]);
    const b1 = square();
    resolveCollisions([a1, b1], P);
    const a2 = probe([2, 5], [-1, 5]);
    const b2 = square();
    resolveCollisions([b2, a2], P);
    expect(snapshot(a2)).toEqual(snapshot(a1));
    expect(snapshot(b2)).toEqual(snapshot(b1));
  });

  it('決定性：同輸入跑兩次位元相同', () => {
    const runOnce = () => {
      const a = probe([2, 5], [-1, 4]);
      const b = square();
      resolveCollisions([a, b], P);
      return [snapshot(a), snapshot(b)];
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

/** A 的 tip 相對於 B 邊上接觸點（t = 0.5，即 B 左邊中點）的切線（y 向）位移。 */
function relTangential(a: CollisionBody, b: CollisionBody): number {
  const tipDy = a.positions[1]! - a.prevPositions[1]!;
  const contactDy =
    0.5 * (b.positions[1]! - b.prevPositions[1]!) + 0.5 * (b.positions[7]! - b.prevPositions[7]!);
  return tipDy - contactDy;
}

describe('resolveCollisions — 摩擦與整體衝量', () => {
  it('friction = 0：相對切線位移不變', () => {
    const a = probe([2, 5], [2, 4]); // 這個 substep 沿邊往 +y 滑了 1
    const b = square();
    resolveCollisions([a, b], { ...P, friction: 0 });
    expect(relTangential(a, b)).toBeCloseTo(1, 12);
  });

  it('friction = 1：相對切線位移歸零（|位移| ≤ μ·depth 時為靜摩擦）', () => {
    const a = probe([2, 5], [2, 4]);
    const b = square();
    resolveCollisions([a, b], { ...P, friction: 1 });
    expect(relTangential(a, b)).toBeCloseTo(0, 12);
    // 法線方向的推出不受摩擦影響。
    expect(a.positions[0]).toBeCloseTo(b.positions[0]!, 12);
  });

  it('friction = 0.3：滑動超過 μ·depth 時只抵銷 μ·depth（動摩擦）', () => {
    const a = probe([2, 5], [2, 0]); // 滑了 5、深度 2 → 最多抵銷 0.6
    const b = square();
    resolveCollisions([a, b], P);
    expect(relTangential(a, b)).toBeCloseTo(5 - 0.6, 12);
  });

  it('兩塊趨近時整體衝量扣掉 75% 質心趨近速度：平移全體 prev、動量守恆、只扣趨近', () => {
    // A 整體以每 substep 4 單位往 +x 撞向靜止的 B。
    const a = body(
      [-10, 5, -20, 0, -20, 10],
      [0, 1, 2],
      [2, 5, -20, 0, -20, 10],
      [-2, 5, -24, 0, -24, 10],
    );
    const b = square();
    resolveCollisions([a, b], { ...P, friction: 0 });
    // 推出後：A 質心位移 x = 4 − (4/3)/3、B = (4/3)/4；趨近 = 差 × 0.75，依 Particle 數配重。
    const approach = 4 - 4 / 9 - 1 / 3;
    const total = approach * 0.75;
    const dA = (total * 4) / 7;
    const dB = (total * 3) / 7;
    for (let i = 0; i < 3; i++)
      expect(a.prevPositions[2 * i]! - [-2, -24, -24][i]!).toBeCloseTo(dA, 12);
    for (let i = 0; i < 4; i++)
      expect(b.prevPositions[2 * i]! - [0, 10, 10, 0][i]!).toBeCloseTo(-dB, 12);
    // y 方向的 prev 不動。
    expect(Array.from(a.prevPositions).filter((_, k) => k % 2 === 1)).toEqual([5, 0, 10]);
    // 動量守恆：Σ Δprev = 0（等質量）。
    expect(3 * dA - 4 * dB).toBeCloseTo(0, 12);
  });

  it('impactAbsorb = 0：prev 只受摩擦影響（這裡 friction = 0 → 完全不動）', () => {
    const a = probe([2, 5], [-2, 5]);
    const b = square();
    resolveCollisions([a, b], { ...P, friction: 0, impactAbsorb: 0 });
    expect(Array.from(a.prevPositions)).toEqual([-2, 5, -20, 0, -20, 10]);
    expect(Array.from(b.prevPositions)).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  });
});

describe('resolveCollisions — 凹形內外判定', () => {
  it('落在 L 形缺口（bbox 內、輪廓外）的 Particle 不被推；落在 L 形內的被推到最近邊', () => {
    // 3×3 頂點、間距 10，拿掉右上 cell → L 形；缺口 = x ∈ (10, 20), y ∈ (0, 10)。
    const mesh = gridMesh(3, 3, 10, (i, j) => !(i === 1 && j === 0));
    // 探針三角形另外兩點放在 L 形下方遠處，避免 L 的頂點反過來落進探針裡。
    const spike = (tip: [number, number]) =>
      body([15, -10, 15, -30, 25, -30], [0, 1, 2], [tip[0], tip[1], 15, -30, 25, -30]);
    const l = body(Array.from(mesh.positions), Array.from(mesh.indices));
    const inNotch = spike([15, 5]);
    const before = snapshot(inNotch);
    resolveCollisions([inNotch, l], P);
    expect(snapshot(inNotch)).toEqual(before);

    const l2 = body(Array.from(mesh.positions), Array.from(mesh.indices));
    const inside = spike([15, 12]); // 在 L 形橫桿裡，離缺口底邊 y = 10 最近（深度 2）
    const stats = resolveCollisions([inside, l2], P);
    expect(stats.contacts).toBe(1);
    expect(stats.maxDepth).toBeCloseTo(2, 12);
    expect(inside.positions[1]).toBeLessThan(12); // 往 −y 推出
  });
});
