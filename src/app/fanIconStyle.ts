/**
 * 電風扇圖示的外觀選擇（issue #143）——開發者分區的「風扇圖示外觀」下拉選單：`vector` 是
 * `FanOverlay` 原本的向量圖示，`photo` 是一張去背的真實桌扇照片（離線錄製素材用）。
 *
 * 跟側欄版面（`panelLayout`）一樣只存在瀏覽器自己的 `localStorage`、不進片段檔；但用
 * 獨立的 key，不塞進版面那份 JSON——兩者互不相干，版面格式改了也不會把這個選擇洗掉。
 * 讀寫一律包 try/catch（理由同 `panelLayout` 頂端說明），讀不到或值不認得就退回向量。
 */

import type { KeyValueStorage } from './panelLayout';

export type FanIconStyle = 'vector' | 'photo';

export const FAN_ICON_STYLE_STORAGE_KEY = 'jelly-sandbox:fan-icon-style';

export function loadFanIconStyle(storage: KeyValueStorage | null): FanIconStyle {
  try {
    return storage?.getItem(FAN_ICON_STYLE_STORAGE_KEY) === 'photo' ? 'photo' : 'vector';
  } catch {
    return 'vector';
  }
}

export function saveFanIconStyle(storage: KeyValueStorage | null, style: FanIconStyle): void {
  try {
    storage?.setItem(FAN_ICON_STYLE_STORAGE_KEY, style);
  } catch {
    // 存不進去就算了：這一頁照樣用目前的選擇，只是重新整理後回到向量圖示。
  }
}
