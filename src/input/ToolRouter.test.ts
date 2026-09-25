import { describe, expect, it, vi } from 'vitest';

import type { FanState, InputEvent, Point } from '../sim';
import {
  DEFAULT_FAN_FALLOFF_EXPONENT,
  DEFAULT_FAN_FREQUENCY,
  DEFAULT_FAN_STRENGTH,
  DEFAULT_FAN_WIDTH,
  DEFAULT_HANDFUL_RADIUS,
  DEFAULT_TOOL,
  FAN_FALLOFF_RANGE,
  FAN_FREQUENCY_RANGE,
  FAN_STRENGTH_RANGE,
  FAN_WIDTH_RANGE,
  HANDFUL_RADIUS_RANGE,
  PIN_BRUSH_RADIUS_RANGE,
  TOOL_IDS,
  ToolRouter,
  modesOf,
  type GrabMode,
  type ToolRouterOptions,
} from './ToolRouter';

/**
 * 切到抓取工具的某個模式（issue #122）：單點＝原本的「一般操作」、大把＝原本的「大把
 * 抓取」、編隊＝原本的「編隊抓取」——既有的各分支測試照原樣沿用，只換掉選分支的方式。
 */
function selectGrab(router: ToolRouter, mode: GrabMode): void {
  router.setActiveTool('grab');
  router.setMode('grab', mode);
}

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
  it('預設就是抓取工具的單點模式（＝原本的一般操作）', () => {
    const { router } = makeRouter();
    expect(router.currentTool).toBe(DEFAULT_TOOL);
    expect(router.currentTool).toBe('grab');
    expect(router.currentMode).toBe('single');
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

  it('切回一般操作 → Grab/Tap 手勢立刻恢復正常', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    selectGrab(router, 'single'); // 切換過程中沒有殘留任何一般操作的追蹤
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
    selectGrab(router, 'formation');
    router.down(1, 0, 0, 0);
    expect(events).toEqual([]);
  });

  it('定義兩點後在果凍上拖曳 → 兩個 grab（id 相異）+ 同步的 moveGrab + 兩個 release', () => {
    const { router, events } = makeRouter();
    selectGrab(router, 'formation');
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
    selectGrab(router, 'formation');
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
    selectGrab(router, 'formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0); // (1000, 1000)
    router.down(1, 10, 0, 0); // (1010, 1000) → 偏移 (10, 0)
    router.endFormationDefine();

    router.down(2, 100, 100, 0); // 世界座標 (1100, 1100)：主點在內、偏移點 (1110,1100) 在外
    // 按久一點（> tapMaxMs）避免同時觸發編隊輕拍（issue #81）——這一則只管
    // grab/release 的落點過濾，輕拍的部分由該 issue 自己那組測試涵蓋。
    router.up(2, 100, 100, 300);

    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
    ]);
  });

  it('偏移量在拖曳中固定、不隨方向旋轉——不管往哪個方向拖，兩點的相對位移都一致', () => {
    const { router, events } = makeRouter();
    selectGrab(router, 'formation');
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
    selectGrab(router, 'formation');
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
    selectGrab(router, 'formation');
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
    selectGrab(router, 'formation');
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.endFormationDefine();

    selectGrab(router, 'single');
    router.down(2, 0, 0, 0); // 一般操作的 grab
    router.up(2, 0, 0, 500);

    selectGrab(router, 'formation');
    // 同上：按久一點避開編隊輕拍（issue #81），這一則只管工具切換後 down 有沒有恢復作用。
    router.down(3, 50, 50, 0);
    router.up(3, 50, 50, 300);

    expect(events).toEqual([
      { type: 'grab', id: 2, x: 1000, y: 1000 },
      { type: 'release', id: 2 },
      { type: 'grab', id: 'formation:1:0', x: 1050, y: 1050 },
      { type: 'release', id: 'formation:1:0' },
    ]);
  });
});

describe('ToolRouter — 編隊形狀的懸停預覽（issue #79 / V2 T3-8）', () => {
  /** 定義一個「主點 + 右 10 + 下 20」的形狀，之後拿它試預覽。 */
  function withShape() {
    const made = makeRouter();
    selectGrab(made.router, 'formation');
    made.router.beginFormationDefine();
    made.router.down(1, 0, 0, 0);
    made.router.down(1, 10, 0, 0);
    made.router.down(1, 0, 20, 0);
    made.router.endFormationDefine();
    return made;
  }

  it('還沒定義過形狀 → 沒有預覽點（沒有東西可預覽）', () => {
    const { router } = makeRouter();
    expect(router.formationPreviewAt({ x: 500, y: 500 })).toEqual([]);
  });

  it('已定義形狀 → 以傳入的世界座標為主點，套上各偏移量', () => {
    const { router } = withShape();
    expect(router.formationPreviewAt({ x: 500, y: 300 })).toEqual([
      { x: 500, y: 300 },
      { x: 510, y: 300 },
      { x: 500, y: 320 },
    ]);
  });

  // 「拖曳時整組偏移量不隨方向旋轉、只整體跟著指標平移」（CONTEXT.md 編隊抓取）
  // ——預覽是那個行為的事前呈現，換個主點只能是整組平移。
  it('換一個主點 → 整組平移，點與點的相對關係完全不變', () => {
    const { router } = withShape();
    const a = router.formationPreviewAt({ x: 0, y: 0 });
    const b = router.formationPreviewAt({ x: -40, y: 70 });
    expect(b).toEqual(a.map((p) => ({ x: p.x - 40, y: p.y + 70 })));
  });

  it('重新設定形狀 → 預覽跟著換成新形狀', () => {
    const { router } = withShape();
    router.beginFormationDefine();
    router.down(1, 0, 0, 0);
    router.down(1, -5, -5, 0);
    router.endFormationDefine();
    expect(router.formationPreviewAt({ x: 100, y: 100 })).toEqual([
      { x: 100, y: 100 },
      { x: 95, y: 95 },
    ]);
  });

  // 預覽純粹是視覺提示，呼叫它不該驚動求解器（ADR-0005：只有真正的操作才走 emit）。
  it('讀預覽不送出任何 InputEvent', () => {
    const { router, events } = withShape();
    const before = events.length;
    router.formationPreviewAt({ x: 1, y: 2 });
    router.formationPreviewAt({ x: 3, y: 4 });
    expect(events.length).toBe(before);
  });
});

