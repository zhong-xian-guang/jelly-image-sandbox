/**
 * 提示（CONTEXT.md「提示」）的「意圖＋現算」規則（issue #71 起在 `JellySandbox`，issue #130 抽出來
 * 才測得到）：`JellySandbox.hintIntent` 永遠存使用者的開關意圖，實際看不看得到由這裡現算——
 * 被壓下時全體隱藏，壓下的理由一消失就回到意圖原樣，不必另外記快照。
 */

/**
 * 會被「播放時隱藏提示」（issue #71）與乾淨畫面（issue #130）蓋到的提示層，每層一個 key——即面板上
 * 那六顆顯示開關（issue #113 加上大把抓取範圍圈 `handfulRange`）。Pin 工具的筆刷圓圈刻意不在此列，
 * 理由見 `JellySandbox.applyHintVisibility`。
 */
export type HintKey = 'wireframe' | 'pins' | 'fanRange' | 'fanIcon' | 'formation' | 'handfulRange';
/** 各提示層的顯示狀態：可能是使用者的意圖（`hintIntent`），也可能是算完壓下之後的實際值（`effectiveHints`）。 */
export type HintVisibility = Record<HintKey, boolean>;
/** 被壓下時的實際狀態——壓下的理由都是全域的，沒有逐層覆寫，所以壓下就是全滅。 */
export const ALL_HINTS_HIDDEN: Readonly<HintVisibility> = {
  wireframe: false,
  pins: false,
  fanRange: false,
  fanIcon: false,
  formation: false,
  handfulRange: false,
};

/** 目前把提示整批壓下的理由（任一成立就全滅）。 */
export interface HintSuppression {
  /** 「播放時隱藏提示」開著且正在播放（issue #71）。 */
  playback: boolean;
  /** 乾淨畫面中（issue #130）。 */
  cleanView: boolean;
}

/** 每層提示「現在實際上該不該顯示」：沒被壓下就是意圖原樣，被壓下就全體隱藏。不改寫 `intent`。 */
export function visibleHints(
  intent: Readonly<HintVisibility>,
  suppression: Readonly<HintSuppression>,
): Readonly<HintVisibility> {
  return suppression.playback || suppression.cleanView ? ALL_HINTS_HIDDEN : intent;
}
