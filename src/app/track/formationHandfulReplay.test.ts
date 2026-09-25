/**
 * 編隊抓取的每點大把（issue #135）錄製 → 重播一致：真的走 `ToolRouter` 的手勢產生事件、
 * 邊套進 `SimCore` 邊用 `TrackRecorder` 錄，再把錄到的 Action Track（經過一次 JSON 來回，
 * 等同存成片段檔再載入）用 `DemoRunner` 餵給一塊全新的果凍，兩邊逐位元相同。
 *
 * 每步的順序比照 `JellySandbox.frame`：`demoRunner.advance` → `sim.step` → `trackRecorder.tick`。
 */

import { describe, expect, it } from 'vitest';

import { ToolRouter } from '../../input';
import type { SimMesh } from '../../mesh';
import { SimCore, type InputEvent } from '../../sim';
import { DemoRunner } from '../demos/DemoRunner';
import { STEP_SECONDS } from '../demos/time';
import type { DemoStep } from '../demos/types';
import { TrackRecorder } from './TrackRecorder';

/** 規則網格（同 `demos/scripts.test.ts` 的 fixture）。 */
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

const MESH = () => gridMesh(13, 13, 8); // 96×96

/** 用 `ToolRouter` 做一段編隊操作（拖曳＋輕拍），邊跑邊錄；回傳錄到的 Action Track 與總步數。 */
function recordLive(perPointHandful: boolean): {
  sim: SimCore;
  action: readonly DemoStep[];
  steps: number;
  events: InputEvent[];
} {
  const sim = new SimCore(MESH());
  const recorder = new TrackRecorder();
  const events: InputEvent[] = [];
  const router = new ToolRouter({
    screenToWorld: (x, y) => ({ x, y }),
    hitTest: (w) => sim.pick(w.x, w.y) !== null,
    emit: (e) => {
      events.push(e);
      sim.applyInput(e);
      recorder.record(e);
    },
  });
  router.setActiveTool('grab');
  router.setMode('grab', 'formation');
  // 兩點相距 16、半徑 20：兩把的範圍重疊（ADR-0014：重疊處被兩邊一起拉）；第三點落在果凍外。
  router.beginFormationDefine();
  for (const [x, y] of [
    [40, 48],
    [56, 48],
    [200, 48],
  ] as const) {
    router.down(1, x, y, 0);
    router.up(1, x, y, 10);
  }
  router.endFormationDefine();
  router.setFormationParams({ perPointHandful });
  router.setHandfulParams({ radius: 20 });

  recorder.start('action');
  let steps = 0;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      sim.step(STEP_SECONDS);
      recorder.tick();
      steps++;
    }
  };
  router.down(3, 30, 30, 1000);
  router.up(3, 30, 30, 1050); // 快速按放 → 每點各一次範圍 Tap
  run(20);
  router.down(2, 40, 48, 2000);
  run(3);
  router.move(2, 70, 60);
  run(5);
  router.move(2, 110, 90);
  run(5);
  router.up(2, 110, 90, 2500);
  run(20);
  const { action } = recorder.stop();
  return { sim, action, steps, events };
}

function replay(action: readonly DemoStep[], steps: number): SimCore {
  const sim = new SimCore(MESH());
  const runner = new DemoRunner();
  runner.start(action);
  for (let i = 0; i < steps; i++) {
    runner.advance(
      (e) => sim.applyInput(e),
      () => {},
    );
    sim.step(STEP_SECONDS);
  }
  return sim;
}

describe('編隊抓取的每點大把：錄製 → 重播一致（issue #135）', () => {
  it('開啟每點大把錄下的 Track（存檔再載入）重播，結果逐位元相同', () => {
    const live = recordLive(true);
    // 確實是每點大把：兩個落在果凍上的點各帶半徑，第三點（果凍外）沒送；Tap 也帶半徑。
    const grabs = live.events.filter((e) => e.type === 'grab');
    expect(grabs).toHaveLength(4);
    expect(grabs.every((e) => e.type === 'grab' && e.handfulRadius === 20)).toBe(true);
    const taps = live.events.filter((e) => e.type === 'tap');
    expect(taps).toHaveLength(2);
    expect(taps.every((e) => e.type === 'tap' && e.radius === 20)).toBe(true);

    const saved = JSON.parse(JSON.stringify(live.action)) as DemoStep[];
    const replayed = replay(saved, live.steps);
    expect(Array.from(replayed.positions)).toEqual(Array.from(live.sim.positions));
    expect(replayed.grabCount).toBe(0);
  });

  it('舊片段檔（沒有 handfulRadius）照舊播成單點編隊，也一致；而且跟每點大把的結果不同', () => {
    const plain = recordLive(false);
    expect(plain.events.some((e) => 'handfulRadius' in e || 'radius' in e)).toBe(false);
    const replayed = replay(plain.action, plain.steps);
    expect(Array.from(replayed.positions)).toEqual(Array.from(plain.sim.positions));

    const handful = recordLive(true);
    expect(Array.from(handful.sim.positions)).not.toEqual(Array.from(plain.sim.positions));
  });
});
