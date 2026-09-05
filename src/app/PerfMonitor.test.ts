import { describe, expect, it } from 'vitest';

import { PerfMonitor } from './PerfMonitor';

const SLOW_MS = 30; // 明顯超過預設 degradeThresholdMs（22）
const FAST_MS = 10; // 明顯低於預設 recoverThresholdMs（15）
const OK_MS = 18; // 兩個門檻之間，不該觸發任何一邊

describe('PerfMonitor', () => {
  it('初始為 highSubsteps（4）、未降級、無待處理的網格退路', () => {
    const m = new PerfMonitor();
    expect(m.substeps).toBe(4);
    expect(m.degraded).toBe(false);
    expect(m.consumeMeshFallbackPending()).toBe(false);
  });

  it('偶發一幀超標（未累積滿 sustainSeconds）→ 不降級', () => {
    const m = new PerfMonitor();
    m.sample(SLOW_MS, 0.1);
    expect(m.substeps).toBe(4);
  });

  it('持續超標累積滿 sustainSeconds → 降級到 lowSubsteps，且點亮網格退路旗標', () => {
    const m = new PerfMonitor({ sustainSeconds: 1 });
    for (let i = 0; i < 10; i++) m.sample(SLOW_MS, 0.1); // 累積 1.0s
    expect(m.substeps).toBe(2);
    expect(m.degraded).toBe(true);
    expect(m.consumeMeshFallbackPending()).toBe(true);
  });

  it('網格退路旗標讀取一次後歸零——不會影響下下次匯入', () => {
    const m = new PerfMonitor({ sustainSeconds: 1 });
    for (let i = 0; i < 10; i++) m.sample(SLOW_MS, 0.1);
    expect(m.consumeMeshFallbackPending()).toBe(true);
    expect(m.consumeMeshFallbackPending()).toBe(false);
  });

  it('超標途中出現一幀不超標 → 累積歸零、不觸發降級', () => {
    const m = new PerfMonitor({ sustainSeconds: 1 });
    for (let i = 0; i < 9; i++) m.sample(SLOW_MS, 0.1); // 累積 0.9s，還沒到 1s
    m.sample(OK_MS, 0.1); // 打斷累積
    m.sample(SLOW_MS, 0.1); // 重新只累積 0.1s
    expect(m.substeps).toBe(4);
  });

  it('降級後持續回穩累積滿 sustainSeconds → 升回 highSubsteps', () => {
    const m = new PerfMonitor({ sustainSeconds: 1 });
    for (let i = 0; i < 10; i++) m.sample(SLOW_MS, 0.1); // 先降級
    expect(m.substeps).toBe(2);
    for (let i = 0; i < 10; i++) m.sample(FAST_MS, 0.1); // 累積 1.0s 回穩
    expect(m.substeps).toBe(4);
    expect(m.degraded).toBe(false);
  });

  it('降級狀態下，介於兩門檻之間的幀時間不算回穩、也不再繼續降級', () => {
    const m = new PerfMonitor({ sustainSeconds: 1 });
    for (let i = 0; i < 10; i++) m.sample(SLOW_MS, 0.1);
    expect(m.substeps).toBe(2);
    for (let i = 0; i < 20; i++) m.sample(OK_MS, 0.1);
    expect(m.substeps).toBe(2); // 還在降級——沒回穩到 recoverThresholdMs 以下
  });

  it('回穩累積中出現一幀又超標 → 不升回', () => {
    const m = new PerfMonitor({ sustainSeconds: 1 });
    for (let i = 0; i < 10; i++) m.sample(SLOW_MS, 0.1);
    for (let i = 0; i < 9; i++) m.sample(FAST_MS, 0.1); // 累積 0.9s
    m.sample(SLOW_MS, 0.1); // 打斷
    expect(m.substeps).toBe(2);
  });

  it('可自訂門檻與 substep 數', () => {
    const m = new PerfMonitor({
      degradeThresholdMs: 50,
      recoverThresholdMs: 40,
      sustainSeconds: 0.5,
      highSubsteps: 8,
      lowSubsteps: 3,
    });
    expect(m.substeps).toBe(8);
    for (let i = 0; i < 5; i++) m.sample(60, 0.1); // 累積 0.5s，超過自訂門檻 50
    expect(m.substeps).toBe(3);
  });
});
