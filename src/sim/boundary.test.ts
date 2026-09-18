import { describe, expect, it } from 'vitest';

import {
  type Boundary,
  FloorBoundary,
  type FloorBoundaryOptions,
  InfiniteBoundary,
  WalledBoundary,
  type WalledBoundaryOptions,
} from './boundary';

/** `[x0,y0,x1,y1,...]` → Float64Array。 */
const flat = (...xy: number[]) => Float64Array.from(xy);

describe('InfiniteBoundary', () => {
  it('resolveBoundary 為 no-op：pos / prev 原封不動', () => {
    const pos = flat(-999, 999, 5000, -5000);
    const prev = flat(-990, 990, 4990, -4990);
    const posCopy = Array.from(pos);
    const prevCopy = Array.from(prev);
    const b: Boundary = new InfiniteBoundary();
    b.resolveBoundary(pos, prev, 2, 1 / 240);
    expect(Array.from(pos)).toEqual(posCopy);
    expect(Array.from(prev)).toEqual(prevCopy);
  });
});

describe('WalledBoundary', () => {
  const box: WalledBoundaryOptions = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  const walled = (opts: WalledBoundaryOptions = box): Boundary => new WalledBoundary(opts);

  it('把越界 Particle clamp 回 AABB', () => {
    const pos = flat(-150, 0, 0, 250, 30, -40);
    const prev = flat(-120, 0, 0, 120, 30, -40);
    walled().resolveBoundary(pos, prev, 3, 1 / 240);
    expect(Array.from(pos)).toEqual([-100, 0, 0, 100, 30, -40]); // 前兩點 clamp、第三點不動
  });

  it('e = 0：撞牆軸的回推速度歸零，非撞牆軸不受影響', () => {
    // Particle 從 (-90, 10) 移到 (-130, 30)：X 越界、Y 沒有
    const pos = flat(-130, 30);
    const prev = flat(-90, 10);
    walled().resolveBoundary(pos, prev, 1, 1 / 240);
    const h = 1 / 240;
    const vx = (pos[0]! - prev[0]!) / h;
    const vy = (pos[1]! - prev[1]!) / h;
    expect(pos[0]).toBe(-100);
    expect(vx).toBe(0); // 向外分量歸零
    expect(vy).toBeCloseTo((30 - 10) / h, 9); // Y 分量原樣
  });

  it('restitution：回推速度 = −e · 入射速度（含 overshoot，e = 1 為真彈性）', () => {
    const h = 1 / 240;
    const preX = -130; // clamp 前的位置（已 overshoot 到牆外）
    const prevX = -90;
    const vIn = (preX - prevX) / h; // 真入射速度（撞 −X 牆 → 負）

    for (const e of [0, 0.5, 1]) {
      const pos = flat(preX, 0);
      const prev = flat(prevX, 0);
      walled({ ...box, restitution: e }).resolveBoundary(pos, prev, 1, h);
      const vOut = (pos[0]! - prev[0]!) / h;
      expect(pos[0]).toBe(-100); // clamp 到牆
      expect(vOut).toBeCloseTo(-e * vIn, 9); // e=0 → 0；e=1 → 完全反向等速
    }
  });

  it('上界同樣處理（maxX / maxY），e = 0 → 回推速度歸零', () => {
    const pos = flat(140, 160);
    const prev = flat(90, 90);
    walled().resolveBoundary(pos, prev, 1, 1 / 240);
    expect(Array.from(pos)).toEqual([100, 100]);
    expect(pos[0]! - prev[0]!).toBe(0);
    expect(pos[1]! - prev[1]!).toBe(0);
  });

  it('box 是純 Bbox、restitution 分開，公開唯讀供算繪 / 相機取用', () => {
    const b = new WalledBoundary({ ...box, restitution: 0.3 });
    expect(b.box).toEqual(box);
    expect(b.restitution).toBe(0.3);
    expect(new WalledBoundary(box).restitution).toBe(0); // 預設
  });
});

