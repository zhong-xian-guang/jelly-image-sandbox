/**
 * 拖放匯入（issue #12 / T11）——從拖放事件的 `DataTransfer` 挑出可用的 PNG 檔案。
 *
 * 純函式、不碰 DOM 以外的東西，方便單元測試；實際讀檔／解碼／重建 Jelly 留給
 * `JellySandbox`（那段需要真的 WebGL canvas，走不了 jsdom）。
 */

/**
 * 挑出第一個看起來是 PNG 的檔案；沒有就回 `null`（呼叫端據此忽略、不崩——
 * 見 issue #12 驗收條件「拖放非圖片或不支援格式 → 忽略、不崩」）。
 *
 * 優先看 MIME type（`image/png`）；type 缺失時（部分瀏覽器/OS 對某些來源—例如
 * 剪貼簿或某些檔案管理器拖出的檔案—不填 `File.type`）退回看副檔名。
 *
 * 命名故意避開「pick」——那個詞在這個專案已經是 `sim.pick`（世界座標→表面點）
 * 的專用術語，這裡挑的是檔案，不要混用（見 CONTEXT.md）。
 */
export function selectDroppedPng(dataTransfer: DataTransfer | null | undefined): File | null {
  if (!dataTransfer) return null;
  for (const file of Array.from(dataTransfer.files)) {
    if (isPngFile(file)) return file;
  }
  return null;
}

function isPngFile(file: File): boolean {
  if (file.type) return file.type === 'image/png';
  return file.name.toLowerCase().endsWith('.png');
}
