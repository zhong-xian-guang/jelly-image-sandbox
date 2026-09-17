/**
 * `scaleMeshToLongestEdge` 的單元測試（issue #88 / V3 T1-1）——只驗外部行為：
 * 最長邊縮到目標值（寬較長／高較長各一）、`restAreas` 乘 s²、`uv`／`indices`
 * 位元相同、不改動輸入、退化 bbox 回傳原樣、目標等於原尺寸時 positions 相等。
 * prior art：`buildSimMesh.test.ts` 的深度相等斷言。
 */

import { describe, expect, it } from 'vitest';

import { scaleMeshToLongestEdge } from './scaleMesh';
import type { SimMesh } from './types';

/** 一個手排的兩三角形矩形網格，bbox = `width × height`（原點左上）。 */
function rectMesh(width: number, height: number): SimMesh {
  return {
    positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    restAreas: new Float64Array([(width * height) / 2, (width * height) / 2]),
  };
}

function bbox(mesh: SimMesh): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 2) {
    const x = mesh.positions[i]!;
    const y = mesh.positions[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { width: maxX - minX, height: maxY - minY };
}

function cloneMesh(mesh: SimMesh): SimMesh {
  return {
    positions: mesh.positions.slice(),
    indices: mesh.indices.slice(),
    uv: mesh.uv.slice(),
    restAreas: mesh.restAreas.slice(),
  };
}

describe('scaleMeshToLongestEdge', () => {
  it('寬較長：縮放後 bbox 最長邊 = 目標，另一邊等比', () => {
    const out = scaleMeshToLongestEdge(rectMesh(200, 100), 512);
    expect(bbox(out).width).toBeCloseTo(512, 3);
    expect(bbox(out).height).toBeCloseTo(256, 3);
  });

  it('高較長：縮放後 bbox 最長邊 = 目標，另一邊等比', () => {
    const out = scaleMeshToLongestEdge(rectMesh(100, 400), 512);
    expect(bbox(out).height).toBeCloseTo(512, 3);
    expect(bbox(out).width).toBeCloseTo(128, 3);
  });

  it('縮小也對：2000px 寬的網格縮到 512', () => {
    const out = scaleMeshToLongestEdge(rectMesh(2000, 1000), 512);
    expect(bbox(out).width).toBeCloseTo(512, 3);
    expect(bbox(out).height).toBeCloseTo(256, 3);
  });

  it('restAreas 乘以縮放係數的平方', () => {
    const out = scaleMeshToLongestEdge(rectMesh(200, 100), 400); // s = 2
    expect(Array.from(out.restAreas)).toEqual([((200 * 100) / 2) * 4, ((200 * 100) / 2) * 4]);
  });

  it('uv 與 indices 位元相同（拓撲與貼圖對應不動）', () => {
    const input = rectMesh(200, 100);
    const out = scaleMeshToLongestEdge(input, 512);
    expect(Array.from(out.uv)).toEqual(Array.from(input.uv));
    expect(Array.from(out.indices)).toEqual(Array.from(input.indices));
  });

  it('不改動輸入（回傳的是新的 typed array）', () => {
    const input = rectMesh(200, 100);
    const before = cloneMesh(input);
    const out = scaleMeshToLongestEdge(input, 512);
    expect(input).toEqual(before);
    expect(out.positions).not.toBe(input.positions);
    expect(out.restAreas).not.toBe(input.restAreas);
  });

  it('退化 bbox（最長邊為 0）→ 回傳原樣', () => {
    const input: SimMesh = {
      positions: new Float32Array([5, 5, 5, 5, 5, 5]),
      indices: new Uint32Array([0, 1, 2]),
      uv: new Float32Array([0, 0, 0, 0, 0, 0]),
      restAreas: new Float64Array([0]),
    };
    const out = scaleMeshToLongestEdge(input, 512);
    expect(out).toEqual(input);
  });

  it('目標等於原尺寸 → positions 相等', () => {
    const input = rectMesh(200, 100);
    const out = scaleMeshToLongestEdge(input, 200);
    expect(Array.from(out.positions)).toEqual(Array.from(input.positions));
    expect(Array.from(out.restAreas)).toEqual(Array.from(input.restAreas));
  });

  it('以原點為錨：非零偏移的頂點也整體乘上係數（不置中）', () => {
    const input: SimMesh = {
      positions: new Float32Array([10, 20, 110, 20, 110, 70, 10, 70]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      uv: new Float32Array(8),
      restAreas: new Float64Array([2500, 2500]),
    };
    const out = scaleMeshToLongestEdge(input, 200); // 最長邊 100 → 200，s = 2
    expect(Array.from(out.positions)).toEqual([20, 40, 220, 40, 220, 140, 20, 140]);
  });
});
