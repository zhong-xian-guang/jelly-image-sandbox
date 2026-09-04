/**
 * 固定時間步 accumulator（issue #11 / T10）。
 *
 * 餵進「自上次以來的真實秒數」，吐出這一輪要推進的固定步數。單次餵入的上限
 * clamp 防「spiral of death」——一次掉幀很久也不會累出一大堆步、把主執行緒卡死。
 * accumulator 的餘量留到下次，讓模擬平均下來跟真實時間對齊（見
 * `docs/design/simulation-and-mesh.md`「迴圈」）。
 */
export class FixedStepAccumulator {
  private accum = 0;

  constructor(
    /** 每步秒數（如 `1 / 60`）。 */
    readonly step: number,
    /** 單次 `advance` 最多吸收多少真實秒數，超過的丟棄。預設 0.25。 */
    readonly maxDelta = 0.25,
  ) {
    if (!(step > 0)) throw new RangeError(`step 必須 > 0，收到 ${step}`);
    if (!(maxDelta >= step)) throw new RangeError(`maxDelta（${maxDelta}）必須 ≥ step（${step}）`);
  }

  /**
   * 餵入自上次以來的真實秒數，回傳現在要跑的固定步數（≥ 0 整數）。
   * 負值 / NaN 視為 0；超過 `maxDelta` 的部分丟棄。
   */
  advance(deltaSeconds: number): number {
    const clamped = deltaSeconds > 0 ? Math.min(deltaSeconds, this.maxDelta) : 0;
    this.accum += clamped;
    let steps = 0;
    while (this.accum >= this.step) {
      this.accum -= this.step;
      steps++;
    }
    return steps;
  }

  /** 尚未消化的餘量，`0 ≤ pending < step`。v1 不做算繪插值，僅供觀察。 */
  get pending(): number {
    return this.accum;
  }

  reset(): void {
    this.accum = 0;
  }
}