describe('ToolRouter — 編隊抓取的輕拍（issue #81 / V2 T3-9）', () => {
  /** 定義一個「主點 + 右 10」的兩點形狀，之後拿它試輕拍。 */
  function withShape(extra?: Partial<ToolRouterOptions>) {
    const made = makeRouter(undefined, undefined, extra);
    selectGrab(made.router, 'formation');
    made.router.beginFormationDefine();
    made.router.down(1, 0, 0, 0);
    made.router.down(1, 10, 0, 0);
    made.router.endFormationDefine();
    made.events.length = 0; // 定義階段不 emit，清掉以防萬一
    return made;
  }

  it('快速按放 → 每個命中點各一次 tap，順序是 grab×N → tap×N → release×N', () => {
    const { router, events } = withShape();
    router.down(2, 100, 100, 0);
    router.up(2, 101, 100, 200); // 200ms、位移 1px → 算輕拍

    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'grab', id: 'formation:1:1', x: 1110, y: 1100 },
      { type: 'tap', x: 1100, y: 1100 },
      { type: 'tap', x: 1110, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
      { type: 'release', id: 'formation:1:1' },
    ]);
  });

  // 比照 `GestureTracker.up`：tap 打在**按下當下**的位置，不是放開位置。
  it('tap 座標用按下當下的位置，不是放開位置', () => {
    const { router, events } = withShape();
    router.down(2, 50, 50, 0);
    router.up(2, 54, 52, 100); // 位移 ~4.5px，仍在門檻內
    const taps = events.filter((e) => e.type === 'tap');
    expect(taps).toEqual([
      { type: 'tap', x: 1050, y: 1050 },
      { type: 'tap', x: 1060, y: 1050 },
    ]);
  });

  it('按太久（> tapMaxMs）→ 不算輕拍，只有 grab/release', () => {
    const { router, events } = withShape();
    router.down(2, 100, 100, 0);
    router.up(2, 100, 100, 300);
    expect(events.map((e) => e.type)).toEqual(['grab', 'grab', 'release', 'release']);
  });

  it('位移太大（> tapMaxDist）→ 不算輕拍，即使很快', () => {
    const { router, events } = withShape();
    router.down(2, 100, 100, 0);
    router.move(2, 130, 100);
    router.up(2, 130, 100, 50);
    expect(events.filter((e) => e.type === 'tap')).toEqual([]);
    expect(events.map((e) => e.type)).toEqual([
      'grab',
      'grab',
      'moveGrab',
      'moveGrab',
      'release',
      'release',
    ]);
  });

  // 輕拍的門檻必須跟一般操作是同一組——同一個使用者在兩個模式下「怎樣算快速
  // 按放」不一致的話，手感會前後矛盾。
  it('沿用注入的 GestureConfig 門檻（與一般操作同一組）', () => {
    const made = makeRouter({ tapMaxMs: 50 });
    selectGrab(made.router, 'formation');
    made.router.beginFormationDefine();
    made.router.down(1, 0, 0, 0);
    made.router.endFormationDefine();
    made.events.length = 0;

    made.router.down(2, 0, 0, 0);
    made.router.up(2, 0, 0, 120); // 120ms > 放寬後的 50ms → 不算輕拍
    expect(made.events.filter((e) => e.type === 'tap')).toEqual([]);
  });

  it('部分偏移點落在果凍外 → 只有命中的那幾點被拍', () => {
    // 只讓主點（x = 1100）命中；右邊那點（x = 1110）落在果凍外。
    const { router, events } = withShape({ hitTest: (p) => p.x === 1100 });
    router.down(2, 100, 100, 0);
    router.up(2, 100, 100, 100);
    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'tap', x: 1100, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
    ]);
  });

  it('整組都落在果凍外 → 什麼都不送', () => {
    const { router, events } = withShape({ hitTest: () => false });
    router.down(2, 100, 100, 0);
    router.up(2, 100, 100, 100);
    expect(events).toEqual([]);
  });

  // 取消不是「完成一次輕拍」——手勢被中斷時只放開，不補一記 tap。
  it('cancel → 只 release，不送 tap', () => {
    const { router, events } = withShape();
    router.down(2, 100, 100, 0);
    router.cancel(2);
    expect(events.map((e) => e.type)).toEqual(['grab', 'grab', 'release', 'release']);
  });

  it('輕拍完 session 已清掉——再 up 一次不會重送', () => {
    const { router, events } = withShape();
    router.down(2, 100, 100, 0);
    router.up(2, 100, 100, 100);
    const count = events.length;
    router.up(2, 100, 100, 150);
    expect(events.length).toBe(count);
    expect(router.formationActiveGroups).toEqual([]);
  });
});

