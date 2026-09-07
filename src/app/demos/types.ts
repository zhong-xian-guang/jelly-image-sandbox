/**
 * Demo（issue #15 / T14）的型別；issue #29 / V2 T1a 擴充成也能排 `CameraCommand`，
 * 讓 `TrackRecorder` 錄下的相機操作（平移／縮放）能跟輸入事件排在同一條時間軸上
 * 重播（見 `DemoRunner`）。
 *
 * 一個 Demo = 一段依「sim step 計數」排定的事件時間軸，跟即時輸入走同一條
 * `applyInput`／`cameraCommands` 窄介面（ADR-0005），不抄捷徑直接戳 `SimCore`
 * 內部狀態。`build` 吃「目前」Jelly 的 Particle 位置陣列，每次啟動都重新算一次，
 * 才能套用在任何已匯入的形狀上（不是寫死座標）。
 */

import type { CameraCommand } from '../../camera';
import type { InputEvent } from '../../sim';

/**
 * `InputEvent` 跟 `CameraCommand` 的 `type` 字面值彼此不重疊（見兩邊型別定義），
 * 所以可以直接用 `type` 判別是哪一種，不需要額外的 tag 欄位（見 `DemoRunner`
 * 的 `isCameraCommand`）。
 */
export type DemoEvent = InputEvent | CameraCommand;

/** 排定在第幾個固定 sim step（60Hz，見 `JellySandbox` 主迴圈）觸發的一個事件。 */
export interface DemoStep {
  atStep: number;
  event: DemoEvent;
}

export interface DemoDefinition {
  id: string;
  label: string;
  build(positions: Float64Array): DemoStep[];
}
