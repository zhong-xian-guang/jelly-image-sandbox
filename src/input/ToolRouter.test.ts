import { describe, expect, it, vi } from 'vitest';

import type { InputEvent, Point } from '../sim';
import { DEFAULT_TOOL, ToolRouter, type ToolRouterOptions } from './ToolRouter';

/** 同 `GestureTracker.test.ts` 的黑盒手法：`screenToWorld` 把螢幕座標 +1000 好分辨已換算。 */
function makeRouter(config?: ToolRouterOptions['config']) {
  const events: InputEvent[] = [];
  const screenToWorld = vi.fn((x: number, y: number): Point => ({ x: x + 1000, y: y + 1000 }));
  const router = new ToolRouter({ screenToWorld, emit: (e) => events.push(e), config });
  return { router, events, screenToWorld };
}

describe('ToolRouter — 「一般操作」委派給內部 GestureTracker，行為分毫不差', () => {
  it('預設就是一般操作', () => {
    const { router } = makeRouter();
    expect(router.currentTool).toBe(DEFAULT_TOOL);
    expect(router.currentTool).toBe('general');
  });

  it('down → grab（世界座標，經 screenToWorld）', () => {
    const { router, events } = makeRouter();
    router.down(1, 30, 40, 0);
    expect(events).toEqual([{ type: 'grab', id: 1, x: 1030, y: 1040 }]);
    expect(router.activeCount).toBe(1);
  });

  it('down → move → move → up（慢、有位移）→ grab, moveGrab×2, release（無 tap）', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.move(1, 10, 0);
    router.move(1, 40, 5);
    router.up(1, 40, 5, 400);
    expect(events.map((e) => e.type)).toEqual(['grab', 'moveGrab', 'moveGrab', 'release']);
    expect(router.activeCount).toBe(0);
  });

  it('快速按放、幾乎沒動 → grab, tap（在按下的世界座標）, release', () => {
    const { router, events } = makeRouter();
    router.down(1, 50, 60, 100);
    router.up(1, 52, 61, 300); // 200ms、位移 ~2.2px
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1050, y: 1060 },
      { type: 'tap', x: 1050, y: 1060 },
      { type: 'release', id: 1 },
    ]);
  });

  it('按太久（> 250ms）→ 不算 tap', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.up(1, 1, 1, 300);
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('位移太大（> 6px）→ 不算 tap，即使很快', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.up(1, 10, 0, 50);
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('config 可調 tap 門檻（轉傳給內部 GestureTracker）', () => {
    const { router, events } = makeRouter({ tapMaxMs: 100, tapMaxDist: 2 });
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 150); // 150 > 100 → 不是 tap
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('cancel → release；沒在追的 cancel 不 emit', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.cancel(1);
    router.cancel(1); // 已移除
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
  });

  it('多指各自獨立', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.down(2, 100, 0, 0);
    expect(router.activeCount).toBe(2);
    router.up(2, 100, 0, 50); // 快速放 → tap
    router.up(1, 0, 0, 500); // 慢放 → 只 release
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000 },
      { type: 'grab', id: 2, x: 1100, y: 1000 },
      { type: 'tap', x: 1100, y: 1000 },
      { type: 'release', id: 2 },
      { type: 'release', id: 1 },
    ]);
  });

  it('hitTest 回 false（背景）→ 不追這個指標、不 emit（轉傳給內部 GestureTracker）', () => {
    const events: InputEvent[] = [];
    const router = new ToolRouter({
      screenToWorld: (x, y) => ({ x, y }),
      emit: (e) => events.push(e),
      hitTest: (w) => w.x < 100,
    });
    router.down(1, 5, 0, 0); // 命中
    router.down(2, 500, 0, 0); // 背景
    expect(events).toEqual([{ type: 'grab', id: 1, x: 5, y: 0 }]);
    expect(router.activeCount).toBe(1);
  });

  it('setActiveTool 切到非一般操作（目前僅 general 存在，這裡直接測還是 general 不受影響）', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('general');
    expect(router.currentTool).toBe('general');
    router.down(1, 0, 0, 0);
    expect(events).toEqual([{ type: 'grab', id: 1, x: 1000, y: 1000 }]);
  });
});
