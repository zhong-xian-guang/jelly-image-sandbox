/**
 * `FileImportInput`（issue #56 / V2 T2-3）的 DOM 測試——薄接線層：隱藏
 * `<input type=file>` → `readSelectedImageFile` → `onImport`／`onReject`。
 * 挑檔／拒絕／讀位元組的行為在 `dropImport.test.ts`（`readSelectedImageFile`）
 * 已涵蓋；這裡只驗 DOM 接線（開選擇器、accept、`change` 轉呼叫、value 重置、
 * destroy）。jsdom 下 `<input type=file>.files` 唯讀，用 `Object.defineProperty` 灌。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileImportInput } from './FileImportInput';
import { fakeFileList } from './testFixtures';

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

  it('隱藏 input 的 accept 恰為 image/png,image/jpeg,image/gif', () => {
    new FileImportInput(document, { onImport: vi.fn() });

    expect(hiddenInput().accept).toBe('image/png,image/jpeg,image/gif');
  });

  it('選到支援的圖 → change 轉呼叫 readSelectedImageFile，最終 onImport 帶位元組', async () => {
    const onImport = vi.fn();
    new FileImportInput(document, { onImport });

    chooseFiles(hiddenInput(), [fakeFile('jelly.png', 'image/png', [9, 8, 7])]);
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith(new Uint8Array([9, 8, 7])));
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
