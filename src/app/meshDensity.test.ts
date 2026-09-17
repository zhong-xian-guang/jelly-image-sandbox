import { describe, expect, it } from 'vitest';

import { DEFAULT_PARAMS } from '../mesh';

import { DEFAULT_MESH_DENSITY, MESH_DENSITY_RANGE, halveMeshDensity } from './meshDensity';

describe('meshDensity — 「網格密度」拉霸的範圍與效能退路砍半（issue #89 / V3 T1-2）', () => {
  it('範圍 100–800、步進 10；預設值 = DEFAULT_PARAMS.targetParticleCount（350）', () => {
    expect(MESH_DENSITY_RANGE).toEqual({ min: 100, max: 800, step: 10 });
    expect(DEFAULT_MESH_DENSITY).toBe(350);
    expect(DEFAULT_MESH_DENSITY).toBe(DEFAULT_PARAMS.targetParticleCount);
  });

  it('砍半並對齊步進：350 → 170（175 向下對齊到 10 的倍數）', () => {
    expect(halveMeshDensity(350, MESH_DENSITY_RANGE)).toBe(170);
  });

  it('已是步進倍數的一半直接回傳：800 → 400', () => {
    expect(halveMeshDensity(800, MESH_DENSITY_RANGE)).toBe(400);
  });

  it('砍半低於下限時夾到下限：170 → 100（85 → 80 < 100）', () => {
    expect(halveMeshDensity(170, MESH_DENSITY_RANGE)).toBe(100);
  });

  it('連續多次砍半停在下限，不會低於 100', () => {
    let v = 350;
    for (let i = 0; i < 5; i++) v = halveMeshDensity(v, MESH_DENSITY_RANGE);
    expect(v).toBe(100);
    expect(halveMeshDensity(100, MESH_DENSITY_RANGE)).toBe(100);
  });

  it('對齊以下限為基準（下限不是步進倍數時也對齊到 min + k·step）', () => {
    expect(halveMeshDensity(95, { min: 25, max: 200, step: 10 })).toBe(45); // 47.5 → 45
  });
});
