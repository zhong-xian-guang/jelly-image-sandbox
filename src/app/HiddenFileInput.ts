/**
 * 隱藏 `<input type=file>` 的共用外殼（issue #56 起；issue #58 / V2 T2-5 抽出，
 * 供「匯入圖片」`FileImportInput` 與「載入片段」`ClipFileInput` 共用）——兩者都是
 * 「按鈕開原生檔案選擇器」的同一種接線，差別只在 `accept` 篩選跟選到檔後怎麼讀。
 *
 * `change` 時先把 `input.files`（live `FileList`）複製出來再清 `input.value`——
 * 依 HTML 規範，清 `value` 會就地清空同一個 `FileList` 物件；先複製再清，選好的
 * 檔案才不會被自己緊接著的清空動作連帶清掉（issue #56 修過的迴歸）。清空 `value`
 * 本身是為了讓「選同一個檔案兩次」也能再觸發 `change`。
 */

export class HiddenFileInput {
  private readonly input: HTMLInputElement;
  private readonly onFiles: (files: File[]) => void;

  constructor(doc: Document, accept: string, onFiles: (files: File[]) => void) {
    this.onFiles = onFiles;
    this.input = doc.createElement('input');
    this.input.type = 'file';
    this.input.accept = accept;
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
    const files = this.input.files ? Array.from(this.input.files) : [];
    this.input.value = '';
    this.onFiles(files);
  };
}
