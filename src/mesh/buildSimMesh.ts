/**
 * Mesh pipeline 核心（T2 / GitHub issue #3）。
 *
 * `buildSimMesh(pngBytes, params)` 是純函式、決定性的：
 * 解碼 PNG → alpha 二值化 + 降採樣 → 取最大不透明連通元件 → 手刻 marching squares
 * 描輪廓 → Douglas–Peucker 簡化 → 有種子 PRNG 撒內部點 → `cdt2d` constrained
 * Delaunay → 自寫 Ruppert 品質細化 → 粗 sliver 清理 → 指定 UV → 凍結拓撲。
 *
 * 整條管線不碰 `Math.random` 或 wall-clock。禁用 Shewchuk Triangle／JIGSAW／
 * CGAL Mesh_2／MarchingSquaresJS（授權不相容，見 ADR-0002 / ADR-0005）。
 * Ruppert 細化見 `refine.ts`（issue #4）。
 */

import simplify from 'simplify-js';

import { toDownsampledMask } from './alphaMask';
import { largestOpaqueComponent } from './components';
import { decodePngAlpha } from './decodeImage';
import { countBadTriangles, signedPolygonArea, triangleSignedArea, triVerts } from './geometry';
import { traceContours } from './marchingSquares';
import { deriveSeed, mulberry32 } from './prng';
import { refineRuppert } from './refine';
import { removeSlivers } from './slivers';
import { interiorSpacing, scatterInteriorPoints } from './steiner';
import { triangulate, type MeshBuffers, type RawMesh } from './triangulate';
import { DEFAULT_PARAMS, type BuildSimMeshParams, type Point, type SimMesh } from './types';

export class MeshPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshPipelineError';
  }
}

export function buildSimMesh(
  pngBytes: Uint8Array | ArrayBuffer,
  params: Partial<BuildSimMeshParams> = {},
): SimMesh {
  const p: BuildSimMeshParams = { ...DEFAULT_PARAMS, ...params };

  const { width: imgW, height: imgH, alpha } = decodePngAlpha(pngBytes);
  const mask = toDownsampledMask(alpha, imgW, imgH, p.maxMaskEdge, p.alphaThreshold);

  const { mask: solid, count } = largestOpaqueComponent(mask);
  if (count === 0) throw new MeshPipelineError('影像沒有任何不透明像素');

  const rawRings = traceContours(solid.data, solid.width, solid.height);
  if (rawRings.length === 0) throw new MeshPipelineError('描不出輪廓');

  const rings = simplifyRings(rawRings, p.simplifyTolerance, p.targetParticleCount);
  if (rings.length === 0) throw new MeshPipelineError('輪廓簡化後不成環');
  // 外環 = 面積最大者，排到第一個（scatterInteriorPoints 用它抓 bbox）。
  rings.sort((a, b) => Math.abs(signedPolygonArea(b)) - Math.abs(signedPolygonArea(a)));

  // 種子 = hash(降採樣 alpha mask 位元組 + 網格參數)，見 ADR-0005。
  const rand = mulberry32(deriveSeed(mask.data, p));
  const interior = scatterInteriorPoints(rings, p.targetParticleCount, rand);

  const spacing = interiorSpacing(rings, p.targetParticleCount);
  const refineMaxArea =
    p.refineMinAngleDeg > 0 ? p.refineMaxAreaFactor * spacing * spacing : Infinity;
  const raw = triangulateAndRefine(rings, interior, p, refineMaxArea);
  const clean = removeSlivers(raw, p.minTriangleArea, p.minTriangleAngleDeg);
  if (clean.indices.length === 0) throw new MeshPipelineError('三角化後沒有有效三角形');

  // 記錄（見 issue #4 驗收條件：少數貼著 constrained segment 的例外允許並記錄）：
  // Ruppert + sliver 清理後仍未達品質門檻的三角形。
  if (p.refineMinAngleDeg > 0) {
    const residual = countBadTriangles(
      clean.positions,
      clean.indices,
      p.refineMinAngleDeg,
      refineMaxArea,
    );
    if (residual > 0) {
      console.warn(
        `buildSimMesh: 細化後仍有 ${residual} 個三角形未達品質門檻` +
          `（最小角 ${p.refineMinAngleDeg}° / 最大面積 ${refineMaxArea.toFixed(1)}）——貼著剪影邊緣的例外`,
      );
    }
  }

  const positions = new Float32Array(clean.positions);
  const indices = new Uint32Array(clean.indices);
  // UV = 頂點在原圖的正規化座標。solid 是原圖等比例降採樣，故除以其尺寸即可。
  const uv = normalizedUv(clean.positions, solid.width, solid.height);
  const restAreas = triangleRestAreas(clean);

  return { positions, indices, uv, restAreas };
}

/**
 * 逐環 Douglas–Peucker 簡化（順便用容差收掉共線點）。若簡化後輪廓頂點數已超過
 * 目標 Particle 數，逐步放大容差再簡化，讓 Particle 預算對高細節剪影仍有意義。
 */
function simplifyRings(
  rawRings: readonly Point[][],
  baseTolerance: number,
  targetParticleCount: number,
): Point[][] {
  let tolerance = baseTolerance;
  let rings: Point[][] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    rings = [];
    for (const ring of rawRings) {
      const s = simplify(ring, tolerance, true);
      if (s.length >= 3) rings.push(s);
    }
    const contourVerts = rings.reduce((sum, r) => sum + r.length, 0);
    if (contourVerts <= targetParticleCount || rings.length === 0) break;
    tolerance *= 1.6;
  }
  return rings;
}

/**
 * CDT，接著（`refineMinAngleDeg > 0` 時）Ruppert 品質細化。`refineMinAngleDeg <= 0`
 * 走裸 CDT，讓呼叫端能關掉細化做對照。細化的頂點數封頂在目標數的 4 倍，避免尖銳
 * 輸入角誘發的補點連鎖失控（殘餘壞三角形交給後面的 sliver 清理，見 issue #4）。
 */
function triangulateAndRefine(
  rings: readonly Point[][],
  interior: readonly Point[],
  p: BuildSimMeshParams,
  refineMaxArea: number,
): RawMesh {
  if (p.refineMinAngleDeg <= 0) return triangulate(rings, interior);
  return refineRuppert(rings, interior, {
    minAngleDeg: p.refineMinAngleDeg,
    maxArea: refineMaxArea,
    maxPasses: p.refineMaxPasses,
    maxVertices: p.targetParticleCount * 4,
  });
}

function normalizedUv(positions: readonly number[], width: number, height: number): Float32Array {
  const uv = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 2) {
    uv[i] = positions[i]! / width;
    uv[i + 1] = positions[i + 1]! / height;
  }
  return uv;
}

function triangleRestAreas(mesh: MeshBuffers): Float64Array {
  const triCount = mesh.indices.length / 3;
  const restAreas = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    restAreas[t] = triangleSignedArea(...triVerts(mesh.positions, mesh.indices, t));
  }
  return restAreas;
}
