import { describe, expect, it, vi } from 'vitest';

import { mulberry32 } from '../mesh';
import type { FanState, InputEvent, Point } from '../sim';
import {
  DEFAULT_FAN_FALLOFF_EXPONENT,
  DEFAULT_FAN_FREQUENCY,
  DEFAULT_FAN_STRENGTH,
  DEFAULT_FAN_WIDTH,
  DEFAULT_TOOL,
  ToolRouter,
  type ToolRouterOptions,
} from './ToolRouter';

/** 同 `GestureTracker.test.ts` 的黑盒手法：`screenToWorld` 把螢幕座標 +1000 好分辨已換算。 */
function makeRouter(
  config?: ToolRouterOptions['config'],
  getFan?: () => FanState | null,
  extra?: Partial<ToolRouterOptions>,
) {
  const events: InputEvent[] = [];
  const screenToWorld = vi.fn((x: number, y: number): Point => ({ x: x + 1000, y: y + 1000 }));
  const router = new ToolRouter({
    screenToWorld,
    emit: (e) => events.push(e),
    config,
    getFan,
    ...extra,
  });
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
        frequency: DEFAULT_FAN_FREQUENCY,
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
        frequency: DEFAULT_FAN_FREQUENCY,
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
        frequency: DEFAULT_FAN_FREQUENCY,
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

  it('setFanParams（issue #67）只覆寫有帶到的欄位，套用到下一次放置', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.setFanParams({ width: 300 });
    router.down(1, 0, 0, 0);
    router.up(1, 40, 0, 50);

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 1000,
        originY: 1000,
        dirX: 1,
        dirY: 0,
        length: 40,
        width: 300,
        strength: DEFAULT_FAN_STRENGTH,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
        frequency: DEFAULT_FAN_FREQUENCY,
      },
    ]);

    router.setFanParams({ strength: 9000, falloffExponent: 0.5 });
    router.down(1, 0, 0, 0);
    router.up(1, 40, 0, 100);

    expect(events[1]).toEqual({
      type: 'setFan',
      originX: 1000,
      originY: 1000,
      dirX: 1,
      dirY: 0,
      length: 40,
      width: 300, // 上一次設定的值持續生效，不用每次都重帶
      strength: 9000,
      falloffExponent: 0.5,
      frequency: DEFAULT_FAN_FREQUENCY, // 沒被設過，維持預設值
    });

    router.setFanParams({ frequency: 5 });
    router.down(1, 0, 0, 0);
    router.up(1, 40, 0, 150);

    expect(events[2]).toEqual({
      type: 'setFan',
      originX: 1000,
      originY: 1000,
      dirX: 1,
      dirY: 0,
      length: 40,
      width: 300,
      strength: 9000,
      falloffExponent: 0.5,
      frequency: 5,
    });
  });
});

