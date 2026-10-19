import { describe, expect, it } from 'vitest';

import { FAN_ICON_STYLE_STORAGE_KEY, loadFanIconStyle, saveFanIconStyle } from './fanIconStyle';
import type { KeyValueStorage } from './panelLayout';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
};

describe('fanIconStyle', () => {
  it('沒存過、沒有 storage 或 storage 丟錯時預設是向量圖示', () => {
    expect(loadFanIconStyle(memoryStorage())).toBe('vector');
    expect(loadFanIconStyle(null)).toBe('vector');
    expect(loadFanIconStyle(throwing)).toBe('vector');
  });

  it('存了照片，下次讀回照片', () => {
    const storage = memoryStorage();
    saveFanIconStyle(storage, 'photo');
    expect(storage.data.get(FAN_ICON_STYLE_STORAGE_KEY)).toBe('photo');
    expect(loadFanIconStyle(storage)).toBe('photo');
    saveFanIconStyle(storage, 'vector');
    expect(loadFanIconStyle(storage)).toBe('vector');
  });

  it('存的值不認得就退回向量', () => {
    const storage = memoryStorage();
    storage.data.set(FAN_ICON_STYLE_STORAGE_KEY, 'sprite');
    expect(loadFanIconStyle(storage)).toBe('vector');
  });

  it('存不進去不會丟錯', () => {
    expect(() => saveFanIconStyle(throwing, 'photo')).not.toThrow();
    expect(() => saveFanIconStyle(null, 'photo')).not.toThrow();
  });
});
