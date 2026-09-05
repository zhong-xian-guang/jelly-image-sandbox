import { describe, expect, it } from 'vitest';

import { CameraGestures, DEFAULT_CAMERA_GESTURES_CONFIG } from './CameraGestures';
import type { CameraCommand } from './types';

function make(config?: Partial<typeof DEFAULT_CAMERA_GESTURES_CONFIG>) {
  const cmds: CameraCommand[] = [];
  const g = new CameraGestures({ emit: (c) => cmds.push(c), config });
  return { g, cmds };
}

const pans = (cmds: CameraCommand[]) => cmds.filter((c) => c.type === 'panBy');
const zooms = (cmds: CameraCommand[]) => cmds.filter((c) => c.type === 'zoomBy');

describe('CameraGestures — 滾輪縮放', () => {
  it('wheel → zoomBy，factor = exp(−deltaY·k)、pivot 在指標處', () => {
    const { g, cmds } = make();
    g.wheel(-100, 620, 130);
    expect(cmds).toHaveLength(1);
    const c = cmds[0]!;
    expect(c.type).toBe('zoomBy');
    if (c.type === 'zoomBy') {
      expect(c.factor).toBeCloseTo(
        Math.exp(100 * DEFAULT_CAMERA_GESTURES_CONFIG.wheelZoomPerPx),
        6,
      );
      expect(c.pivotScreen).toEqual({ x: 620, y: 130 });
    }
  });

  it('deltaY 正負對應縮小 / 放大，且 factor 夾在合理範圍', () => {
    const { g, cmds } = make();
    g.wheel(100000, 0, 0); // 極端往下 → 縮小，但不無限小
    g.wheel(-100000, 0, 0); // 極端往上 → 放大，但不無限大
    const [a, b] = zooms(cmds);
    expect(a!.type === 'zoomBy' && a!.factor).toBeGreaterThanOrEqual(0.2);
    expect(a!.type === 'zoomBy' && a!.factor).toBeLessThan(1);
    expect(b!.type === 'zoomBy' && b!.factor).toBeLessThanOrEqual(5);
    expect(b!.type === 'zoomBy' && b!.factor).toBeGreaterThan(1);
  });
});

describe('CameraGestures — 單一相機指標拖曳平移', () => {
  it('單一相機指標拖曳 → panBy（螢幕位移），不縮放', () => {
    const { g, cmds } = make();
    g.pointerDown(1, 100, 100, true);
    g.pointerMove(1, 130, 90);
    g.pointerMove(1, 140, 90);
    const p = pans(cmds);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ type: 'panBy', dxScreen: 30, dyScreen: -10 });
    expect(p[1]).toMatchObject({ type: 'panBy', dxScreen: 10, dyScreen: 0 });
    expect(zooms(cmds)).toHaveLength(0);
  });

  it('CameraInput 判定不該算相機（例如觸控命中 Jelly）的指標 → 不觸發相機', () => {
    const { g, cmds } = make();
    g.pointerDown(1, 100, 100, false);
    g.pointerMove(1, 200, 200);
    g.pointerUp(1);
    expect(cmds).toHaveLength(0);
  });

  it('放開後再 move → 無事', () => {
    const { g, cmds } = make();
    g.pointerDown(1, 0, 0, true);
    g.pointerUp(1);
    g.pointerMove(1, 50, 50);
    expect(cmds).toHaveLength(0);
  });
});

describe('CameraGestures — 雙指平移 + 縮放', () => {
  it('兩個相機指標一起平移 → 累積 panBy = 質心位移、淨縮放 ≈ 1', () => {
    const { g, cmds } = make();
    g.pointerDown(1, 0, 0, true);
    g.pointerDown(2, 100, 0, true);
    for (let i = 1; i <= 5; i++) {
      g.pointerMove(1, i * 4, 0);
      g.pointerMove(2, 100 + i * 4, 0);
    }
    const totalDx = pans(cmds).reduce((s, c) => s + (c.type === 'panBy' ? c.dxScreen : 0), 0);
    expect(totalDx).toBeCloseTo(20, 6); // 兩指各 +20 → 質心 +20
    const netZoom = zooms(cmds).reduce((p, c) => p * (c.type === 'zoomBy' ? c.factor : 1), 1);
    expect(netZoom).toBeCloseTo(1, 6); // 間距沒淨變化
  });

  it('兩指分開 → zoomBy factor > 1，pivot 在兩指質心', () => {
    const { g, cmds } = make();
    g.pointerDown(1, -50, 0, true);
    g.pointerDown(2, 50, 0, true);
    g.pointerMove(1, -100, 0); // 間距 100 → 200
    const z = zooms(cmds).at(-1)!;
    expect(z.type).toBe('zoomBy');
    if (z.type === 'zoomBy') {
      expect(z.factor).toBeGreaterThan(1);
      expect(z.pivotScreen.x).toBeCloseTo(-25, 6); // (−100 + 50) / 2
    }
  });

  it('第二指按下不產生跳動（基準重設）', () => {
    const { g, cmds } = make();
    g.pointerDown(1, 0, 0, true);
    g.pointerMove(1, 40, 40); // 單指拖曳
    cmds.length = 0;
    g.pointerDown(2, 200, 200, true); // 第二指落在很遠處
    expect(cmds).toHaveLength(0); // down 本身不 emit
    g.pointerMove(2, 200, 200); // 沒動
    expect(
      pans(cmds).every((c) => c.type === 'panBy' && c.dxScreen === 0 && c.dyScreen === 0),
    ).toBe(true);
  });
});