describe('ToolRouter — 拖曳既有風扇（issue #67 事後追加）', () => {
  /** 世界座標 (1000,1000)、朝 +x 吹、長 100、寬 40 的既有風扇。 */
  const existingFan: FanState = {
    originX: 1000,
    originY: 1000,
    dirX: 1,
    dirY: 0,
    length: 100,
    width: 40,
    strength: 999,
    falloffExponent: 3,
    frequency: 4,
  };

  it('down 落在既有風扇矩形內、但不是正好按在原點上 → 立刻送一次 setFan，原點維持不變（不瞬移到按下點）', () => {
    const { router, events } = makeRouter(undefined, () => existingFan);
    router.setActiveTool('fan');
    router.down(1, 50, 0, 0); // 世界座標 (1050, 1000)：along=50 in [0,100]、across=0 in [-20,20]，離原點 (1000,1000) 有 50 的距離

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 1000, // 按下當下維持原本的原點，不是按下點 (1050, 1000)——見類別頂端說明
        originY: 1000,
        dirX: 1,
        dirY: 0,
        length: 100,
        width: 40,
        strength: 999,
        falloffExponent: 3,
        frequency: 4,
      },
    ]);
  });

  it('move 期間每次都即時送一次 setFan，原點跟著位移量走、維持按下當下的相對位移', () => {
    const { router, events } = makeRouter(undefined, () => existingFan);
    router.setActiveTool('fan');
    router.down(1, 50, 0, 0); // 世界座標 (1050, 1000)，offset = (1000-1050, 1000-1000) = (-50, 0)
    router.move(1, 60, 10); // 世界座標 (1060, 1010)：位移 (+10, +10)

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'setFan',
      originX: 1010, // 1060 + offsetX(-50)
      originY: 1010, // 1010 + offsetY(0)
      dirX: 1,
      dirY: 0,
      length: 100,
      width: 40,
      strength: 999,
      falloffExponent: 3,
      frequency: 4,
    });
  });

  it('up 在放開點（套用同一個 offset）送最後一次收尾', () => {
    const { router, events } = makeRouter(undefined, () => existingFan);
    router.setActiveTool('fan');
    router.down(1, 50, 0, 0); // offset = (-50, 0)
    router.move(1, 60, 10);
    router.up(1, 70, 20, 50); // 世界座標 (1070, 1020)

    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({
      type: 'setFan',
      originX: 1020, // 1070 + offsetX(-50)
      originY: 1020,
      dirX: 1,
      dirY: 0,
      length: 100,
      width: 40,
      strength: 999,
      falloffExponent: 3,
      frequency: 4,
    });
  });

  it('down 正好按在原點上（offset 為 0）→ 行為等同直接設到指標位置，向下相容原本的直覺', () => {
    const { router, events } = makeRouter(undefined, () => existingFan);
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0); // 世界座標 (1000, 1000) == fan.origin
    router.move(1, 10, 10); // 世界座標 (1010, 1010)

    expect(events[1]).toEqual({
      type: 'setFan',
      originX: 1010,
      originY: 1010,
      dirX: 1,
      dirY: 0,
      length: 100,
      width: 40,
      strength: 999,
      falloffExponent: 3,
      frequency: 4,
    });
  });

  it('cancel 中途放棄 → 不再繼續跟隨指標，但不回捲已經 emit 過的移動（比照 Grab 的 cancel）', () => {
    const { router, events } = makeRouter(undefined, () => existingFan);
    router.setActiveTool('fan');
    router.down(1, 50, 0, 0);
    router.move(1, 60, 10);
    router.cancel(1);

    expect(events).toHaveLength(2); // down + 一次 move 各 emit 一次，cancel 不再多 emit、也不補一個「復原」事件
  });

  it('down 落在既有風扇矩形外 → 退回「放置新風扇」，不受既有風扇影響', () => {
    const { router, events } = makeRouter(undefined, () => existingFan);
    router.setActiveTool('fan');
    router.down(1, 1000, 1000, 0); // 世界座標 (2000, 2000)，遠在矩形之外
    router.up(1, 1040, 1000, 50); // 位移 (40, 0)

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 2000,
        originY: 2000,
        dirX: 1,
        dirY: 0,
        length: 40,
        width: DEFAULT_FAN_WIDTH,
        strength: DEFAULT_FAN_STRENGTH,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
        frequency: DEFAULT_FAN_FREQUENCY,
      },
    ]);
  });

  it('沒有 getFan（未接、或場上沒有風扇）→ 一律當放置新風扇，行為不變', () => {
    const { router, events } = makeRouter(undefined, () => null);
    router.setActiveTool('fan');
    router.down(1, 50, 0, 0);
    router.up(1, 90, 0, 50);

    expect(events).toEqual([
      {
        type: 'setFan',
        originX: 1050,
        originY: 1000,
        dirX: 1,
        dirY: 0,
        length: 40,
        width: DEFAULT_FAN_WIDTH,
        strength: DEFAULT_FAN_STRENGTH,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
        frequency: DEFAULT_FAN_FREQUENCY,
      },
    ]);
  });
});

