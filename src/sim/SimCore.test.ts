import { describe, expect, it } from 'vitest';

import type { SimMesh } from '../mesh';
import { type Boundary, FloorBoundary, InfiniteBoundary, WalledBoundary } from './boundary';
import { SimCore } from './SimCore';
import type { InputEvent, SurfacePoint } from './types';

/**
 * 手搭一張規則三角網格當測試 fixture（不經 mesh pipeline，讓求解器測試獨立）。
 * `nx × ny` 個頂點、間距 `s`，每個 cell 切兩個三角形（CCW，y 向下）。
 * 可選 `keepCell(i, j)`：只保留遮罩內的 cell（沒被任何三角形用到的頂點一併
 * 剔除、索引重編），用來刻凹形 fixture。
 */
function gridMesh(
  nx: number,
  ny: number,
  s: number,
  keepCell: (i: number, j: number) => boolean = () => true,
): SimMesh {
  const idx = (i: number, j: number) => j * nx + i;
  const rawInd: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      if (!keepCell(i, j)) continue;
      rawInd.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
      rawInd.push(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
    }

  // 未用到的頂點剔除、其餘保持 row-major 順序重編（全保留時索引 = `j * nx + i`）。
  const used = new Set(rawInd);
  const remap = new Map<number, number>();
  const pos: number[] = [];
  for (let raw = 0; raw < nx * ny; raw++) {
    if (!used.has(raw)) continue;
    remap.set(raw, remap.size);
    pos.push((raw % nx) * s, Math.floor(raw / nx) * s);
  }
  const ind = rawInd.map((raw) => remap.get(raw)!);

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

/**
 * 抓 `(x, y)` 往 +x 拉 8 幀（每幀 `dxPerFrame`）後放開——Fling 的共用手勢
 * （issue #93 摩擦、issue #106 側視阻尼測試共用）。
 */
function flingRight(sim: SimCore, x: number, y: number, dxPerFrame = 40): void {
  sim.applyInput({ type: 'grab', id: 'fling', x, y });
  for (let step = 1; step <= 8; step++) {
    sim.applyInput({ type: 'moveGrab', id: 'fling', x: x + dxPerFrame * step, y });
    sim.step(1 / 60);
  }
  sim.applyInput({ type: 'release', id: 'fling' });
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

describe('SimCore — pick', () => {
  it('網格內的點 → 回傳含它的三角形 + 和為 1 的重心座標', () => {
    const sim = new SimCore(gridMesh(5, 5, 10)); // 40×40
    const hit = sim.pick(15, 12);
    expect(hit).not.toBeNull();
    const [w0, w1, w2] = hit!.w;
    expect(w0 + w1 + w2).toBeCloseTo(1, 9);
    for (const w of hit!.w) expect(w).toBeGreaterThanOrEqual(-0.02);
    // 重心座標重建該世界座標
    const [i0, i1, i2] = hit!.tri;
    const rx =
      w0 * sim.positions[2 * i0]! + w1 * sim.positions[2 * i1]! + w2 * sim.positions[2 * i2]!;
    const ry =
      w0 * sim.positions[2 * i0 + 1]! +
      w1 * sim.positions[2 * i1 + 1]! +
      w2 * sim.positions[2 * i2 + 1]!;
    expect(rx).toBeCloseTo(15, 6);
    expect(ry).toBeCloseTo(12, 6);
  });

  it('網格外的點 → null（不做最近 Particle 吸附）', () => {
    const sim = new SimCore(gridMesh(5, 5, 10));
    expect(sim.pick(-50, -50)).toBeNull();
    expect(sim.pick(500, 5)).toBeNull();
  });

  it('跟著變形移動：讀的是目前位置，被抓角落拉走後 pick 跟到新位置', () => {
    const sim = new SimCore(gridMesh(6, 6, 10));
    expect(sim.pick(0, 0)).not.toBeNull();
    sim.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: -40, y: -40 });
    run(sim, 120);
    const now = sim.attachPoint('g')!;
    expect(Math.hypot(now.x - 0, now.y - 0)).toBeGreaterThan(10); // 角落確實移動了
    expect(sim.pick(now.x, now.y)).not.toBeNull(); // pick 命中它的新位置
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

/** 甩動量級擾動：從 `(fromX, fromY)` 抓住、猛拉遠去再放開。 */
function fling(
  sim: SimCore,
  id: string,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): void {
  sim.applyInput({ type: 'grab', id, x: fromX, y: fromY });
  for (let f = 1; f <= 6; f++) {
    sim.applyInput({ type: 'moveGrab', id, x: fromX + dx * f, y: fromY + dy * f });
    sim.step(1 / 60);
  }
  sim.applyInput({ type: 'release', id });
}

describe('SimCore — Pin', () => {
  it('pin 後施加甩動量級擾動 → 被 Pin 的附著點維持不動', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    expect(sim.pinCount).toBe(1);
    expect(sim.grabCount).toBe(0);
    const before = sim.attachPoint('p')!;

    fling(sim, 'y', 96, 96, 200, 160);
    run(sim, 120);

    const after = sim.attachPoint('p')!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-3);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('多個 Pin + 一個 Grab 同時 → 各約束成立、無 NaN', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p1', x: 0, y: 0 });
    sim.applyInput({ type: 'pin', id: 'p2', x: 96, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: 150, y: 150 });
    expect(sim.pinCount).toBe(2);
    expect(sim.grabCount).toBe(1);

    run(sim, 120);

    const p1 = sim.attachPoint('p1')!;
    const p2 = sim.attachPoint('p2')!;
    const g = sim.attachPoint('g')!;
    expect(p1.x).toBeCloseTo(0, 2);
    expect(p1.y).toBeCloseTo(0, 2);
    expect(p2.x).toBeCloseTo(96, 2);
    expect(p2.y).toBeCloseTo(0, 2);
    expect(g.x).toBeCloseTo(150, 2);
    expect(g.y).toBeCloseTo(150, 2);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('unpin → 該點恢復自由', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    run(sim, 30);
    sim.applyInput({ type: 'unpin', id: 'p' });
    expect(sim.pinCount).toBe(0);
    expect(sim.attachPoint('p')).toBeNull();

    const free0 = { x: sim.positions[0]!, y: sim.positions[1]! }; // Particle 0 靜止在 (0,0) 角
    fling(sim, 'y', 96, 96, 160, 160);
    run(sim, 20);
    const free1 = { x: sim.positions[0]!, y: sim.positions[1]! };
    expect(Math.hypot(free1.x - free0.x, free1.y - free0.y)).toBeGreaterThan(1);
  });

  it('movePin → 鎖定點移到新位置並在該處重新硬鎖', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    run(sim, 20);
    sim.applyInput({ type: 'movePin', id: 'p', x: -25, y: -18 });
    run(sim, 90);

    const a = sim.attachPoint('p')!;
    expect(a.x).toBeCloseTo(-25, 3);
    expect(a.y).toBeCloseTo(-18, 3);
    expect(sim.pinCount).toBe(1);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('質心附近數個 Pin + 拉遠端一角 → 質心偏移遠小於無 Pin 對照', () => {
    const centers: Array<[number, number]> = [
      [40, 40],
      [56, 40],
      [40, 56],
      [56, 56],
    ];

    const pinned = new SimCore(MESH());
    const pc0 = pinned.centroid();
    centers.forEach(([x, y], i) => pinned.applyInput({ type: 'pin', id: `c${i}`, x, y }));
    expect(pinned.pinCount).toBe(4);
    pinned.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    pinned.applyInput({ type: 'moveGrab', id: 'g', x: 260, y: 260 });
    run(pinned, 120);
    const maxAt120 = pinned.stretchStats().max;
    run(pinned, 60);
    const pinnedShift = Math.hypot(pinned.centroid().x - pc0.x, pinned.centroid().y - pc0.y);
    // 拉伸比到頂後穩定
    expect(Math.abs(pinned.stretchStats().max - maxAt120)).toBeLessThan(0.05 * maxAt120);

    const bare = new SimCore(MESH());
    const bc0 = bare.centroid();
    bare.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    bare.applyInput({ type: 'moveGrab', id: 'g', x: 260, y: 260 });
    run(bare, 180);
    const bareShift = Math.hypot(bare.centroid().x - bc0.x, bare.centroid().y - bc0.y);

    expect(pinnedShift).toBeLessThan(bareShift * 0.5);
    expect(allFinite(pinned.positions)).toBe(true);
  });

  it('不相干的 Grab 剛好抓在 Pin 同一個三角形上、用力拖走 → Pin 自己紋風不動', () => {
    // 兩個約束共用同一個三角形／權重（同座標 picking 必命中同一個三角形）：
    // Pin 用 id='p' 先建；'other' 用不同 id 建一個 Grab、再拖到很遠。修 bug 前
    // Grab 在 Map 插入順序上排在 Pin 之後，會在同一個 substep 覆寫掉 Pin 的修正，
    // 把 Pin 的附著點一路拖走——這裡驗證改成「Pin 永遠最後解」後不會再發生。
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 48, y: 48 });
    const before = sim.attachPoint('p')!;

    sim.applyInput({ type: 'grab', id: 'other', x: 48, y: 48 });
    for (let f = 1; f <= 30; f++) {
      sim.applyInput({ type: 'moveGrab', id: 'other', x: 48 + 5 * f, y: 48 + 5 * f });
      sim.step(1 / 60);
    }

    const after = sim.attachPoint('p')!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  });

  it('Pin 建立在先、Grab 在後也一樣不會被拖走（不依賴約束的插入順序）', () => {
    // 上一個測項的 Pin 剛好先建；這裡反過來——Grab 先建、Pin 後建，且刻意用
    // 「插入順序」上會排在 Pin 之後的第三個約束再次確認 Pin 恆常最後解。
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'grab', id: 'other', x: 48, y: 48 });
    sim.applyInput({ type: 'pin', id: 'p', x: 48, y: 48 });
    const before = sim.attachPoint('p')!;

    for (let f = 1; f <= 30; f++) {
      sim.applyInput({ type: 'moveGrab', id: 'other', x: 48 - 5 * f, y: 48 + 5 * f });
      sim.step(1 / 60);
    }

    const after = sim.attachPoint('p')!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  });

  it('pin 不帶座標 → 就地把 Grab 凍結成 Pin，之後 moveGrab 被忽略', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'grab', id: 'h', x: 0, y: 0 });
    sim.applyInput({ type: 'moveGrab', id: 'h', x: -30, y: -20 });
    run(sim, 60);
    const held = sim.attachPoint('h')!;

    sim.applyInput({ type: 'pin', id: 'h' });
    expect(sim.pinCount).toBe(1);
    expect(sim.grabCount).toBe(0);

    sim.applyInput({ type: 'moveGrab', id: 'h', x: 300, y: 300 });
    run(sim, 120);
    const after = sim.attachPoint('h')!;
    expect(Math.hypot(after.x - held.x, after.y - held.y)).toBeLessThan(1);
  });

  it('release 不會解除 Pin', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    sim.applyInput({ type: 'release', id: 'p' });
    expect(sim.pinCount).toBe(1);
    expect(sim.attachPoint('p')).not.toBeNull();
  });

  it('pin 帶座標但 picking 沒命中 → no-op，不會把同 id 的既有 Grab 就地凍結', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'grab', id: 'x', x: 0, y: 0 });
    sim.applyInput({ type: 'moveGrab', id: 'x', x: -20, y: -20 });
    run(sim, 20);

    // 座標遠在網格外、半徑極小 → picking 必落空
    sim.applyInput({ type: 'pin', id: 'x', x: 10_000, y: 10_000, radius: 1e-3 });
    expect(sim.pinCount).toBe(0);
    expect(sim.grabCount).toBe(1);

    // 仍是活的 Grab：moveGrab 照常生效
    sim.applyInput({ type: 'moveGrab', id: 'x', x: 30, y: 25 });
    run(sim, 90);
    const a = sim.attachPoint('x')!;
    expect(a.x).toBeCloseTo(30, 2);
    expect(a.y).toBeCloseTo(25, 2);
  });

  it('clearPins：一次移除所有 Pin，保留 Grab', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p1', x: 0, y: 0 });
    sim.applyInput({ type: 'pin', id: 'p2', x: 96, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    expect(sim.pinCount).toBe(2);
    expect(sim.grabCount).toBe(1);

    sim.clearPins();

    expect(sim.pinCount).toBe(0);
    expect(sim.grabCount).toBe(1);
    expect(sim.attachPoint('p1')).toBeNull();
    expect(sim.attachPoint('p2')).toBeNull();
    expect(sim.attachPoint('g')).not.toBeNull();
  });

  it("applyInput({ type: 'clearPins' })：清掉所有 Pin，保留未鎖的 Grab（比照 clearPins()）", () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p1', x: 0, y: 0 });
    sim.applyInput({ type: 'pin', id: 'p2', x: 96, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    expect(sim.pinCount).toBe(2);
    expect(sim.grabCount).toBe(1);

    sim.applyInput({ type: 'clearPins' });

    expect(sim.pinCount).toBe(0);
    expect(sim.grabCount).toBe(1);
    expect(sim.attachPoint('p1')).toBeNull();
    expect(sim.attachPoint('p2')).toBeNull();
    expect(sim.attachPoint('g')).not.toBeNull();
  });

  it("applyInput({ type: 'clearPins' })：畫面上沒有 Pin 時是 no-op（不丟例外）", () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    expect(() => sim.applyInput({ type: 'clearPins' })).not.toThrow();
    expect(sim.grabCount).toBe(1);
  });

  it('listPins：回傳每個 Pin 的 id + 附著點，不含 Grab', () => {
    const sim = new SimCore(MESH());
    expect(sim.listPins()).toEqual([]);

    sim.applyInput({ type: 'pin', id: 'p1', x: 0, y: 0 });
    sim.applyInput({ type: 'pin', id: 'p2', x: 96, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });

    const pins = sim.listPins();
    expect(pins).toHaveLength(2);
    const byId = new Map(pins.map((p) => [p.id, p.point]));
    expect(byId.get('p1')!.x).toBeCloseTo(0, 6);
    expect(byId.get('p1')!.y).toBeCloseTo(0, 6);
    expect(byId.get('p2')!.x).toBeCloseTo(96, 6);
    expect(byId.get('p2')!.y).toBeCloseTo(0, 6);

    sim.clearPins();
    expect(sim.listPins()).toEqual([]);
  });

  it('listPins：附著點隨網格變形移動（跟 attachPoint 一致）', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: 140, y: 130 });
    run(sim, 30);

    const pins = sim.listPins();
    expect(pins).toHaveLength(1);
    expect(pins[0]!.id).toBe('p');
    expect(pins[0]!.point).toEqual(sim.attachPoint('p'));
  });

  it('決定性：含 pin / movePin / unpin 的事件流兩次跑結果完全相等', () => {
    const play = (): number[] => {
      const sim = new SimCore(MESH());
      sim.applyInput({ type: 'pin', id: 1, x: 0, y: 0 });
      sim.applyInput({ type: 'grab', id: 2, x: 96, y: 96 });
      sim.applyInput({ type: 'moveGrab', id: 2, x: 140, y: 130 });
      run(sim, 15);
      sim.applyInput({ type: 'movePin', id: 1, x: -10, y: -8 });
      run(sim, 15);
      sim.applyInput({ type: 'unpin', id: 1 });
      sim.applyInput({ type: 'pin', id: 2 }); // Grab 就地轉 Pin
      run(sim, 20);
      return Array.from(sim.positions);
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(allFinite(a)).toBe(true);
  });
});

