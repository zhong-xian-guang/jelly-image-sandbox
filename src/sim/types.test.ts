import { describe, expect, it } from 'vitest';

import { isPointInFanRect, type FanState } from './types';

/** 一個朝 +x 吹、寬 40、長 100 的風扇，原點在世界原點——方便手算矩形四角。 */
function makeFan(overrides: Partial<FanState> = {}): FanState {
  return {
    originX: 0,
    originY: 0,
    dirX: 1,
    dirY: 0,
    length: 100,
    width: 40,
    strength: 1000,
    falloffExponent: 2,
    ...overrides,
  };
}

describe('isPointInFanRect', () => {
  it('矩形正中央 → true', () => {
    expect(isPointInFanRect(makeFan(), { x: 50, y: 0 })).toBe(true);
  });

  it('沿吹風方向超出 length（在矩形之後）→ false', () => {
    expect(isPointInFanRect(makeFan(), { x: 100.1, y: 0 })).toBe(false);
  });

  it('沿吹風方向小於 0（在原點之後、矩形之外）→ false', () => {
    expect(isPointInFanRect(makeFan(), { x: -0.1, y: 0 })).toBe(false);
  });

  it('垂直吹風方向超出 width/2 → false；剛好在邊界上 → true', () => {
    expect(isPointInFanRect(makeFan(), { x: 50, y: 20.1 })).toBe(false);
    expect(isPointInFanRect(makeFan(), { x: 50, y: 20 })).toBe(true);
    expect(isPointInFanRect(makeFan(), { x: 50, y: -20 })).toBe(true);
  });

  it('斜向風扇（dir 非軸對齊）也正確依旋轉後的矩形判定', () => {
    // 朝 (0.6, 0.8) 吹、原點 (10, 10)：沿軸 60 處的中心點應落在矩形內。
    const fan = makeFan({ originX: 10, originY: 10, dirX: 0.6, dirY: 0.8, length: 100, width: 20 });
    const along = 60;
    const center = { x: 10 + 0.6 * along, y: 10 + 0.8 * along };
    expect(isPointInFanRect(fan, center)).toBe(true);
    // 同一點沿橫向（垂直方向）推出去超過 half-width 應變 false。
    const perpX = -0.8;
    const perpY = 0.6;
    const outside = { x: center.x + perpX * 11, y: center.y + perpY * 11 };
    expect(isPointInFanRect(fan, outside)).toBe(false);
  });
});
