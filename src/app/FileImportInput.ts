/**
 * `FileImportInput`（issue #56 / V2 T2-3）——讓「匯入圖片」按鈕與角落的常駐提示字
 * 也能開圖片，而不只能靠拖曳。
 *
 * 薄的接線層（對照 `DropImportInput`）：持有一個隱藏的 `<input type="file">`，
 * `open()` 觸發瀏覽器原生檔案選擇器；`change` → `readSelectedImageFile`（與拖放
 * 共用的「挑檔 → 讀位元組 → 回呼」尾段）→ `onImport` / `onReject`。按取消（沒有
 * 選到任何檔）由 `readSelectedImageFile` 靜默略過。
 *
 * `<input accept>` 只列 png/jpg/gif，那只是給使用者的預設篩選、擋不住硬選其他檔，
 * 真正的把關仍是 `selectSupportedImageFile`（與拖放路徑同一套判斷）。
 */

import { readSelectedImageFile, type ImageBytesHandlers } from './dropImport';

export type FileImportInputOptions = ImageBytesHandlers;

/** 原生檔案選擇器的預設篩選——比照 `decodeImageAlpha` 分派的三種格式（見 issue #53）。 */
const ACCEPT = 'image/png,image/jpeg,image/gif';

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
    // `input.files` 是跟著 input 的 live FileList——先複製出來再清 `value`，否則
    // `input.value = ''`（依 HTML 規範會清空「已選檔案清單」）會連同把手上這份
    // 也清掉，`readSelectedImageFile` 拿到空清單、靜默返回，選好的圖沒反應。
    const files = this.input.files ? Array.from(this.input.files) : null;
    // 選同一個檔第二次也要能再觸發 `change`（否則「匯入同一張圖」第二次起沒反應）——用完即清空。
    this.input.value = '';
    readSelectedImageFile(files, this.opts);
  };
}