describe('SimCore — restAttachPoint（片段初始 Pin 的 rest 座標，issue #39）', () => {
  it('同一個 Pin，Jelly 變形前後回傳同一個 rest 附著座標', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 24, y: 24 });
    const before = sim.restAttachPoint('p');
    expect(before).not.toBeNull();
    expect(before!.x).toBeCloseTo(24, 6);
    expect(before!.y).toBeCloseTo(24, 6);

    // 拉另一角大幅變形，跑到穩定
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: 170, y: 150 });
    run(sim, 90);

    expect(sim.restAttachPoint('p')).toEqual(before);
  });

  it('回算的是原始三角形＋重心座標套在 rest 上：movePin 把附著點拖走後仍不動', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 24, y: 24 });
    const rest = sim.restAttachPoint('p')!;
    expect(rest.x).toBeCloseTo(24, 6);
    expect(rest.y).toBeCloseTo(24, 6);

    // movePin 只改目標點、不改三角形／重心座標 → attachPoint（目前）跟去新位置
    sim.applyInput({ type: 'movePin', id: 'p', x: 80, y: 70 });
    run(sim, 60);

    const now = sim.attachPoint('p')!;
    expect(Math.hypot(now.x - 80, now.y - 70)).toBeLessThan(1); // 目前附著點被拖到 (80,70)
    expect(sim.restAttachPoint('p')).toEqual(rest); // rest 回算仍在原本的表面點
  });

  it('拍快照時 Jelly 正在晃 → 回傳的 rest 座標之後不再隨變形改變', () => {
    const sim = new SimCore(MESH());
    // 先讓網格晃起來
    sim.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: -20, y: -16 });
    run(sim, 10);
    sim.applyInput({ type: 'release', id: 'g' });
    run(sim, 3);

    // 晃動中把靠近中心的一點 picking 成 Pin
    sim.applyInput({ type: 'pin', id: 'p', x: 48, y: 48 });
    const rest = sim.restAttachPoint('p')!;
    // 落在 rest 形狀的網格範圍內、靠近被 pick 的中心區
    expect(rest.x).toBeGreaterThan(24);
    expect(rest.x).toBeLessThan(72);
    expect(rest.y).toBeGreaterThan(24);
    expect(rest.y).toBeLessThan(72);

    run(sim, 60);
    expect(sim.restAttachPoint('p')).toEqual(rest);
  });

  it('未知 id → null', () => {
    const sim = new SimCore(MESH());
    expect(sim.restAttachPoint('nope')).toBeNull();
  });
});

