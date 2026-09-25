/**
 * 操作說明文字（issue #132 / V4 U5；spec #127「操作說明」）——工具卡底下那一行、「?」說明浮層、
 * 編隊形狀定義中畫布上方那行提示，全部集中在這裡。純資料，不碰 DOM；操作規則改了只要改這一份。
 *
 * 內容以 spec #121（工具／模式／滑鼠按鍵的權威描述）與各票的最終行為為準。工具與模式的名稱
 * 取自 `toolLabels`，改名不會跟工具列、模式鈕、游標標籤對不上。
 */

import { modesOf, type ModalToolId, type ToolId } from '../input';
import { MODE_LABELS, TOOL_LABELS } from './toolLabels';

/**
 * 每張工具卡最底下那一行固定的滑鼠操作說明（spec #127：「左鍵：…｜中鍵點：…｜右鍵＋滾輪：…」）。
 * 抓取的右鍵＋滾輪要看模式（issue #138，對照 `ToolRouter` 的 `MODE_VALUE_KEYS`）：大把、以及
 * 編隊開了「每個點用大把抓」時調大把半徑；單點、編隊沒開時縮放。工具卡上縮成「用大把時調半徑，
 * 否則縮放」，在 310px 側欄裡收在兩行內（issue #141）；分模式的完整說明在「?」浮層。
 */
export const TOOL_HELP_LINES: Readonly<Record<ToolId, string>> = {
  grab: '左鍵：拖曳抓、快速點拍｜中鍵點：切模式｜右鍵＋滾輪：用大把時調半徑，否則縮放',
  pin: '左鍵：點一下放／拔、拖曳撒／擦｜中鍵點：切放／拔｜右鍵＋滾輪：筆刷半徑',
  fan: '左鍵：拖曳放置／搬移｜右鍵點風扇：移除｜中鍵點：切參數｜右鍵＋滾輪：調參數',
  jelly: '左鍵：生成｜右鍵點果凍：重建／移除',
};

/** 說明浮層裡的一列：左邊是怎麼按，右邊是會發生什麼。 */
export interface HelpEntry {
  keys: string;
  action: string;
}

/** 說明浮層裡的一組（一個工具、相機或快捷鍵）。 */
export interface HelpGroup {
  title: string;
  entries: readonly HelpEntry[];
}

/** 「左鍵（單點）」這種寫法——同一個按鍵在不同模式下做不同的事時用。 */
function inMode(keys: string, mode: keyof typeof MODE_LABELS): string {
  return `${keys}（${MODE_LABELS[mode]}）`;
}

/** 中鍵單擊輪替的順序（「單點 → 大把 → 編隊」），照 `TOOL_MODES` 排。 */
function modeCycle(tool: ModalToolId): string {
  return modesOf(tool)
    .map((mode) => MODE_LABELS[mode])
    .join(' → ');
}

function toolTitle(tool: ToolId): string {
  const label = TOOL_LABELS[tool];
  return `${label.icon} ${label.text}`;
}

/**
 * 「?」說明浮層的內容（spec #127）：四個工具在各模式下的滑鼠操作，再加相機操作與快捷鍵。
 * 工具順序跟工具列一樣（也就是 1–4 快捷鍵的順序）。
 */
export const HELP_GROUPS: readonly HelpGroup[] = [
  {
    title: toolTitle('grab'),
    entries: [
      { keys: inMode('左鍵', 'single'), action: '拖曳抓住一點、甩動、放開；快速點一下＝輕拍' },
      {
        keys: inMode('左鍵', 'handful'),
        action: '拖曳抓起範圍內的一團；快速點＝範圍輕拍',
      },
      {
        keys: inMode('左鍵', 'formation'),
        action:
          '先按參數卡的「開始設定形狀」，在畫布上依序點出各點再按「完成設定」（設定途中不能切模式）；之後拖曳一次抓起整組點，快速點＝各點各拍一下',
      },
      {
        keys: '每個點用大把抓',
        action: '編隊參數卡的開關：打開後編隊的每個點都抓起一團，半徑跟大把共用',
      },
      { keys: '中鍵點', action: `切換模式：${modeCycle('grab')}` },
      {
        keys: '右鍵＋滾輪',
        action:
          '大把：調抓取半徑；編隊：開了「每個點用大把抓」時調抓取半徑，沒開時縮放；單點：縮放',
      },
    ],
  },
  {
    title: toolTitle('pin'),
    entries: [
      { keys: inMode('左鍵', 'place'), action: '點一下放一顆 Pin；拖曳沿路撒 Pin' },
      { keys: inMode('左鍵', 'remove'), action: '點一下拔掉最近的一顆；拖曳像橡皮擦沿路拔' },
      { keys: '中鍵點', action: `切換模式：${modeCycle('pin')}` },
      { keys: '右鍵＋滾輪', action: '調 Pin 筆刷半徑（撒和擦共用）' },
    ],
  },
  {
    title: toolTitle('fan'),
    entries: [
      { keys: '左鍵拖曳', action: '在空白處放置風扇；在風扇上拖曳＝搬移' },
      { keys: '右鍵點風扇', action: '移除風扇' },
      { keys: '中鍵點', action: `切換要調的參數：${modeCycle('fan')}` },
      { keys: '右鍵＋滾輪', action: '調目前的參數，場上的風扇即時套用' },
    ],
  },
  {
    title: toolTitle('jelly'),
    entries: [
      { keys: '左鍵點', action: '生成一塊 Jelly（點在果凍上也照樣生成）' },
      { keys: '右鍵點果凍', action: '開選單：重建／移除這一塊' },
      { keys: '右鍵＋滾輪', action: '縮放（這個工具沒有模式）' },
    ],
  },
  {
    title: '🎥 相機',
    entries: [
      { keys: '中鍵拖曳', action: '平移畫面' },
      { keys: '滾輪', action: '縮放' },
    ],
  },
  {
    title: '⌨️ 快捷鍵',
    entries: [
      { keys: '1–4', action: '切換工具：抓取、Pin、電風扇、Jelly' },
      { keys: '空白鍵', action: '播放中暫停／繼續' },
      { keys: 'Esc', action: '關閉選單或這個說明；離開乾淨畫面' },
    ],
  },
];

/** 編隊形狀定義中，畫布上方那一行說明（spec #127；它是提示，見 `FormationDefineHint`）。 */
export const FORMATION_DEFINE_HINT = '依序點出各點，按『完成設定』結束';