describe('ToolRouter — 編隊抓取（issue #68 / V2 T3-4）', () => {
  it('切到編隊抓取但還沒定義形狀 → down 不 emit 任何事件', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.down(1, 0, 0, 0);
    expect(events).toEqual([]);
  });

  it('定義兩點後在果凍上拖曳 → 兩個 grab（id 相異）+ 同步的 moveGrab + 兩個 release', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0); // 世界座標 (1000, 1000)：主點，偏移 (0,0)
    router.down(1, 10, 0, 0); // 世界座標 (1010, 1000)：偏移 (10, 0)
    router.endFormationDefine();

    router.down(2, 100, 100, 0); // 世界座標 (1100, 1100)
    router.move(2, 120, 100);
    router.up(2, 120, 100, 50);

    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'grab', id: 'formation:1:1', x: 1110, y: 1100 },
      { type: 'moveGrab', id: 'formation:1:0', x: 1120, y: 1100 },
      { type: 'moveGrab', id: 'formation:1:1', x: 1130, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
      { type: 'release', id: 'formation:1:1' },
    ]);
  });

  it('定義中的 down 不 emit 任何事件（只記點）', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.down(1, 10, 0, 0);
    router.down(1, 20, 0, 0);
    expect(events).toEqual([]);
  });

  it('其中一點的 hitTest 回 false（落在果凍外）→ 只有另一點的 grab/release，不整組取消', () => {
    const events: InputEvent[] = [];
    const screenToWorld = vi.fn((x: number, y: number): Point => ({ x: x + 1000, y: y + 1000 }));
    // 世界座標 x >= 1110 一律判定為落在果凍外（第二個偏移點 1110,1000 命中這條件）。
    const router = new ToolRouter({
      screenToWorld,
      emit: (e) => events.push(e),
      hitTest: (w) => w.x < 1110,
    });
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0); // (1000, 1000)
    router.down(1, 10, 0, 0); // (1010, 1000) → 偏移 (10, 0)
    router.endFormationDefine();

    router.down(2, 100, 100, 0); // 世界座標 (1100, 1100)：主點在內、偏移點 (1110,1100) 在外
    router.up(2, 100, 100, 50);

    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
    ]);
  });

  it('偏移量在拖曳中固定、不隨方向旋轉——不管往哪個方向拖，兩點的相對位移都一致', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.down(1, 10, 0, 0); // 偏移 (10, 0)
    router.endFormationDefine();

    router.down(2, 0, 0, 0); // (1000, 1000)
    router.move(2, 5, 30); // 世界座標 (1005, 1030)：往斜下方拖
    router.up(2, 5, 30, 50);

    const moveEvents = events.filter((e) => e.type === 'moveGrab');
    expect(moveEvents).toEqual([
      { type: 'moveGrab', id: 'formation:1:0', x: 1005, y: 1030 },
      { type: 'moveGrab', id: 'formation:1:1', x: 1015, y: 1030 }, // 仍然是主點 + (10, 0)
    ]);
  });

  it('cancel → 對已附著的每個點送 release（跟一般 Grab 的 cancel 一樣，是活著的約束要真的放開）', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.down(1, 10, 0, 0);
    router.endFormationDefine();

    router.down(2, 0, 0, 0);
    router.cancel(2);
    router.cancel(2); // 已經清掉，不會二次 emit

    expect(events.map((e) => e.type)).toEqual(['grab', 'grab', 'release', 'release']);
  });

  it('重新設定形狀（再呼叫一次 begin/end）→ 覆蓋掉舊形狀', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.down(1, 10, 0, 0);
    router.endFormationDefine();
    expect(router.formationShape).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);

    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.down(1, 0, 20, 0);
    router.down(1, 0, -20, 0);
    router.endFormationDefine();
    expect(router.formationShape).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 0, y: -20 },
    ]);

    router.down(2, 0, 0, 0);
    expect(events.filter((e) => e.type === 'grab')).toHaveLength(3);
  });

  it('endFormationDefine 沒記到任何點 → 保留舊形狀不動', () => {
    const { router } = makeRouter();
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.endFormationDefine();
    const shape = router.formationShape;

    router.beginFormationDefine();
    router.endFormationDefine(); // 沒有任何 down
    expect(router.formationShape).toEqual(shape);
  });

  it('切回一般操作 → 編隊抓取的 down 不再作用；切回編隊抓取後形狀仍在，恢復正常', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.endFormationDefine();

    router.setActiveTool('general');
    router.down(2, 0, 0, 0); // 一般操作的 grab
    router.up(2, 0, 0, 500);

    router.setActiveTool('formation');
    router.down(3, 50, 50, 0);
    router.up(3, 50, 50, 50);

    expect(events).toEqual([
      { type: 'grab', id: 2, x: 1000, y: 1000 },
      { type: 'release', id: 2 },
      { type: 'grab', id: 'formation:1:0', x: 1050, y: 1050 },
      { type: 'release', id: 'formation:1:0' },
    ]);
  });
});

