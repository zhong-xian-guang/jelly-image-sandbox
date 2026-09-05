import { describe, expect, it } from 'vitest';

import type { CameraCommand } from '../../camera';
import type { InputEvent } from '../../sim';
import { DemoRunner } from './DemoRunner';
import type { DemoStep } from './types';

/**
 * 只收集 `InputEvent`；`applyCamera` 回呼故意在被呼叫時丟例外，讓既有
 * （只用 `InputEvent` 的）測試案例順便斷言「這些排程不會誤觸發相機回呼」。
 * `CameraCommand` 分流本身另有專門測試（見下方）。
 */
function collect(runner: DemoRunner, ticks: number): InputEvent[] {
  const log: InputEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    runner.advance(
      (event) => log.push(event),
      () => {
        throw new Error('未預期收到 CameraCommand');
      },
    );
  }
  return log;
}

describe('DemoRunner', () => {
  it('依 atStep 依序觸發，同一 step 可以有多個事件', () => {
    const schedule: DemoStep[] = [
      { atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } },
      { atStep: 2, event: { type: 'moveGrab', id: 'a', x: 1, y: 1 } },
      { atStep: 2, event: { type: 'tap', x: 5, y: 5 } },
      { atStep: 4, event: { type: 'release', id: 'a' } },
    ];
    const runner = new DemoRunner();
    runner.start(schedule);

    const log = collect(runner, 5);
    expect(log).toEqual([
      { type: 'grab', id: 'a', x: 0, y: 0 },
      { type: 'moveGrab', id: 'a', x: 1, y: 1 },
      { type: 'tap', x: 5, y: 5 },
      { type: 'release', id: 'a' },
    ]);
  });

  it('未排序的排程一樣依 atStep 升冪觸發', () => {
    const schedule: DemoStep[] = [
      { atStep: 3, event: { type: 'release', id: 'a' } },
      { atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } },
    ];
    const runner = new DemoRunner();
    runner.start(schedule);

    const log = collect(runner, 4);
    expect(log.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('播完排程最後一個事件後 isRunning 自動變 false，之後 advance 不再觸發任何事', () => {
    const runner = new DemoRunner();
    runner.start([{ atStep: 0, event: { type: 'tap', x: 0, y: 0 } }]);
    expect(runner.isRunning).toBe(true);

    const log = collect(runner, 1);
    expect(log).toHaveLength(1);
    expect(runner.isRunning).toBe(false);

    const after = collect(runner, 10);
    expect(after).toHaveLength(0);
  });

  it('stop() 立即清空排程，之後 advance 不再觸發任何事件', () => {
    const runner = new DemoRunner();
    runner.start([
      { atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } },
      { atStep: 5, event: { type: 'release', id: 'a' } },
    ]);
    collect(runner, 1); // 觸發 grab
    runner.stop();
    expect(runner.isRunning).toBe(false);

    const log = collect(runner, 10);
    expect(log).toHaveLength(0);
  });

  it('空排程 start([]) → isRunning 為 false，advance 不觸發任何事件', () => {
    const runner = new DemoRunner();
    runner.start([]);
    expect(runner.isRunning).toBe(false);
    expect(collect(runner, 5)).toHaveLength(0);
  });

  it('start() 會取代播放中的舊排程（新排程從 step 0 重新算）', () => {
    const runner = new DemoRunner();
    runner.start([{ atStep: 10, event: { type: 'tap', x: 0, y: 0 } }]);
    collect(runner, 3); // 舊排程還沒到 step 10，尚未觸發

    runner.start([{ atStep: 0, event: { type: 'tap', x: 9, y: 9 } }]);
    const log = collect(runner, 1);
    expect(log).toEqual([{ type: 'tap', x: 9, y: 9 }]);
  });

  it('CameraCommand 事件派送到相機回呼，InputEvent 派送到 applyInput，互不混淆（issue #29）', () => {
    const schedule: DemoStep[] = [
      { atStep: 0, event: { type: 'grab', id: 'a', x: 0, y: 0 } },
      { atStep: 0, event: { type: 'panBy', dxScreen: 10, dyScreen: -5 } },
      { atStep: 1, event: { type: 'zoomBy', factor: 1.2, pivotScreen: { x: 1, y: 2 } } },
      { atStep: 1, event: { type: 'release', id: 'a' } },
    ];
    const runner = new DemoRunner();
    runner.start(schedule);

    const inputs: InputEvent[] = [];
    const cameraCommands: CameraCommand[] = [];
    for (let i = 0; i < 2; i++) {
      runner.advance(
        (event) => inputs.push(event),
        (cmd) => cameraCommands.push(cmd),
      );
    }

    expect(inputs).toEqual([
      { type: 'grab', id: 'a', x: 0, y: 0 },
      { type: 'release', id: 'a' },
    ]);
    expect(cameraCommands).toEqual([
      { type: 'panBy', dxScreen: 10, dyScreen: -5 },
      { type: 'zoomBy', factor: 1.2, pivotScreen: { x: 1, y: 2 } },
    ]);
  });
});