/** 把所有 Particle 對質心 (48,48) 水平拉伸、垂直壓成一條近水平線。 */
function squash(sim: SimCore): void {
  const p = sim.positions; // 極端初始狀態：測試直接改動內部緩衝（非算繪端）
  for (let i = 0; i < p.length / 2; i++) {
    p[2 * i] = 48 + (p[2 * i]! - 48) * 1.5;
    p[2 * i + 1] = 48 + (p[2 * i + 1]! - 48) * 0.03;
  }
}

describe('SimCore — XPBD 細節層', () => {
  it('開與關：長時間 step + 甩動皆不產生 NaN', () => {
    for (const xpbd of [true, false]) {
      const sim = new SimCore(MESH(), { xpbd });
      fling(sim, 'f', 96, 96, 180, 140);
      run(sim, 300);
      expect(allFinite(sim.positions)).toBe(true);
      expect(Number.isFinite(sim.stretchStats().max)).toBe(true);
      expect(Number.isFinite(sim.areaStats().min)).toBe(true);
      expect(Number.isFinite(sim.kineticEnergy())).toBe(true);
    }
  });

  it('軟脊椎 + 大幅拖曳：開啟時最小三角面積比明顯高於關閉時', () => {
    const soft = { alphaSm: 0.2, cellFrac: 0.15 } as const;
    const drag = (sim: SimCore) => {
      sim.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 });
      sim.applyInput({ type: 'moveGrab', id: 'g', x: -200, y: -160 });
      run(sim, 150);
    };
    const on = new SimCore(MESH(), { ...soft, xpbd: true });
    const off = new SimCore(MESH(), { ...soft, xpbd: false });
    drag(on);
    drag(off);

    // 關閉時軟脊椎撐不住 → 靠近把手的三角形塌陷／翻面（min < 0）；
    // 開啟時 signed-area 約束把它們撐住（min 明顯較高、無翻面）。
    expect(off.areaStats().min).toBeLessThan(0);
    expect(on.areaStats().min).toBeGreaterThan(off.areaStats().min + 0.5);
    expect(on.areaStats().min).toBeGreaterThan(0);
    expect(allFinite(on.positions)).toBe(true);
    expect(allFinite(off.positions)).toBe(true);
  });

  it('壓扁成一條線再 step 數百次 → 邊拉伸比回到 ~1、無殘留翻面', () => {
    const sim = new SimCore(MESH(), { xpbd: true });
    squash(sim);
    run(sim, 400);

    const s = sim.stretchStats();
    expect(s.avg).toBeGreaterThan(0.9);
    expect(s.avg).toBeLessThan(1.1);
    expect(s.max).toBeLessThan(1.5);
    expect(sim.areaStats().min).toBeGreaterThan(0); // 無殘留翻面
    expect(sim.kineticEnergy()).toBeLessThan(1e-3);
  });

  it('硬脊椎下開/關差異很小', () => {
    const drag = (sim: SimCore) => {
      sim.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 });
      sim.applyInput({ type: 'moveGrab', id: 'g', x: -40, y: -40 });
      run(sim, 90);
    };
    const on = new SimCore(MESH(), { xpbd: true }); // 預設 α_sm 0.7、cellFrac 0.15（硬）
    const off = new SimCore(MESH(), { xpbd: false });
    drag(on);
    drag(off);

    expect(Math.abs(on.stretchStats().max - off.stretchStats().max)).toBeLessThan(0.15);
    expect(Math.abs(on.areaStats().min - off.areaStats().min)).toBeLessThan(0.15);
  });

  it('靜置時 XPBD 為 no-op（位置不漂移）', () => {
    const sim = new SimCore(MESH(), { xpbd: true });
    const before = Float64Array.from(sim.positions);
    run(sim, 120);
    for (let i = 0; i < before.length; i++) expect(sim.positions[i]!).toBeCloseTo(before[i]!, 9);
    expect(sim.areaStats().min).toBeCloseTo(1, 6);
    expect(sim.areaStats().max).toBeCloseTo(1, 6);
  });
});

describe('SimCore — Tap', () => {
  it('tap → 動能出現有界尖峰、數秒內 ring-down 回 ~0', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'tap', x: 48, y: 48 });

    const peak = sim.kineticEnergy();
    expect(peak).toBeGreaterThan(0);
    expect(Number.isFinite(peak)).toBe(true);

    run(sim, 240); // 4 秒
    expect(sim.kineticEnergy()).toBeLessThan(peak * 1e-3);
    expect(sim.kineticEnergy()).toBeLessThan(1);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('tap 後最大邊拉伸比有界、無 NaN', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'tap', x: 48, y: 48, strength: 9000 });
    for (let f = 0; f < 120; f++) {
      sim.step(1 / 60);
      expect(Number.isFinite(sim.stretchStats().max)).toBe(true);
      expect(sim.stretchStats().max).toBeLessThan(6); // 有界，不發散
    }
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('拍在 Jelly 外（附近無 Particle）→ 狀態完全不變', () => {
    const sim = new SimCore(MESH());
    const before = Array.from(sim.positions);
    sim.applyInput({ type: 'tap', x: 100_000, y: 100_000 });
    expect(sim.kineticEnergy()).toBe(0);
    run(sim, 30);
    expect(Array.from(sim.positions)).toEqual(before);
  });

  it('strength 加倍 → 動能尖峰約 4×（KE ∝ strength²）', () => {
    const a = new SimCore(MESH());
    a.applyInput({ type: 'tap', x: 48, y: 48, strength: 3000 });
    const b = new SimCore(MESH());
    b.applyInput({ type: 'tap', x: 48, y: 48, strength: 6000 });
    expect(b.kineticEnergy() / a.kineticEnergy()).toBeCloseTo(4, 6);
  });

  it('決定性：相同 tap 事件流兩次跑結果完全相等', () => {
    const play = (): number[] => {
      const sim = new SimCore(MESH());
      sim.applyInput({ type: 'tap', x: 40, y: 52 });
      run(sim, 20);
      sim.applyInput({ type: 'tap', x: 60, y: 44, strength: 9000 });
      run(sim, 20);
      return Array.from(sim.positions);
    };
    expect(play()).toEqual(play());
  });
});

