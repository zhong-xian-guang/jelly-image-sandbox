import { describe, expect, it, vi } from 'vitest';

import type { InputEvent, Point } from '../sim';
import {
  DEFAULT_FAN_FALLOFF_EXPONENT,
  DEFAULT_FAN_STRENGTH,
  DEFAULT_FAN_WIDTH,
  DEFAULT_TOOL,
  ToolRouter,
  type ToolRouterOptions,
} from './ToolRouter';

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

  it('setActiveTool 切到非一般操作 → 一般操作的 down 不再 emit grab', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    expect(router.currentTool).toBe('fan');
    router.down(1, 0, 0, 0);
    expect(events).toEqual([]); // 電風扇的 down 只記原點，放開才 emit（見下方 fan 區塊）
  });
});

describe('ToolRouter — 電風扇（issue #66 / V2 T3-2；ADR-0010）', () => {
  it('down → move（僅更新內部預覽，不 emit）→ up → 恰好一個 setFan，欄位對應拖曳的起點/方向/距離', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0); // 世界座標（經 screenToWorld +1000）(1000, 1000)
    router.move(1, 5, 0); // 預覽中，不 emit
    router.move(1, 40, 0); // 世界座標 (1040, 1000)
    router.up(1, 40, 0, 100);

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 1000,
        originY: 1000,
        dirX: 1,
        dirY: 0,
        length: 40,
        width: DEFAULT_FAN_WIDTH,
        strength: DEFAULT_FAN_STRENGTH,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
      },
    ]);
  });

  it('斜向拖曳 → dirX/dirY 是正規化單位向量、length 是實際距離', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0); // (1000, 1000)
    router.up(1, 3, 4, 50); // (1003, 1004) → 位移 (3, 4)，長度 5

    expect(events).toHaveLength(1);
    const e = events[0] as Extract<InputEvent, { type: 'setFan' }>;
    expect(e.type).toBe('setFan');
    expect(e.length).toBeCloseTo(5, 9);
    expect(e.dirX).toBeCloseTo(0.6, 9);
    expect(e.dirY).toBeCloseTo(0.8, 9);
  });

  it('再拖曳一次 → 第二次的 setFan 直接取代（不用先送 clearFan，ADR-0010）', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    router.up(1, 40, 0, 50);
    router.down(1, 100, 100, 100);
    router.up(1, 100, 140, 150);

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === 'setFan')).toBe(true);
  });

  it('按下沒拖曳（原地放開）→ 仍送一個 length=0 的 setFan，方向退回 (1, 0)（SimCore 對 length<=0 no-op）', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 10, 10, 0);
    router.up(1, 10, 10, 50);

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 1010,
        originY: 1010,
        dirX: 1,
        dirY: 0,
        length: 0,
        width: DEFAULT_FAN_WIDTH,
        strength: DEFAULT_FAN_STRENGTH,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
      },
    ]);
  });

  it('cancel → 放棄這次放置，不 emit 任何事件；沒有進行中的手勢時 cancel 也不 emit', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    router.move(1, 40, 0);
    router.cancel(1);
    router.cancel(1); // 已經清掉，不會二次 emit
    expect(events).toEqual([]);
  });

  it('cancel 後再 down/up → 是一次全新的放置，不受被取消那次影響', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    router.cancel(1);
    router.down(1, 50, 50, 0);
    router.up(1, 90, 50, 50);

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 1050,
        originY: 1050,
        dirX: 1,
        dirY: 0,
        length: 40,
        width: DEFAULT_FAN_WIDTH,
        strength: DEFAULT_FAN_STRENGTH,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
      },
    ]);
  });

  it('電風扇工具下，一般操作的手勢（Grab/Tap）完全不觸發', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    router.up(1, 1, 1, 50); // 快、幾乎沒動——一般操作下會是 tap，這裡不該有
    expect(events.some((e) => e.type === 'grab' || e.type === 'tap')).toBe(false);
  });

  it('切回一般操作 → Grab/Pin/Tap 手勢立刻恢復正常', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    router.setActiveTool('general'); // 切換過程中沒有殘留任何一般操作的追蹤
    router.down(2, 0, 0, 0);
    expect(events).toEqual([{ type: 'grab', id: 2, x: 1000, y: 1000 }]);
  });
});
