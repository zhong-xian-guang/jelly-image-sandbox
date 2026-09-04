import { describe, expect, it, vi } from 'vitest';

import type { InputEvent, Point } from '../sim';
import { GestureTracker, type GestureTrackerOptions } from './GestureTracker';

/** 收集 emit 出來的事件；`screenToWorld` 預設把螢幕座標 +1000（好分辨已換算）。 */
function makeTracker(config?: GestureTrackerOptions['config']) {
  const events: InputEvent[] = [];
  const screenToWorld = vi.fn((x: number, y: number): Point => ({ x: x + 1000, y: y + 1000 }));
  const tracker = new GestureTracker({ screenToWorld, emit: (e) => events.push(e), config });
  return { tracker, events, screenToWorld };
}

describe('GestureTracker', () => {
  it('down → grab（世界座標，經 screenToWorld）', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 30, 40, 0);
    expect(events).toEqual([{ type: 'grab', id: 1, x: 1030, y: 1040 }]);
    expect(tracker.activeCount).toBe(1);
  });

  it('down → move → move → up（慢、有位移）→ grab, moveGrab×2, release（無 tap）', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 0, 0, 0);
    tracker.move(1, 10, 0);
    tracker.move(1, 40, 5);
    tracker.up(1, 40, 5, 400);
    expect(events.map((e) => e.type)).toEqual(['grab', 'moveGrab', 'moveGrab', 'release']);
    expect(tracker.activeCount).toBe(0);
  });

  it('快速按放、幾乎沒動 → grab, tap（在按下的世界座標）, release', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 50, 60, 100);
    tracker.up(1, 52, 61, 300); // 200ms、位移 ~2.2px
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1050, y: 1060 },
      { type: 'tap', x: 1050, y: 1060 },
      { type: 'release', id: 1 },
    ]);
  });

  it('按太久（> 250ms）→ 不算 tap', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 0, 0, 0);
    tracker.up(1, 1, 1, 300);
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('位移太大（> 6px）→ 不算 tap，即使很快', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 0, 0, 0);
    tracker.up(1, 10, 0, 50);
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('config 可調 tap 門檻', () => {
    const { tracker, events } = makeTracker({ tapMaxMs: 100, tapMaxDist: 2 });
    tracker.down(1, 0, 0, 0);
    tracker.up(1, 0, 0, 150); // 150 > 100 → 不是 tap
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('沒 down 就 move / up → 無事發生', () => {
    const { tracker, events } = makeTracker();
    tracker.move(1, 5, 5);
    tracker.up(1, 5, 5, 10);
    expect(events).toEqual([]);
  });

  it('cancel → release；沒在追的 cancel 不 emit', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 0, 0, 0);
    tracker.cancel(1);
    tracker.cancel(1); // 已移除
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('多指各自獨立', () => {
    const { tracker, events } = makeTracker();
    tracker.down(1, 0, 0, 0);
    tracker.down(2, 100, 0, 0);
    expect(tracker.activeCount).toBe(2);
    tracker.move(1, 20, 0);
    tracker.up(2, 100, 0, 50); // 指 2 快速放 → tap
    tracker.up(1, 20, 0, 500); // 指 1 慢放、有位移 → 只 release
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000 },
      { type: 'grab', id: 2, x: 1100, y: 1000 },
      { type: 'moveGrab', id: 1, x: 1020, y: 1000 },
      { type: 'tap', x: 1100, y: 1000 },
      { type: 'release', id: 2 },
      { type: 'release', id: 1 },
    ]);
  });

  it('只 emit InputEvent，不碰求解器內部（型別上就是 applyInput 的參數）', () => {
    const { tracker, events } = makeTracker();
    tracker.down('p', 0, 0, 0);
    tracker.up('p', 0, 0, 10);
    for (const e of events) {
      expect(['grab', 'moveGrab', 'release', 'tap']).toContain(e.type);
    }
  });
});
