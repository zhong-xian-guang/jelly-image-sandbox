import { describe, expect, it } from 'vitest';

import { HELP_GROUPS, TOOL_HELP_LINES } from './helpText';
import { TOOL_LABELS } from './toolLabels';

/**
 * 抓取的右鍵＋滾輪要看模式（issue #138；行為見 `ToolRouter` 的 `MODE_VALUE_KEYS` 與其測試）：
 * 單點＝縮放、大把＝大把半徑、編隊＝開了「每個點用大把抓」調大把半徑、沒開縮放。
 */
describe('抓取的右鍵＋滾輪說明跟實際行為一致（issue #138）', () => {
  it('工具卡那一行：大把、編隊（每點大把）調半徑，否則縮放', () => {
    const wheel = TOOL_HELP_LINES.grab.split('｜').find((part) => part.startsWith('右鍵＋滾輪'));
    expect(wheel).toBe('右鍵＋滾輪：大把／編隊開每點大把＝調半徑，否則縮放');
  });

  it('「?」浮層：單點、大把、編隊開／關四種情況都寫到', () => {
    const grab = HELP_GROUPS.find((g) => g.title.includes(TOOL_LABELS.grab.text))!;
    const wheel = grab.entries.find((e) => e.keys === '右鍵＋滾輪')!;
    expect(wheel.action).toBe(
      '大把：調抓取半徑；編隊：開了「每個點用大把抓」時調抓取半徑，沒開時縮放；單點：縮放',
    );
  });
});