describe('SimCore — Fan（issue #66 / V2 T3-2；ADR-0010；issue #67 事後檢視改成陣風）', () => {
  /**
   * `frequency * h ≥ 1` 時 `rng() < frequency * h` 恆真（`rng()` 落在
   * `[0, 1)`）——保證每個 substep 都觸發陣風，等同還原成舊版連續力場，方便
   * 沿用既有的空間形狀測試（矩形涵蓋、falloff、Pin 免疫……）而不必為了單純
   * 驗證「形狀」還要顧慮陣風有沒有抽中。真正驗證「陣風真的是離散、機率性」
   * 的測試在檔案最後，見「頻率」小節。
   */
  const FORCE_EVERY_SUBSTEP = 1e9;

  it('矩形完全沒涵蓋到任何 Particle → 狀態完全不變', () => {
    const sim = new SimCore(MESH());
    const before = Array.from(sim.positions);
    sim.applyInput({
      type: 'setFan',
      originX: 1000,
      originY: 1000,
      dirX: 1,
      dirY: 0,
      length: 50,
      width: 50,
      strength: 5000,
      falloffExponent: 1,
      frequency: FORCE_EVERY_SUBSTEP,
    });
    run(sim, 30);
    expect(Array.from(sim.positions)).toEqual(before);
  });

  it('矩形內獲得沿吹風方向的位移，矩形外（橫向超出半寬）幾乎無感', () => {
    const sim = new SimCore(MESH());
    // 涵蓋 y ∈ [38, 58] 的窄帶（半寬 10，中心 y=48），沿 +x 吹到底。單一極小步
    // （比照 falloffExponent 測試）＋強制每個 substep 都吹：讓比較聚焦在「這
    // 一步電風扇本身加了多少速度」，不被後續多步的 shape-matching 彈性耦合
    // （regions 重疊、會把擾動傳給鄰近但沒被風扇直接吹到的 Particle）淹沒、
    // 也不受陣風有沒有抽中影響。
    sim.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 48,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 20,
      strength: 6000,
      falloffExponent: 1,
      frequency: FORCE_EVERY_SUBSTEP,
    });
    sim.step(1 / 6000);

    // (0, 48)：窄帶正中央，緊貼風扇面 → 應該明顯往 +x 位移。
    const insideIdx = 6 * 13 + 0; // i=0(x=0), j=6(y=48)
    const outsideIdx = 12 * 13 + 0; // i=0(x=0), j=12(y=96)：離窄帶 48 單位，遠超半寬
    const insideDx = sim.positions[2 * insideIdx]! - 0;
    const outsideDx = sim.positions[2 * outsideIdx]! - 0;

    expect(insideDx).toBeGreaterThan(1e-6);
    expect(Math.abs(outsideDx)).toBeLessThan(insideDx * 0.05);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('同縱向距離、不同橫向位置 → 位移一致（力只跟縱向距離有關）', () => {
    const sim = new SimCore(MESH());
    // 寬度覆蓋整個 mesh（半寬 100 ≥ 96），沿 +x 吹，兩個 y 不同、x 相同的點應等量位移。
    sim.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 48,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 200,
      strength: 6000,
      falloffExponent: 1,
      frequency: FORCE_EVERY_SUBSTEP,
    });
    sim.step(1 / 6000); // 單一極小步，理由同上

    const a = 3 * 13 + 0; // i=0(x=0), j=3(y=24)
    const b = 9 * 13 + 0; // i=0(x=0), j=9(y=72)
    const dxA = sim.positions[2 * a]! - 0;
    const dxB = sim.positions[2 * b]! - 0;
    expect(dxA).toBeGreaterThan(1e-6);
    expect(dxA).toBeCloseTo(dxB, 6);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('縱向越遠力越小：緊貼風扇面的點比矩形遠端的點位移更多', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 48,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 200,
      strength: 6000,
      falloffExponent: 1,
      frequency: FORCE_EVERY_SUBSTEP,
    });
    sim.step(1 / 6000); // 單一極小步，理由同上

    const near = 6 * 13 + 0; // i=0(x=0)：緊貼風扇面，falloff 最大
    const far = 6 * 13 + 12; // i=12(x=96)：矩形遠端（縱向距離 = length），falloff → 0
    const dxNear = sim.positions[2 * near]! - 0;
    const dxFar = sim.positions[2 * far]! - 96;
    expect(dxNear).toBeGreaterThan(1e-6);
    expect(dxFar).toBeGreaterThan(0); // 仍會被吹到一點（靠鄰近 Particle 的彈性耦合），但遠小於 near
    expect(dxFar).toBeLessThan(dxNear * 0.5);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('falloffExponent 加大 → 同一個縱向位置的力衰減更快（同 strength 比較）', () => {
    const HALF_LENGTH_IDX = 6 * 13 + 6; // i=6(x=48)，縱向距離 = length/2 = 48 → (1 − 0.5)^exponent

    function halfwayDx(falloffExponent: number): number {
      const sim = new SimCore(MESH());
      sim.applyInput({
        type: 'setFan',
        originX: 0,
        originY: 48,
        dirX: 1,
        dirY: 0,
        length: 96,
        width: 200,
        strength: 6000,
        falloffExponent,
        frequency: FORCE_EVERY_SUBSTEP,
      });
      sim.step(1 / 6000); // 單一極小步，讓彈性回拉可忽略，貼近純速度注入的比較
      return sim.positions[2 * HALF_LENGTH_IDX]! - 48;
    }

    const dxExp1 = halfwayDx(1); // falloff = 0.5
    const dxExp4 = halfwayDx(4); // falloff = 0.5^4 = 0.0625，衰減明顯更快
    expect(dxExp1).toBeGreaterThan(0);
    expect(dxExp4).toBeGreaterThan(0);
    expect(dxExp4).toBeLessThan(dxExp1 * 0.5);
  });

  it('已 Pin 的點在風扇作用下附著點仍不動', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'pin', id: 'p', x: 48, y: 48 });
    const before = sim.attachPoint('p')!;

    sim.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 0,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 200,
      strength: 8000,
      falloffExponent: 1,
      frequency: FORCE_EVERY_SUBSTEP,
    });
    run(sim, 120);

    const after = sim.attachPoint('p')!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-3);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('clearFan 後力立即消失：後續動能不再被推高，改為衰減', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 0,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 200,
      strength: 6000,
      falloffExponent: 1,
      frequency: FORCE_EVERY_SUBSTEP,
    });
    run(sim, 60);
    const keWithFan = sim.kineticEnergy();
    expect(keWithFan).toBeGreaterThan(0);

    sim.applyInput({ type: 'clearFan' });
    run(sim, 60);
    const keAfterClear = sim.kineticEnergy();
    expect(keAfterClear).toBeLessThan(keWithFan);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('決定性：相同 setFan/clearFan 事件流兩次跑結果完全相等（含陣風時機——同一顆種子重新播種，見 SimCore 建構子）', () => {
    const play = (): number[] => {
      const sim = new SimCore(MESH());
      sim.applyInput({
        type: 'setFan',
        originX: 0,
        originY: 0,
        dirX: 1,
        dirY: 0,
        length: 96,
        width: 200,
        strength: 6000,
        falloffExponent: 1,
        frequency: 3,
      });
      run(sim, 20);
      sim.applyInput({
        type: 'setFan',
        originX: 96,
        originY: 96,
        dirX: -1,
        dirY: 0,
        length: 60,
        width: 40,
        strength: 9000,
        falloffExponent: 2,
        frequency: 6,
      });
      run(sim, 20);
      sim.applyInput({ type: 'clearFan' });
      run(sim, 20);
      return Array.from(sim.positions);
    };
    expect(play()).toEqual(play());
  });

  describe('頻率（issue #67 事後檢視追加：推力從連續力場改成離散陣風）', () => {
    it('frequency = 0 → 陣風永遠不觸發，矩形內外都無感（機率恆為 0，非統計性、不會偶發失敗）', () => {
      const sim = new SimCore(MESH());
      const before = Array.from(sim.positions);
      sim.applyInput({
        type: 'setFan',
        originX: 0,
        originY: 48,
        dirX: 1,
        dirY: 0,
        length: 96,
        width: 200,
        strength: 6000,
        falloffExponent: 1,
        frequency: 0,
      });
      run(sim, 60);
      expect(Array.from(sim.positions)).toEqual(before);
    });

    it('頻率愈高，同樣（短）時間內累積的動能愈高（陣風次數變多、不是固定力道）', () => {
      // 刻意用短視窗（5 幀）比較，不是像上面「強制每個 substep 都吹」跑一長段：
      // 拉到極端頻率長跑，Particle 很快就被吹出矩形（沿吹風方向超出 length）
      // 不再受力，加上後續振盪／阻尼的交互作用，長時間下來的動能末值不見得隨
      // 頻率單調——這裡只要證明「頻率確實調控陣風次數」，短視窗、力道還沒讓
      // Particle 飛出矩形之前比較最乾淨。
      function kineticEnergyAfter(frequency: number): number {
        const sim = new SimCore(MESH());
        sim.applyInput({
          type: 'setFan',
          originX: 0,
          originY: 0,
          dirX: 1,
          dirY: 0,
          length: 96,
          width: 200,
          strength: 6000,
          falloffExponent: 1,
          frequency,
        });
        run(sim, 5);
        return sim.kineticEnergy();
      }

      const keSparse = kineticEnergyAfter(0.5); // 5 幀 ≈ 0.083 秒，期望陣風次數 ≈ 0.04，幾乎抽不中
      const keFrequent = kineticEnergyAfter(50); // 同樣 5 幀，期望陣風次數 ≈ 4.2，多次抽中
      expect(keFrequent).toBeGreaterThan(keSparse);
    });
  });
});

