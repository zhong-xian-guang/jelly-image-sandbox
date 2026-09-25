/**
 * Pin 工具的路由（issue #123 / V4 T2；spec #121「Pin 工具」）——放／拔兩個模式，全部在
 * `ToolRouter` 裡直接送 `pin`／`unpin`（取代原本「照一般操作送 grab、再由 `routeForPinTool`
 * 轉換」的做法）。只看公開介面：送指標事件、看發出的 `InputEvent`。
 */

import { describe, expect, it, vi } from 'vitest';

import { mulberry32 } from '../mesh';
import type { InputEvent, PinInfo, Point } from '../sim';
import {
  DEFAULT_PIN_BRUSH_RADIUS,
  DEFAULT_SPRAY_SPACING,
  MAX_SPRAY_PINS_PER_STROKE,
  PIN_BRUSH_RADIUS_RANGE,
  PIN_REMOVE_RADIUS_PX,
  ToolRouter,
  modesOf,
  type ToolRouterOptions,
} from './ToolRouter';

/** 撒點用的隨機數注入固定種子，測試才逐次一致（預設是 `Math.random`）。 */
const seeded = () => mulberry32(0x5eed);

/**
 * `scale` = 相機縮放（螢幕像素／世界單位）：`screenToWorld` 把螢幕座標除以它、再 +1000
 * 好分辨已換算。`pins` 是場上既有的 Pin；`live` 時 `emit` 收到 `pin`／`unpin` 會同步改動
 * 清單（模擬真實路徑上同步進 `sim.applyInput`），`live: false` 則刻意保持靜態，用來驗證
 * 「間距／不重送」是這一筆自己記住的，不是碰巧靠清單變了。
 */