describe('ToolRouter — 撒 Pin（issue #69 / V2 T3-5）', () => {
  /** 撒點用的隨機數注入固定種子，測試才逐次一致（預設是 `Math.random`）。 */
  const seeded = () => mulberry32(0x5eed);

  /** 這批 `pin` 事件的座標（撒 Pin 只會送 `pin`，這裡順便當成型別收窄）。 */
  function pinPoints(events: readonly InputEvent[]): Point[] {
    return events.flatMap((e) =>
      e.type === 'pin' && e.x !== undefined && e.y !== undefined ? [{ x: e.x, y: e.y }] : [],
    );
  }

  /** 點集合裡任兩點的最小距離（少於兩點時回 `Infinity`）。 */
  function minPairDistance(points: readonly Point[]): number {
    let min = Infinity;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        min = Math.min(min, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
      }
    }
    return min;
  }

  it('點一下 → 一批 pin 事件，id 各自相異、都帶 spray: 前綴', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.down(1, 0, 0, 0);

    expect(events.length).toBeGreaterThan(1);
    expect(events.every((e) => e.type === 'pin')).toBe(true);
    const ids = events.map((e) => (e.type === 'pin' ? e.id : null));
    expect(ids.every((id) => typeof id === 'string' && id.startsWith('spray:'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('撒出的任兩顆 Pin 距離 ≥ 設定的間距', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.setSprayParams({ radius: 200, spacing: 40 });
    router.down(1, 0, 0, 0);

    const points = pinPoints(events);
    expect(points.length).toBeGreaterThan(1);
    expect(minPairDistance(points)).toBeGreaterThanOrEqual(40);
  });

  it('跟注入的既有 Pin（listPins）也保持 ≥ 間距——不會撒在已經有 Pin 的地方', () => {
    const existing = [
      { id: 'a', point: { x: 1000, y: 1000 } },
      { id: 'b', point: { x: 1060, y: 1020 } },
    ];
    const { router, events } = makeRouter(undefined, undefined, {
      random: seeded(),
      listPins: () => existing,
    });
    router.setActiveTool('spray');
    router.setSprayParams({ radius: 200, spacing: 40 });
    router.down(1, 0, 0, 0); // 圓心 (1000, 1000)，正好蓋住兩顆既有 Pin

    const points = pinPoints(events);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      for (const pin of existing) {
        expect(Math.hypot(p.x - pin.point.x, p.y - pin.point.y)).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('密度調高（間距調小）→ 同樣半徑撒出的 Pin 數量變多', () => {
    const sparse = makeRouter(undefined, undefined, { random: seeded() });
    sparse.router.setActiveTool('spray');
    sparse.router.setSprayParams({ radius: 200, spacing: 80 });
    sparse.router.down(1, 0, 0, 0);

    const dense = makeRouter(undefined, undefined, { random: seeded() });
    dense.router.setActiveTool('spray');
    dense.router.setSprayParams({ radius: 200, spacing: 25 });
    dense.router.down(1, 0, 0, 0);

    expect(dense.events.length).toBeGreaterThan(sparse.events.length);
  });

  it('撒出的 Pin 都落在以點擊處為圓心、設定半徑內', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.setSprayParams({ radius: 120, spacing: 30 });
    router.down(1, 50, 70, 0); // 世界座標圓心 (1050, 1070)

    const points = pinPoints(events);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Math.hypot(p.x - 1050, p.y - 1070)).toBeLessThanOrEqual(120);
    }
  });

  it('候選點落在果凍外（hitTest 回 false）→ 不送出對應的 pin', () => {
    const { router, events } = makeRouter(undefined, undefined, {
      random: seeded(),
      hitTest: (w) => w.x < 1000, // 圓心右半邊一律判定為落在果凍外
    });
    router.setActiveTool('spray');
    router.setSprayParams({ radius: 200, spacing: 30 });
    router.down(1, 0, 0, 0); // 圓心 (1000, 1000)

    const points = pinPoints(events);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((p) => p.x < 1000)).toBe(true);
  });

  it('整個範圍都在果凍外 → 一顆都不送', () => {
    const { router, events } = makeRouter(undefined, undefined, {
      random: seeded(),
      hitTest: () => false,
    });
    router.setActiveTool('spray');
    router.down(1, 0, 0, 0);
    expect(events).toEqual([]);
  });

  it('點一下就完成的單次動作——後續 move／up／cancel 不再送出任何事件', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.down(1, 0, 0, 0);
    const afterDown = events.length;

    router.move(1, 30, 30);
    router.up(1, 30, 30, 50);
    router.cancel(1);
    expect(events).toHaveLength(afterDown);
  });

  it('連撒兩次 → 第二批的 id 不跟第一批重複（每顆 Pin 之後才能各自獨立操作）', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.down(1, 0, 0, 0);
    router.down(2, 400, 400, 0);

    const ids = events.map((e) => (e.type === 'pin' ? e.id : null));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // 間距被調到極小、半徑極大時，dart throwing 的嘗試次數與撒出的顆數都必須有
  // 上限——否則一下撒進上千顆硬約束，求解器當場被壓垮、這個迴圈本身也會掉幀。
  it('半徑極大 + 間距極小 → 仍有上限，不會一次撒進無限多顆，也會在有限次嘗試內結束', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.setSprayParams({ radius: 100000, spacing: 0.0001 });
    router.down(1, 0, 0, 0);
    expect(events.length).toBeLessThanOrEqual(200);
  });

  it('間距為 0（極端輸入）→ 不會無窮迴圈，仍在上限內收斂', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.setSprayParams({ radius: 200, spacing: 0 });
    router.down(1, 0, 0, 0);
    expect(events.length).toBeLessThanOrEqual(200);
  });

  it('撒 Pin 不影響一般操作——切回去仍是既有的 Grab 手勢', () => {
    const { router, events } = makeRouter(undefined, undefined, { random: seeded() });
    router.setActiveTool('spray');
    router.setActiveTool('general');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 500);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000 },
      { type: 'release', id: 1 },
    ]);
  });
});

