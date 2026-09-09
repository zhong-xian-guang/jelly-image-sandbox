import { describe, expect, it } from 'vitest';

import { isSupportedImageFile, selectSupportedImageFile } from './dropImport';

/** 造一個 `FileList` 形狀的物件（有索引 + `length`，但不可迭代）——貼近 `DataTransfer.files`。 */
function fakeFileList(files: File[]): FileList {
  const list: Record<number, File> & { length: number } = { length: files.length };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list as unknown as FileList;
}

describe('selectSupportedImageFile', () => {
  it('挑出第一個 MIME type 為 image/png 的檔案', () => {
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const png = new File(['x'], 'jelly.png', { type: 'image/png' });

    expect(selectSupportedImageFile([txt, png])).toBe(png);
  });

  it('接受 jpeg 與 gif（issue #55）', () => {
    const jpg = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const gif = new File(['x'], 'anim.gif', { type: 'image/gif' });

    expect(selectSupportedImageFile([jpg])).toBe(jpg);
    expect(selectSupportedImageFile([gif])).toBe(gif);
  });

  it('挑第一個支援的：png 排在 jpg 後面也能各自被選中', () => {
    const jpg = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const png = new File(['x'], 'jelly.png', { type: 'image/png' });

    expect(selectSupportedImageFile([jpg, png])).toBe(jpg);
  });

  it('MIME type 缺失時退回看副檔名（.PNG / .JPG / .GIF，大小寫不拘）', () => {
    const png = new File(['x'], 'jelly.PNG', { type: '' });
    const jpg = new File(['x'], 'photo.JPG', { type: '' });
    const jpeg = new File(['x'], 'photo.jpeg', { type: '' });
    const gif = new File(['x'], 'anim.GIF', { type: '' });

    expect(selectSupportedImageFile([png])).toBe(png);
    expect(selectSupportedImageFile([jpg])).toBe(jpg);
    expect(selectSupportedImageFile([jpeg])).toBe(jpeg);
    expect(selectSupportedImageFile([gif])).toBe(gif);
  });

  it('不支援的格式（webp / bmp / 無副檔名）→ null，呼叫端據此忽略', () => {
    const webp = new File(['x'], 'pic.webp', { type: 'image/webp' });
    const bmp = new File(['x'], 'pic.bmp', { type: '' });
    const txt = new File(['x'], 'notes.txt', { type: '' });

    expect(selectSupportedImageFile([webp, bmp, txt])).toBeNull();
  });

  it('空清單 / null / undefined → null，不丟例外', () => {
    expect(selectSupportedImageFile([])).toBeNull();
    expect(selectSupportedImageFile(null)).toBeNull();
    expect(selectSupportedImageFile(undefined)).toBeNull();
  });

  it('吃 FileList 風格的 array-like 輸入（DataTransfer.files / input.files 同形）', () => {
    const png = new File(['x'], 'jelly.png', { type: 'image/png' });
    expect(selectSupportedImageFile(fakeFileList([png]))).toBe(png);
    expect(selectSupportedImageFile(fakeFileList([]))).toBeNull();
  });
});

describe('isSupportedImageFile', () => {
  it('MIME 命中就算數，忽略副檔名', () => {
    expect(isSupportedImageFile(new File(['x'], 'weird.name', { type: 'image/png' }))).toBe(true);
    expect(isSupportedImageFile(new File(['x'], 'photo.png', { type: 'image/webp' }))).toBe(false);
  });
});
