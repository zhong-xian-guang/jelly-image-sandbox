/**
 * 錄下的拔 Pin 在播放時拔得到「別人放的」Pin（issue #154）：真的走 `ToolRouter` 的拔模式手勢
 * 產生事件、邊套進 `SimCore` 邊用 `TrackRecorder` 錄，再照 `JellySandbox.playAll` 的方式用
 * `mergeTracks` 合併（片段初始 Pin 合成軌 `setup/`、各條 Track 加 `t{n}/` 前綴）交給
 * `DemoRunner` 重播在一塊全新的果凍上。
 *
 * 以前 `unpin` 用 Pin id 指定，播放時 id 被前綴改寫（`5` → `t1/5`，初始 Pin 叫 `setup/0`），
 * 對不上就什麼都沒拔到；現在 `unpin` 帶世界座標，跟 id 無關。
 */

import { describe, expect, it } from 'vitest';

import { ToolRouter } from '../../input';
import { SimCore, type Point } from '../../sim';
import { DemoRunner } from '../demos/DemoRunner';
import { mergeTracks, setupPinsTrack, type OverlayTrack } from '../demos/overlay';
import { STEP_SECONDS } from '../demos/time';
import type { DemoStep } from '../demos/types';
import { gridMesh } from '../../sim/testFixtures';
import { TrackRecorder } from './TrackRecorder';

const MESH = () => gridMesh(13, 13, 8); // 96×96

/** 三顆 Pin 的位置（都在果凍上、彼此相距夠遠）。 */
const PIN_POINTS: readonly Point[] = [
  { x: 16, y: 48 },
  { x: 48, y: 48 },
  { x: 80, y: 48 },
];

/** 一段錄製：`act` 用 `router` 操作，回傳錄到的 Action Track。 */
function record(sim: SimCore, act: (router: ToolRouter) => void): DemoStep[] {
  const recorder = new TrackRecorder();
  const router = new ToolRouter({
    screenToWorld: (x, y) => ({ x, y }),
    hitTest: (w) => sim.pick(w.x, w.y) !== null,
    listPins: () => sim.listPins(),
    emit: (e) => {
      sim.applyInput(e);
      recorder.record(e);
    },
  });
  router.setActiveTool('pin');
  recorder.start('action');
  act(router);
  for (let i = 0; i < 5; i++) {
    sim.step(STEP_SECONDS);
    recorder.tick();
  }
  return [...recorder.stop().action];
}

/** 放模式在每個點各點一下。 */
function placePins(router: ToolRouter): void {
  router.setMode('pin', 'place');
  PIN_POINTS.forEach(({ x, y }, i) => {
    router.down(10 + i, x, y, 0);
    router.up(10 + i, x, y, 10);
  });
}

/** 拔模式從左到右拖過所有 Pin（筆刷半徑蓋得到）。 */
function eraseAcross(router: ToolRouter): void {
  router.setMode('pin', 'remove');
  router.params.set('pinBrushRadius', 12);
  router.down(1, 0, 48, 100);
  for (let x = 4; x <= 96; x += 4) router.move(1, x, 48);
  router.up(1, 96, 48, 600);
}

/** 單擊拔模式，逐顆點掉。 */
function clickRemove(router: ToolRouter): void {
  router.setMode('pin', 'remove');
  PIN_POINTS.forEach(({ x, y }, i) => {
    router.down(20 + i, x, y, 0);
    router.up(20 + i, x, y, 10);
  });
}

/** 照 `playAll` 合併後重播在全新的果凍上，回傳播完時場上剩下的 Pin 數。 */
function replay(tracks: readonly OverlayTrack[]): number {
  const sim = new SimCore(MESH());
  const runner = new DemoRunner();
  runner.start(mergeTracks(tracks));
  for (let i = 0; i < 200 && runner.isRunning; i++) {
    runner.advance(
      (e) => sim.applyInput(e),
      () => {},
    );
    sim.step(STEP_SECONDS);
  }
  return sim.pinCount;
}

function track(n: number, steps: readonly DemoStep[]): OverlayTrack {
  // 經過一次 JSON 來回，等同存成片段檔再載入。
  return { startStep: 0, idPrefix: `t${n}/`, steps: JSON.parse(JSON.stringify(steps)) };
}

describe('錄下的拔 Pin 播放時拔得到（issue #154）', () => {
  for (const [name, remove] of [
    ['拖曳範圍拔', eraseAcross],
    ['單擊拔', clickRemove],
  ] as const) {
    it(`${name}：片段初始 Pin 被錄下的拔除拔掉`, () => {
      const sim = new SimCore(MESH());
      for (const [i, p] of PIN_POINTS.entries()) sim.applyInput({ type: 'pin', id: i + 5, ...p });
      const setup = sim.listPins().map((p) => p.point); // 「設為目前 Pin」（未變形，rest = 現在）
      const erase = record(sim, remove);
      expect(sim.pinCount).toBe(0);

      expect(replay([setupPinsTrack(setup), track(1, erase)])).toBe(0);
      expect(replay([setupPinsTrack(setup)])).toBe(PIN_POINTS.length); // 對照：沒有拔除那條
    });

    it(`${name}：A Track 放、B Track 拔，一起播放時拔掉`, () => {
      const sim = new SimCore(MESH());
      const place = record(sim, placePins);
      expect(sim.pinCount).toBe(PIN_POINTS.length);
      const erase = record(sim, remove);

      expect(replay([track(1, place), track(2, erase)])).toBe(0);
      expect(replay([track(1, place)])).toBe(PIN_POINTS.length);
    });
  }

  it('同一條 Track 先放後拔，播放結果照舊', () => {
    const sim = new SimCore(MESH());
    const both = record(sim, (router) => {
      placePins(router);
      eraseAcross(router);
    });
    expect(replay([track(1, both)])).toBe(0);
  });
});
