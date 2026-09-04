import { describe, expect, it } from 'vitest';

import type { SimMesh } from '../mesh';
import { SimCore } from './SimCore';
import type { InputEvent } from './types';

/**
 * 手搭一張規則三角網格當測試 fixture（不經 mesh pipeline，讓求解器測試獨立）。
 * `nx × ny` 個頂點、間距 `s`，每個 cell 切兩個三角形（CCW，y 向下）。
 */
function gridMesh(nx: number, ny: number, s: number): SimMesh {
  const pos: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pos.push(i * s, j * s);

  const idx = (i: number, j: number) => j * nx + i;
  const ind: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      ind.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
      ind.push(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
    }

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(ind);
  const restAreas = new Float64Array(indices.length / 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    restAreas[t / 3] =
      0.5 *
      ((positions[2 * b]! - positions[2 * a]!) * (positions[2 * c + 1]! - positions[2 * a + 1]!) -
        (positions[2 * b + 1]! - positions[2 * a + 1]!) * (positions[2 * c]! - positions[2 * a]!));
  }
  const uv = new Float32Array(positions.length);
  for (let k = 0; k < positions.length; k++) uv[k] = positions[k]! / (Math.max(nx, ny) * s);

  return { positions, indices, uv, restAreas };
}

function allFinite(xs: ArrayLike<number>): boolean {
  for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i]!)) return false;
  return true;
}

/** 跑一段 60fps 的 frame。 */
function run(sim: SimCore, frames: number): void {
  for (let f = 0; f < frames; f++) sim.step(1 / 60);
}

const MESH = () => gridMesh(13, 13, 8); // 96×96，對角線 ≈ 136

describe('SimCore — 靜置', () => {
  it('step 數百次後動能維持 0、位置不漂移', () => {
    const sim = new SimCore(MESH());
    const before = Float64Array.from(sim.positions);
    run(sim, 600);
    expect(sim.kineticEnergy()).toBeLessThan(1e-9);
    for (let i = 0; i < before.length; i++) expect(sim.positions[i]!).toBeCloseTo(before[i]!, 9);
    expect(allFinite(sim.positions)).toBe(true);
  });
});

describe('SimCore — grab 按下不動', () => {
  it('grab 後不 moveGrab 就 step：質心／拉伸比／動能皆不變', () => {
    const sim = new SimCore(MESH());
    const c0 = sim.centroid();
    const s0 = sim.stretchStats();

    sim.applyInput({ type: 'grab', id: 1, x: 0, y: 0 }); // 抓原點角
    expect(sim.grabCount).toBe(1);
    run(sim, 120);

    const c1 = sim.centroid();
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y)).toBeLessThan(1e-6);
    expect(sim.stretchStats().max).toBeCloseTo(s0.max, 6);
    expect(sim.kineticEnergy()).toBeLessThan(1e-9);
  });
});

describe('SimCore — grab + moveGrab 收斂到目標', () => {
  it('附著點世界座標收斂到 moveGrab 的 target', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: -40, y: -30 });
    run(sim, 90);

    const anchor = sim.attachPoint('g');
    expect(anchor).not.toBeNull();
    expect(anchor!.x).toBeCloseTo(-40, 3);
    expect(anchor!.y).toBeCloseTo(-30, 3);
    expect(allFinite(sim.positions)).toBe(true);
  });
});

