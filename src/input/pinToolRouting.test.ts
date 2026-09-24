import { describe, expect, it } from 'vitest';

import type { InputEvent, PinInfo } from '../sim';
import type { ToolId } from './ToolRouter';
import { routeForPinTool } from './pinToolRouting';

/** 沒有既有 Pin、半徑 0——多數測項不關心「點掉既有 Pin」分支時的預設 context。 */
const NO_PINS = { pins: [] as PinInfo[], removeRadius: 0 };

describe('routeForPinTool', () => {
  it('目前工具不是 Pin（含一般操作、大把抓取）→ 所有事件原樣放行（context 不影響結果）', () => {
    const others: ToolId[] = ['general', 'handfulGrab', 'formation'];
    const events: InputEvent[] = [
      { type: 'grab', id: 1, x: 1, y: 2 },
      { type: 'moveGrab', id: 1, x: 3, y: 4 },
      { type: 'release', id: 1 },
      { type: 'tap', x: 5, y: 6 },
    ];
    for (const tool of others) {
      for (const event of events) {
        expect(routeForPinTool(event, tool, NO_PINS)).toEqual(event);
      }
    }
  });

  it('Pin 工具、附近沒有既有 Pin → grab 轉成同座標／同 id 的 pin', () => {
    const routed = routeForPinTool({ type: 'grab', id: 'a', x: 10, y: 20 }, 'pin', NO_PINS);
    expect(routed).toEqual({ type: 'pin', id: 'a', x: 10, y: 20 });
  });

  it('Pin 工具 → tap 被丟棄（避免點一下同時放 Pin 又戳一下）', () => {
    expect(routeForPinTool({ type: 'tap', x: 1, y: 2 }, 'pin', NO_PINS)).toBeNull();
  });

  it('Pin 工具 → moveGrab／release／既有 pin 相關事件原樣轉發', () => {
    const passthrough: InputEvent[] = [
      { type: 'moveGrab', id: 1, x: 3, y: 4 },
      { type: 'release', id: 1 },
      { type: 'pin', id: 2, x: 0, y: 0 },
      { type: 'unpin', id: 2 },
      { type: 'movePin', id: 2, x: 5, y: 5 },
    ];
    for (const event of passthrough) {
      expect(routeForPinTool(event, 'pin', NO_PINS)).toEqual(event);
    }
  });

  it('點擊落在既有 Pin 的移除半徑內 → 轉成 unpin（用那個 Pin 自己的 id，不是這次手勢的 id）', () => {
    const context = {
      pins: [{ id: 'existing-pin', point: { x: 10, y: 10 } }],
      removeRadius: 5,
    };
    const routed = routeForPinTool(
      { type: 'grab', id: 'new-gesture', x: 12, y: 11 },
      'pin',
      context,
    );
    expect(routed).toEqual({ type: 'unpin', id: 'existing-pin' });
  });

  it('點擊在移除半徑之外 → 正常放新 Pin（不誤刪遠處的既有 Pin）', () => {
    const context = {
      pins: [{ id: 'existing-pin', point: { x: 10, y: 10 } }],
      removeRadius: 5,
    };
    const routed = routeForPinTool(
      { type: 'grab', id: 'new-gesture', x: 100, y: 100 },
      'pin',
      context,
    );
    expect(routed).toEqual({ type: 'pin', id: 'new-gesture', x: 100, y: 100 });
  });

  it('多個既有 Pin → 只點掉距離最近、且落在半徑內的那一個', () => {
    const context = {
      pins: [
        { id: 'far', point: { x: 0, y: 0 } },
        { id: 'near', point: { x: 10, y: 10 } },
      ],
      removeRadius: 8,
    };
    const routed = routeForPinTool({ type: 'grab', id: 'g', x: 11, y: 10 }, 'pin', context);
    expect(routed).toEqual({ type: 'unpin', id: 'near' });
  });

  it('剛好在半徑邊界上（含）算命中', () => {
    const context = {
      pins: [{ id: 'p', point: { x: 0, y: 0 } }],
      removeRadius: 5,
    };
    const routed = routeForPinTool({ type: 'grab', id: 'g', x: 5, y: 0 }, 'pin', context);
    expect(routed).toEqual({ type: 'unpin', id: 'p' });
  });
});
