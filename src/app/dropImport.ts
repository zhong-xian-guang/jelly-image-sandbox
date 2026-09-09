/**
 * 匯入時的檔案挑選（issue #12 / T11、issue #55、issue #56）——從一批 `File` 裡挑出
 * 第一個支援的影像檔（png / jpeg / gif），以及把挑到的檔讀成位元組交給呼叫端。
 *
 * `selectSupportedImageFile` / `isSupportedImageFile` 是純函式、不碰 DOM。
 * `readSelectedImageFile` 多一步 `File.arrayBuffer()` 與 `console.warn`（拖放與「匯入
 * 圖片」按鈕兩條匯入路共用的「挑檔 → 讀位元組 → 回呼」尾段，issue #56），故非純；
 * 實際解碼／重建 Jelly 仍留給 `JellySandbox`（那段需要真的 WebGL canvas，走不了
 * jsdom）。拖放（`DataTransfer.files`）與檔案選擇器（`<input type=file>.files`）兩條路
 * 的 `FileList` 同形，共用這裡。
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

export interface ImageBytesHandlers {
  /** 挑到支援的影像檔並讀成位元組後呼叫。 */
  onImport: (imageBytes: Uint8Array) => void;
  /**
   * 有選檔但格式全不支援，或讀檔失敗。帶一句給使用者看的說明（呼叫端負責顯示在
   * 畫面上）。沒有選到任何檔（拖非檔案、按取消）不算，不會觸發。
   */
  onReject?: (message: string) => void;
}

/**
 * 拖放（`DropImportInput`）與「匯入圖片」按鈕（`FileImportInput`）共用的尾段
 * （issue #56）：從選到的檔案裡挑出第一個支援的影像 → 讀成位元組 → `onImport`。
 *
 * - 有選檔、但沒有一個是支援格式（webp/avif/bmp…）→ `console.warn` + `onReject`。
 * - 沒有選到任何檔（拖非檔案、按取消）→ 靜默、不呼叫任何回呼。
 * - 讀檔本身失敗 → `console.warn` + `onReject`。
 */
export function readSelectedImageFile(
  files: FileList | null | undefined,
  handlers: ImageBytesHandlers,
): void {
  const file = selectSupportedImageFile(files);
  if (!file) {
    if (files && files.length > 0) {
      console.warn('[jelly] 檔案不是支援的圖片格式（僅支援 PNG / JPEG / GIF），已略過');
      handlers.onReject?.('不支援這個格式，請改用 PNG / JPEG / GIF 圖片');
    }
    return;
  }
  file
    .arrayBuffer()
    .then((buf) => handlers.onImport(new Uint8Array(buf)))
    .catch((err: unknown) => {
      console.warn('[jelly] 讀取檔案失敗，已略過', err);
      handlers.onReject?.('這個檔案讀不進來，已略過');
    });
}
