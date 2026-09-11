/**
 * `ClipFileInput`（issue #58 / V2 T2-5）——「載入片段」按鈕：選一個 `.json` 片段檔
 * → 讀成文字 → `onLoad`。跟 `FileImportInput`（issue #56）共用 `HiddenFileInput`
 * 外殼；差別是讀文字而非影像位元組，格式／版本／欄位驗證交給呼叫端的
 * `parseClipFile`（這裡只把關「有沒有選到檔」「讀不讀得出文字」）。
 *
 * `<input accept>` 只是給使用者的預設篩選，擋不住硬選其他副檔名——真正的把關仍是
 * `parseClipFile`（呼叫端跑）。
 */

import { HiddenFileInput } from './HiddenFileInput';

const ACCEPT = 'application/json,.json';

export interface ClipFileInputOptions {
  /** 選到檔並讀出文字內容後呼叫；文字是否為合法片段檔由呼叫端的 `parseClipFile` 判斷。 */
  onLoad: (text: string) => void;
  /** 讀檔本身失敗時呼叫，帶一句給使用者看的說明。沒有選到任何檔（按取消）不算，不會觸發。 */
  onReject?: (message: string) => void;
}

export class ClipFileInput {
  private readonly hidden: HiddenFileInput;
  private readonly opts: ClipFileInputOptions;

  constructor(doc: Document, opts: ClipFileInputOptions) {
    this.opts = opts;
    this.hidden = new HiddenFileInput(doc, ACCEPT, (files) => this.onFiles(files));
  }

  /** 開啟瀏覽器原生檔案選擇器。 */
  open(): void {
    this.hidden.open();
  }

  destroy(): void {
    this.hidden.destroy();
  }

  private onFiles(files: File[]): void {
    const file = files[0];
    if (!file) return; // 按取消，沒有選到任何檔——靜默略過
    file
      .text()
      .then((text) => this.opts.onLoad(text))
      .catch((err: unknown) => {
        console.warn('[jelly] 讀取片段檔案失敗，已略過', err);
        this.opts.onReject?.('這個檔案讀不進來，已略過');
      });
  }
}
