/**
 * `DropImportInput`（issue #12 / T11）——把 DOM 拖放事件接到 `selectSupportedImageFile`。
 *
 * 薄的接線層（對照 `PointerInput`/`CameraInput`）：`dragenter`/`dragover`/
 * `dragleave`/`drop` → 挑出支援的影像檔（png/jpeg/gif）→ 讀成位元組 → 呼叫 `onImport`。
 * 非檔案拖曳（文字、連結）完全不理會、不擋預設行為。`dragenter`/`dragleave` 用巢狀計數
 * （子元素間移動也會先觸發子元素的 `dragleave` 再觸發父層的 `dragenter`，單純
 * 用布林旗標會在中途誤判「已離開」）判斷真的離開時才關掉提示。
 */

import { selectSupportedImageFile } from './dropImport';

export interface DropImportInputOptions {
  /** 挑到支援的影像檔並讀成位元組後呼叫。 */
  onImport: (imageBytes: Uint8Array) => void;
  /** 正在拖著檔案經過 `target`（顯示／隱藏拖放提示用）。 */
  onDragActiveChange: (active: boolean) => void;
}

export class DropImportInput {
  private readonly target: HTMLElement;
  private readonly opts: DropImportInputOptions;
  private dragDepth = 0;

  constructor(target: HTMLElement, opts: DropImportInputOptions) {
    this.target = target;
    this.opts = opts;

    target.addEventListener('dragenter', this.onDragEnter);
    target.addEventListener('dragover', this.onDragOver);
    target.addEventListener('dragleave', this.onDragLeave);
    target.addEventListener('drop', this.onDrop);
  }

  destroy(): void {
    this.target.removeEventListener('dragenter', this.onDragEnter);
    this.target.removeEventListener('dragover', this.onDragOver);
    this.target.removeEventListener('dragleave', this.onDragLeave);
    this.target.removeEventListener('drop', this.onDrop);
  }

  /** 只有真的在拖檔案時才理會；`dragover` 要 `preventDefault` 瀏覽器才會觸發 `drop`。 */
  private isFileDrag(ev: DragEvent): boolean {
    return ev.dataTransfer != null && Array.from(ev.dataTransfer.types).includes('Files');
  }

  private onDragEnter = (ev: DragEvent): void => {
    if (!this.isFileDrag(ev)) return;
    ev.preventDefault();
    this.dragDepth++;
    this.opts.onDragActiveChange(true);
  };

  private onDragOver = (ev: DragEvent): void => {
    if (!this.isFileDrag(ev)) return;
    ev.preventDefault();
  };

  private onDragLeave = (ev: DragEvent): void => {
    if (!this.isFileDrag(ev)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.opts.onDragActiveChange(false);
  };

  private onDrop = (ev: DragEvent): void => {
    ev.preventDefault();
    this.dragDepth = 0;
    this.opts.onDragActiveChange(false);

    const files = ev.dataTransfer?.files;
    const file = selectSupportedImageFile(files);
    if (!file) {
      // 真的拖了檔案、只是格式不支援（webp/avif/bmp…）→ 主控台一行警告後略過
      // （issue #55 驗收條件：「畫面無變化、主控台一行警告、原本的果凍不受影響」）。
      // 純文字／連結拖曳沒有 files，不吭聲。
      if (files && files.length > 0) {
        console.warn(
          '[jelly] 拖進來的檔案不是支援的圖片格式（僅支援 PNG / JPEG / GIF），已略過',
        );
      }
      return;
    }
    file
      .arrayBuffer()
      .then((buf) => this.opts.onImport(new Uint8Array(buf)))
      .catch((err: unknown) => console.warn('[jelly] 讀取拖放檔案失敗，已略過', err));
  };
}
