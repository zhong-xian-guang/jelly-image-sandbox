import { describe, expect, it } from 'vitest';

import { FAN_PHOTO_GUARD, FanOverlay, type FanOverlayState } from './FanOverlay';

const HIDDEN = 'jelly-fan-overlay-part-hidden';

function state(angleRad: number, radiusPx = 100): FanOverlayState {
  return {
    corners: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    icon: { x: 50, y: 60, angleRad, radiusPx },
  };
}

function parts(overlay: FanOverlay): { vector: Element; photo: Element; image: Element } {
  const vector = overlay.element.querySelector('.jelly-fan-overlay-icon')!;
  const photo = overlay.element.querySelector('.jelly-fan-overlay-photo')!;
  const image = photo.querySelector('image')!;
  return { vector, photo, image };
}

describe('FanOverlay 圖示外觀（issue #143）', () => {
  it('預設是向量圖示，照片藏起來', () => {
    const { vector, photo } = parts(new FanOverlay());
    expect(vector.classList.contains(HIDDEN)).toBe(false);
    expect(photo.classList.contains(HIDDEN)).toBe(true);
  });

  it('切成照片：照片出現、向量藏起來；切回來相反', () => {
    const overlay = new FanOverlay();
    const { vector, photo, image } = parts(overlay);
    overlay.setIconStyle('photo');
    expect(vector.classList.contains(HIDDEN)).toBe(true);
    expect(photo.classList.contains(HIDDEN)).toBe(false);
    expect(image.getAttribute('href')).toBeTruthy();
    overlay.setIconStyle('vector');
    expect(vector.classList.contains(HIDDEN)).toBe(false);
    expect(photo.classList.contains(HIDDEN)).toBe(true);
  });

  it('「顯示風扇圖示」關掉時兩種外觀都藏，切外觀也不會讓它跑出來', () => {
    const overlay = new FanOverlay();
    const { vector, photo } = parts(overlay);
    overlay.setShowIcon(false);
    overlay.setIconStyle('photo');
    expect(vector.classList.contains(HIDDEN)).toBe(true);
    expect(photo.classList.contains(HIDDEN)).toBe(true);
    overlay.setShowIcon(true);
    expect(photo.classList.contains(HIDDEN)).toBe(false);
    expect(vector.classList.contains(HIDDEN)).toBe(true);
  });

  it('照片往右吹（含正上／正下）照轉，往左吹多一個上下翻轉＝畫面上水平翻轉', () => {
    const overlay = new FanOverlay();
    const { photo } = parts(overlay);
    for (const angle of [0, 0.5, -0.5, Math.PI / 2, -Math.PI / 2]) {
      overlay.update(state(angle));
      expect(photo.getAttribute('transform')).not.toContain('scale');
    }
    for (const angle of [Math.PI, 2.5, -2.5]) {
      overlay.update(state(angle));
      expect(photo.getAttribute('transform')).toContain('scale(1 -1)');
    }
  });

  it('向量圖示維持原本的整組旋轉，往左吹也不翻轉', () => {
    const overlay = new FanOverlay();
    overlay.update(state(Math.PI));
    expect(parts(overlay).vector.getAttribute('transform')).toBe('translate(50 60) rotate(180)');
  });

  it('照片的網罩中心對齊圖示錨點、網罩縱向半徑＝radiusPx', () => {
    const overlay = new FanOverlay();
    const { image } = parts(overlay);
    for (const r of [100, 37]) {
      overlay.update(state(0, r));
      const x = Number(image.getAttribute('x'));
      const y = Number(image.getAttribute('y'));
      const w = Number(image.getAttribute('width'));
      const h = Number(image.getAttribute('height'));
      expect(x + w * FAN_PHOTO_GUARD.centerX).toBeCloseTo(0);
      expect(y + h * FAN_PHOTO_GUARD.centerY).toBeCloseTo(0);
      expect(h * FAN_PHOTO_GUARD.radius).toBeCloseTo(r);
      expect(w / h).toBeCloseTo(FAN_PHOTO_GUARD.aspect);
    }
  });
});