function makePinRouter(opts?: {
  pins?: readonly PinInfo[];
  live?: boolean;
  scale?: number;
  hitTest?: (world: Point) => boolean;
  extra?: Partial<ToolRouterOptions>;
}) {
  const scale = opts?.scale ?? 1;
  const store: PinInfo[] = [...(opts?.pins ?? [])];
  const events: InputEvent[] = [];
  const router = new ToolRouter({
    screenToWorld: (x, y) => ({ x: x / scale + 1000, y: y / scale + 1000 }),
    emit: (e) => {
      events.push(e);
      if (!(opts?.live ?? true)) return;
      if (e.type === 'pin' && e.x !== undefined && e.y !== undefined) {
        store.push({ id: e.id, point: { x: e.x, y: e.y } });
      } else if (e.type === 'unpin') {
        const index = store.findIndex((p) => p.id === e.id);
        if (index >= 0) store.splice(index, 1);
      }
    },
    listPins: () => store,
    hitTest: opts?.hitTest,
    random: seeded(),
    ...opts?.extra,
  });
  router.setActiveTool('pin');
  const pinPoints = (): Point[] =>
    events.flatMap((e) =>
      e.type === 'pin' && e.x !== undefined && e.y !== undefined ? [{ x: e.x, y: e.y }] : [],
    );
  const unpinnedIds = () => events.flatMap((e) => (e.type === 'unpin' ? [e.id] : []));
  return { router, events, store, pinPoints, unpinnedIds };
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

/** 從 `(x0, y0)` 拖到 `(x1, y1)`，途中送 `steps` 個 `move`，慢慢放開（不是快速按放）。 */
function drag(
  router: ToolRouter,
  id: number,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  steps = 10,
): void {
  router.down(id, x0, y0, 0);
  for (let i = 1; i <= steps; i++) {
    router.move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
  }
  router.up(id, x1, y1, 2000);
}

describe('Pin 工具 — 模式與數值', () => {
  it('模式是 放／拔，預設是放', () => {
    const { router } = makePinRouter();
    expect(modesOf('pin')).toEqual(['place', 'remove']);
    expect(router.currentMode).toBe('place');
    expect(router.cycleMode()).toBe('remove');
    expect(router.cycleMode()).toBe('place');
  });

  it('兩種模式共用一條 Pin 筆刷半徑：右鍵＋滾輪一格 = 拉霸 step，夾在 20–400', () => {
    const { router } = makePinRouter();
    expect(PIN_BRUSH_RADIUS_RANGE).toEqual({ min: 20, max: 400, step: 10 });
    expect(DEFAULT_PIN_BRUSH_RADIUS).toBe(120);
    expect(router.activeValue).toEqual({ key: 'pinBrushRadius', value: 120 });
    expect(router.adjustActiveValue(2)).toEqual({ key: 'pinBrushRadius', value: 140 });
    router.setMode('pin', 'remove');
    expect(router.activeValue).toEqual({ key: 'pinBrushRadius', value: 140 });
    expect(router.adjustActiveValue(-100)).toEqual({ key: 'pinBrushRadius', value: 20 });
    router.setMode('pin', 'place');
    expect(router.adjustActiveValue(100)).toEqual({ key: 'pinBrushRadius', value: 400 });
  });

  it('拉霸寫入的半徑（setPinBrushParams）也是滾輪調的那一個', () => {
    const { router } = makePinRouter();
    router.setPinBrushParams({ radius: 200 });
    expect(router.activeValue).toEqual({ key: 'pinBrushRadius', value: 200 });
  });
});

describe('Pin 工具 — 放模式', () => {
  it('單擊 → 在按下點放一顆 Pin（id = 指標 id），不送 grab／tap／release', () => {
    const { router, events } = makePinRouter();
    router.down(7, 50, 60, 100);
    router.up(7, 50, 60, 150); // 快速按放：Pin 工具不觸發 Tap
    expect(events).toEqual([{ type: 'pin', id: 7, x: 1050, y: 1060 }]);
  });

  it('點在既有 Pin 附近 → 照樣放新的，不拔舊的', () => {
    const { router, events } = makePinRouter({
      pins: [{ id: 'old', point: { x: 1051, y: 1060 } }],
    });
    router.down(1, 50, 60, 0);
    router.up(1, 50, 60, 50);
    expect(events).toEqual([{ type: 'pin', id: 1, x: 1050, y: 1060 }]);
  });

  it('按在 Jelly 外 → 單擊什麼都不放', () => {
    const { router, events } = makePinRouter({ hitTest: () => false });
    router.down(1, 50, 60, 0);
    router.up(1, 50, 60, 50);
    expect(events).toEqual([]);
  });

  it('拖曳沒超過 Tap 門檻 → 只有按下那一顆', () => {
    const { router, events } = makePinRouter();
    router.down(1, 0, 0, 0);
    router.move(1, 3, 2);
    router.up(1, 3, 2, 2000);
    expect(events).toEqual([{ type: 'pin', id: 1, x: 1000, y: 1000 }]);
  });

  it('拖曳超過 Tap 門檻 → 沿路撒 Pin：id 各自相異、撒出的帶 spray: 前綴', () => {
    const { router, events } = makePinRouter();
    drag(router, 1, [0, 0], [300, 0]);
    expect(events.length).toBeGreaterThan(5);
    expect(events.every((e) => e.type === 'pin')).toBe(true);
    const ids = events.map((e) => (e.type === 'pin' ? e.id : null));
    expect(ids[0]).toBe(1);
    expect(ids.slice(1).every((id) => typeof id === 'string' && id.startsWith('spray:'))).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('撒出的 Pin 彼此、與按下那一顆、與既有 Pin 間距都 ≥ 最小間距（不靠清單同步）', () => {
    const existing: PinInfo[] = [
      { id: 'e1', point: { x: 1100, y: 1000 } },
      { id: 'e2', point: { x: 1200, y: 1030 } },
    ];
    const { router, pinPoints } = makePinRouter({ pins: existing, live: false });
    drag(router, 1, [0, 0], [300, 0], 30);
    const placed = pinPoints();
    expect(placed.length).toBeGreaterThan(5);
    expect(minPairDistance(placed)).toBeGreaterThanOrEqual(DEFAULT_SPRAY_SPACING);
    for (const p of placed) {
      for (const e of existing) {
        expect(Math.hypot(p.x - e.point.x, p.y - e.point.y)).toBeGreaterThanOrEqual(
          DEFAULT_SPRAY_SPACING,
        );
      }
    }
  });

  it('間距拉霸（setPinBrushParams spacing）調小 → 撒得更密', () => {
    const sparse = makePinRouter();
    sparse.router.setPinBrushParams({ spacing: 60 });
    drag(sparse.router, 1, [0, 0], [300, 0], 30);
    const dense = makePinRouter();
    dense.router.setPinBrushParams({ spacing: 20 });
    drag(dense.router, 1, [0, 0], [300, 0], 30);
    expect(minPairDistance(dense.pinPoints())).toBeGreaterThanOrEqual(20);
    expect(minPairDistance(sparse.pinPoints())).toBeGreaterThanOrEqual(60);
    expect(dense.pinPoints().length).toBeGreaterThan(sparse.pinPoints().length);
  });

  it('撒出的 Pin 都落在 Jelly 上（hitTest 否的候選作廢）', () => {
    const onJelly = (p: Point) => p.y >= 1000; // 下半平面才是果凍
    const { router, pinPoints } = makePinRouter({ hitTest: onJelly });
    drag(router, 1, [0, 0], [300, 0], 30);
    const placed = pinPoints();
    expect(placed.length).toBeGreaterThan(3);
    expect(placed.every(onJelly)).toBe(true);
  });

  it('撒出的 Pin 都落在路徑上某個指標位置的筆刷半徑內', () => {
    const { router, pinPoints } = makePinRouter();
    router.setPinBrushParams({ radius: 50 });
    drag(router, 1, [0, 0], [300, 0], 30);
    const placed = pinPoints();
    expect(placed.length).toBeGreaterThan(3);
    for (const p of placed) {
      // 路徑是 y=1000、x∈[1000, 1300] 的線段：到線段的距離 ≤ 半徑。
      const cx = Math.min(1300, Math.max(1000, p.x));
      expect(Math.hypot(p.x - cx, p.y - 1000)).toBeLessThanOrEqual(50 + 1e-9);
    }
  });

  it('一筆的數量有上限：半徑極大、間距極小也不會無限撒', () => {
    const { router, pinPoints } = makePinRouter();
    router.setPinBrushParams({ radius: 400, spacing: 0 });
    drag(router, 1, [0, 0], [300, 0], 60);
    expect(pinPoints().length).toBeLessThanOrEqual(MAX_SPRAY_PINS_PER_STROKE + 1);
  });

  it('cancel → 停止撒，之後的 move 不再作用；不送 release', () => {
    const { router, events } = makePinRouter();
    router.down(1, 0, 0, 0);
    router.move(1, 100, 0);
    const before = events.length;
    router.cancel(1);
    router.move(1, 250, 0);
    router.up(1, 250, 0, 2000);
    expect(events.length).toBe(before);
    expect(events.every((e) => e.type === 'pin')).toBe(true);
  });

  it('沒按下就 move → 不撒', () => {
    const { router, events } = makePinRouter();
    router.move(1, 100, 0);
    expect(events).toEqual([]);
  });
});

describe('Pin 工具 — 拔模式', () => {
  it('單擊 → 只拔螢幕半徑 PIN_REMOVE_RADIUS_PX 內最近的一顆（筆刷半徑內其他的不動）', () => {
    const { router, events } = makePinRouter({
      pins: [
        { id: 'far-in-brush', point: { x: 1060, y: 1000 } },
        { id: 'near', point: { x: 1005, y: 1000 } },
        { id: 'nearer', point: { x: 1002, y: 1001 } },
      ],
    });
    router.setMode('pin', 'remove');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([{ type: 'unpin', id: 'nearer' }]);
  });

  it('點擊半徑是螢幕像素：放大兩倍時，世界距離只剩一半才算點中', () => {
    const r = PIN_REMOVE_RADIUS_PX;
    const pins: PinInfo[] = [{ id: 'p', point: { x: 1000 + r * 0.75, y: 1000 } }];
    const zoomedOut = makePinRouter({ pins, scale: 1 });
    zoomedOut.router.setMode('pin', 'remove');
    zoomedOut.router.down(1, 0, 0, 0);
    zoomedOut.router.up(1, 0, 0, 50);
    expect(zoomedOut.unpinnedIds()).toEqual(['p']);

    const zoomedIn = makePinRouter({ pins, scale: 2 }); // 螢幕上相距 1.5r，超出點擊半徑
    zoomedIn.router.setMode('pin', 'remove');
    zoomedIn.router.down(1, 0, 0, 0);
    zoomedIn.router.up(1, 0, 0, 50);
    expect(zoomedIn.unpinnedIds()).toEqual([]);
  });

  it('點擊半徑內沒有 Pin → 什麼都不拔（即使筆刷半徑內有）', () => {
    const { router, events } = makePinRouter({
      pins: [{ id: 'in-brush', point: { x: 1050, y: 1000 } }],
    });
    router.setMode('pin', 'remove');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([]);
  });

  it('拖曳 → 沿路拔掉筆刷半徑內的 Pin，路徑外的不動；每顆只送一次', () => {
    const { router, unpinnedIds, events } = makePinRouter({
      pins: [
        { id: 'on-path-a', point: { x: 1100, y: 1030 } },
        { id: 'on-path-b', point: { x: 1250, y: 990 } },
        { id: 'off-path', point: { x: 1150, y: 1200 } },
      ],
      live: false,
    });
    router.setMode('pin', 'remove');
    router.setPinBrushParams({ radius: 60 });
    drag(router, 1, [0, 0], [300, 0], 30);
    expect(unpinnedIds().sort()).toEqual(['on-path-a', 'on-path-b']);
    expect(events.every((e) => e.type === 'unpin')).toBe(true);
  });

  it('按下先拔最近一顆，接著拖曳也不重送它', () => {
    const { router, unpinnedIds } = makePinRouter({
      pins: [
        { id: 'under', point: { x: 1001, y: 1000 } },
        { id: 'later', point: { x: 1200, y: 1000 } },
      ],
      live: false,
    });
    router.setMode('pin', 'remove');
    drag(router, 1, [0, 0], [300, 0], 30);
    expect(unpinnedIds()).toEqual(['under', 'later']);
  });

  it('拖曳沒超過 Tap 門檻 → 不當橡皮擦（筆刷半徑內的其他 Pin 不動）', () => {
    const { router, unpinnedIds } = makePinRouter({
      pins: [{ id: 'in-brush', point: { x: 1050, y: 1000 } }],
    });
    router.setMode('pin', 'remove');
    router.down(1, 0, 0, 0);
    router.move(1, 3, 0);
    router.up(1, 3, 0, 2000);
    expect(unpinnedIds()).toEqual([]);
  });

  it('只作用於 Pin：不送 release、不送 tap', () => {
    const { router, events } = makePinRouter({
      pins: [{ id: 'p', point: { x: 1000, y: 1000 } }],
    });
    router.setMode('pin', 'remove');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    expect(events).toEqual([{ type: 'unpin', id: 'p' }]);
  });
});

describe('Pin 工具 — 手勢分支在按下當下定下（spec #121）', () => {
  it('放模式按下、拖曳中切到抓取工具後快速放開 → 不冒出 tap（只有那一顆 Pin）', () => {
    const { router, events } = makePinRouter();
    router.down(1, 50, 60, 100);
    router.setActiveTool('grab');
    router.up(1, 50, 60, 150);
    expect(events).toEqual([{ type: 'pin', id: 1, x: 1050, y: 1060 }]);
  });

  it('放模式按下、拖曳中切成拔模式 → 這一筆照舊撒、不拔', () => {
    const { router, events } = makePinRouter();
    router.down(1, 0, 0, 0);
    router.setMode('pin', 'remove');
    for (let i = 1; i <= 10; i++) router.move(1, i * 30, 0);
    router.up(1, 300, 0, 2000);
    expect(events.length).toBeGreaterThan(1);
    expect(events.every((e) => e.type === 'pin')).toBe(true);
  });

  it('拔模式按下、拖曳中切成放模式 → 這一筆照舊擦、不放', () => {
    const { router, events } = makePinRouter({
      pins: [{ id: 'p', point: { x: 1200, y: 1000 } }],
    });
    router.setMode('pin', 'remove');
    router.down(1, 0, 0, 0);
    router.setMode('pin', 'place');
    for (let i = 1; i <= 10; i++) router.move(1, i * 30, 0);
    router.up(1, 300, 0, 2000);
    expect(events).toEqual([{ type: 'unpin', id: 'p' }]);
  });

  it('抓取（單點）按下、途中切到 Pin 工具 → 仍是 grab → tap → release，不變成 Pin', () => {
    const emitted: InputEvent[] = [];
    const router = new ToolRouter({
      screenToWorld: (x, y) => ({ x, y }),
      emit: (e) => emitted.push(e),
    });
    router.down(1, 10, 10, 0);
    router.setActiveTool('pin');
    router.up(1, 10, 10, 50);
    expect(emitted.map((e) => e.type)).toEqual(['grab', 'tap', 'release']);
  });

  it('Pin 工具不影響抓取：切回抓取仍是既有的 Grab 手勢', () => {
    const emit = vi.fn();
    const router = new ToolRouter({ screenToWorld: (x, y) => ({ x, y }), emit });
    router.setActiveTool('pin');
    router.down(1, 0, 0, 0);
    router.up(1, 0, 0, 50);
    router.setActiveTool('grab');
    router.down(2, 0, 0, 0);
    router.move(2, 40, 0);
    router.up(2, 40, 0, 2000);
    expect(emit.mock.calls.map(([e]) => (e as InputEvent).type)).toEqual([
      'pin',
      'grab',
      'moveGrab',
      'release',
    ]);
  });
});
