/**
 * `FileImportInput`（issue #56 / V2 T2-3）——讓「匯入圖片」按鈕與角落的常駐提示字
 * 也能開圖片，而不只能靠拖曳。
 *
 * 薄的接線層（對照 `DropImportInput`）：`HiddenFileInput`（issue #58 抽出的共用
 * 外殼）負責隱藏 `<input type="file">` 的開啟／挑檔／value 重置；選到的檔案交給
 * `readSelectedImageFile`（與拖放共用的「挑檔 → 讀位元組 → 回呼」尾段）→
 * `onImport` / `onReject`。按取消（沒有選到任何檔）由 `readSelectedImageFile` 靜默
 * 略過。
 *
 * `<input accept>` 只列 png/jpg/gif，那只是給使用者的預設篩選、擋不住硬選其他檔，
 * 真正的把關仍是 `selectSupportedImageFile`（與拖放路徑同一套判斷）。
 */

import { readSelectedImageFile, type ImageBytesHandlers } from './dropImport';
import { HiddenFileInput } from './HiddenFileInput';

export type FileImportInputOptions = ImageBytesHandlers;

/** 原生檔案選擇器的預設篩選——比照 `decodeImageAlpha` 分派的三種格式（見 issue #53）。 */
const ACCEPT = 'image/png,image/jpeg,image/gif';

export class FileImportInput {
  private readonly hidden: HiddenFileInput;

  constructor(doc: Document, opts: FileImportInputOptions) {
    this.hidden = new HiddenFileInput(doc, ACCEPT, (files) => readSelectedImageFile(files, opts));
  }

  /** 開啟瀏覽器原生檔案選擇器。 */
  open(): void {
    this.hidden.open();
  }

  destroy(): void {
    this.hidden.destroy();
  }
}
