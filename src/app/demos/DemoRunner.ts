/**
 * 輕量時間軸執行器（issue #15 / T14）——依「已經跑了幾個固定 sim step」（不是
 * wall-clock 時間或 RAF 幀數）觸發排定的事件，跟即時輸入走同一條
 * `applyInput`／`cameraCommands` 窄介面（ADR-0005），不繞過它們直接戳 `SimCore`
 * 或相機內部狀態。
 *
 * 用 sim-step 計數而非幀數/時間，是因為 `JellySandbox` 主迴圈用
 * `FixedStepAccumulator` 把真實時間切成數量不定的固定步——同一個排程不管
 * 實際掉幀與否，只要跑過一樣多的 sim step，事件就在同一個 step 觸發，結果
 * 決定性一致（issue #15 驗收條件：「Demo 在決定性模擬下每次播放結果一致」）。
 * `JellySandbox` 需要在 `sim.step()` 前呼叫一次 `advance()`（每個固定 step 各一次）。
 *
 * issue #29 / V2 T1a 擴充：排程裡的事件可能是 `InputEvent` 也可能是
 * `CameraCommand`（`TrackRecorder` 錄下的相機平移／縮放），`advance` 依 `type`
 * 分流派給對應的回呼——兩者字面值不重疊，不需要額外 tag（見 `isCameraCommand`）。
 * 這條路徑也是 Track 重播機制本身：`TrackRecorder.stop()` 回傳的排程格式跟
 * `DemoStep[]` 相同，可以直接餵給這裡的 `start()` 精準重播（見 ADR-0006）。
 */

import type { CameraCommand } from '../../camera';
import type { InputEvent } from '../../sim';
import { isCameraCommand } from './eventKind';
import type { DemoStep } from './types';

export class DemoRunner {
  private schedule: DemoStep[] = [];
  private cursor = 0;
  private stepIndex = 0;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * 目前已經推進過的全域 sim step 數（issue #34 / V2 T1-2）——每呼叫一次
   * `advance()` 加一，`start()`／`stop()` 歸零。`JellySandbox` 用它換算成秒
   * 顯示「目前播放到第幾秒」；暫停時主迴圈不呼叫 `advance()`，這個數字自然
   * 定住，讀出跟著停。
   */
  get elapsedSteps(): number {
    return this.stepIndex;
  }

  /** 開始播放一段時間軸；已在播放中的 Demo（若有）直接被取代。 */
  start(schedule: readonly DemoStep[]): void {
    this.schedule = [...schedule].sort((a, b) => a.atStep - b.atStep);
    this.cursor = 0;
    this.stepIndex = 0;
    this.running = this.schedule.length > 0;
  }

  /** 立即停止並清空排程（不動 Jelly 本身——重設交給呼叫端另外做的 `sim.reset()`）。 */
  stop(): void {
    this.schedule = [];
    this.cursor = 0;
    this.stepIndex = 0;
    this.running = false;
  }

  /**
   * 每個固定 sim step 呼叫一次：把「這個 step（含）之前該觸發、還沒觸發」的
   * 事件依序分流送進 `applyInput`（`InputEvent`）或 `applyCamera`
   * （`CameraCommand`），再把內部 step 計數加一。播完排程最後一個事件後自動
   * 停止（`isRunning` 變 `false`）。
   */
  advance(
    applyInput: (event: InputEvent) => void,
    applyCamera: (command: CameraCommand) => void,
  ): void {
    if (!this.running) return;
    while (
      this.cursor < this.schedule.length &&
      this.schedule[this.cursor]!.atStep <= this.stepIndex
    ) {
      const event = this.schedule[this.cursor]!.event;
      if (isCameraCommand(event)) applyCamera(event);
      else applyInput(event);
      this.cursor++;
    }
    this.stepIndex++;
    if (this.cursor >= this.schedule.length) this.running = false;
  }
}
