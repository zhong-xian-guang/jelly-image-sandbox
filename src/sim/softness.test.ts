import { describe, expect, it } from 'vitest';

import { softnessToParams } from './softness';
import { DEFAULT_SIM_PARAMS } from './types';

describe('softnessToParams', () => {
  it('t = 0.5（滑桿中點）對應目前的 DEFAULT_SIM_PARAMS 手感基準', () => {
    const p = softnessToParams(0.5);
    expect(p.cellFrac).toBeCloseTo(DEFAULT_SIM_PARAMS.cellFrac, 9);
    expect(p.alphaSm).toBeCloseTo(DEFAULT_SIM_PARAMS.alphaSm, 9);
  });

  it('t = 0（很軟）與 t = 1（很硬）落在兩端，且硬比軟的 cellFrac／alphaSm 都大', () => {
    const soft = softnessToParams(0);
    const stiff = softnessToParams(1);
    expect(stiff.cellFrac).toBeGreaterThan(soft.cellFrac);
    expect(stiff.alphaSm).toBeGreaterThan(soft.alphaSm);
  });

  it('對 t 單調遞增', () => {
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map(softnessToParams);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.cellFrac).toBeGreaterThan(samples[i - 1]!.cellFrac);
      expect(samples[i]!.alphaSm).toBeGreaterThan(samples[i - 1]!.alphaSm);
    }
  });

  it('輸入超出 [0, 1] 會 clamp，不會外推出範圍', () => {
    const below = softnessToParams(-5);
    const above = softnessToParams(5);
    expect(below).toEqual(softnessToParams(0));
    expect(above).toEqual(softnessToParams(1));
  });
});
