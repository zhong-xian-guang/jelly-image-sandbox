import { describe, expect, it } from 'vitest';

import {
  type Boundary,
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
