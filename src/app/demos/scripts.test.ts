import { describe, expect, it } from 'vitest';

import type { SimMesh } from '../../mesh';
import { SimCore } from '../../sim';
import { DemoRunner } from './DemoRunner';
import { DEMOS } from './scripts';

/** 同 `SimCore.test.ts` 的規則網格 fixture，這裡獨立複一份，讓 Demo 測試不依賴其他測試檔。 */
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

const MESH = () => gridMesh(13, 13, 8); // 96×96，對角線 ≈ 136

function allFinite(xs: ArrayLike<number>): boolean {
  for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i]!)) return false;
  return true;
}

/** 把一個 Demo 從頭播到排程結束（回傳跑完當下的 `SimCore`，尚未額外收斂）。 */
function playToEnd(sim: SimCore, demoId: string): void {
  const demo = DEMOS.find((d) => d.id === demoId);
  if (!demo) throw new Error(`unknown demo id: ${demoId}`);
  const runner = new DemoRunner();
  runner.start(demo.build(sim.positions));
  while (runner.isRunning) {
    runner.advance((event) => sim.applyInput(event));
    sim.step(1 / 60);
  }
}

describe('內建 Demo 腳本', () => {
  it('每個 Demo 都排出非空、atStep 遞增有效（非負整數）的時間軸', () => {
    const sim = new SimCore(MESH());
    for (const demo of DEMOS) {
      const schedule = demo.build(sim.positions);
      expect(schedule.length).toBeGreaterThan(0);
      for (const step of schedule) {
        expect(step.atStep).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(step.atStep)).toBe(true);
      }
    }
  });

  it.each(DEMOS.map((d) => d.id))('%s：播完＋收斂 600 幀後所有 Particle 位置仍為有限值', (id) => {
    const sim = new SimCore(MESH());
    playToEnd(sim, id);
    for (let i = 0; i < 600; i++) sim.step(1 / 60);
    expect(allFinite(sim.positions)).toBe(true);
  });

  it.each(DEMOS.map((d) => d.id))('%s：決定性——同一張網格重播兩次，結果逐位元相同', (id) => {
    const a = new SimCore(MESH());
    const b = new SimCore(MESH());
    playToEnd(a, id);
    playToEnd(b, id);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it('拉到極限放開：播完後沒有殘留的 Grab', () => {
    const sim = new SimCore(MESH());
    playToEnd(sim, 'stretch-release');
    expect(sim.grabCount).toBe(0);
    expect(sim.pinCount).toBe(0);
  });

  it('用力甩：播完後沒有殘留的 Grab（放手瞬間仍帶速度）', () => {
    const sim = new SimCore(MESH());
    playToEnd(sim, 'whip');
    expect(sim.grabCount).toBe(0);
    expect(sim.kineticEnergy()).toBeGreaterThan(0); // 放手當下仍在飛，動能不為 0
  });

  it('Pin 定住＋拉一角：播放中曾同時有一個 Pin 與一個 Grab，結束後兩者皆已清除', () => {
    const sim = new SimCore(MESH());
    const demo = DEMOS.find((d) => d.id === 'pin-and-pull')!;
    const runner = new DemoRunner();
    runner.start(demo.build(sim.positions));

    let sawPinAndGrabTogether = false;
    while (runner.isRunning) {
      runner.advance((event) => sim.applyInput(event));
      if (sim.pinCount === 1 && sim.grabCount === 1) sawPinAndGrabTogether = true;
      sim.step(1 / 60);
    }

    expect(sawPinAndGrabTogether).toBe(true);
    expect(sim.pinCount).toBe(0);
    expect(sim.grabCount).toBe(0);
  });

  it('雙點扭轉：一開始就同時有兩個獨立 Grab，結束後皆已放開', () => {
    const sim = new SimCore(MESH());
    const demo = DEMOS.find((d) => d.id === 'twist')!;
    const runner = new DemoRunner();
    runner.start(demo.build(sim.positions));

    runner.advance((event) => sim.applyInput(event)); // step 0：兩個 grab 一起下
    expect(sim.grabCount).toBe(2);
    sim.step(1 / 60);

    while (runner.isRunning) {
      runner.advance((event) => sim.applyInput(event));
      sim.step(1 / 60);
    }
    expect(sim.grabCount).toBe(0);
  });

  it('輕拍：不建立任何 Grab／Pin，純粹兩次徑向脈衝', () => {
    const sim = new SimCore(MESH());
    playToEnd(sim, 'tap');
    expect(sim.grabCount).toBe(0);
    expect(sim.pinCount).toBe(0);
  });
});
