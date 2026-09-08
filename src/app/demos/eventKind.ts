/**
 * 判別一個 `DemoEvent` 是 `CameraCommand` 還是 `InputEvent`（issue #33 / V2 T1-1
 * 從 `DemoRunner` 抽出來共用）。
 *
 * `InputEvent` 跟 `CameraCommand` 的 `type` 字面值彼此不重疊（見兩邊型別定義），
 * 所以直接看 `type` 就能分流，不需要額外的 tag 欄位。`DemoRunner` 用它在重播時
 * 把事件派給對應佇列；`TrackRecorder.stop()` 用它把錄到的混合事件流拆成
 * 「動作」與「相機」兩份（ADR-0007 的拆軌模型）。
 */

import type { CameraCommand } from '../../camera';
import type { DemoEvent } from './types';

/**
 * `CameraCommand` 聯集裡每個 `type` 的成員表——鍵型別綁死 `CameraCommand['type']`，
 * 之後在 `../../camera/types` 新增相機指令變體卻忘了補這裡，會是編譯錯誤而不是
 * 默默被歸類成動作事件。`CAMERA_COMMAND_TYPES` 與 `isCameraCommand` 都由它衍生，
 * 只有這一份要維護。
 */
const CAMERA_COMMAND_TYPE_SET: Record<CameraCommand['type'], true> = {
  panBy: true,
  zoomBy: true,
  setFollow: true,
  frame: true,
};

/** `CameraCommand` 所有的 `type` 字面值（衍生自 `CAMERA_COMMAND_TYPE_SET`）。 */
export const CAMERA_COMMAND_TYPES: readonly string[] = Object.keys(CAMERA_COMMAND_TYPE_SET);

export function isCameraCommand(event: DemoEvent): event is CameraCommand {
  return event.type in CAMERA_COMMAND_TYPE_SET;
}
