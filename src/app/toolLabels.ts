/**
 * 工具與模式的顯示文字（issue #122 / V4 T1）——工具列按鈕、參數卡模式鈕、游標標籤共用
 * 同一份，改一個名字不會三處對不上。純資料，不碰 DOM。
 */

import type { ToolId, ToolMode } from '../input';

/** 工具列按鈕的圖示＋文字（圖示只是裝飾，文字才是名稱）。 */
export const TOOL_LABELS: Readonly<Record<ToolId, { icon: string; text: string }>> = {
  grab: { icon: '✋', text: '抓取' },
  pin: { icon: '📌', text: 'Pin' },
  fan: { icon: '🌀', text: '電風扇' },
  jelly: { icon: '🍮', text: 'Jelly' },
};

/** 模式名稱（CONTEXT.md「模式」）。 */
export const MODE_LABELS: Readonly<Record<ToolMode, string>> = {
  single: '單點',
  handful: '大把',
  formation: '編隊',
  place: '放',
  remove: '拔',
  // 電風扇的模式＝右鍵＋滾輪調的參數（issue #125）。
  width: '寬度',
  strength: '強度',
  falloff: '衰減',
  frequency: '頻率',
};
