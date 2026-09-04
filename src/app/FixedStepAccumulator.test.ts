import { describe, expect, it } from 'vitest';

import { FixedStepAccumulator } from './FixedStepAccumulator';

const STEP = 1 / 60;

describe('FixedStepAccumulator', () => {
  it('一個標準幀（16.7ms）→ 跑 1 步', () => {
    const acc = new FixedStepAccumulator(STEP);
    expect(acc.advance(0.0167)).toBe(1);
  });

  it('半步半步餵 → 0 步、然後 1 步（餘量累積）', () => {
    const acc = new FixedStepAccumulator(STEP);
    expect(acc.advance(STEP / 2)).toBe(0);
    expect(acc.advance(STEP / 2)).toBe(1);
  });

  it('一次餵一大段 → 依比例跑多步、餘量 < step', () => {
    const acc = new FixedStepAccumulator(STEP);
    expect(acc.advance(STEP * 4 + STEP * 0.3)).toBe(4);
    expect(acc.pending).toBeGreaterThanOrEqual(0);
    expect(acc.pending).toBeLessThan(STEP);
  });

  it('掉幀很久（2s）→ clamp 到 maxDelta，不是 120 步', () => {
    const acc = new FixedStepAccumulator(STEP, 0.25);
    const steps = acc.advance(2);
    expect(steps).toBe(Math.floor(0.25 / STEP)); // 15
    expect(steps).toBeLessThan(120);
  });

  it('負值 / NaN / 0 → 0 步、不動餘量', () => {
    const acc = new FixedStepAccumulator(STEP);
    acc.advance(STEP * 0.5); // 存一點餘量
    const before = acc.pending;
    expect(acc.advance(-1)).toBe(0);
    expect(acc.advance(Number.NaN)).toBe(0);
    expect(acc.advance(0)).toBe(0);
    expect(acc.pending).toBe(before);
  });

  it('長時間平均下來，步數 × step ≈ 真實時間（餘量有界）', () => {
    const acc = new FixedStepAccumulator(STEP);
    let total = 0;
    let realTime = 0;
    for (let i = 0; i < 600; i++) {
      const dt = 0.0159 + (i % 7) * 0.0004; // 抖動的幀時間
      realTime += dt;
      total += acc.advance(dt);
    }
    expect(Math.abs(total * STEP - realTime)).toBeLessThan(STEP);
  });

  it('step <= 0 或 maxDelta < step → 建構時丟', () => {
    expect(() => new FixedStepAccumulator(0)).toThrow();
    expect(() => new FixedStepAccumulator(-1)).toThrow();
    expect(() => new FixedStepAccumulator(STEP, STEP / 2)).toThrow(/maxDelta/);
  });

  it('reset 清掉餘量', () => {
    const acc = new FixedStepAccumulator(STEP);
    acc.advance(STEP * 0.7);
    acc.reset();
    expect(acc.pending).toBe(0);
  });
});
