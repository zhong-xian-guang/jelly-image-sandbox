/**
 * `src/app/` 測試共用的小 fixture。
 *
 * 不是產品程式碼；放在 `src/` 下是為了讓 `dropImport.test.ts` 與
 * `FileImportInput.test.ts` 共用同一份 `FileList` 替身（見 issue #56 code
 * review：避免兩個測試檔各自抄一份 `fakeFileList`）。
 */

/**
 * 造一個 `FileList` 形狀的物件（有索引 + `length`，但不保證可迭代）——貼近
 * `DataTransfer.files` 與 `<input type=file>.files`。內容型別放寬成 `unknown`，
 * 好讓測試塞只實作了 `type` / `name` / `arrayBuffer` 的 `File` 替身。
 */
export function fakeFileList(files: readonly unknown[]): FileList {
  const list: Record<number, unknown> & { length: number } = { length: files.length };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list as unknown as FileList;
}
