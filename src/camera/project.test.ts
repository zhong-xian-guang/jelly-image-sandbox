import { describe, expect, it } from 'vitest';

import { screenToWorld, worldToScreen } from './project';
import type { CameraTransform, CanvasSize } from './types';

const CANVAS: CanvasSize = { width: 800, height: 600 };

describe('worldToScreen', () => {
  it('camera 在原點、scale 1 → 世界原點落在畫布中心', () => {
    expect(worldToScreen({ x: 0, y: 0, scale: 1 }, CANVAS, 0, 0)).toEqual({ x: 400, y: 300 });
  });

  it('平移／縮放 camera → 依公式位移', () => {
    const t: CameraTransform = { x: 100, y: 50, scale: 2 };
    expect(worldToScreen(t, CANVAS, 100, 50)).toEqual({ x: 400, y: 300 }); // 焦點本身在中心
    expect(worldToScreen(t, CANVAS, 110, 50)).toEqual({ x: 420, y: 300 }); // +10 世界 → +20 螢幕
  });
});

describe('screenToWorld', () => {
  it('是 worldToScreen 的逆：畫布中心 ↔ camera 焦點', () => {
    const t: CameraTransform = { x: 30, y: -20, scale: 1.5 };
    const w = screenToWorld(t, CANVAS, 400, 300);
    expect(w.x).toBeCloseTo(t.x, 9);
    expect(w.y).toBeCloseTo(t.y, 9);
  });

  it('screenToWorld ∘ worldToScreen 往返還原', () => {
    const t: CameraTransform = { x: 12, y: 34, scale: 0.8 };
    const world = { x: 55, y: -18 };
    const screen = worldToScreen(t, CANVAS, world.x, world.y);
    const back = screenToWorld(t, CANVAS, screen.x, screen.y);
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });
});