describe('ToolRouter — Jelly 工具（issue #97 的點一下手勢；issue #124 合併＋右鍵選單）', () => {
  /** 左鍵單擊（生成）與右鍵單擊（開選單）各自收集起來比對。 */
  function makeJellyTool(hitTest?: (world: Point) => boolean) {
    const spawned: Point[] = [];
    const menus: { world: Point; screen: Point }[] = [];
    const { router, events } = makeRouter(undefined, undefined, {
      hitTest,
      onJellyClick: (world) => spawned.push(world),
      onJellyContextMenu: (world, screen) => menus.push({ world, screen }),
    });
    router.setActiveTool('jelly');
    return { router, events, spawned, menus };
  }

  it('左鍵點一下 → onJellyClick 收到按下處的世界座標，不 emit 任何 InputEvent', () => {
    const { router, events, spawned } = makeJellyTool();
    router.down(1, 30, 40, 0);
    router.up(1, 30, 40, 120);
    expect(spawned).toEqual([{ x: 1030, y: 1040 }]);
    expect(events).toEqual([]);
  });

  it('點在既有 Jelly 上也照樣生成（不因命中 Jelly 改成別的動作）', () => {
    const { router, spawned, menus } = makeJellyTool(() => true);
    router.down(1, 5, 7, 0);
    router.up(1, 5, 7, 80);
    expect(spawned).toEqual([{ x: 1005, y: 1007 }]);
    expect(menus).toEqual([]);
  });

  it('按住一陣子再放開（沒拖曳）仍算點一下——只要位置沒動就生成', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 10, 10, 0);
    router.move(1, 12, 11);
    router.up(1, 12, 11, 3000);
    expect(spawned).toEqual([{ x: 1010, y: 1010 }]);
  });

  it('拖曳（位移超過門檻）→ 不生成', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 0, 0, 0);
    router.move(1, 40, 0);
    router.up(1, 40, 0, 100);
    expect(spawned).toEqual([]);
  });

  it('拖出去又回到原點 → 仍不算點一下（中途已經判定為拖曳）', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 0, 0, 0);
    router.move(1, 50, 50);
    router.move(1, 0, 0);
    router.up(1, 0, 0, 200);
    expect(spawned).toEqual([]);
  });

  it('cancel → 不生成；之後再 up 也不會補送', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 0, 0, 0);
    router.cancel(1);
    router.up(1, 0, 0, 100);
    expect(spawned).toEqual([]);
  });

  it('沒有 down 過的 up 不生成；同一次 up 不會重送兩次', () => {
    const { router, spawned } = makeJellyTool();
    router.up(9, 0, 0, 100);
    expect(spawned).toEqual([]);

    router.down(1, 0, 0, 200);
    router.up(1, 0, 0, 300);
    router.up(1, 0, 0, 400);
    expect(spawned).toHaveLength(1);
  });

  it('多指各自獨立：其中一指拖曳不影響另一指的點一下', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 0, 0, 0);
    router.down(2, 100, 100, 0);
    router.move(1, 60, 0); // 第一指拖曳
    router.up(1, 60, 0, 200);
    router.up(2, 100, 100, 200);
    expect(spawned).toEqual([{ x: 1100, y: 1100 }]);
  });

  it('按住途中切到抓取工具 → 放開時仍完成這次點一下，且不留殘餘 session', () => {
    const { router, spawned, events } = makeJellyTool();
    router.down(1, 20, 30, 0);
    selectGrab(router, 'single');
    router.up(1, 20, 30, 100);
    expect(spawned).toEqual([{ x: 1020, y: 1030 }]);
    expect(events).toEqual([]); // 沒有被當成一般操作的 Grab/Tap

    // session 已清掉：接下來的單點抓取是乾淨的一次 Grab。
    router.down(2, 0, 0, 200);
    router.up(2, 0, 0, 1000);
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
    expect(spawned).toHaveLength(1);
  });

  it('按住途中切到抓取工具、期間拖曳 → 仍判定為拖曳，不生成', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 0, 0, 0);
    selectGrab(router, 'single');
    router.move(1, 50, 0);
    router.up(1, 50, 0, 200);
    expect(spawned).toEqual([]);
  });

  it('按住途中切走工具後 cancel → 不生成', () => {
    const { router, spawned } = makeJellyTool();
    router.down(1, 0, 0, 0);
    router.setActiveTool('fan');
    router.cancel(1);
    expect(spawned).toEqual([]);
  });

  it('沒有注入回呼（未接線）→ 點一下、右鍵單擊什麼都不做，不爆炸', () => {
    const { router, events } = makeRouter(undefined, undefined, { hitTest: () => true });
    router.setActiveTool('jelly');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 100);
    router.rightClick({ x: 0, y: 0 }, 0, 0);
    expect(events).toEqual([]);
  });

  it('Jelly 工具下，單點抓取的 Grab／Tap 完全不觸發；切回抓取工具後恢復', () => {
    const { router, events } = makeJellyTool();
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 100);
    expect(events).toEqual([]);

    selectGrab(router, 'single');
    router.down(3, 0, 0, 400);
    router.up(3, 0, 0, 500);
    expect(events).toEqual([
      { type: 'grab', id: 3, x: 1000, y: 1000 },
      { type: 'tap', x: 1000, y: 1000 },
      { type: 'release', id: 3 },
    ]);
  });

  it('右鍵單擊點中 Jelly → onJellyContextMenu 收到世界座標與畫布局部座標，不 emit、不生成', () => {
    const { router, events, spawned, menus } = makeJellyTool(() => true);
    router.rightClick({ x: 1012, y: 1034 }, 12, 34);
    expect(menus).toEqual([{ world: { x: 1012, y: 1034 }, screen: { x: 12, y: 34 } }]);
    expect(spawned).toEqual([]);
    expect(events).toEqual([]);
  });

  it('右鍵單擊點在空白處（沒命中 Jelly）→ 不開選單', () => {
    const { router, menus } = makeJellyTool((w) => w.x > 1500);
    router.rightClick({ x: 1012, y: 1034 }, 12, 34);
    expect(menus).toEqual([]);
    router.rightClick({ x: 1600, y: 1034 }, 600, 34);
    expect(menus).toHaveLength(1);
  });

  it('其他工具下的右鍵單擊 → 不開 Jelly 選單、不 emit', () => {
    const { router, events, menus } = makeJellyTool(() => true);
    for (const tool of ['grab', 'pin', 'fan'] as const) {
      router.setActiveTool(tool);
      router.rightClick({ x: 1000, y: 1000 }, 0, 0);
    }
    expect(menus).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('ToolRouter — 大把抓取（issue #113 / V3 T4-1；ADR-0014）', () => {
  function makeHandful(extra?: Partial<ToolRouterOptions>) {
    const made = makeRouter(undefined, undefined, extra);
    selectGrab(made.router, 'handful');
    return made;
  }

  it('拖曳 → grab{handfulRadius} → moveGrab… → release，不送 tap', () => {
    const { router, events } = makeHandful();
    router.down(1, 10, 20, 0);
    router.move(1, 40, 20);
    router.move(1, 80, 30);
    router.up(1, 80, 30, 500);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1010, y: 1020, handfulRadius: DEFAULT_HANDFUL_RADIUS },
      { type: 'moveGrab', id: 1, x: 1040, y: 1020 },
      { type: 'moveGrab', id: 1, x: 1080, y: 1030 },
      { type: 'release', id: 1 },
    ]);
  });

  it('快速按放 → grab → tap{radius}（按下當下位置）→ release', () => {
    const { router, events } = makeHandful();
    router.down(1, 10, 20, 0);
    router.move(1, 12, 21);
    router.up(1, 12, 21, 100);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1010, y: 1020, handfulRadius: DEFAULT_HANDFUL_RADIUS },
      { type: 'moveGrab', id: 1, x: 1012, y: 1021 },
      { type: 'tap', x: 1010, y: 1020, radius: DEFAULT_HANDFUL_RADIUS },
      { type: 'release', id: 1 },
    ]);
  });

  it('cancel 只 release，不送 tap', () => {
    const { router, events } = makeHandful();
    router.down(1, 10, 20, 0);
    router.cancel(1);
    expect(events.map((e) => e.type)).toEqual(['grab', 'release']);
    router.up(1, 10, 20, 50); // session 已結束 → 不再 emit
    expect(events.length).toBe(2);
  });

  it('多指各自一把，互不干擾', () => {
    const { router, events } = makeHandful();
    router.down(1, 0, 0, 0);
    router.down(2, 100, 0, 0);
    router.move(2, 150, 0);
    router.up(1, 0, 0, 500);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000, handfulRadius: DEFAULT_HANDFUL_RADIUS },
      { type: 'grab', id: 2, x: 1100, y: 1000, handfulRadius: DEFAULT_HANDFUL_RADIUS },
      { type: 'moveGrab', id: 2, x: 1150, y: 1000 },
      { type: 'release', id: 1 },
    ]);
  });

  it('半徑讀按下當下的值：拖曳途中改半徑不影響這一把的 tap', () => {
    const { router, events } = makeHandful();
    router.setHandfulParams({ radius: 60 });
    router.down(1, 0, 0, 0);
    router.setHandfulParams({ radius: 300 });
    router.up(1, 0, 0, 50);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000, handfulRadius: 60 },
      { type: 'tap', x: 1000, y: 1000, radius: 60 },
      { type: 'release', id: 1 },
    ]);
    events.length = 0;
    router.down(2, 0, 0, 100);
    expect(events[0]).toEqual({ type: 'grab', id: 2, x: 1000, y: 1000, handfulRadius: 300 });
  });

  it('按在 Jelly 外（hitTest 否）→ 不追這個指標、不 emit（背景拖曳歸相機）', () => {
    const { router, events } = makeHandful({ hitTest: () => false });
    router.down(1, 0, 0, 0);
    router.move(1, 50, 0);
    router.up(1, 50, 0, 500);
    expect(events).toEqual([]);
  });

  it('按住途中切走工具，這一把仍照常跟隨並放開', () => {
    const { router, events } = makeHandful();
    router.down(1, 0, 0, 0);
    selectGrab(router, 'single');
    router.move(1, 30, 0);
    router.up(1, 30, 0, 500);
    expect(events.map((e) => e.type)).toEqual(['grab', 'moveGrab', 'release']);
  });

  it('一般操作的 Grab 不帶 handfulRadius（行為不變）', () => {
    const { router, events } = makeRouter();
    router.setHandfulParams({ radius: 200 });
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000 },
      { type: 'tap', x: 1000, y: 1000 },
      { type: 'release', id: 1 },
    ]);
  });
});

