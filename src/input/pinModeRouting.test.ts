import { describe, expect, it } from 'vitest';

import type { InputEvent } from '../sim';
import { routeForPinMode } from './pinModeRouting';

describe('routeForPinMode', () => {
  it('Pin 模式關閉 → 所有事件原樣放行', () => {
    const events: InputEvent[] = [
      { type: 'grab', id: 1, x: 1, y: 2 },
      { type: 'moveGrab', id: 1, x: 3, y: 4 },
      { type: 'release', id: 1 },
      { type: 'tap', x: 5, y: 6 },
    ];
    for (const event of events) {
      expect(routeForPinMode(event, false)).toEqual(event);
    }
  });

  it('Pin 模式開啟 → grab 轉成同座標／同 id 的 pin', () => {
    const routed = routeForPinMode({ type: 'grab', id: 'a', x: 10, y: 20 }, true);
    expect(routed).toEqual({ type: 'pin', id: 'a', x: 10, y: 20 });
  });

  it('Pin 模式開啟 → tap 被丟棄（避免點一下同時放 Pin 又戳一下）', () => {
    expect(routeForPinMode({ type: 'tap', x: 1, y: 2 }, true)).toBeNull();
  });

  it('Pin 模式開啟 → moveGrab／release／既有 pin 相關事件原樣轉發', () => {
    const passthrough: InputEvent[] = [
      { type: 'moveGrab', id: 1, x: 3, y: 4 },
      { type: 'release', id: 1 },
      { type: 'pin', id: 2, x: 0, y: 0 },
      { type: 'unpin', id: 2 },
      { type: 'movePin', id: 2, x: 5, y: 5 },
    ];
    for (const event of passthrough) {
      expect(routeForPinMode(event, true)).toEqual(event);
    }
  });
});
