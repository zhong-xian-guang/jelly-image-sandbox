/**
 * Mesh pipeline 的共用錯誤型別。獨立成一個小模組，讓 `decodeImage` 與 `buildSimMesh`
 * 都能引用而不互相 import（`buildSimMesh` → `decodeImage` 的相依是單向的）。
 */

export class MeshPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshPipelineError';
  }
}