describe('ToolRouter — 調整目前模式的數值（issue #114 調半徑；issue #122 推廣）', () => {
  it('Pin 工具（兩種模式）：每一格照拉霸 step 增減，夾在拉霸的最小／最大值之間', () => {
    const { router } = makeRouter();
    router.setActiveTool('pin');
    router.setPinBrushParams({ radius: 140 });
    expect(router.adjustActiveValue(1)).toEqual({
      key: 'pinBrushRadius',
      value: 140 + PIN_BRUSH_RADIUS_RANGE.step,
    });
    router.setMode('pin', 'remove');
    expect(router.adjustActiveValue(-3)).toEqual({
      key: 'pinBrushRadius',
      value: 140 - 2 * PIN_BRUSH_RADIUS_RANGE.step,
    });
    expect(router.adjustActiveValue(100)).toEqual({
      key: 'pinBrushRadius',
      value: PIN_BRUSH_RADIUS_RANGE.max,
    });
    expect(router.adjustActiveValue(-100)).toEqual({
      key: 'pinBrushRadius',
      value: PIN_BRUSH_RADIUS_RANGE.min,
    });
  });

  it('大把抓取半徑與 Pin 筆刷半徑各自獨立', () => {
    const { router } = makeRouter();
    router.setPinBrushParams({ radius: 100 });
    router.setHandfulParams({ radius: 100 });
    router.setActiveTool('pin');
    router.adjustActiveValue(2);
    selectGrab(router, 'handful');
    expect(router.adjustActiveValue(0)).toEqual({ key: 'handfulRadius', value: 100 });
    router.setActiveTool('pin');
    expect(router.adjustActiveValue(0)).toEqual({
      key: 'pinBrushRadius',
      value: 100 + 2 * PIN_BRUSH_RADIUS_RANGE.step,
    });
  });

  it('抓取工具：大把模式調大把抓取半徑；單點、編隊模式回報「不處理」（照舊縮放）', () => {
    const { router } = makeRouter();
    router.setHandfulParams({ radius: 140 });
    expect(router.adjustActiveValue(1)).toBeNull(); // 預設單點
    router.setMode('grab', 'formation');
    expect(router.adjustActiveValue(1)).toBeNull();
    router.setMode('grab', 'handful');
    expect(router.adjustActiveValue(1)).toEqual({
      key: 'handfulRadius',
      value: 140 + HANDFUL_RADIUS_RANGE.step,
    });
  });

  it('沒有數值的工具（Jelly）回報「不處理」', () => {
    const { router } = makeRouter();
    router.setActiveTool('jelly');
    expect(router.adjustActiveValue(1)).toBeNull();
    expect(router.activeValue).toBeNull();
  });

  it('activeValue 回報目前模式的數值但不改它（游標標籤用）', () => {
    const { router } = makeRouter();
    expect(router.activeValue).toBeNull(); // 單點
    router.setHandfulParams({ radius: 180 });
    router.setMode('grab', 'handful');
    expect(router.activeValue).toEqual({ key: 'handfulRadius', value: 180 });
    expect(router.activeValue).toEqual({ key: 'handfulRadius', value: 180 });
    router.setActiveTool('pin');
    router.setPinBrushParams({ radius: 60 });
    expect(router.activeValue).toEqual({ key: 'pinBrushRadius', value: 60 });
  });

  it('大把抓取：只影響下一次按下，抓住中的那一把不受影響', () => {
    const { router, events } = makeRouter();
    selectGrab(router, 'handful');
    router.setHandfulParams({ radius: 140 });
    router.down(1, 0, 0, 0);
    router.adjustActiveValue(4);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000, handfulRadius: 140 },
      { type: 'tap', x: 1000, y: 1000, radius: 140 },
      { type: 'release', id: 1 },
    ]);
    events.length = 0;
    router.down(2, 0, 0, 100);
    expect(events[0]).toEqual({
      type: 'grab',
      id: 2,
      x: 1000,
      y: 1000,
      handfulRadius: 140 + 4 * HANDFUL_RADIUS_RANGE.step,
    });
  });
});

