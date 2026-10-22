/**
 * 播放時保留播放前的鏡位（issue #156）：走真的 `JellySandbox` 接線（同 `JellySandbox.cleanView.test.ts`
 * 的做法：算繪端換成替身、預設果凍貼圖換成小方塊 PNG、不跑 rAF 迴圈），看 `playAll`／`resetSim`
 * 對相機做了什麼；再用純函式（`mergeTracks` + `DemoRunner` + `updateCamera`）驗「從同一個鏡位
 * 連按兩次播放，鏡頭軌跡逐格一致」。
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

import { updateCamera, type CameraCommand, type CameraState } from '../camera';
import { DemoRunner } from './demos/DemoRunner';
import { mergeTracks } from './demos/overlay';
import { STEP_SECONDS } from './demos/time';
import type { DemoStep } from './demos/types';
import type { JellySandbox } from './JellySandbox';
import { createTestSandbox } from './sandboxTestHarness';

/** 測試要碰的私有成員（只讀寫狀態與呼叫既有入口，不改實作）。 */
interface SandboxInternals {
  cameraState: CameraState;
  cameraCommands: CameraCommand[];
  addTrack(kind: 'action' | 'camera', steps: DemoStep[], startCamera: CameraState | null): void;
  setTrackStartTime(id: string, seconds: number): void;
  tracks: { id: string }[];
  playAll(): void;
  resetSim(): void;
}

/** 使用者事先擺好的鏡位：平移到別處、縮小、關掉跟隨。 */
const PREPARED: CameraState = {
  transform: { x: 640, y: -320, scale: 0.4 },
  followEnabled: false,
  framing: false,
  sinceManualSeconds: 0,
};

/** 相機軌錄下的起點鏡位。 */
const RECORDED: CameraState = {
  transform: { x: -50, y: 75, scale: 2 },
  followEnabled: true,
  framing: false,
  sinceManualSeconds: 2,
};

const TAP: DemoStep = { atStep: 0, event: { type: 'tap', x: 0, y: 0 } };

describe('JellySandbox — 播放保留播放前的鏡位（issue #156）', () => {
  let root: HTMLDivElement;
  let sandbox: JellySandbox;
  let s: SandboxInternals;

  beforeEach(() => {
    localStorage.setItem('jelly-sandbox:help-seen', '1');
    root = document.createElement('div');
    document.body.appendChild(root);
    ({ sandbox } = createTestSandbox(root));
    s = sandbox as unknown as SandboxInternals;
    s.cameraState = PREPARED;
    s.cameraCommands = [];
  });

  afterEach(() => {
    sandbox.destroy();
    document.body.replaceChildren();
    localStorage.clear();
  });

  it('沒有相機軌：播放開始時鏡頭留在原處、跟隨照舊關著，不推「框住果凍」', () => {
    s.addTrack('action', [TAP], null);
    s.playAll();
    expect(s.cameraState).toEqual(PREPARED);
    expect(s.cameraCommands).toEqual([]);
  });

  it('有相機軌：相機軌開始前維持播放前的鏡位（不重設成跟隨開著）', () => {
    s.addTrack('camera', [{ atStep: 0, event: { type: 'setFollow', enabled: true } }], RECORDED);
    s.setTrackStartTime(s.tracks[0]!.id, 1);
    s.playAll();
    expect(s.cameraState).toEqual(PREPARED);
    expect(s.cameraCommands).toEqual([]);
  });

  it('停止／重設：相機回到播放前的鏡位與跟隨狀態', () => {
    s.addTrack('action', [TAP], null);
    s.playAll();
    s.cameraState = RECORDED; // 播放中鏡頭被相機軌或跟隨帶走
    s.cameraCommands = [{ type: 'frame' }];
    s.resetSim();
    expect(s.cameraState).toEqual(PREPARED);
    expect(s.cameraCommands).toEqual([]);
  });

  it('播放中又按一次播放：記下的仍是最初播放前的鏡位', () => {
    s.addTrack('action', [{ atStep: 600, event: { type: 'tap', x: 0, y: 0 } }], null);
    s.playAll();
    s.cameraState = RECORDED; // 播放中鏡頭被帶走
    s.playAll();
    s.resetSim();
    expect(s.cameraState).toEqual(PREPARED);
  });

  it('沒有播放過就按停止／重設：相機不動', () => {
    s.cameraState = RECORDED;
    s.resetSim();
    expect(s.cameraState).toEqual(RECORDED);
  });

  it('還原一次之後，下一次停止／重設不再把鏡頭拉回去', () => {
    s.addTrack('action', [TAP], null);
    s.playAll();
    s.resetSim();
    s.cameraState = RECORDED; // 使用者重新擺鏡位
    s.resetSim();
    expect(s.cameraState).toEqual(RECORDED);
  });
});

describe('從同一個鏡位連按兩次播放全部，鏡頭軌跡逐格一致（issue #156，沿用 #33／#36 的決定性）', () => {
  const canvas = { width: 1280, height: 800 };
  const target = { bbox: { minX: -50, minY: -50, maxX: 50, maxY: 50 } };

  /** 照 `JellySandbox.frame` 的順序跑：`demoRunner.advance` 收相機指令 → `updateCamera`。 */
  function trajectory(start: CameraState): CameraState[] {
    const runner = new DemoRunner();
    runner.start(
      mergeTracks([
        { startStep: 0, idPrefix: 't1/', steps: [TAP] },
        {
          startStep: 30,
          idPrefix: 't2/',
          steps: [{ atStep: 20, event: { type: 'panBy', dxScreen: 40, dyScreen: 0 } }],
          startCamera: RECORDED,
        },
      ]),
    );
    let state = start;
    const out: CameraState[] = [];
    for (let i = 0; i < 90; i++) {
      const cmds: CameraCommand[] = [];
      runner.advance(
        () => {},
        (c) => cmds.push(c),
      );
      state = updateCamera(state, target, canvas, cmds, STEP_SECONDS);
      out.push(state);
    }
    return out;
  }

  it('兩次一樣；相機軌開始前停在播放前的鏡位，開始那一格硬切到錄好的快照', () => {
    const a = trajectory(PREPARED);
    const b = trajectory(PREPARED);
    expect(a).toEqual(b);
    expect(a[29]!.transform).toEqual(PREPARED.transform); // 跟隨關著 → 原地不動
    expect(a[30]!.transform).toEqual(RECORDED.transform);
  });
});
