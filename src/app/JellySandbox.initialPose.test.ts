/**
 * 「設為初始位置」（issue #155）的沙盒接線：走真的 `JellySandbox`（接線見 `sandboxTestHarness`），
 * 把預設果凍「搬走＋轉個角度」（直接改它的 Particle 位置）之後按下，看 Scene、場上、之後的
 * 停止／重設與其他會重拍 Scene 的操作。位移與旋轉怎麼算在 `rigidFit.test.ts`／`World.test.ts`。
 */

import { encode as encodePng } from 'fast-png';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../render', () => ({ JellyRenderer: class {} }));
vi.mock('./defaultJelly', () => ({
  drawDefaultTexture: () => document.createElement('canvas'),
  canvasToPng: () => {
    const size = 32;
    const data = new Uint8Array(size * size * 4).fill(255);
    return encodePng({ width: size, height: size, data, channels: 4 });
  },
}));

import type { World } from '../sim';
import type { JellySandbox } from './JellySandbox';
import { createTestSandbox } from './sandboxTestHarness';

/** 測試要碰的私有成員（只讀寫狀態與呼叫既有入口）。 */
interface SandboxInternals {
  world: World;
  setInitialPose(): void;
  resetSim(): void;
  commitSceneUnlessRecording(): void;
}

/** 把唯一那塊果凍整個繞質心轉 `angle`、再平移 `(dx, dy)`。 */
function moveJelly(world: World, angle: number, dx: number, dy: number): number[] {
  const j = world.jellies()[0]!;
  const p = j.positions;
  const n = p.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += p[2 * i]! / n;
    cy += p[2 * i + 1]! / n;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i < n; i++) {
    const x = p[2 * i]! - cx;
    const y = p[2 * i + 1]! - cy;
    p[2 * i] = cos * x - sin * y + cx + dx;
    p[2 * i + 1] = sin * x + cos * y + cy + dy;
  }
  return Array.from(p);
}

/** 畫布播放控制條上的「● 錄製／■ 停止錄製」鈕（使用者實際按的那顆）。 */
function recordButton(): HTMLButtonElement {
  const button = document.querySelector('.jelly-playback-bar button[data-action="record"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('找不到錄製鈕');
  return button;
}

function expectPositions(world: World, expected: readonly number[]): void {
  const p = world.jellies()[0]!.positions;
  expect(p.length).toBe(expected.length);
  // rest 是 Float32Array：比到 Float32 的精度。
  for (let i = 0; i < p.length; i++) expect(p[i]).toBeCloseTo(expected[i]!, 2);
}

describe('JellySandbox — 設為初始位置（issue #155）', () => {
  let root: HTMLDivElement;
  let sandbox: JellySandbox;
  let s: SandboxInternals;

  beforeEach(() => {
    localStorage.setItem('jelly-sandbox:help-seen', '1');
    root = document.createElement('div');
    document.body.appendChild(root);
    ({ sandbox } = createTestSandbox(root));
    s = sandbox as unknown as SandboxInternals;
  });

  afterEach(() => {
    sandbox.destroy();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('按下：Scene 記下位置與角度，場上立刻以那個姿態、rest 形狀擺好；停止／重設也回到這裡', () => {
    const moved = moveJelly(s.world, 0.8, 300, -120);
    s.setInitialPose();
    const entry = s.world.sceneSnapshot()[0]!;
    expect(entry.rotation).toBeCloseTo(0.8, 6);
    expectPositions(s.world, moved);
    moveJelly(s.world, -0.3, -500, 40); // 之後再亂動
    s.resetSim();
    expectPositions(s.world, moved);
  });

  it('按下前的 Pin 留著（同 id、同位置）', () => {
    const p = s.world.jellies()[0]!.positions;
    s.world.applyInput({ type: 'pin', id: 'keep', x: p[0]!, y: p[1]! });
    const before = s.world.listPins()[0]!.point;
    s.setInitialPose();
    const pins = s.world.listPins();
    expect(pins.map((pin) => pin.id)).toEqual(['keep']);
    expect(pins[0]!.point.x).toBeCloseTo(before.x, 3);
    expect(pins[0]!.point.y).toBeCloseTo(before.y, 3);
  });

  it('之後重拍 Scene（匯入／生成／移除後的那一步）不會把姿態洗回去', () => {
    moveJelly(s.world, 1.2, 80, 80);
    s.setInitialPose();
    s.commitSceneUnlessRecording();
    expect(s.world.sceneSnapshot()[0]!.rotation).toBeCloseTo(1.2, 6);
  });

  it('錄製中不作用', () => {
    const rest = Array.from(s.world.jellies()[0]!.mesh.positions);
    recordButton().click();
    moveJelly(s.world, 0.5, 100, 0);
    s.setInitialPose();
    recordButton().click();
    expect(s.world.sceneSnapshot()[0]!.rotation ?? 0).toBe(0);
    s.resetSim();
    expectPositions(s.world, rest);
  });
});
