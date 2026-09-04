import { describe, expect, it } from 'vitest';

import { deriveSeed, fnv1a32, mulberry32 } from './prng';
import type { BuildSimMeshParams } from './types';

describe('mulberry32', () => {
  it('同一種子產生同一串數列', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('不同種子產生不同數列', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('輸出落在 [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fnv1a32', () => {
  it('決定性', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(fnv1a32(bytes)).toBe(fnv1a32(bytes));
  });

  it('對輸入變化敏感', () => {
    expect(fnv1a32(new Uint8Array([1, 2, 3]))).not.toBe(fnv1a32(new Uint8Array([1, 2, 4])));
  });

  it('可串接（seed 參數）', () => {
    const first = fnv1a32(new Uint8Array([1, 2]));
    const chained = fnv1a32(new Uint8Array([3, 4]), first);
    const oneShot = fnv1a32(new Uint8Array([1, 2, 3, 4]));
    expect(chained).toBe(oneShot);
  });
});

describe('deriveSeed', () => {
  const params: BuildSimMeshParams = {
    maxMaskEdge: 1024,
    alphaThreshold: 0.5,
    simplifyTolerance: 1.5,
    targetParticleCount: 350,
    minTriangleArea: 0.5,
    minTriangleAngleDeg: 15,
  };

  it('mask 或參數任一改變，種子就變', () => {
    const mask = new Uint8Array([0, 1, 1, 0, 1]);
    const base = deriveSeed(mask, params);
    expect(deriveSeed(mask, params)).toBe(base);
    expect(deriveSeed(new Uint8Array([0, 1, 1, 0, 0]), params)).not.toBe(base);
    expect(deriveSeed(mask, { ...params, targetParticleCount: 351 })).not.toBe(base);
  });

  it('與呼叫端物件的鍵序無關', () => {
    const mask = new Uint8Array([2, 3, 5, 7]);
    const reordered: BuildSimMeshParams = {
      minTriangleAngleDeg: 15,
      targetParticleCount: 350,
      alphaThreshold: 0.5,
      simplifyTolerance: 1.5,
      maxMaskEdge: 1024,
      minTriangleArea: 0.5,
    };
    expect(deriveSeed(mask, reordered)).toBe(deriveSeed(mask, params));
  });
});
