/**
 * Track（issue #29 / V2 T1a，見 CONTEXT.md「Track」詞條、ADR-0006）的型別。
 *
 * 一個 Track 是一段錄下的輸入事件流（Grab／拖曳／放開、Tap、Pin、相機操作），
 * 跟 Demo 共用同一種「sim-step → 事件」排程格式（`DemoStep`）——錄好的 Track
 * 可以直接丟給 `DemoRunner.start()` 精準重播，不需要另外寫一個播放器。
 */

import type { DemoStep } from '../demos/types';

export type Track = readonly DemoStep[];