describe('ToolRouter — 移除 Pin（issue #70 / V2 T3-6）', () => {
  /**
   * 這個工具唯一的資料來源是注入的 `listPins`，所以測試這一端要模擬真實路徑上
   * `SimCore` 的行為：`emit` 收到 `unpin` 就把那顆從清單裡拿掉（真實路徑上 emit
   * 是同步進 `sim.applyInput` 的）。用一個永遠不變的靜態清單測不到「清掉之後
   * 它就不在清單裡了」這件事。`live: false` 則刻意保留靜態清單，用來單獨驗證
   * 「同一次拖曳內不重送」這件事真的由本次手勢的已處理集合擋下，而不是碰巧
   * 靠清單變短。
   */
  function makeEraser(
    pins: readonly { id: string; point: Point }[],
    opts?: { live?: boolean; radius?: number },
  ) {
    const store = [...pins];
    const events: InputEvent[] = [];
    const router = new ToolRouter({
      screenToWorld: (x, y) => ({ x: x + 1000, y: y + 1000 }),
      emit: (e) => {
        events.push(e);
        if ((opts?.live ?? true) && e.type === 'unpin') {
          const index = store.findIndex((p) => p.id === e.id);
          if (index >= 0) store.splice(index, 1);
        }
      },
      listPins: () => store,
    });
    router.setActiveTool('erase');
    if (opts?.radius !== undefined) router.setEraseParams({ radius: opts.radius });
    const unpinnedIds = () => events.flatMap((e) => (e.type === 'unpin' ? [e.id] : []));
    return { router, events, store, unpinnedIds };
  }

  it('按下當下就把圓心半徑內的既有 Pin 清掉（不必等到 move）', () => {
    const { router, unpinnedIds } = makeEraser(
      [
        { id: 'a', point: { x: 1000, y: 1000 } },
        { id: 'far', point: { x: 1500, y: 1500 } },
      ],
      { radius: 60 },
    );
    router.down(1, 0, 0, 0); // 世界座標 (1000, 1000)
    expect(unpinnedIds()).toEqual(['a']);
  });

  it('拖曳經過 → 進到半徑內的 Pin 依序被清掉；始終在半徑外的不受影響', () => {
    const { router, unpinnedIds, store } = makeEraser(
      [
        { id: 'a', point: { x: 1000, y: 1000 } },
        { id: 'b', point: { x: 1100, y: 1000 } },
        { id: 'c', point: { x: 1200, y: 1000 } },
        { id: 'away', point: { x: 1100, y: 1900 } },
      ],
      { radius: 40 },
    );
    router.down(1, 0, 0, 0);
    expect(unpinnedIds()).toEqual(['a']);
    router.move(1, 100, 0);
    expect(unpinnedIds()).toEqual(['a', 'b']);
    router.move(1, 200, 0);
    expect(unpinnedIds()).toEqual(['a', 'b', 'c']);
    router.up(1, 200, 0, 300);
    expect(store.map((p) => p.id)).toEqual(['away']);
  });

  it('同一顆 Pin 在同一次拖曳中只送一次 unpin（即使它一直待在半徑內）', () => {
    const { router, unpinnedIds } = makeEraser([{ id: 'a', point: { x: 1000, y: 1000 } }], {
      live: false, // 清單刻意不變短，逼「已處理集合」自己擋下重送
      radius: 200,
    });
    router.down(1, 0, 0, 0);
    router.move(1, 10, 10);
    router.move(1, 20, 20);
    router.move(1, 5, 5);
    expect(unpinnedIds()).toEqual(['a']);
  });

  it('放開後再次拖過同一個位置 → 已經清掉的 id 不會被重送', () => {
    const { router, unpinnedIds } = makeEraser([{ id: 'a', point: { x: 1000, y: 1000 } }], {
      radius: 80,
    });
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 100);
    router.down(2, 0, 0, 200);
    router.move(2, 10, 10);
    router.up(2, 10, 10, 300);
    expect(unpinnedIds()).toEqual(['a']);
  });

  it('放開後重新按下 → 新一次手勢的集合是乾淨的（同一顆若還在，照樣會被清）', () => {
    const { router, unpinnedIds } = makeEraser([{ id: 'a', point: { x: 1000, y: 1000 } }], {
      live: false, // 模擬「第一次的 unpin 沒有真的生效」，驗證集合確實有被清掉
      radius: 80,
    });
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 100);
    router.down(2, 0, 0, 200);
    expect(unpinnedIds()).toEqual(['a', 'a']);
  });

  // 規格：「up/cancel 清掉那個集合、結束」——放開本身不是一次擦除。瀏覽器在
  // `up` 前一定送過同座標的 `move`，補擦只會在 Track 上多錄一筆重複的 unpin。
  it('up 只是結束，不在放開當下多擦一次', () => {
    const { router, unpinnedIds } = makeEraser(
      [
        { id: 'a', point: { x: 1000, y: 1000 } },
        { id: 'b', point: { x: 1300, y: 1000 } },
      ],
      { radius: 60 },
    );
    router.down(1, 0, 0, 0); // 擦掉 a
    router.up(1, 300, 0, 200); // 放開處剛好壓在 b 上，但沒有 move 走過
    expect(unpinnedIds()).toEqual(['a']);
  });

  it('cancel 同樣結束這次擦除（集合清掉，之後的 move 不再作用）', () => {
    const { router, unpinnedIds } = makeEraser([{ id: 'a', point: { x: 1000, y: 1000 } }], {
      live: false,
      radius: 80,
    });
    router.down(1, 500, 500, 0); // 離 Pin 很遠，什麼都沒清到
    router.cancel(1);
    router.move(1, 0, 0); // 沒有進行中的手勢 → 不作用
    expect(unpinnedIds()).toEqual([]);
  });

  it('沒按下就 move → 不作用（不是「滑過去就擦掉」）', () => {
    const { router, unpinnedIds } = makeEraser([{ id: 'a', point: { x: 1000, y: 1000 } }], {
      radius: 80,
    });
    router.move(1, 0, 0);
    expect(unpinnedIds()).toEqual([]);
  });

  it('半徑滑桿調大 → 同一個位置能擦到更遠的 Pin', () => {
    const pins = [{ id: 'a', point: { x: 1100, y: 1000 } }];
    const small = makeEraser(pins, { radius: 50 });
    small.router.down(1, 0, 0, 0);
    expect(small.unpinnedIds()).toEqual([]);

    const large = makeEraser(pins, { radius: 150 });
    large.router.down(1, 0, 0, 0);
    expect(large.unpinnedIds()).toEqual(['a']);
  });

  // 兩個工具的半徑是各自獨立的欄位（issue #70 驗收條件）：把撒 Pin 的半徑調到
  // 極小，橡皮擦的作用範圍不該跟著縮水。
  it('跟撒 Pin 的半徑各自獨立——調撒 Pin 的半徑不影響擦除範圍', () => {
    const { router, unpinnedIds } = makeEraser([{ id: 'a', point: { x: 1100, y: 1000 } }], {
      radius: 150,
    });
    router.setSprayParams({ radius: 1 });
    router.down(1, 0, 0, 0); // 世界座標 (1000, 1000)，距離 Pin 100
    expect(unpinnedIds()).toEqual(['a']);
  });

  it('只作用於 Pin——不送 release，也不動到一般 Grab；切回一般操作仍是既有手勢', () => {
    const { router, events } = makeEraser([{ id: 'a', point: { x: 1000, y: 1000 } }], {
      radius: 80,
    });
    router.down(1, 0, 0, 0);
    router.move(1, 5, 5);
    router.up(1, 5, 5, 300);
    expect(events.every((e) => e.type === 'unpin')).toBe(true);

    router.setActiveTool('general');
    const before = events.length;
    router.down(2, 0, 0, 400);
    router.up(2, 0, 0, 900);
    expect(events.slice(before)).toEqual([
      { type: 'grab', id: 2, x: 1000, y: 1000 },
      { type: 'release', id: 2 },
    ]);
  });

  it('沒有注入 listPins（場上沒有 Pin 可讀）→ 什麼都不送，不爆炸', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('erase');
    router.down(1, 0, 0, 0);
    router.move(1, 10, 10);
    router.up(1, 10, 10, 300);
    expect(events).toEqual([]);
  });
});
