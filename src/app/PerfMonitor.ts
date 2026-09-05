/**
 * substep 自動降級（issue #16 / T15）。
 *
 * 純函式狀態機、與 DOM／wall-clock 無關（測試餵合成 frame time 即可決定性重現）：
 * 每幀餵入「這一幀實際花了幾毫秒」+「這一幀經過的真實秒數」，持續超標（`degradeThresholdMs`）
 * 累計滿 `sustainSeconds` 才真的降級（4→2），單一幀的尖峰不會誤觸發；降級後持續
 * 低於 `recoverThresholdMs` 累計滿 `sustainSeconds` 才升回 4。降級／回穩門檻不同值
 * （hysteresis）+ 累計時間才觸發，兩者都是為了不要在門檻附近每幀來回抖動。
 *
 * 降級發生的那一幀順便點亮 `meshFallbackPending`——網格解析度退路（過重時下次
 * 匯入用較低目標 Particle 數）靠它知道「該用低解析度了」；`consumeMeshFallbackPending()`
 * 讀取後歸零，所以只影響**下一次**匯入，不是永久切換（若之後又再度降級，會再被
 * 點亮一次）。
 */

export interface PerfMonitorOptions {
  /** 幀時間超過此值（毫秒）視為「超標」。預設 22（約 45fps，60fps 預算 16.7ms 留餘裕才觸發）。 */
  degradeThresholdMs: number;
  /** 幀時間低於此值（毫秒）視為「穩了」。刻意比 `degradeThresholdMs` 低，避免臨界值附近抖動。預設 15。 */
  recoverThresholdMs: number;
  /** 超標／回穩必須連續累積滿這麼多秒才觸發切換，濾掉單幀尖峰。預設 1。 */
  sustainSeconds: number;
  /** 正常 substep 數。預設 4。 */
  highSubsteps: number;
  /** 降級後的 substep 數。預設 2。 */
  lowSubsteps: number;
}

const DEFAULT_OPTIONS: PerfMonitorOptions = {
  degradeThresholdMs: 22,
  recoverThresholdMs: 15,
  sustainSeconds: 1,
  highSubsteps: 4,
  lowSubsteps: 2,
};

/** 累加多筆浮點秒數比較門檻時的容差，抵銷 `0.1 + 0.1 + ... ` 這類加總誤差。 */
const EPSILON = 1e-9;

export class PerfMonitor {
  private readonly opts: PerfMonitorOptions;
  private substepsValue: number;
  private overBudgetSeconds = 0;
  private underBudgetSeconds = 0;
  private meshFallbackPending = false;

  constructor(opts: Partial<PerfMonitorOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.substepsValue = this.opts.highSubsteps;
  }

  /** 目前建議的 substep 數（`highSubsteps` 或 `lowSubsteps`）。 */
  get substeps(): number {
    return this.substepsValue;
  }

  /** 是否處於降級狀態。 */
  get degraded(): boolean {
    return this.substepsValue === this.opts.lowSubsteps;
  }

  /**
   * 餵入這一幀的量測。`frameMs` 是這一幀實際花費的毫秒數（wall-clock）；
   * `elapsedSeconds` 是同一幀的秒數版本，用來累計「超標／回穩維持了多久」。
   */
  sample(frameMs: number, elapsedSeconds: number): void {
    const dt = elapsedSeconds > 0 ? elapsedSeconds : 0;
    if (!this.degraded) {
      if (frameMs > this.opts.degradeThresholdMs) {
        this.overBudgetSeconds += dt;
        if (this.overBudgetSeconds >= this.opts.sustainSeconds - EPSILON) {
          this.substepsValue = this.opts.lowSubsteps;
          this.meshFallbackPending = true;
          this.overBudgetSeconds = 0;
        }
      } else {
        this.overBudgetSeconds = 0;
      }
    } else {
      if (frameMs < this.opts.recoverThresholdMs) {
        this.underBudgetSeconds += dt;
        if (this.underBudgetSeconds >= this.opts.sustainSeconds - EPSILON) {
          this.substepsValue = this.opts.highSubsteps;
          this.underBudgetSeconds = 0;
        }
      } else {
        this.underBudgetSeconds = 0;
      }
    }
  }

  /**
   * 讀取「該用網格解析度退路了嗎」並歸零（一次性）。`importPng` 每次匯入呼叫一次；
   * 只有回傳 `true` 的那一次匯入會用較低的 `targetParticleCount`。
   */
  consumeMeshFallbackPending(): boolean {
    const pending = this.meshFallbackPending;
    this.meshFallbackPending = false;
    return pending;
  }
}
