import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isSupportedImageFile,
  readSelectedImageFile,
  selectSupportedImageFile,
} from './dropImport';
import { fakeFileList } from './testFixtures';

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

/** 一個夠用的 `File` 替身：先看 `type`／`name`，挑中後呼叫 `arrayBuffer()`。 */
function fakeImageFile(name: string, type: string, bytes: number[] = [1, 2, 3]): File {
  return {
    name,
    type,
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
  } as unknown as File;
}

describe('readSelectedImageFile（拖放與匯入按鈕共用尾段，issue #56）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('挑到支援的圖 → 讀成位元組後呼叫 onImport，不呼叫 onReject', async () => {
    const onImport = vi.fn();
    const onReject = vi.fn();

    readSelectedImageFile(fakeFileList([fakeImageFile('jelly.png', 'image/png', [9, 8, 7])]), {
      onImport,
      onReject,
    });
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));

    expect(onImport).toHaveBeenCalledWith(new Uint8Array([9, 8, 7]));
    expect(onReject).not.toHaveBeenCalled();
  });

  it('有選檔但格式全不支援 → console.warn 一行 + onReject 帶說明，不呼叫 onImport', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onImport = vi.fn();
    const onReject = vi.fn();

    readSelectedImageFile(fakeFileList([fakeImageFile('pic.webp', 'image/webp')]), {
      onImport,
      onReject,
    });

    expect(onImport).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/PNG \/ JPEG \/ GIF/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('沒有選到任何檔（拖非檔案 / 按取消）→ 靜默，不呼叫任何回呼、不 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onImport = vi.fn();
    const onReject = vi.fn();

    readSelectedImageFile(fakeFileList([]), { onImport, onReject });
    readSelectedImageFile(null, { onImport, onReject });
    readSelectedImageFile(undefined, { onImport, onReject });

    expect(onImport).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('讀檔失敗 → console.warn + onReject，不呼叫 onImport', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onImport = vi.fn();
    const onReject = vi.fn();
    const broken = {
      name: 'jelly.png',
      type: 'image/png',
      arrayBuffer: () => Promise.reject(new Error('boom')),
    } as unknown as File;

    readSelectedImageFile(fakeFileList([broken]), { onImport, onReject });
    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));

    expect(onImport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
