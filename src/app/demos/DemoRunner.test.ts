import { describe, expect, it } from 'vitest';

import type { InputEvent } from '../../sim';
import { DemoRunner } from './DemoRunner';
import type { DemoStep } from './types';

function collect(runner: DemoRunner, ticks: number): InputEvent[] {
  const log: InputEvent[] = [];
  for (let i = 0; i < ticks; i++) runner.advance((event) => log.push(event));
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
});
