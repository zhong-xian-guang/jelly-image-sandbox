/**
 * 匯入時的檔案挑選（issue #12 / T11、issue #55）——從一批 `File` 裡挑出第一個
 * 支援的影像檔（png / jpeg / gif）。
 *
 * 純函式、不碰 DOM 以外的東西，方便單元測試；實際讀檔／解碼／重建 Jelly 留給
 * `JellySandbox`（那段需要真的 WebGL canvas，走不了 jsdom）。拖放（`DataTransfer.files`）
 * 與檔案選擇器（`<input type=file>.files`）兩條路的 `FileList` 同形，共用這裡。
 */

const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif']);
const SUPPORTED_EXT = ['.png', '.jpg', '.jpeg', '.gif'];

/**
 * 挑出第一個支援的影像檔；沒有就回 `null`（呼叫端據此忽略、不崩——見 issue #12
 * 驗收條件「拖放非圖片或不支援格式 → 忽略、不崩」，issue #55 把範圍擴到 jpg/gif）。
 *
 * 優先看 MIME type；type 缺失時（部分瀏覽器/OS 對某些來源—例如剪貼簿或某些檔案
 * 管理器拖出的檔案—不填 `File.type`）退回看副檔名。
 *
 * 命名故意避開「pick」——那個詞在這個專案已經是 `sim.pick`（世界座標→表面點）
 * 的專用術語，這裡挑的是檔案，不要混用（見 CONTEXT.md）。
 */
export function selectSupportedImageFile(
  files: Iterable<File> | ArrayLike<File> | null | undefined,
): File | null {
  if (!files) return null;
  for (const file of Array.from(files)) {
    if (isSupportedImageFile(file)) return file;
  }
  return null;
}

/** 檔案是否為支援的影像格式（MIME 命中，或 MIME 缺失時副檔名命中）。 */
export function isSupportedImageFile(file: File): boolean {
  if (file.type) return SUPPORTED_MIME.has(file.type);
  const name = file.name.toLowerCase();
  return SUPPORTED_EXT.some((ext) => name.endsWith(ext));
}
