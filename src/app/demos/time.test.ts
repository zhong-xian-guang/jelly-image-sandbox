import { describe, expect, it } from 'vitest';

import { STEP_SECONDS, secondsToStep, stepToSeconds } from './time';

describe('秒 ↔ sim step 換算（issue #34）', () => {
  it('STEP_SECONDS 是 1/60', () => {
    expect(STEP_SECONDS).toBe(1 / 60);
  });

  it('secondsToStep：秒 → 最近的整數 step', () => {
    expect(secondsToStep(0)).toBe(0);
    expect(secondsToStep(1)).toBe(60);
    expect(secondsToStep(2.5)).toBe(150);
    // 非 1/60 整數倍 → 四捨五入
    expect(secondsToStep(0.11)).toBe(7); // 6.6 → 7
    expect(secondsToStep(0.008)).toBe(0); // 0.48 → 0
  });

  it('stepToSeconds：step → 秒', () => {
    expect(stepToSeconds(0)).toBe(0);
    expect(stepToSeconds(60)).toBe(1);
    expect(stepToSeconds(90)).toBeCloseTo(1.5, 10);
  });

  it('stepToSeconds ∘ secondsToStep 對整數秒是同一律', () => {
    for (const s of [0, 1, 2, 5, 10, 42]) {
      expect(stepToSeconds(secondsToStep(s))).toBeCloseTo(s, 10);
    }
  });

  it('secondsToStep 對負輸入直接取整（clamp 到 0 交給呼叫端 setTrackStartTime）', () => {
    expect(secondsToStep(-0.5)).toBe(-30);
  });
});