describe('SimCore — Boundary', () => {
  /** 抓右緣一點把整塊 Jelly 甩向 −X（`reach` = 每幀左移量），然後放開。 */
  function flingLeft(sim: SimCore, reach = 90): void {
    sim.applyInput({ type: 'grab', id: 'f', x: 96, y: 48 });
    for (let step = 1; step <= 8; step++) {
      sim.applyInput({ type: 'moveGrab', id: 'f', x: 96 - reach * step, y: 48 });
      sim.step(1 / 60);
    }
    sim.applyInput({ type: 'release', id: 'f' });
  }

  const minX = (sim: SimCore) => sim.bbox().minX;
  const minParticleX = (sim: SimCore) => {
    let m = Infinity;
    for (let i = 0; i < sim.positions.length; i += 2)
      if (sim.positions[i]! < m) m = sim.positions[i]!;
    return m;
  };

  it('Walled：甩向牆 → Particle 全程不越界、撞到牆、收斂', () => {
    const wall = -20;
    const sim = new SimCore(MESH());
    sim.setBoundary(new WalledBoundary({ minX: wall, minY: -400, maxX: 400, maxY: 400 }));

    flingLeft(sim, 22); // 較溫和：確保撞牆而非把約束撐爆
    let reachedWall = false;
    for (let f = 0; f < 240; f++) {
      sim.step(1 / 60);
      expect(minParticleX(sim)).toBeGreaterThanOrEqual(wall - 1e-6); // 全程不滲牆
      if (minParticleX(sim) <= wall + 1) reachedWall = true;
    }
    expect(reachedWall).toBe(true); // 確實有甩到牆
    expect(sim.kineticEnergy()).toBeLessThan(1); // 向外動量被牆吸收 → 收斂
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('Walled：桌面比 Jelly 窄 → Jelly 被擠壓進盒內', () => {
    const sim = new SimCore(MESH()); // rest x ∈ [0, 96]
    const restWidth = sim.bbox().maxX - sim.bbox().minX;
    const boxW = 60;
    sim.setBoundary(new WalledBoundary({ minX: 10, minY: -400, maxX: 10 + boxW, maxY: 400 }));
    run(sim, 180);

    const width = sim.bbox().maxX - sim.bbox().minX;
    expect(width).toBeLessThanOrEqual(boxW + 1e-6); // 塞得進盒子
    expect(width).toBeLessThan(restWidth * 0.9); // 明顯被擠壓
    for (let i = 0; i < sim.positions.length; i += 2) {
      const x = sim.positions[i]!;
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(10 + boxW + 1e-6);
    }
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('Infinite：Jelly 可被甩到任意遠、位置不受限', () => {
    const sim = new SimCore(MESH()); // 預設 Infinite
    flingLeft(sim);
    run(sim, 120);
    expect(minX(sim)).toBeLessThan(-300); // 飛出去很遠，沒有牆擋
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('執行期切換 Walled ⇄ Infinite：不重建求解器、不爆炸', () => {
    const sim = new SimCore(MESH());
    sim.setBoundary(new WalledBoundary({ minX: -30, minY: -300, maxX: 300, maxY: 300 }));
    flingLeft(sim);
    run(sim, 60);
    expect(minX(sim)).toBeGreaterThanOrEqual(-30 - 1e-6);

    sim.setBoundary(new InfiniteBoundary()); // 切成無牆
    flingLeft(sim);
    run(sim, 120);
    expect(minX(sim)).toBeLessThan(-200); // 現在飛得出去

    sim.setBoundary(new WalledBoundary({ minX: -30, minY: -300, maxX: 300, maxY: 300 }));
    run(sim, 120); // 已在界外 → 被拉回牆內，無 NaN
    expect(minX(sim)).toBeGreaterThanOrEqual(-30 - 1e-6);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('決定性：含 setBoundary 的事件流兩次跑結果完全相等', () => {
    const play = (): number[] => {
      const sim = new SimCore(MESH());
      sim.setBoundary(new WalledBoundary({ minX: -40, minY: -200, maxX: 200, maxY: 200 }));
      flingLeft(sim);
      run(sim, 40);
      sim.setBoundary(new InfiniteBoundary());
      run(sim, 40);
      return Array.from(sim.positions);
    };
    expect(play()).toEqual(play());
  });
});

describe('SimCore — FloorBoundary（issue #92 / V3 T2-2；ADR-0012）', () => {
  /** 抓上緣一點把整塊 Jelly 甩向 +y（往下），然後放開。 */
  function flingDown(sim: SimCore, reach = 22): void {
    sim.applyInput({ type: 'grab', id: 'f', x: 48, y: 0 });
    for (let step = 1; step <= 8; step++) {
      sim.applyInput({ type: 'moveGrab', id: 'f', x: 48, y: reach * step });
      sim.step(1 / 60);
    }
    sim.applyInput({ type: 'release', id: 'f' });
  }

  const maxParticleY = (sim: SimCore) => {
    let m = -Infinity;
    for (let i = 1; i < sim.positions.length; i += 2)
      if (sim.positions[i]! > m) m = sim.positions[i]!;
    return m;
  };

  it('往下甩 → Particle 全程不穿地板、質心 y 收斂到 ≤ floorY、速度收斂到 0', () => {
    const floorY = 120; // 網格 y ∈ [0, 96]，地板在下方 24 單位
    const sim = new SimCore(MESH());
    sim.setBoundary(new FloorBoundary({ floorY }));

    flingDown(sim);
    let reachedFloor = false;
    for (let f = 0; f < 240; f++) {
      sim.step(1 / 60);
      expect(maxParticleY(sim)).toBeLessThanOrEqual(floorY + 1e-6); // 全程不滲地板
      if (maxParticleY(sim) >= floorY - 1) reachedFloor = true;
    }
    expect(reachedFloor).toBe(true); // 確實有甩到地板
    expect(sim.centroid().y).toBeLessThanOrEqual(floorY);
    expect(sim.kineticEnergy()).toBeLessThan(1);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('往左右甩 → 不撞任何牆、飛得出去（x 方向無限）', () => {
    const sim = new SimCore(MESH());
    sim.setBoundary(new FloorBoundary({ floorY: 120 }));
    sim.applyInput({ type: 'grab', id: 'f', x: 96, y: 48 });
    for (let step = 1; step <= 8; step++) {
      sim.applyInput({ type: 'moveGrab', id: 'f', x: 96 - 90 * step, y: 48 });
      sim.step(1 / 60);
    }
    sim.applyInput({ type: 'release', id: 'f' });
    run(sim, 120);
    expect(sim.bbox().minX).toBeLessThan(-200);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('重力 + Floor：落下後停在地板上，質心收斂、動能歸零、不橫向滑走', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    const floorY = 300;
    sim.setBoundary(new FloorBoundary({ floorY }));
    run(sim, 300); // 5 s
    const a = sim.centroid();
    run(sim, 60);
    const b = sim.centroid();
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.1);
    expect(sim.bbox().maxY).toBeLessThanOrEqual(floorY + 1e-9);
    expect(sim.bbox().maxY).toBeGreaterThan(floorY - 1);
    expect(sim.kineticEnergy()).toBeLessThan(1);
  });

  it('地板貼齊 bbox 底邊（floorY = maxY）時，靜置的 Jelly 不動也不被推開', () => {
    const sim = new SimCore(MESH());
    const before = Float64Array.from(sim.positions);
    sim.setBoundary(new FloorBoundary({ floorY: sim.bbox().maxY }));
    run(sim, 60);
    expect(Array.from(sim.positions)).toEqual(Array.from(before));
  });
});

describe('SimCore — 邊界摩擦（issue #93 / V3 T2-3；ADR-0012）', () => {
  /**
   * 重力下讓 Jelly 在 `boundary` 的地板上站穩，再抓**右下角**往 +x 拉 8 幀後放開，
   * 讓整塊貼著地板滑。抓下角是因為抓上緣或中段甩出去 Jelly 會前傾翻滾、底邊離地，
   * 摩擦沒東西可作用（實測翻滾時摩擦 0 vs 1 距離只差 ~15%）；貼地滑時 friction 0.3
   * 距離約為無摩擦的一半。抓點 `(96, 96)` 是 `MESH()` 的右下角——換 fixture 要跟著改。
   * 回傳站穩後（甩之前）的質心 x，供呼叫端算滑行距離。
   */
  /** `MESH()` 的 bbox 底邊——地板貼齊它，Jelly 一開始就站在地板上。 */
  const GROUND_Y = 96;

  function flingAlongFloor(sim: SimCore, boundary: Boundary): number {
    sim.params.gravity = 2000;
    sim.setBoundary(boundary);
    run(sim, 30); // 先讓它在地板上站穩
    const restX = sim.centroid().x;
    flingRight(sim, 96, 96);
    return restX;
  }

  /**
   * 甩完跑 4 s，回傳質心 x 總位移。有摩擦那組 4 s 早就停了（`slideUntilStopped` 驗）；
   * 無摩擦那組在側視阻尼拆開後（issue #106）質心只剩 `airDamping`，不會自己停——所以
   * 這裡量的是固定時間的距離，不是「停下的距離」。
   */
  function slideFor4s(sim: SimCore, boundary: Boundary): number {
    const restX = flingAlongFloor(sim, boundary);
    run(sim, 240);
    expect(allFinite(sim.positions)).toBe(true);
    return sim.centroid().x - restX;
  }

  /** `slideFor4s` 之後再跑 1 s 確認質心 x 已不再變，回傳總滑行距離（= 停下的距離）。 */
  function slideUntilStopped(sim: SimCore, boundary: Boundary): number {
    const d = slideFor4s(sim, boundary);
    const a = sim.centroid().x;
    run(sim, 60);
    const b = sim.centroid().x;
    expect(Math.abs(b - a)).toBeLessThan(0.1); // 已經停了，量到的才是「停下的距離」
    return d + (b - a);
  }

  it('重力 + Floor + 側向初速：friction > 0 時質心 x 停下的距離明顯短於 friction = 0', () => {
    const slick = slideFor4s(new SimCore(MESH()), new FloorBoundary({ floorY: GROUND_Y }));
    const rough = slideUntilStopped(
      new SimCore(MESH()),
      new FloorBoundary({ floorY: GROUND_Y, friction: 0.3 }),
    );
    expect(slick).toBeGreaterThan(0); // 確實有抓到、有甩出去
    expect(rough).toBeGreaterThan(0); // 還是有滑出去，不是黏住
    expect(rough).toBeLessThan(slick * 0.7);
  });

  it('有摩擦時滑到停：放開 4 s 後動能歸零', () => {
    const sim = new SimCore(MESH());
    slideUntilStopped(sim, new FloorBoundary({ floorY: GROUND_Y, friction: 0.3 }));
    expect(sim.kineticEnergy()).toBeLessThan(1);
  });

  it('Walled 有摩擦：重力下沿箱底滑，同樣比無摩擦停得短', () => {
    // 箱子要夠寬：無摩擦那組 4 s 會滑 ~6000 單位，撞到右牆會被彈回來、距離量不準。
    const box = { minX: -20000, minY: -100, maxX: 20000, maxY: GROUND_Y };
    const slick = slideFor4s(new SimCore(MESH()), new WalledBoundary(box));
    const rough = slideUntilStopped(
      new SimCore(MESH()),
      new WalledBoundary({ ...box, friction: 0.3 }),
    );
    expect(rough).toBeGreaterThan(0);
    expect(rough).toBeLessThan(slick * 0.7);
  });

  it('決定性：同輸入兩次跑位置位元相同', () => {
    const runOnce = () => {
      const sim = new SimCore(MESH());
      flingAlongFloor(sim, new FloorBoundary({ floorY: GROUND_Y, friction: 0.3 }));
      run(sim, 120);
      return Array.from(sim.positions);
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('SimCore — reset', () => {
  it('位置回到 rest、速度歸零、清掉 Grab／Pin', () => {
    const sim = new SimCore(MESH());
    const rest = Float64Array.from(sim.positions);

    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    sim.applyInput({ type: 'moveGrab', id: 'g', x: 140, y: 130 });
    run(sim, 30);
    expect(sim.kineticEnergy()).toBeGreaterThan(0); // 甩動中，確實有動能可歸零

    sim.reset();

    expect(Array.from(sim.positions)).toEqual(Array.from(rest));
    expect(sim.kineticEnergy()).toBe(0);
    expect(sim.pinCount).toBe(0);
    expect(sim.grabCount).toBe(0);
  });

  it('reset 後仍可正常 step、grab、pin', () => {
    const sim = new SimCore(MESH());
    sim.applyInput({ type: 'grab', id: 'g', x: 0, y: 0 });
    run(sim, 10);
    sim.reset();

    sim.applyInput({ type: 'pin', id: 'p', x: 96, y: 96 });
    run(sim, 60);
    expect(sim.pinCount).toBe(1);
    expect(sim.kineticEnergy()).toBeLessThan(1e-6);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('reset 也會清掉場上的電風扇（issue #66）：不然重設後下一步又會被同一個風扇立刻吹動', () => {
    const sim = new SimCore(MESH());
    const rest = Float64Array.from(sim.positions);
    sim.applyInput({
      type: 'setFan',
      originX: 0,
      originY: 0,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 200,
      strength: 6000,
      falloffExponent: 1,
      frequency: 5,
    });
    run(sim, 10);
    expect(sim.fanState()).not.toBeNull();

    sim.reset();

    expect(sim.fanState()).toBeNull();
    run(sim, 30);
    expect(sim.kineticEnergy()).toBe(0); // 沒有風扇、沒有殘留速度 → 靜置
    expect(Array.from(sim.positions)).toEqual(Array.from(rest));
  });

  it('reset 會把陣風 PRNG 重新播種——重播同一段風扇事件流跟全新 SimCore 結果相同（issue #67 事後檢視追加，Track 重播靠這個決定性）', () => {
    const fanEvent: InputEvent = {
      type: 'setFan',
      originX: 0,
      originY: 0,
      dirX: 1,
      dirY: 0,
      length: 96,
      width: 200,
      strength: 6000,
      falloffExponent: 1,
      frequency: 3,
    };

    const fresh = new SimCore(MESH());
    fresh.applyInput(fanEvent);
    run(fresh, 30);
    const freshResult = Array.from(fresh.positions);

    // 同一個 SimCore 先跑一段完全不相干的操作（推進 RNG 狀態、留下殘留位移），
    // reset() 後重播同一段風扇事件流——如果 RNG 沒有跟著重新播種，這裡的陣風
    // 時機會接在「跑過一段」之後的 RNG 狀態，跟 fresh 的結果對不上。
    const reused = new SimCore(MESH());
    reused.applyInput({ ...fanEvent, frequency: 8, strength: 3000 });
    run(reused, 17); // 任意一段跟後面重播無關的操作，純粹推進 RNG／時間狀態
    reused.reset();
    reused.applyInput(fanEvent);
    run(reused, 30);
    const reusedResult = Array.from(reused.positions);

    expect(reusedResult).toEqual(freshResult);
  });
});

describe('SimCore — Gravity（issue #91 / V3 T2-1；ADR-0012）', () => {
  /** 質心 y（世界座標 +y 向下）。 */
  const cy = (sim: SimCore) => sim.centroid().y;

  it('gravity = 0（預設）：靜置 step 數百次後動能 0、位置不漂移（與既有俯視行為相同）', () => {
    const sim = new SimCore(MESH());
    expect(sim.params.gravity).toBe(0);
    const before = Float64Array.from(sim.positions);
    run(sim, 600);
    expect(sim.kineticEnergy()).toBeLessThan(1e-9);
    for (let i = 0; i < before.length; i++) expect(sim.positions[i]!).toBeCloseTo(before[i]!, 9);
  });

  it('gravity = 0 與「沒有重力參數」位元相同：Fling 事件流的結果不受 gravity 欄位存在影響', () => {
    // 守住舊片段（沒有 gravity 欄位 → 0）重播結果不變：gravity = 0 時 step 的
    // 每個浮點運算都要跟以前一樣，這裡用同一段事件流對照 `gravity: 0` 顯式設定。
    const play = (setZero: boolean): number[] => {
      const sim = new SimCore(MESH());
      if (setZero) sim.params.gravity = 0;
      sim.applyInput({ type: 'grab', id: 1, x: 0, y: 0 });
      sim.applyInput({ type: 'moveGrab', id: 1, x: 60, y: 10 });
      run(sim, 10);
      sim.applyInput({ type: 'release', id: 1 });
      run(sim, 60);
      return Array.from(sim.positions);
    };
    expect(play(true)).toEqual(play(false));
  });

  it('gravity > 0、damping = airDamping = 0、Infinite：自由落體 N 步後質心 y 位移 ≈ ½ g t²（容許 symplectic Euler 一階誤差）', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 1000;
    sim.params.damping = 0;
    sim.params.airDamping = 0; // issue #106 之後質心速度吃的是這個
    const y0 = cy(sim);
    const x0 = sim.centroid().x;
    const frames = 60; // t = 1 s
    run(sim, frames);
    const t = frames / 60;
    const expected = 0.5 * 1000 * t * t; // 500
    // symplectic Euler：Σ g·h·k（k = 1..N）= ½ g t² (1 + 1/N)，N = 240 substep → 誤差 ≈ 0.4%
    expect(cy(sim) - y0).toBeGreaterThan(expected * 0.99);
    expect(cy(sim) - y0).toBeLessThan(expected * 1.01);
    expect(sim.centroid().x).toBeCloseTo(x0, 6); // 方向固定向下，x 不動
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('gravity > 0 + 有阻尼：整塊一起下落、形狀不散（拉伸比維持 ~1）', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    run(sim, 120);
    const st = sim.stretchStats();
    expect(st.avg).toBeGreaterThan(0.95);
    expect(st.avg).toBeLessThan(1.05);
    expect(st.max).toBeLessThan(1.2);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('gravity > 0 + Pin 住一點 → 該附著點停在鎖定點、質心往下垂', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    const y0 = cy(sim);
    sim.applyInput({ type: 'pin', id: 'p', x: 48, y: 0 });
    const lock = sim.attachPoint('p')!;
    run(sim, 180);
    const now = sim.attachPoint('p')!;
    expect(Math.hypot(now.x - lock.x, now.y - lock.y)).toBeLessThan(0.5);
    expect(cy(sim)).toBeGreaterThan(y0 + 1); // 其餘往下垂
    expect(cy(sim)).toBeLessThan(y0 + 200); // 但被 Pin 拉住、不是自由落體（自由落體 4.5 s 會掉 ~2×10⁴）
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('gravity > 0 + Walled：落到箱底後質心收斂、動能歸零、不在無摩擦地板上橫向滑走', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    const floorY = 300;
    sim.setBoundary(new WalledBoundary({ minX: -500, minY: -500, maxX: 500, maxY: floorY }));
    run(sim, 300); // 5 s
    const a = sim.centroid();
    run(sim, 60);
    const b = sim.centroid();
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    // shape matching 跨 Region 等權平均會漏動量，沒修正的話靜置的 Jelly 會在
    // 無摩擦地板上以 ~30 單位／秒一路橫移（見 `solveShapeMatching` 說明）。
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.1);
    expect(sim.bbox().maxY).toBeLessThanOrEqual(floorY + 1e-9);
    expect(sim.bbox().maxY).toBeGreaterThan(floorY - 1);
    expect(sim.kineticEnergy()).toBeLessThan(1);
  });

  it('決定性：gravity > 0 同一段事件流兩次跑結果位元相同', () => {
    const play = (): number[] => {
      const sim = new SimCore(MESH());
      sim.params.gravity = 1500;
      sim.applyInput({ type: 'grab', id: 1, x: 0, y: 0 });
      sim.applyInput({ type: 'moveGrab', id: 1, x: 60, y: -40 });
      run(sim, 20);
      sim.applyInput({ type: 'release', id: 1 });
      run(sim, 40);
      return Array.from(sim.positions);
    };
    expect(play()).toEqual(play());
  });

  it('reset() 不動 params.gravity（它是參數不是狀態）', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 1200;
    run(sim, 30);
    sim.reset();
    expect(sim.params.gravity).toBe(1200);
    expect(sim.kineticEnergy()).toBe(0);
    // reset 後再 step：重力仍在作用（位置回 rest 後重新落下）
    const y0 = cy(sim);
    run(sim, 30);
    expect(cy(sim)).toBeGreaterThan(y0);
  });
});

describe('SimCore — 側視阻尼只作用在內部運動（issue #106 / V3 T2-4；ADR-0012）', () => {
  const cy = (sim: SimCore) => sim.centroid().y;

  it('gravity > 0、預設阻尼、Infinite：自由落體第 2 秒的位移明顯大於第 1 秒（看得到加速）', () => {
    // 舊路徑（全域阻尼 0.02 也套在質心速度上）終端速度 g / 4.8、0.2 s 就到，兩秒的
    // 位移比 ≈ 1.1；拆開後質心只剩 airDamping，比值接近自由落體的 3。
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    const y0 = cy(sim);
    run(sim, 60);
    const first = cy(sim) - y0;
    run(sim, 60);
    const second = cy(sim) - y0 - first;
    expect(first).toBeGreaterThan(0);
    expect(second / first).toBeGreaterThan(2);
    expect(second / first).toBeLessThan(3); // airDamping > 0 → 略低於理想值 3
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('airDamping 決定質心速度的衰減：airDamping = damping 時退回舊的等速落體', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    sim.params.airDamping = sim.params.damping;
    const y0 = cy(sim);
    run(sim, 60);
    const first = cy(sim) - y0;
    run(sim, 60);
    const second = cy(sim) - y0 - first;
    expect(second / first).toBeLessThan(1.4); // 第 1 秒含 0.2 s 加速段，舊路徑實測 ≈ 1.25
  });

  it('gravity > 0 + Floor（貼齊 bbox 底邊）靜置：動能歸零、不橫向漂移', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    sim.setBoundary(new FloorBoundary({ floorY: sim.bbox().maxY, friction: 0.3 }));
    run(sim, 300); // 5 s
    const a = sim.centroid();
    run(sim, 60);
    const b = sim.centroid();
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.1); // 動量守恆修正仍成立，沒有跟著阻尼一起走掉
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
    expect(sim.kineticEnergy()).toBeLessThan(1);
  });

  it('gravity > 0 + Floor：抓上緣輕輕甩起放手 → 落地後 ≤ 2 s 內部抖動靜止、拉伸比回到 ~1', () => {
    // 輕甩（8 單位／幀、離地 ~50）落地後 ~1.3 s 靜止；用力甩（25／幀、飛 2 倍身高）會
    // 翻滾＋回彈一次、~3 s 才靜止——「≤ 2 s」是對正常放手講的，不是對砸下來講的。
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    const floorY = sim.bbox().maxY;
    sim.setBoundary(new FloorBoundary({ floorY, friction: 0.3 }));
    run(sim, 30);
    sim.applyInput({ type: 'grab', id: 'g', x: 48, y: 0 });
    for (let step = 1; step <= 6; step++) {
      sim.applyInput({ type: 'moveGrab', id: 'g', x: 48, y: -8 * step });
      sim.step(1 / 60);
    }
    sim.applyInput({ type: 'release', id: 'g' });
    // 等到重新碰地（放開瞬間還在空中）
    let touched = false;
    for (let f = 0; f < 120 && !touched; f++) {
      sim.step(1 / 60);
      if (sim.bbox().maxY >= floorY - 1) touched = true;
    }
    expect(touched).toBe(true);
    run(sim, 120); // 落地後 2 s
    const a = sim.centroid();
    run(sim, 30);
    const b = sim.centroid();
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.2);
    expect(sim.kineticEnergy()).toBeLessThan(100); // 169 顆 RMS < 1 單位／秒，肉眼靜止
    const st = sim.stretchStats();
    expect(st.avg).toBeGreaterThan(0.95);
    expect(st.avg).toBeLessThan(1.05);
  });

  it('gravity > 0 + Floor：從 2 倍身高落下，回彈一次後 ≤ 2 s 靜止、拉伸比回到 ~1、不橫向漂移', () => {
    // 落 200 單位、~890 單位／秒著地（舊路徑終端速度只有 417）：壓扁到 0.64、彈起
    // 一次（~70 單位）、1.5 s 第二次落地，之後靠內部阻尼在 ~1 s 內靜止。
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    sim.setBoundary(new FloorBoundary({ floorY: sim.bbox().maxY + 200, friction: 0.3 }));
    run(sim, 180); // 3 s
    const a = sim.centroid();
    run(sim, 60);
    const b = sim.centroid();
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.5);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.1);
    const st = sim.stretchStats();
    expect(st.avg).toBeGreaterThan(0.95);
    expect(st.avg).toBeLessThan(1.05);
    expect(sim.kineticEnergy()).toBeLessThan(1);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it('gravity = 0：airDamping 完全不參與（俯視路徑不變）', () => {
    const play = (airDamping: number): number[] => {
      const sim = new SimCore(MESH());
      sim.params.airDamping = airDamping;
      sim.applyInput({ type: 'grab', id: 1, x: 0, y: 0 });
      sim.applyInput({ type: 'moveGrab', id: 1, x: 60, y: 10 });
      run(sim, 10);
      sim.applyInput({ type: 'release', id: 1 });
      run(sim, 60);
      return Array.from(sim.positions);
    };
    expect(play(0)).toEqual(play(0.5));
  });

  it('gravity > 0 + Infinite：側甩後質心 x 速度只被 airDamping 慢慢吃掉，1 s 後仍保有大半', () => {
    const sim = new SimCore(MESH());
    sim.params.gravity = 2000;
    flingRight(sim, 96, 48);
    const x0 = sim.centroid().x;
    run(sim, 6);
    const early = (sim.centroid().x - x0) / 0.1; // 放手後 0.1 s 的平均 x 速度
    run(sim, 54);
    const x1 = sim.centroid().x;
    run(sim, 6);
    const late = (sim.centroid().x - x1) / 0.1; // 1 s 後
    expect(early).toBeGreaterThan(0);
    expect(late / early).toBeGreaterThan(0.6); // 舊路徑 1 s 後只剩 e^(−4.8) ≈ 0.8%
  });
});

describe('SimCore — Region 依網格拓撲分組（issue #83）', () => {
  /**
   * 音叉形：13×13 頂點網格（間距 8）挖掉第 6 欄、第 0–9 列的 cell → 兩根叉齒
   * x∈[0,48] 與 x∈[56,96]，只靠底部兩列 cell 相連。兩齒尖端相距 8，遠小於
   * Region cell 邊長（對角線 ≈ 136 × cellFrac 0.15 ≈ 20）。
   */
  const FORK = () => gridMesh(13, 13, 8, (i, j) => !(i === 6 && j <= 9));

  /** 以 `pick` 拿到的 surface point 在目前位置下的世界座標（重心內插）。 */
  function surfacePos(sim: SimCore, sp: SurfacePoint): { x: number; y: number } {
    const pos = sim.positions;
    let x = 0;
    let y = 0;
    for (let k = 0; k < 3; k++) {
      x += sp.w[k]! * pos[2 * sp.tri[k]!]!;
      y += sp.w[k]! * pos[2 * sp.tri[k]! + 1]!;
    }
    return { x, y };
  }

  it('拉 A 齒尖端，隔著縫隙、網格上不相連的 B 齒尖端不跟著動', () => {
    const sim = new SimCore(FORK());
    // 釘住整排叉齒根部（y = 80），排除經底部的正當傳導——剩下的耦合只能來自
    // 求解器把兩齒放進同一個 Region。
    for (let x = 0; x <= 96; x += 8) sim.applyInput({ type: 'pin', id: `root${x}`, x, y: 80 });
    const bTip = sim.pick(56, 0)!;
    const bBefore = surfacePos(sim, bTip);

    sim.applyInput({ type: 'grab', id: 'a', x: 48, y: 0 });
    sim.applyInput({ type: 'moveGrab', id: 'a', x: 28, y: -30 });
    run(sim, 120);

    const a = sim.attachPoint('a')!;
    const aMoved = Math.hypot(a.x - 48, a.y - 0);
    expect(aMoved).toBeGreaterThan(30); // 拉得動 A

    const bAfter = surfacePos(sim, bTip);
    const bMoved = Math.hypot(bAfter.x - bBefore.x, bAfter.y - bBefore.y);
    // 修前 B 跟著走 ≈ 55%；修後剩下的是兩齒根部經底部那列邊真的相連、落在同一
    // 格時合法成為一個 Region 的微量耦合（≈ 2%）。
    expect(bMoved).toBeLessThan(aMoved * 0.05);
  });
});

describe('SimCore — substep 拆段（issue #95 / V3 T3-2，給 World 與碰撞用的 seam）', () => {
  /** 兩顆 sim 吃同一段輸入：抓右下角甩一段、放開、再等一秒——含 Grab／Fling／陣風以外的所有步驟。 */
  function drive(sim: SimCore, stepOnce: (sim: SimCore) => void): void {
    sim.params.gravity = 1500;
    sim.setBoundary(new FloorBoundary({ floorY: 200, friction: 0.3 }));
    sim.applyInput({ type: 'pin', id: 'p', x: 0, y: 0 });
    sim.applyInput({ type: 'grab', id: 'g', x: 96, y: 96 });
    for (let step = 1; step <= 8; step++) {
      sim.applyInput({ type: 'moveGrab', id: 'g', x: 96 + 30 * step, y: 96 + 10 * step });
      stepOnce(sim);
    }
    sim.applyInput({ type: 'release', id: 'g' });
    sim.applyInput({ type: 'tap', x: 48, y: 48 });
    for (let f = 0; f < 60; f++) stepOnce(sim);
  }

  it('predict → solveInternal → finishSubstep 手動迴圈與 step() 位元相同', () => {
    const a = new SimCore(MESH());
    const b = new SimCore(MESH());
    drive(a, (sim) => sim.step(1 / 60));
    drive(b, (sim) => {
      const subs = sim.params.substeps;
      const h = 1 / 60 / subs;
      for (let s = 0; s < subs; s++) {
        sim.predict(h);
        sim.solveInternal(h);
        sim.finishSubstep(h);
      }
    });
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(b.kineticEnergy()).toBe(a.kineticEnergy());
  });

  it('輪廓邊 = 只屬於一個三角形的邊，外法線朝外；輪廓 Particle 索引去重', () => {
    const sim = new SimCore(gridMesh(3, 3, 10)); // 3×3 頂點、8 個三角形，正中間頂點 4 不在輪廓上
    expect(sim.contour.length).toBe(8);
    const surface = Array.from(sim.surfaceParticles).sort((p, q) => p - q);
    expect(surface).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    const pos = sim.positions;
    for (const e of sim.contour) {
      const ax = pos[2 * e.a]!;
      const ay = pos[2 * e.a + 1]!;
      const bx = pos[2 * e.b]!;
      const by = pos[2 * e.b + 1]!;
      // 外法線 = nsign · perp(b − a)，perp(x, y) = (y, −x)；邊中點指向網格中心 (10, 10) 的向量要跟它反向。
      const nx = e.nsign * (by - ay);
      const ny = e.nsign * -(bx - ax);
      const mx = (ax + bx) / 2 - 10;
      const my = (ay + by) / 2 - 10;
      expect(nx * mx + ny * my).toBeGreaterThan(0);
    }
  });
});
