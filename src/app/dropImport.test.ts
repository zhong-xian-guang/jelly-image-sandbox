import { describe, expect, it } from 'vitest';

import { selectDroppedPng } from './dropImport';

/** 造一個假 `DataTransfer`——只需要 `selectDroppedPng` 用得到的 `files`。 */
function fakeDataTransfer(files: File[]): DataTransfer {
  return { files } as unknown as DataTransfer;
}

describe('selectDroppedPng', () => {
  it('挑出第一個 MIME type 為 image/png 的檔案', () => {
    const jpg = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const png = new File(['x'], 'jelly.png', { type: 'image/png' });

    expect(selectDroppedPng(fakeDataTransfer([jpg, png]))).toBe(png);
  });

  it('MIME type 缺失時退回看副檔名（部分瀏覽器/OS 對某些來源不填 type）', () => {
    const noMime = new File(['x'], 'jelly.PNG', { type: '' });

    expect(selectDroppedPng(fakeDataTransfer([noMime]))).toBe(noMime);
  });

  it('沒有 PNG（也沒有可辨識副檔名）→ 回傳 null，呼叫端據此忽略', () => {
    const jpg = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const txt = new File(['x'], 'notes.txt', { type: '' });

    expect(selectDroppedPng(fakeDataTransfer([jpg, txt]))).toBeNull();
  });

  it('空檔案清單 → null', () => {
    expect(selectDroppedPng(fakeDataTransfer([]))).toBeNull();
  });

  it('DataTransfer 本身缺失（null / undefined）→ null，不丟例外', () => {
    expect(selectDroppedPng(null)).toBeNull();
    expect(selectDroppedPng(undefined)).toBeNull();
  });
});
