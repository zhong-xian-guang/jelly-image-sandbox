/**
 * Demo（issue #15 / T14）的型別。
 *
 * 一個 Demo = 一段依「sim step 計數」排定的 `InputEvent` 時間軸（見 `DemoRunner`），
 * 跟即時輸入走同一條 `applyInput` 窄介面（ADR-0005），不抄捷徑直接戳 `SimCore`
 * 內部狀態。`build` 吃「目前」Jelly 的 Particle 位置陣列，每次啟動都重新算一次，
 * 才能套用在任何已匯入的形狀上（不是寫死座標）。
 */

import type { InputEvent } from '../../sim';

/** 排定在第幾個固定 sim step（60Hz，見 `JellySandbox` 主迴圈）觸發的一個事件。 */
export interface DemoStep {
  atStep: number;
  event: InputEvent;
}

export interface DemoDefinition {
  id: string;
  label: string;
  build(positions: Float64Array): DemoStep[];
}
