/**
 * `ClipFileInput`（issue #58 / V2 T2-5）的 DOM 測試——薄接線層：隱藏
 * `<input type=file>`（`HiddenFileInput`）→ 讀第一個選到檔的文字 → `onLoad`／
 * `onReject`。格式／版本／欄位驗證是呼叫端 `parseClipFile` 的事，不在此測
 * （見 `clipFile.test.ts`）。`fakeFileList`／live-FileList 清空模擬同
 * `FileImportInput.test.ts`。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClipFileInput } from './ClipFileInput';
import { fakeFileList } from './testFixtures';

/** 一個夠用的 `File` 替身：`ClipFileInput` 只呼叫 `.text()`。 */
function fakeFile(name: string, text: string | (() => Promise<string>)): File {
  return {
    name,
    text: typeof text === 'function' ? text : () => Promise.resolve(text),
  } as unknown as File;
}

/** 取出 `ClipFileInput` 掛在 `document.body` 上的那個隱藏 input。 */
function hiddenInput(): HTMLInputElement {
  const el = document.body.querySelector('input[type=file]');
  if (!el) throw new Error('找不到隱藏的 file input');
  return el as HTMLInputElement;
}

/** 同 `FileImportInput.test.ts`：模擬 live FileList 被 `value = ''` 就地清空。 */
function chooseFiles(input: HTMLInputElement, files: unknown[]): void {
  const listObj = fakeFileList(files) as unknown as Record<number, unknown> & { length: number };
  Object.defineProperty(input, 'files', { configurable: true, get: () => listObj });
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => (listObj.length > 0 ? `C:\\fakepath\\${(listObj[0] as File).name}` : ''),
    set: (v: string) => {
      if (v !== '') return;
      for (let i = 0; i < listObj.length; i++) delete listObj[i];
      listObj.length = 0;
    },
  });
  input.dispatchEvent(new Event('change'));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ClipFileInput', () => {
  it('open() 觸發隱藏 input 的原生檔案選擇器', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const cfi = new ClipFileInput(document, { onLoad: vi.fn() });

    cfi.open();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('隱藏 input 的 accept 恰為 application/json,.json', () => {
    new ClipFileInput(document, { onLoad: vi.fn() });

    expect(hiddenInput().accept).toBe('application/json,.json');
  });

  it('選到檔 → onLoad 帶讀出的文字（即使 onChange 內先清了 input.value）', async () => {
    const onLoad = vi.fn();
    new ClipFileInput(document, { onLoad });

    chooseFiles(hiddenInput(), [fakeFile('clip.json', '{"version":1}')]);
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith('{"version":1}'));
  });

  it('change 後清空 input.value，讓連續選同一個檔都能再觸發', () => {
    new ClipFileInput(document, { onLoad: vi.fn() });
    const input = hiddenInput();

    chooseFiles(input, [fakeFile('clip.json', '{}')]);

    expect(input.value).toBe('');
  });

  it('沒有選到任何檔（按取消）→ 不呼叫 onLoad／onReject', () => {
    const onLoad = vi.fn();
    const onReject = vi.fn();
    new ClipFileInput(document, { onLoad, onReject });

    chooseFiles(hiddenInput(), []);

    expect(onLoad).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it('讀檔失敗 → onReject 帶說明，不呼叫 onLoad', async () => {
    const onLoad = vi.fn();
    const onReject = vi.fn();
    new ClipFileInput(document, { onLoad, onReject });

    chooseFiles(hiddenInput(), [fakeFile('clip.json', () => Promise.reject(new Error('boom')))]);

    await vi.waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('destroy() 把隱藏 input 從文件移除', () => {
    const cfi = new ClipFileInput(document, { onLoad: vi.fn() });
    expect(document.body.querySelector('input[type=file]')).not.toBeNull();

    cfi.destroy();

    expect(document.body.querySelector('input[type=file]')).toBeNull();
  });
});
