/**
 * `FileImportInput`（issue #56 / V2 T2-3）——讓「匯入圖片」按鈕與角落的常駐提示字
 * 也能開圖片，而不只能靠拖曳。
 *
 * 薄的接線層（對照 `DropImportInput`）：持有一個隱藏的 `<input type="file">`，
 * `open()` 觸發瀏覽器原生檔案選擇器；選到檔 → `selectSupportedImageFile` 挑出第一個
 * 支援的影像（png/jpeg/gif）→ 讀成位元組 → `onImport`（與 `DropImportInput.onImport`
 * 同形，呼叫端可共用同一條匯入路徑）。選到不支援的檔 → `console.warn` + `onReject`；
 * 按取消（沒有選到任何檔）→ 安靜略過、不呼叫任何回呼。
 *
 * `<input accept>` 只列 png/jpg/gif，但那只是給使用者的預設篩選、擋不住硬選其他檔，
 * 真正的把關仍是 `selectSupportedImageFile`（與拖放路徑同一套判斷）。
 */

import { selectSupportedImageFile } from './dropImport';

export interface FileImportInputOptions {
  /** 挑到支援的影像檔並讀成位元組後呼叫（與 `DropImportInput.onImport` 同形）。 */
  onImport: (imageBytes: Uint8Array) => void;
  /**
   * 選到的檔沒有一個是支援的影像格式，或讀檔失敗。帶一句給使用者看的說明
   * （呼叫端負責顯示在畫面上）。按取消不算，不會觸發。
   */
  onReject?: (message: string) => void;
}

/** 原生檔案選擇器的預設篩選——同時給 MIME 與副檔名，涵蓋不填 `File.type` 的來源。 */
const ACCEPT = 'image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif';

export class FileImportInput {
  private readonly input: HTMLInputElement;
  private readonly opts: FileImportInputOptions;

  constructor(doc: Document, opts: FileImportInputOptions) {
    this.opts = opts;
    this.input = doc.createElement('input');
    this.input.type = 'file';
    this.input.accept = ACCEPT;
    this.input.hidden = true;
    this.input.addEventListener('change', this.onChange);
    doc.body.appendChild(this.input);
  }

  /** 開啟瀏覽器原生檔案選擇器。 */
  open(): void {
    this.input.click();
  }

  destroy(): void {
    this.input.removeEventListener('change', this.onChange);
    this.input.remove();
  }

  private onChange = (): void => {
    const files = this.input.files;
    const file = selectSupportedImageFile(files);
    // 選同一個檔第二次也要能再觸發 `change`（否則「匯入同一張圖」第二次起沒反應）——用完即清空。
    this.input.value = '';
    if (!file) {
      // 真的選了檔、只是格式不支援（webp/avif/bmp…）→ 比照 `DropImportInput` 的處置：
      // 主控台一行警告 + 畫面提示後略過。按取消時 `files` 為空，不吭聲。
      if (files && files.length > 0) {
        console.warn('[jelly] 選到的檔案不是支援的圖片格式（僅支援 PNG / JPEG / GIF），已略過');
        this.opts.onReject?.('不支援這個格式，請改用 PNG / JPEG / GIF 圖片');
      }
      return;
    }
    file
      .arrayBuffer()
      .then((buf) => this.opts.onImport(new Uint8Array(buf)))
      .catch((err: unknown) => {
        console.warn('[jelly] 讀取選擇的檔案失敗，已略過', err);
        this.opts.onReject?.('這個檔案讀不進來，已略過');
      });
  };
}
