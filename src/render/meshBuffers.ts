/**
 * Renderer 的純資料層（issue #10 / T9）。把 `SimMesh` 的靜態拓撲（`uv`、`indices`）
 * 與每幀變動的頂點 `positions` 轉成 PixiJS `MeshGeometry` 需要的三個 typed array。
 * 無 DOM、無 WebGL——可 headless 測試。
 */

import type { SimMesh } from '../mesh';

/** PixiJS `MeshGeometry({ positions, uvs, indices })` 的 buffer 組。 */
export interface RenderBuffers {
  /** `[x0, y0, x1, y1, ...]`，世界座標，逐幀由 `writePositions` 覆寫。 */
  positions: Float32Array;
  /** `[u0, v0, ...]`，靜態，= `SimMesh.uv`。 */
  uvs: Float32Array;
  /** 三角形頂點索引，靜態，= `SimMesh.indices`。 */
  indices: Uint32Array;
}

/** Renderer 只需要 `SimMesh` 的這一部分——不碰 `positions` / `restAreas`。 */
export type RenderMesh = Pick<SimMesh, 'uv' | 'indices'>;

/**
 * 檢查拓撲自洽：`uv` 長度為偶數、`indices` 長度為 3 的倍數、每個索引都在頂點範圍內。
 * 不合法就丟——早失敗好過 GPU 上畫出破面。
 */
export function validateRenderMesh(mesh: RenderMesh): void {
  const { uv, indices } = mesh;
  if (uv.length % 2 !== 0) {
    throw new RangeError(`uv 長度 ${uv.length} 不是偶數`);
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError(`indices 長度 ${indices.length} 不是 3 的倍數`);
  }
  const vertexCount = uv.length / 2;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!;
    if (idx < 0 || idx >= vertexCount) {
      throw new RangeError(`indices[${i}] = ${idx} 超出頂點範圍 [0, ${vertexCount})`);
    }
  }
}

/**
 * 建立一組 `RenderBuffers`。`positions` 深拷貝成新的 `Float32Array`（Renderer 每幀
 * 就地覆寫它、再交給 GPU）；`uvs` / `indices` 也各自複製一份，與來源 `SimMesh` 脫鉤。
 */
export function createRenderBuffers(mesh: RenderMesh, positions: ArrayLike<number>): RenderBuffers {
  validateRenderMesh(mesh);
  const vertexCount = mesh.uv.length / 2;
  if (positions.length !== vertexCount * 2) {
    throw new RangeError(
      `positions 長度 ${positions.length} 與頂點數不符（預期 ${vertexCount * 2}）`,
    );
  }
  return {
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(mesh.uv),
    indices: Uint32Array.from(mesh.indices),
  };
}

/**
 * 把求解器的頂點座標（`Float64Array` 世界座標）就地寫進 render buffer（`Float32Array`）。
 * 長度不符就丟。回傳 `target` 方便串接。
 */
export function writePositions(target: Float32Array, positions: ArrayLike<number>): Float32Array {
  if (positions.length !== target.length) {
    throw new RangeError(
      `positions 長度 ${positions.length} 與 render buffer ${target.length} 不符`,
    );
  }
  target.set(positions);
  return target;
}

/**
 * PixiJS 容器變換：世界→螢幕為 `screen = (world − view) · scale + 畫布中心`。
 * 換算成 container 的 `position`（scale 直接用 `view.scale`）。T12 Camera 的輸出接這裡。
 */
export function containerPosition(
  view: { x: number; y: number; scale: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: width / 2 - view.x * view.scale,
    y: height / 2 - view.y * view.scale,
  };
}