describe('FloorBoundary（issue #92 / V3 T2-2；ADR-0012）', () => {
  const floorY = 50;
  const floor = (restitution?: number): Boundary =>
    new FloorBoundary(restitution === undefined ? { floorY } : { floorY, restitution });

  it('y > floorY 的 Particle clamp 到 floorY；y ≤ floorY 不動', () => {
    const pos = flat(0, 80, 10, 50, 20, -300);
    const prev = flat(0, 40, 10, 50, 20, -290);
    floor().resolveBoundary(pos, prev, 3, 1 / 240);
    expect(Array.from(pos)).toEqual([0, 50, 10, 50, 20, -300]); // 只有第一點被 clamp
  });

  it('x 方向與上方不管：左右／往上飛多遠都不動', () => {
    const pos = flat(-99999, -99999, 99999, 10);
    const prev = flat(-99990, -99990, 99990, 10);
    const posCopy = Array.from(pos);
    const prevCopy = Array.from(prev);
    floor().resolveBoundary(pos, prev, 2, 1 / 240);
    expect(Array.from(pos)).toEqual(posCopy);
    expect(Array.from(prev)).toEqual(prevCopy);
  });

  it('e = 0（預設）：撞地板時回推的 y 速度歸零、x 速度不受影響', () => {
    const h = 1 / 240;
    const pos = flat(30, 70);
    const prev = flat(10, 30);
    floor().resolveBoundary(pos, prev, 1, h);
    expect(pos[1]).toBe(floorY);
    expect((pos[1]! - prev[1]!) / h).toBe(0);
    expect((pos[0]! - prev[0]!) / h).toBeCloseTo((30 - 10) / h, 9);
  });

  it('restitution：回推 y 速度 = −e · 入射速度（比照 WalledBoundary）', () => {
    const h = 1 / 240;
    const preY = 70;
    const prevY = 30;
    const vIn = (preY - prevY) / h;
    for (const e of [0, 0.5, 1]) {
      const pos = flat(0, preY);
      const prev = flat(0, prevY);
      floor(e).resolveBoundary(pos, prev, 1, h);
      expect(pos[1]).toBe(floorY);
      expect((pos[1]! - prev[1]!) / h).toBeCloseTo(-e * vIn, 9);
    }
  });

  it('floorY 公開唯讀供算繪畫地板線；restitution 預設 0', () => {
    const b = new FloorBoundary({ floorY: 123.5 });
    expect(b.floorY).toBe(123.5);
    expect(b.restitution).toBe(0);
    expect(new FloorBoundary({ floorY: 0, restitution: 0.4 }).restitution).toBe(0.4);
  });
});

