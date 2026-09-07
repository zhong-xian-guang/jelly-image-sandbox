/**
 * `TrackRecorder`（issue #29 / V2 T1a）——把一段即時操作錄成一條 `Track`，跟
 * `DemoRunner` 互補：`DemoRunner` 依 sim-step 排程「播」事件，`TrackRecorder`
 * 依 sim-step 排程「錄」事件，兩者共用 `DemoStep` 格式，錄好的 Track 可以直接
 * 丟給 `DemoRunner.start()` 重播（見 ADR-0006）。
 *
 * 純類別，不碰 DOM／`SimCore`。呼叫端（`JellySandbox`）要在兩個既有派送點各
 * 呼叫一次 `record()`——`sim.applyInput(routed)` 之前、`cameraInput` 的 `emit`
 * 把 `CameraCommand` 推進 `cameraCommands` 佇列之前——不新增輸入路徑、不繞過
 * ADR-0005 的窄介面；並在每個固定 sim step 呼叫一次 `tick()`（跟
 * `JellySandbox` 主迴圈呼叫 `demoRunner.advance()`／`sim.step()` 同一個迴圈、
 * 同樣的 step 計數），錄下的時間戳記才會跟重播時 `DemoRunner` 的 step 計數
 * 對得上。
 */

import type { DemoEvent, DemoStep } from '../demos/types';
import type { Track } from './types';

export class TrackRecorder {
  private recording = false;
  private stepIndex = 0;
  private steps: DemoStep[] = [];

  get isRecording(): boolean {
    return this.recording;
  }

  /** 開始錄製；已在錄製中的（若有）直接被取代，時間軸從 step 0 重算。 */
  start(): void {
    this.recording = true;
    this.stepIndex = 0;
    this.steps = [];
  }

  /** 每個固定 sim step 呼叫一次，讓錄製時間軸前進一格；未在錄製時是 no-op。 */
  tick(): void {
    if (this.recording) this.stepIndex++;
  }

  /** 錄下一個事件，時間戳記為目前的 step 計數；未在錄製時是 no-op（停止後呼叫不會偷偷繼續錄）。 */
  record(event: DemoEvent): void {
    if (!this.recording) return;
    this.steps.push({ atStep: this.stepIndex, event });
  }

  /** 停止錄製並回傳這段 Track（沒有操作過就回傳空陣列）；可以直接餵給 `DemoRunner.start()` 重播。 */
  stop(): Track {
    this.recording = false;
    return this.steps;
  }
}