describe('ToolRouter — 工具與模式（issue #122 / V4 T1；ADR-0016）', () => {
  it('工具列的四個工具：抓取在最前（預設）、Pin、電風扇、Jelly（合併了生成／移除／重建）', () => {
    expect([...TOOL_IDS]).toEqual(['grab', 'pin', 'fan', 'jelly']);
  });

  it('有模式的工具：抓取（單點／大把／編隊）、Pin（放／拔）、電風扇（寬度／強度／衰減／頻率）', () => {
    expect(modesOf('grab')).toEqual(['single', 'handful', 'formation']);
    expect(modesOf('pin')).toEqual(['place', 'remove']);
    expect(modesOf('fan')).toEqual(['width', 'strength', 'falloff', 'frequency']);
    expect(modesOf('jelly')).toEqual([]);
  });

  it('cycleMode 依序輪替目前工具的模式，最後一個繞回第一個', () => {
    const { router } = makeRouter();
    expect(router.cycleMode()).toBe('handful');
    expect(router.currentMode).toBe('handful');
    expect(router.cycleMode()).toBe('formation');
    expect(router.cycleMode()).toBe('single');
    expect(router.modeOf('grab')).toBe('single');
  });

  it('沒有模式的工具：cycleMode 回 null、currentMode 為 null，抓取工具的模式不受影響', () => {
    const { router } = makeRouter();
    router.setMode('grab', 'handful');
    router.setActiveTool('jelly');
    expect(router.currentMode).toBeNull();
    expect(router.cycleMode()).toBeNull();
    expect(router.modeOf('grab')).toBe('handful');
  });

  it('每個工具各自記住模式：切走再切回，模式保留', () => {
    const { router, events } = makeRouter();
    router.setMode('grab', 'handful');
    router.setMode('pin', 'remove');
    router.setActiveTool('pin');
    router.setActiveTool('grab');
    expect(router.modeOf('pin')).toBe('remove');
    expect(router.currentMode).toBe('handful');
    router.down(1, 0, 0, 0);
    expect(events[0]).toMatchObject({ type: 'grab', handfulRadius: DEFAULT_HANDFUL_RADIUS });
  });

  it('單點模式 = 原本的一般操作：grab → moveGrab → release，快速按放多一個 tap', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.move(1, 30, 0);
    router.up(1, 30, 0, 500);
    router.down(2, 5, 5, 600);
    router.up(2, 5, 5, 650);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000 },
      { type: 'moveGrab', id: 1, x: 1030, y: 1000 },
      { type: 'release', id: 1 },
      { type: 'grab', id: 2, x: 1005, y: 1005 },
      { type: 'tap', x: 1005, y: 1005 },
      { type: 'release', id: 2 },
    ]);
  });

  it('大把模式 = 原本的大把抓取：grab 帶 handfulRadius，快速按放是範圍 Tap', () => {
    const { router, events } = makeRouter();
    router.setMode('grab', 'handful');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000, handfulRadius: DEFAULT_HANDFUL_RADIUS },
      { type: 'tap', x: 1000, y: 1000, radius: DEFAULT_HANDFUL_RADIUS },
      { type: 'release', id: 1 },
    ]);
  });

  it('編隊模式 = 原本的編隊抓取：每個偏移點各一個 grab，放開各自 release', () => {
    const { router, events } = makeRouter();
    router.setMode('grab', 'formation');
    router.beginFormationDefine();
    router.down(9, 0, 0, 0);
    router.down(10, 10, 0, 0);
    router.endFormationDefine();
    router.down(1, 100, 100, 0);
    router.up(1, 100, 100, 500);
    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'grab', id: 'formation:1:1', x: 1110, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
      { type: 'release', id: 'formation:1:1' },
    ]);
  });

  it('編隊模式、還沒定義形狀 → 左鍵拖曳不做任何事', () => {
    const { router, events } = makeRouter();
    router.setMode('grab', 'formation');
    router.down(1, 0, 0, 0);
    router.move(1, 40, 0);
    router.up(1, 40, 0, 500);
    expect(events).toEqual([]);
  });

  it('拖曳中切模式（單點 → 大把）：進行中的手勢照舊跟隨、放開，新模式只套用到下一次按下', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.cycleMode(); // → 大把
    router.move(1, 20, 0);
    router.up(1, 20, 0, 500);
    expect(events).toEqual([
      { type: 'grab', id: 1, x: 1000, y: 1000 },
      { type: 'moveGrab', id: 1, x: 1020, y: 1000 },
      { type: 'release', id: 1 },
    ]);
    events.length = 0;
    router.down(2, 0, 0, 600);
    expect(events).toEqual([
      { type: 'grab', id: 2, x: 1000, y: 1000, handfulRadius: DEFAULT_HANDFUL_RADIUS },
    ]);
  });

  it('拖曳中切模式（大把 → 編隊）：這一把的快速按放仍是範圍 Tap', () => {
    const { router, events } = makeRouter();
    router.setMode('grab', 'handful');
    router.down(1, 0, 0, 0);
    router.setMode('grab', 'formation');
    router.up(1, 0, 0, 50);
    expect(events.map((e) => e.type)).toEqual(['grab', 'tap', 'release']);
    expect(events[1]).toEqual({ type: 'tap', x: 1000, y: 1000, radius: DEFAULT_HANDFUL_RADIUS });
  });

  it('拖曳中切模式（編隊 → 單點）：這一組照舊整組跟隨、整組放開', () => {
    const { router, events } = makeRouter();
    router.setMode('grab', 'formation');
    router.beginFormationDefine();
    router.down(9, 0, 0, 0);
    router.down(10, 10, 0, 0);
    router.endFormationDefine();
    router.down(1, 0, 0, 0);
    router.cycleMode(); // → 單點
    router.move(1, 5, 0);
    router.up(1, 5, 0, 500);
    expect(events.map((e) => [e.type, 'id' in e ? e.id : null])).toEqual([
      ['grab', 'formation:1:0'],
      ['grab', 'formation:1:1'],
      ['moveGrab', 'formation:1:0'],
      ['moveGrab', 'formation:1:1'],
      ['release', 'formation:1:0'],
      ['release', 'formation:1:1'],
    ]);
  });

  it('拖曳中切工具（抓取 → 電風扇）：進行中的抓取照舊放開，不被當成風扇放置', () => {
    const { router, events } = makeRouter();
    router.down(1, 0, 0, 0);
    router.setActiveTool('fan');
    router.move(1, 30, 0);
    router.up(1, 30, 0, 500);
    expect(events.map((e) => e.type)).toEqual(['grab', 'moveGrab', 'release']);
  });

  it('拖曳中切工具（電風扇 → 抓取）：這次仍完成風扇放置', () => {
    const { router, events } = makeRouter();
    router.setActiveTool('fan');
    router.down(1, 0, 0, 0);
    router.setActiveTool('grab');
    router.up(1, 40, 0, 500);
    expect(events.map((e) => e.type)).toEqual(['setFan']);
  });
});