describe('摩擦（issue #93 / V3 T2-3；ADR-0012）', () => {
  const h = 1 / 240;
  const box: WalledBoundaryOptions = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  /** 回推速度 `(pos − prev) / h` 的 x / y 分量。 */
  const vel = (pos: Float64Array, prev: Float64Array) => ({
    vx: (pos[0]! - prev[0]!) / h,
    vy: (pos[1]! - prev[1]!) / h,
  });
  const walled = (opts: WalledBoundaryOptions): Boundary & { friction: number } =>
    new WalledBoundary(opts);
  const floor = (opts: FloorBoundaryOptions): Boundary & { friction: number } =>
    new FloorBoundary(opts);

  describe('WalledBoundary', () => {
    it('撞 x 面 → 回推 y 速度乘 (1 − friction)、x 依 restitution（e = 0 → 歸零）', () => {
      for (const friction of [0.3, 0.7]) {
        const pos = flat(-130, 30);
        const prev = flat(-90, 10);
        walled({ ...box, friction }).resolveBoundary(pos, prev, 1, h);
        const { vx, vy } = vel(pos, prev);
        expect(pos[0]).toBe(-100);
        expect(vx).toBe(0);
        expect(vy).toBeCloseTo(((30 - 10) / h) * (1 - friction), 9);
      }
    });

    it('撞 y 面對稱：回推 x 速度乘 (1 − friction)、y 歸零', () => {
      const pos = flat(20, 140);
      const prev = flat(-20, 90);
      walled({ ...box, friction: 0.3 }).resolveBoundary(pos, prev, 1, h);
      const { vx, vy } = vel(pos, prev);
      expect(pos[1]).toBe(100);
      expect(vy).toBe(0);
      expect(vx).toBeCloseTo(((20 - -20) / h) * 0.7, 9);
    });

    it('摩擦與 restitution 各管各的：撞 x 面時 x 走 −e·入射、y 走 (1 − friction)', () => {
      const pos = flat(-130, 30);
      const prev = flat(-90, 10);
      walled({ ...box, restitution: 0.5, friction: 0.3 }).resolveBoundary(pos, prev, 1, h);
      const { vx, vy } = vel(pos, prev);
      expect(vx).toBeCloseTo(-0.5 * ((-130 - -90) / h), 9);
      expect(vy).toBeCloseTo(((30 - 10) / h) * 0.7, 9);
    });

    it('角落兩軸都撞 → 兩軸都是法線（依 restitution）也都是切線（乘 1 − friction）', () => {
      const pos = flat(-130, 140);
      const prev = flat(-90, 90);
      walled({ ...box, restitution: 1, friction: 0.5 }).resolveBoundary(pos, prev, 1, h);
      const { vx, vy } = vel(pos, prev);
      expect(Array.from(pos)).toEqual([-100, 100]);
      expect(vx).toBeCloseTo(-1 * ((-130 - -90) / h) * 0.5, 9);
      expect(vy).toBeCloseTo(-1 * ((140 - 90) / h) * 0.5, 9);
    });

    it('沒撞到的 Particle 切線速度不變', () => {
      const pos = flat(30, -40);
      const prev = flat(10, -80);
      walled({ ...box, friction: 0.9 }).resolveBoundary(pos, prev, 1, h);
      expect(Array.from(pos)).toEqual([30, -40]);
      expect(Array.from(prev)).toEqual([10, -80]);
    });

    it('friction = 0（預設）與沒有 friction 位元相同', () => {
      const posA = flat(-130, 30.1, 20, 140.3, 5, 5);
      const prevA = flat(-90, 10.7, -20.9, 90, 1, 1);
      const posB = Float64Array.from(posA);
      const prevB = Float64Array.from(prevA);
      walled(box).resolveBoundary(posA, prevA, 3, h);
      walled({ ...box, friction: 0 }).resolveBoundary(posB, prevB, 3, h);
      expect(Array.from(posA)).toEqual(Array.from(posB));
      expect(Array.from(prevA)).toEqual(Array.from(prevB));
      expect(walled(box).friction).toBe(0);
    });

    it('friction = 1 → 切線速度歸零', () => {
      const pos = flat(-130, 30);
      const prev = flat(-90, 10);
      walled({ ...box, friction: 1 }).resolveBoundary(pos, prev, 1, h);
      const { vx, vy } = vel(pos, prev);
      expect(vx).toBe(0);
      expect(vy).toBe(0);
    });
  });

  describe('FloorBoundary', () => {
    const floorY = 50;

    it('撞地板 → 回推 x 速度乘 (1 − friction)、y 依 restitution', () => {
      for (const friction of [0.3, 0.7]) {
        const pos = flat(30, 70);
        const prev = flat(10, 30);
        floor({ floorY, friction }).resolveBoundary(pos, prev, 1, h);
        const { vx, vy } = vel(pos, prev);
        expect(pos[1]).toBe(floorY);
        expect(vy).toBe(0);
        expect(vx).toBeCloseTo(((30 - 10) / h) * (1 - friction), 9);
      }
      const pos = flat(30, 70);
      const prev = flat(10, 30);
      floor({ floorY, restitution: 0.5, friction: 0.3 }).resolveBoundary(pos, prev, 1, h);
      const { vx, vy } = vel(pos, prev);
      expect(vy).toBeCloseTo(-0.5 * ((70 - 30) / h), 9);
      expect(vx).toBeCloseTo(((30 - 10) / h) * 0.7, 9);
    });

    it('沒撞到地板的 Particle 不動', () => {
      const pos = flat(30, 20);
      const prev = flat(10, -10);
      floor({ floorY, friction: 0.9 }).resolveBoundary(pos, prev, 1, h);
      expect(Array.from(pos)).toEqual([30, 20]);
      expect(Array.from(prev)).toEqual([10, -10]);
    });

    it('friction = 0（預設）與沒有 friction 位元相同；friction = 1 → x 速度歸零', () => {
      const posA = flat(30.3, 70.1, 10, 20);
      const prevA = flat(10.7, 30, -10.1, -10);
      const posB = Float64Array.from(posA);
      const prevB = Float64Array.from(prevA);
      floor({ floorY }).resolveBoundary(posA, prevA, 2, h);
      floor({ floorY, friction: 0 }).resolveBoundary(posB, prevB, 2, h);
      expect(Array.from(posA)).toEqual(Array.from(posB));
      expect(Array.from(prevA)).toEqual(Array.from(prevB));
      expect(floor({ floorY }).friction).toBe(0);

      const pos = flat(30, 70);
      const prev = flat(10, 30);
      floor({ floorY, friction: 1 }).resolveBoundary(pos, prev, 1, h);
      const { vx, vy } = vel(pos, prev);
      expect(vx).toBe(0);
      expect(vy).toBe(0);
    });
  });
});