describe('SimCore — release 後 Fling 收斂靜止', () => {
  it('帶著拖曳速度飛出、約 1–2 秒內收斂靜止', () => {
    const sim = new SimCore(MESH());
    const start = sim.centroid();
    sim.applyInput({ type: 'grab', id: 1, x: 0, y: 0 });

    // 6 frame 內把把手拉到 (140, -20) → 賦予拖曳速度
    for (let f = 1; f <= 6; f++) {
      sim.applyInput({ type: 'moveGrab', id: 1, x: (140 * f) / 6, y: (-20 * f) / 6 });
      sim.step(1 / 60);
    }
    sim.applyInput({ type: 'release', id: 1 });
    expect(sim.grabCount).toBe(0);

    const keAtRelease = sim.kineticEnergy();
    expect(keAtRelease).toBeGreaterThan(1); // 確實在動

    run(sim, 120); // 2 秒
    // 動能掉了 3 個數量級以上，且平均每 Particle 速度已是次像素等級 → 視覺上靜止
    expect(sim.kineticEnergy()).toBeLessThan(keAtRelease * 1e-3);
    const n = sim.positions.length / 2;
    expect(Math.sqrt((2 * sim.kineticEnergy()) / n)).toBeLessThan(1); // RMS 速度 < 1 px/s

    const end = sim.centroid();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(10); // 飛出去了
    expect(allFinite(sim.positions)).toBe(true);
  });
});

describe('SimCore — 多重 grab', () => {
  it('兩個同時 grab 各自約束成立、無 NaN', () => {
    const sim = new SimCore(gridMesh(13, 13, 8)); // 兩個角落分別在 (0,0) 與 (96,96)

    sim.applyInput({ type: 'grab', id: 'a', x: 0, y: 0 });
    sim.applyInput({ type: 'grab', id: 'b', x: 96, y: 96 });
    expect(sim.grabCount).toBe(2);

    sim.applyInput({ type: 'moveGrab', id: 'a', x: -30, y: -20 });
    sim.applyInput({ type: 'moveGrab', id: 'b', x: 150, y: 130 });
    run(sim, 120);

    const a = sim.attachPoint('a')!;
    const b = sim.attachPoint('b')!;
    expect(a.x).toBeCloseTo(-30, 2);
    expect(a.y).toBeCloseTo(-20, 2);
    expect(b.x).toBeCloseTo(150, 2);
    expect(b.y).toBeCloseTo(130, 2);
    expect(allFinite(sim.positions)).toBe(true);
  });
});

describe('SimCore — 決定性', () => {
  const script: InputEvent[] = [
    { type: 'grab', id: 1, x: 0, y: 0 },
    { type: 'moveGrab', id: 1, x: 60, y: 10 },
    { type: 'moveGrab', id: 1, x: 90, y: -30 },
    { type: 'release', id: 1 },
    { type: 'grab', id: 2, x: 96, y: 96 },
    { type: 'moveGrab', id: 2, x: 120, y: 120 },
  ];

  function playOut(): number[] {
    const sim = new SimCore(MESH());
    sim.applyInput(script[0]!);
    sim.applyInput(script[1]!);
    run(sim, 10);
    sim.applyInput(script[2]!);
    run(sim, 10);
    sim.applyInput(script[3]!);
    run(sim, 30);
    sim.applyInput(script[4]!);
    sim.applyInput(script[5]!);
    run(sim, 40);
    return Array.from(sim.positions);
  }

  it('相同 SimMesh + 相同事件流 + 相同步數 → positions 完全相等', () => {
    const a = playOut();
    const b = playOut();
    expect(a).toEqual(b);
    expect(allFinite(a)).toBe(true);
  });
});

describe('SimCore — 讀出與參數', () => {
  it('bbox 與 centroid 對靜止網格正確', () => {
    const sim = new SimCore(gridMesh(5, 5, 10)); // 40×40
    const bb = sim.bbox();
    expect(bb).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 40 });
    expect(sim.centroid()).toEqual({ x: 20, y: 20 });
    expect(sim.stretchStats().avg).toBeCloseTo(1, 9);
  });

  it('cellFrac 改動 + rebuildRegions 後仍穩定', () => {
    const sim = new SimCore(MESH());
    sim.params.cellFrac = 0.3;
    sim.rebuildRegions();
    run(sim, 60);
    expect(sim.kineticEnergy()).toBeLessThan(1e-9);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('dt <= 0 為 no-op', () => {
    const sim = new SimCore(MESH());
    const before = Array.from(sim.positions);
    sim.step(0);
    sim.step(-1);
    expect(Array.from(sim.positions)).toEqual(before);
  });
});
