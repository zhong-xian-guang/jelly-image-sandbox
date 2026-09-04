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
