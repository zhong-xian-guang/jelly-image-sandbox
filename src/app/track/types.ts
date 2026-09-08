/**
 * Track（軌）的型別（issue #29 / V2 T1a 起，issue #33 / V2 T1-1 依 ADR-0007
 * 改為拆軌模型）。見 CONTEXT.md「Track」「Action Track」「Camera Track」詞條。
 *
 * 一個 Track 是一段錄下的事件流，跟 Demo 共用同一種「sim-step → 事件」排程格式
 * （`DemoStep`）——錄好的 Track 可以直接丟給 `DemoRunner.start()` 精準重播，不需要
 * 另外寫一個播放器。
 *
 * ADR-0007 把「一次錄製 = 一條混合流」改成「一次錄製依錄製目標產出**最多兩條**
 * Track」：一條只含指標事件的 **Action Track**、一條只含相機指令的 **Camera Track**。
 * `TrackRecorder.stop()` 因此回傳 `SplitTracks`（兩份都在，單頻道模式下另一份為空）。
 */

import type { CameraState } from '../../camera';
import type { DemoStep } from '../demos/types';

export type Track = readonly DemoStep[];

/**
 * 按下錄製前選定的錄製目標：只錄動作／只錄運鏡／兩者同時。單頻道模式下另一路的
 * 操作即時生效但不錄進去（過濾發生在 `TrackRecorder.stop()`）。
 */
export type RecordTarget = 'action' | 'camera' | 'both';

/** `TrackRecorder.stop()` 的回傳：錄到的事件依種類拆成的兩份時間軸 ＋ 起點鏡頭快照。 */
export interface SplitTracks {
  /** 指標事件（Grab／moveGrab／release／Tap／Pin／unpin／movePin）。 */
  action: Track;
  /** 相機指令（panBy／zoomBy／setFollow／frame）。 */
  camera: Track;
  /**
   * 錄製「開始」當下的鏡頭快照（issue #36 / V2 T1-4）——相機軌播放到起始時間時
   * 由 `mergeTracks` 插一個絕對相機指令「硬切」進場用。由 `JellySandbox` 在
   * `start()` 當下傳入；沒帶（或只錄動作）時為 `null`。
   */
  startCamera: CameraState | null;
}
