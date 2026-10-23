import { describe, expect, it, vi } from 'vitest';
import { ToolParams } from './ToolParams';

describe('ToolParams（issue #160：工具參數的唯一擁有者）', () => {
  it('七個參數各有預設值', () => {
    const params = new ToolParams();
    expect(params.get('fanWidth')).toBe(150);
    expect(params.get('fanStrength')).toBe(4000);
    expect(params.get('fanFalloffExponent')).toBe(2);
    expect(params.get('fanFrequency')).toBe(2);
    expect(params.get('pinBrushRadius')).toBe(120);
    expect(params.get('spraySpacing')).toBe(36);
    expect(params.get('handfulRadius')).toBe(140);
  });

  it('step 依拉霸 step 增減、夾在範圍內，回傳並寫入新值', () => {
    const params = new ToolParams();
    expect(params.step('handfulRadius', 2)).toBe(160);
    expect(params.get('handfulRadius')).toBe(160);
    expect(params.step('handfulRadius', -1000)).toBe(20);
    expect(params.step('handfulRadius', 1000)).toBe(400);
    expect(params.step('spraySpacing', 1)).toBe(38);
    expect(params.step('spraySpacing', -1000)).toBe(12);
  });

  it('step 對齊拉霸格點、不累積浮點誤差（0.1 的 step）', () => {
    const params = new ToolParams();
    params.set('fanFalloffExponent', 0.2);
    let value = 0;
    for (let i = 0; i < 7; i++) value = params.step('fanFalloffExponent', 1);
    expect(value).toBe(0.9);
  });

  it('set 照原值寫入（拉霸本身已在範圍內，不另外夾值）', () => {
    const params = new ToolParams();
    params.set('spraySpacing', 0);
    expect(params.get('spraySpacing')).toBe(0);
  });

  it('每次寫入（set／step）都送出一次帶 key 與新值的變更通知', () => {
    const params = new ToolParams();
    const listener = vi.fn();
    const unsubscribe = params.subscribe(listener);
    params.set('fanWidth', 200);
    params.step('fanStrength', 1);
    params.step('handfulRadius', 1000);
    params.step('handfulRadius', 1); // 已在上限，值不變仍通知
    expect(listener.mock.calls).toEqual([
      ['fanWidth', 200],
      ['fanStrength', 4200],
      ['handfulRadius', 400],
      ['handfulRadius', 400],
    ]);
    unsubscribe();
    params.set('fanWidth', 100);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('range 回報該參數的拉霸範圍', () => {
    const params = new ToolParams();
    expect(params.range('spraySpacing')).toEqual({ min: 12, max: 120, step: 2 });
    expect(params.range('fanWidth')).toEqual({ min: 20, max: 280, step: 5 });
  });
});