describe('ToolRouter — 電風扇的模式、滾輪調參數與右鍵移除（issue #125 / V4 T4）', () => {
  /** 世界座標 (1000,1000)、朝 +x 吹、長 100、寬 40 的既有風扇。 */
  const fan: FanState = {
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

  function makeFanTool(getFan: () => FanState | null = () => null) {
    const made = makeRouter(undefined, getFan);
    made.router.setActiveTool('fan');
    return made;
  }

  it('預設模式是寬度；中鍵單擊依序輪替寬度 → 強度 → 衰減 → 頻率 → 寬度', () => {
    const { router } = makeFanTool();
    expect(router.currentMode).toBe('width');
    expect(router.cycleMode()).toBe('strength');
    expect(router.cycleMode()).toBe('falloff');
    expect(router.cycleMode()).toBe('frequency');
    expect(router.cycleMode()).toBe('width');
  });

  it('每個模式調各自的參數：一格＝該拉霸的 step，activeValue 同步回報', () => {
    const { router } = makeFanTool();
    expect(router.activeValue).toEqual({ key: 'fanWidth', value: DEFAULT_FAN_WIDTH });
    expect(router.adjustActiveValue(2)).toEqual({
      key: 'fanWidth',
      value: DEFAULT_FAN_WIDTH + 2 * FAN_WIDTH_RANGE.step,
    });
    router.setMode('fan', 'strength');
    expect(router.adjustActiveValue(-1)).toEqual({
      key: 'fanStrength',
      value: DEFAULT_FAN_STRENGTH - FAN_STRENGTH_RANGE.step,
    });
    router.setMode('fan', 'falloff');
    expect(router.adjustActiveValue(1)).toEqual({ key: 'fanFalloffExponent', value: 2.1 });
    router.setMode('fan', 'frequency');
    expect(router.adjustActiveValue(-1)).toEqual({ key: 'fanFrequency', value: 1.9 });
    expect(router.activeValue).toEqual({ key: 'fanFrequency', value: 1.9 });
  });

  it('夾在拉霸範圍內', () => {
    const { router } = makeFanTool();
    const cases = [
      ['width', FAN_WIDTH_RANGE],
      ['strength', FAN_STRENGTH_RANGE],
      ['falloff', FAN_FALLOFF_RANGE],
      ['frequency', FAN_FREQUENCY_RANGE],
    ] as const;
    for (const [mode, range] of cases) {
      router.setMode('fan', mode);
      expect(router.adjustActiveValue(100000)?.value).toBe(range.max);
      expect(router.adjustActiveValue(-100000)?.value).toBe(range.min);
    }
  });

  it('小數 step 連續滾不累積浮點誤差（值落在拉霸的格點上）', () => {
    const { router } = makeFanTool();
    router.setMode('fan', 'falloff');
    router.setFanParams({ falloffExponent: FAN_FALLOFF_RANGE.min });
    let value = 0;
    for (let i = 0; i < 7; i++) value = router.adjustActiveValue(1)!.value;
    expect(value).toBe(0.9);
  });

  it('調過的參數套用到下一次放置（跟面板拉霸同一份狀態）', () => {
    const { router, events } = makeFanTool();
    router.adjustActiveValue(1); // 寬度
    router.setMode('fan', 'strength');
    router.adjustActiveValue(1);
    router.down(1, 0, 0, 0);
    router.up(1, 50, 0, 300);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'setFan',
        width: DEFAULT_FAN_WIDTH + FAN_WIDTH_RANGE.step,
        strength: DEFAULT_FAN_STRENGTH + FAN_STRENGTH_RANGE.step,
        falloffExponent: DEFAULT_FAN_FALLOFF_EXPONENT,
        frequency: DEFAULT_FAN_FREQUENCY,
      }),
    ]);
  });

  it('面板拉霸寫入的值（setFanParams）就是滾輪起算的值', () => {
    const { router } = makeFanTool();
    router.setFanParams({ width: 200 });
    expect(router.adjustActiveValue(1)).toEqual({
      key: 'fanWidth',
      value: 200 + FAN_WIDTH_RANGE.step,
    });
  });

  it('切模式不影響左鍵放置與搬移：拖曳既有風扇照舊', () => {
    const { router, events } = makeFanTool(() => fan);
    router.cycleMode();
    router.down(1, 10, 0, 0); // 世界 (1010,1000)，在矩形內
    router.up(1, 20, 0, 300);
    expect(events.map((e) => e.type)).toEqual(['setFan', 'setFan']);
    expect(events[1]).toMatchObject({ originX: 1010, originY: 1000, width: fan.width });
  });

  it('右鍵單擊落在風扇矩形內 → clearFan（跟「移除風扇」按鈕同一種事件）', () => {
    const { router, events } = makeFanTool(() => fan);
    router.rightClick({ x: 1050, y: 1010 }, 50, 10);
    expect(events).toEqual([{ type: 'clearFan' }]);
  });

  it('右鍵單擊落在風扇外 → 什麼都不做', () => {
    const { router, events } = makeFanTool(() => fan);
    router.rightClick({ x: 1200, y: 1000 }, 200, 0); // 超過長度
    router.rightClick({ x: 1050, y: 1100 }, 50, 100); // 超過寬度
    router.rightClick({ x: 990, y: 1000 }, -10, 0); // 風扇面背後
    expect(events).toEqual([]);
  });

  it('場上沒有風扇時右鍵單擊 → 什麼都不做', () => {
    const { router, events } = makeFanTool(() => null);
    router.rightClick({ x: 1050, y: 1000 }, 50, 0);
    expect(events).toEqual([]);
  });

  it('其他工具下右鍵單擊風扇 → 不移除', () => {
    const { router, events } = makeRouter(undefined, () => fan);
    for (const tool of ['grab', 'pin'] as const) {
      router.setActiveTool(tool);
      router.rightClick({ x: 1050, y: 1000 }, 50, 0);
    }
    expect(events).toEqual([]);
  });
});

