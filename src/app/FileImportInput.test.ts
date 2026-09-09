/**
 * `FileImportInput`（issue #56 / V2 T2-3）的 DOM 測試——薄接線層：隱藏
 * `<input type=file>` → `selectSupportedImageFile` → 讀位元組 → `onImport`／`onReject`。
 * jsdom 下 `<input type=file>.files` 唯讀，用 `Object.defineProperty` 灌假的 `FileList`。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileImportInput } from './FileImportInput';

/** 造一個 `FileList` 形狀的物件（索引 + `length`）——貼近 `input.files`。 */
function fakeFileList(files: unknown[]): FileList {
  const list: Record<number, unknown> & { length: number } = { length: files.length };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list as unknown as FileList;
}

/** 一個夠用的 `File` 替身：`selectSupportedImageFile` 看 `type`／`name`，之後呼叫 `arrayBuffer()`。 */
function fakeFile(name: string, type: string, bytes: number[] = [1, 2, 3]): File {
  return {
    name,
    type,
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
  } as unknown as File;
}

/** 取出 `FileImportInput` 掛在 `document.body` 上的那個隱藏 input。 */
function hiddenInput(): HTMLInputElement {
  const el = document.body.querySelector('input[type=file]');
  if (!el) throw new Error('找不到隱藏的 file input');
  return el as HTMLInputElement;
}

/** 設 `input.files` 後派發 `change`（jsdom 不會因為賦值 `.files` 自動派發）。 */
function chooseFiles(input: HTMLInputElement, files: unknown[]): void {
  Object.defineProperty(input, 'files', { value: fakeFileList(files), configurable: true });
  input.dispatchEvent(new Event('change'));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FileImportInput', () => {
  it('open() 觸發隱藏 input 的原生檔案選擇器', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const fi = new FileImportInput(document, { onImport: vi.fn() });

    fi.open();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('隱藏 input 的 accept 只列 png / jpg / gif', () => {
    new FileImportInput(document, { onImport: vi.fn() });
    const accept = hiddenInput().accept;

    expect(accept).toContain('image/png');
    expect(accept).toContain('image/jpeg');
    expect(accept).toContain('image/gif');
    expect(accept).not.toContain('webp');
  });

  it('選到支援的圖 → 讀成位元組後呼叫 onImport，不呼叫 onReject', async () => {
    const onImport = vi.fn();
    const onReject = vi.fn();
    new FileImportInput(document, { onImport, onReject });

    chooseFiles(hiddenInput(), [fakeFile('jelly.png', 'image/png', [9, 8, 7])]);
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));

    expect(onImport).toHaveBeenCalledWith(new Uint8Array([9, 8, 7]));
    expect(onReject).not.toHaveBeenCalled();
  });

  it('選到不支援的格式 → onReject 帶說明、不呼叫 onImport、主控台一行警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onImport = vi.fn();
    const onReject = vi.fn();
    new FileImportInput(document, { onImport, onReject });

    chooseFiles(hiddenInput(), [fakeFile('pic.webp', 'image/webp')]);

    expect(onImport).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(expect.stringMatching(/PNG \/ JPEG \/ GIF/));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('按取消（沒有選到檔）→ 安靜略過，不呼叫任何回呼', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onImport = vi.fn();
    const onReject = vi.fn();
    new FileImportInput(document, { onImport, onReject });

    chooseFiles(hiddenInput(), []);

    expect(onImport).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('change 後清空 input.value，讓連續選同一個檔都能再觸發', () => {
    new FileImportInput(document, { onImport: vi.fn() });
    const input = hiddenInput();

    chooseFiles(input, [fakeFile('jelly.png', 'image/png')]);

    expect(input.value).toBe('');
  });

  it('destroy() 把隱藏 input 從文件移除', () => {
    const fi = new FileImportInput(document, { onImport: vi.fn() });
    expect(document.body.querySelector('input[type=file]')).not.toBeNull();

    fi.destroy();

    expect(document.body.querySelector('input[type=file]')).toBeNull();
  });
});
