/**
 * Mesh pipeline 核心（T2 / GitHub issue #3）。
 *
 * `buildSimMesh(pngBytes, params)` 是純函式、決定性的：
 * 解碼 PNG → alpha 二值化 + 降採樣 → 取最大不透明連通元件 → 手刻 marching squares
 * 描輪廓 → Douglas–Peucker 簡化 → 有種子 PRNG 撒內部點 → `cdt2d` constrained
 * Delaunay → 粗 sliver 清理 → 指定 UV → 凍結拓撲。
 *
 * 整條管線不碰 `Math.random` 或 wall-clock。禁用 Shewchuk Triangle／JIGSAW／
 * CGAL Mesh_2／MarchingSquaresJS（授權不相容，見 ADR-0002 / ADR-0005）。
 * Ruppert 品質細化不在此票範圍（見 issue #4）。
 */

import simplify from 'simplify-js';

import { toDownsampledMask } from './alphaMask';
import { largestOpaqueComponent } from './components';
import { decodePngAlpha } from './decodeImage';
import { signedPolygonArea, triangleSignedArea, triVerts } from './geometry';
import { traceContours } from './marchingSquares';
import { deriveSeed, mulberry32 } from './prng';
import { removeSlivers } from './slivers';
import { scatterInteriorPoints } from './steiner';
import { triangulate, type MeshBuffers } from './triangulate';
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

  const raw = triangulate(rings, interior);
  const clean = removeSlivers(raw, p.minTriangleArea, p.minTriangleAngleDeg);
  if (clean.indices.length === 0) throw new MeshPipelineError('三角化後沒有有效三角形');

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