describe('ToolRouter — 編隊抓取的每點大把（issue #135；CONTEXT.md「每點大把」）', () => {
  /** 編隊模式、「主點 + 右 10」兩點形狀；`perPointHandful` 決定開關。 */
  function withShape(perPointHandful: boolean, extra?: Partial<ToolRouterOptions>) {
    const made = makeRouter(undefined, undefined, extra);
    selectGrab(made.router, 'formation');
    made.router.beginFormationDefine();
    made.router.down(1, 0, 0, 0);
    made.router.down(1, 10, 0, 0);
    made.router.endFormationDefine();
    made.router.setFormationParams({ perPointHandful });
    made.events.length = 0;
    return made;
  }

  it('開關預設關閉', () => {
    const { router } = makeRouter();
    expect(router.perPointHandful).toBe(false);
  });

  it('關閉：編隊的 grab 不帶 handfulRadius（跟原本的編隊抓取一樣）', () => {
    const { router, events } = withShape(false);
    router.down(2, 100, 100, 0);
    router.up(2, 100, 100, 500);
    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100 },
      { type: 'grab', id: 'formation:1:1', x: 1110, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
      { type: 'release', id: 'formation:1:1' },
    ]);
    expect(events.some((e) => 'handfulRadius' in e || 'radius' in e)).toBe(false);
  });

  it('開啟：每個落在 Jelly 上的點送出的 grab 都帶目前的大把半徑；落在外面的點不送', () => {
    // 只有主點（x = 1100）命中；右邊那點（x = 1110）落在果凍外。
    const { router, events } = withShape(true, { hitTest: (p) => p.x < 1110 });
    router.setHandfulParams({ radius: 90 });
    router.down(2, 100, 100, 0);
    router.move(2, 130, 100);
    router.up(2, 130, 100, 500);
    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100, handfulRadius: 90 },
      { type: 'moveGrab', id: 'formation:1:0', x: 1130, y: 1100 },
      { type: 'release', id: 'formation:1:0' },
    ]);
  });

  it('開啟：兩點都命中 → 兩把各自帶同一個半徑（共用大把模式那條）', () => {
    const { router, events } = withShape(true);
    router.down(2, 100, 100, 0);
    expect(events).toEqual([
      {
        type: 'grab',
        id: 'formation:1:0',
        x: 1100,
        y: 1100,
        handfulRadius: DEFAULT_HANDFUL_RADIUS,
      },
      {
        type: 'grab',
        id: 'formation:1:1',
        x: 1110,
        y: 1100,
        handfulRadius: DEFAULT_HANDFUL_RADIUS,
      },
    ]);
  });

  it('開啟時的快速按放：grab×N → tap×N（每個都帶 radius）→ release×N', () => {
    const { router, events } = withShape(true);
    router.setHandfulParams({ radius: 60 });
    router.down(2, 100, 100, 0);
    router.up(2, 101, 100, 100);
    expect(events).toEqual([
      { type: 'grab', id: 'formation:1:0', x: 1100, y: 1100, handfulRadius: 60 },
      { type: 'grab', id: 'formation:1:1', x: 1110, y: 1100, handfulRadius: 60 },
      { type: 'tap', x: 1100, y: 1100, radius: 60 },
      { type: 'tap', x: 1110, y: 1100, radius: 60 },
      { type: 'release', id: 'formation:1:0' },
      { type: 'release', id: 'formation:1:1' },
    ]);
  });

  it('按下後才關掉開關、改半徑：進行中這一抓不受影響（tap 仍帶按下當下的半徑）', () => {
    const { router, events } = withShape(true);
    router.setHandfulParams({ radius: 60 });
    router.down(2, 100, 100, 0);
    router.setFormationParams({ perPointHandful: false });
    router.setHandfulParams({ radius: 200 });
    router.up(2, 100, 100, 100);
    expect(events.filter((e) => e.type === 'tap')).toEqual([
      { type: 'tap', x: 1100, y: 1100, radius: 60 },
      { type: 'tap', x: 1110, y: 1100, radius: 60 },
    ]);
    // 下一次按下才吃到新設定：開關已關 → 單點編隊。
    events.length = 0;
    router.down(3, 100, 100, 200);
    expect(events[0]).toEqual({ type: 'grab', id: 'formation:2:0', x: 1100, y: 1100 });
  });

  it('按下後才打開開關：進行中這一抓仍是單點編隊（tap 不帶 radius）', () => {
    const { router, events } = withShape(false);
    router.down(2, 100, 100, 0);
    router.setFormationParams({ perPointHandful: true });
    router.up(2, 100, 100, 100);
    expect(events.filter((e) => e.type === 'tap')).toEqual([
      { type: 'tap', x: 1100, y: 1100 },
      { type: 'tap', x: 1110, y: 1100 },
    ]);
    expect(events.some((e) => 'handfulRadius' in e || 'radius' in e)).toBe(false);
  });

  it('formationActiveGroups 帶這一抓按下當下的半徑（範圍圈用）；關閉時為 null', () => {
    const on = withShape(true);
    on.router.setHandfulParams({ radius: 70 });
    on.router.down(2, 100, 100, 0);
    on.router.setHandfulParams({ radius: 300 });
    expect(on.router.formationActiveGroups.map((g) => g.handfulRadius)).toEqual([70]);

    const off = withShape(false);
    off.router.down(2, 100, 100, 0);
    expect(off.router.formationActiveGroups.map((g) => g.handfulRadius)).toEqual([null]);
  });

  it('右鍵＋滾輪：開關開啟時編隊模式調大把半徑（跟大把模式同一條）；關閉時回報「不處理」', () => {
    const { router } = withShape(false);
    router.setHandfulParams({ radius: 140 });
    expect(router.adjustActiveValue(1)).toBeNull();
    expect(router.activeValue).toBeNull();

    router.setFormationParams({ perPointHandful: true });
    expect(router.activeValue).toEqual({ key: 'handfulRadius', value: 140 });
    expect(router.adjustActiveValue(2)).toEqual({
      key: 'handfulRadius',
      value: 140 + 2 * HANDFUL_RADIUS_RANGE.step,
    });
    // 大把模式讀到的是同一個值。
    router.setMode('grab', 'handful');
    expect(router.activeValue).toEqual({
      key: 'handfulRadius',
      value: 140 + 2 * HANDFUL_RADIUS_RANGE.step,
    });
  });

  it('開關只影響編隊模式：單點模式照舊沒有數值', () => {
    const { router } = makeRouter();
    router.setFormationParams({ perPointHandful: true });
    expect(router.adjustActiveValue(1)).toBeNull();
  });
});

describe('ToolRouter — 定義編隊形狀途中鎖住抓取工具的模式（issue #135 順帶修 #122 的邊角）', () => {
  function defining() {
    const made = makeRouter();
    selectGrab(made.router, 'formation');
    made.router.beginFormationDefine();
    return made;
  }

  it('中鍵（cycleMode）不切離編隊，回 null；結束定義後照常輪替', () => {
    const { router } = defining();
    expect(router.cycleMode()).toBeNull();
    expect(router.modeOf('grab')).toBe('formation');
    router.endFormationDefine();
    expect(router.cycleMode()).toBe('single');
  });

  it('模式鈕（setMode）在定義中也切不走；左鍵仍是記點、不送事件', () => {
    const { router, events } = defining();
    router.setMode('grab', 'single');
    expect(router.modeOf('grab')).toBe('formation');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([]);
    expect(router.formationDefinePreview).toEqual([{ x: 1000, y: 1000 }]);
  });

  it('別的工具的模式不受影響', () => {
    const { router } = defining();
    router.setActiveTool('pin');
    expect(router.cycleMode()).toBe('remove');
    router.setMode('pin', 'place');
    expect(router.modeOf('pin')).toBe('place');
  });
});
