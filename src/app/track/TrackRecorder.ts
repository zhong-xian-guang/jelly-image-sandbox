/**
 * `TrackRecorder`（issue #29 / V2 T1a，issue #33 / V2 T1-1 依 ADR-0007 改為拆軌）
 * ——把一段即時操作錄成 Track，跟 `DemoRunner` 互補：`DemoRunner` 依 sim-step
 * 排程「播」事件，`TrackRecorder` 依 sim-step 排程「錄」事件，兩者共用 `DemoStep`
 * 格式，錄好的 Track 可以直接丟給 `DemoRunner.start()` 重播（見 ADR-0007）。
 *
 * 純類別，不碰 DOM／`SimCore`。呼叫端（`JellySandbox`）要在兩個既有派送點各
 * 呼叫一次 `record()`——`sim.applyInput(routed)` 之前、`cameraInput` 的 `emit`
 * 把 `CameraCommand` 推進佇列之前——不新增輸入路徑、不繞過 ADR-0005 的窄介面；
 * 並在每個固定 sim step 呼叫一次 `tick()`（跟 `JellySandbox` 主迴圈呼叫
 * `demoRunner.advance()`／`sim.step()` 同一個迴圈、同樣的 step 計數），錄下的
 * 時間戳記才會跟重播時 `DemoRunner` 的 step 計數對得上。
 *
 * **拆軌（ADR-0007）**：錄製期間照舊把指標事件跟相機指令都收進同一個 `steps[]`；
 * `stop()` 時依 `isCameraCommand` 把它拆成 `{ action, camera }` 兩份回傳。錄製
 * 目標若是單頻道（`'action'` / `'camera'`），只回傳被選的那一份、另一份為空
 * （另一路的操作即時生效但不錄）；`'both'` 兩份都回傳。
 */

import { isCameraCommand } from '../demos/eventKind';
import type { DemoEvent, DemoStep } from '../demos/types';
import type { RecordTarget, SplitTracks } from './types';

export class TrackRecorder {
  private recording = false;
  private target: RecordTarget = 'both';
  private stepIndex = 0;
  private steps: DemoStep[] = [];

  get isRecording(): boolean {
    return this.recording;
  }

  /**
   * 開始錄製；已在錄製中的（若有）直接被取代，時間軸從 step 0 重算。`target`
   * 決定 `stop()` 要回傳哪幾份（預設 `'both'`）。
   */
  start(target: RecordTarget = 'both'): void {
    this.recording = true;
    this.target = target;
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

  /**
   * 停止錄製並把錄到的事件依種類拆成 `{ action, camera }` 兩份回傳（各自的
   * `atStep` 仍相對這次錄製的起點）。錄製目標為單頻道時另一份為空陣列；沒有
   * 操作過就兩份都空。可以把 `action`／`camera` 各自餵給 `DemoRunner.start()` 重播。
   */
  stop(): SplitTracks {
    this.recording = false;
    const wantAction = this.target !== 'camera';
    const wantCamera = this.target !== 'action';
    const action: DemoStep[] = [];
    const camera: DemoStep[] = [];
    for (const step of this.steps) {
      if (isCameraCommand(step.event)) {
        if (wantCamera) camera.push(step);
      } else if (wantAction) {
        action.push(step);
      }
    }
    return { action, camera };
  }
}
