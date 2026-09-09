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

/**
 * 模擬瀏覽器選檔：`input.files` 是 live FileList，設 `input.value = ''`（依 HTML
 * 規範）會**就地清空同一個** FileList 物件。jsdom 不實作這個連動，這裡手動接上，
 * 好讓「先複製再清 value」的迴歸缺陷測得出來（就地清空，不是換一個新物件——
 * 換新物件的話還握著舊參照的程式碼就測不出來了）。派發 `change`。
 */
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

  it('選到支援的圖 → onImport 帶位元組（即使 onChange 內先清了 input.value）', async () => {
    // 迴歸：`onChange` 若先清 `input.value` 再讀 `files`，live FileList 已被清空，
    // 選好的圖沒反應。修法是先 `Array.from` 複製再清 value。
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
