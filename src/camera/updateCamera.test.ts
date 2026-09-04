import { describe, expect, it } from 'vitest';

import {
  createCameraState,
  DEFAULT_CAMERA_FOLLOW_CONFIG,
  fitTransform,
  updateCamera,
} from './updateCamera';
import type { CameraCommand, CameraState, CameraTarget, CanvasSize } from './types';

const CANVAS: CanvasSize = { width: 800, height: 600 };
const CFG = DEFAULT_CAMERA_FOLLOW_CONFIG;

/** Jelly 靜止在原點附近的目標（bbox 200×200、質心在原點）。 */
function targetAt(cx: number, cy: number, half = 100): CameraTarget {
  return {
    centroid: { x: cx, y: cy },
    bbox: { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half },
  };
}

/** 跑 `seconds` 秒模擬幀（60Hz），每幀可帶指令（預設無）。 */
function run(
  state: CameraState,
  target: CameraTarget,
  seconds: number,
  commandsForFrame: (frame: number) => CameraCommand[] = () => [],
): CameraState {
  const dt = 1 / 60;
  let s = state;
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) {
    s = updateCamera(s, target, CANVAS, commandsForFrame(f), dt);
  }
  return s;
}

describe('fitTransform', () => {
  it('置中 bbox、縮放到含邊距塞進畫布', () => {
    const t = fitTransform(targetAt(0, 0).bbox, CANVAS);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    // 200px 寬的 bbox、畫布 600 高 800 寬減 80 邊距 → 高度較緊：520 / 200 = 2.6
    expect(t.scale).toBeCloseTo((600 - 80) / 200, 6);
  });

  it('scale 夾在 [minScale, maxScale]', () => {
    const huge = fitTransform({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }, CANVAS);
    expect(huge.scale).toBe(CFG.minScale);
    const tiny = fitTransform({ minX: -0.001, minY: -0.001, maxX: 0.001, maxY: 0.001 }, CANVAS);
    expect(tiny.scale).toBe(CFG.maxScale);
  });
});

describe('createCameraState', () => {
  it('回傳已 fit、跟隨開、未暫停、未框住的狀態', () => {
    const s = createCameraState(targetAt(0, 0), CANVAS);
    expect(s.transform).toEqual(fitTransform(targetAt(0, 0).bbox, CANVAS));
    expect(s.followEnabled).toBe(true);
    expect(s.framing).toBe(false);
    expect(s.sinceManualSeconds).toBe(CFG.resumeDelaySeconds);
  });
});

describe('updateCamera — 自動跟隨', () => {
  it('Jelly 平移 → 相機平移分量單調朝質心收斂、不過衝（AC1）', () => {
    const start = createCameraState(targetAt(0, 0), CANVAS);
    const target = targetAt(300, 0);
    let s = start;
    let prevX = s.transform.x;
    for (let f = 0; f < 60; f++) {
      s = updateCamera(s, target, CANVAS, [], 1 / 60);
      expect(s.transform.x).toBeGreaterThan(prevX); // 單調靠近
      expect(s.transform.x).toBeLessThanOrEqual(300); // 不過衝
      prevX = s.transform.x;
    }
    // ~1s 後已非常接近
    expect(s.transform.x).toBeGreaterThan(280);
  });

  it('用力甩遠（無限模式）→ 幾秒內追上，Jelly 不消失（AC2）', () => {
    const s0 = createCameraState(targetAt(0, 0), CANVAS);
    const far = targetAt(5000, -3000);
    const s = run(s0, far, 3);
    expect(s.transform.x).toBeCloseTo(5000, -1); // 個位數誤差內
    expect(s.transform.y).toBeCloseTo(-3000, -1);
  });

  it('質心不動時相機停在 fit 上（靜置不漂移）', () => {
    const target = targetAt(0, 0);
    const s = run(createCameraState(target, CANVAS), target, 2);
    expect(s.transform).toEqual(fitTransform(target.bbox, CANVAS));
  });

  it('質心突然跳很遠：跟隨落後也保證下一幀就頂住硬上限，不會整幀跑出畫面（AC1/AC2）', () => {
    const s0 = createCameraState(targetAt(0, 0), CANVAS);
    const far = targetAt(20000, 0); // 遠超一幀 ease 追得上的距離
    const s = updateCamera(s0, far, CANVAS, [], 1 / 60);
    const offXPx = Math.abs(far.centroid.x - s.transform.x) * s.transform.scale;
    expect(offXPx).toBeLessThanOrEqual(CANVAS.width * CFG.keepInFrameFrac + 1e-6);
  });
});

describe('updateCamera — 手動輸入暫停 / 回歸（AC3）', () => {
  it('手動平移後自動跟隨暫停；閒置約 2s 後回歸', () => {
    const target = targetAt(0, 0);
    let s = createCameraState(target, CANVAS);

    // 第 0 幀手動平移，之後 Jelly 開始移動
    const moving = targetAt(400, 0);
    s = updateCamera(s, moving, CANVAS, [{ type: 'panBy', dxScreen: 100, dyScreen: 0 }], 1 / 60);
    const afterPanX = s.transform.x;
    // panBy 把閒置時鐘歸零；同幀只前進一個 dt
    expect(s.sinceManualSeconds).toBeLessThan(0.1);

    // 暫停視窗內（~1.5s）：相機不朝質心跑，即使質心遠在硬上限之外
    s = run(s, moving, 1.5);
    expect(s.transform.x).toBeCloseTo(afterPanX, 6);
    expect(s.sinceManualSeconds).toBeLessThan(CFG.resumeDelaySeconds);

    // 再過 ~2s：回歸自動跟隨，朝質心收斂
    s = run(s, moving, 2.5);
    expect(s.sinceManualSeconds).toBe(CFG.resumeDelaySeconds);
    expect(s.transform.x).toBeGreaterThan(afterPanX + 50);
  });

  it('panBy 位移換算：螢幕像素 ÷ scale，相機朝反向移動', () => {
    const s0: CameraState = {
      transform: { x: 0, y: 0, scale: 2 },
      followEnabled: true,
      framing: false,
      sinceManualSeconds: CFG.resumeDelaySeconds,
    };
    const s = updateCamera(
      s0,
      targetAt(0, 0),
      CANVAS,
      [{ type: 'panBy', dxScreen: 10, dyScreen: -4 }],
      0,
    );
    expect(s.transform.x).toBeCloseTo(-5, 9);
    expect(s.transform.y).toBeCloseTo(2, 9);
  });

  it('setFollow 切換不算手動移動（不重置閒置時鐘）', () => {
    const target = targetAt(0, 0);
    let s = run(createCameraState(target, CANVAS), target, 1);
    expect(s.sinceManualSeconds).toBe(CFG.resumeDelaySeconds);
    s = updateCamera(s, target, CANVAS, [{ type: 'setFollow', enabled: false }], 1 / 60);
    expect(s.sinceManualSeconds).toBe(CFG.resumeDelaySeconds);
  });

  it('閒置時鐘不無限成長（上限 resumeDelaySeconds）', () => {
    const target = targetAt(0, 0);
    const s = run(createCameraState(target, CANVAS), target, 30);
    expect(s.sinceManualSeconds).toBe(CFG.resumeDelaySeconds);
  });
});

describe('updateCamera — 縮放對準定點（AC6）', () => {
  it('zoomBy 讓 pivot 螢幕點底下的世界座標維持不變', () => {
    const s0: CameraState = {
      transform: { x: 50, y: -20, scale: 1.5 },
      followEnabled: true,
      framing: false,
      sinceManualSeconds: CFG.resumeDelaySeconds,
    };
    const pivot = { x: 620, y: 130 };
    const worldBefore = {
      x: (pivot.x - CANVAS.width / 2) / s0.transform.scale + s0.transform.x,
      y: (pivot.y - CANVAS.height / 2) / s0.transform.scale + s0.transform.y,
    };
    const s = updateCamera(
      s0,
      targetAt(0, 0),
      CANVAS,
      [{ type: 'zoomBy', factor: 1.8, pivotScreen: pivot }],
      0,
    );
    const worldAfter = {
      x: (pivot.x - CANVAS.width / 2) / s.transform.scale + s.transform.x,
      y: (pivot.y - CANVAS.height / 2) / s.transform.scale + s.transform.y,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(s.transform.scale).toBeCloseTo(1.5 * 1.8, 6);
  });

  it('zoomBy 把 scale 夾在 [minScale, maxScale]', () => {
    const base: CameraState = {
      transform: { x: 0, y: 0, scale: 1 },
      followEnabled: true,
      framing: false,
      sinceManualSeconds: CFG.resumeDelaySeconds,
    };
    const zin = updateCamera(
      base,
      targetAt(0, 0),
      CANVAS,
      [{ type: 'zoomBy', factor: 1e6, pivotScreen: { x: 400, y: 300 } }],
      0,
    );
    expect(zin.transform.scale).toBe(CFG.maxScale);
    const zout = updateCamera(
      base,
      targetAt(0, 0),
      CANVAS,
      [{ type: 'zoomBy', factor: 1e-9, pivotScreen: { x: 400, y: 300 } }],
      0,
    );
    expect(zout.transform.scale).toBe(CFG.minScale);
  });
});

describe('updateCamera — 鎖定跟隨（AC4）', () => {
  it('鎖定時質心移動相機不動，手動仍生效', () => {
    const target = targetAt(0, 0);
    let s = run(createCameraState(target, CANVAS), target, 1);
    s = updateCamera(s, target, CANVAS, [{ type: 'setFollow', enabled: false }], 1 / 60);
    const locked = { ...s.transform };

    // 質心大幅移動、跑 3s → 相機文風不動
    s = run(s, targetAt(600, 400), 3);
    expect(s.transform.x).toBeCloseTo(locked.x, 6);
    expect(s.transform.y).toBeCloseTo(locked.y, 6);

    // 手動平移仍然有效
    s = updateCamera(
      s,
      targetAt(600, 400),
      CANVAS,
      [{ type: 'panBy', dxScreen: -30, dyScreen: 0 }],
      1 / 60,
    );
    expect(s.transform.x).toBeGreaterThan(locked.x);
  });
});

describe('updateCamera — 框住果凍（AC5）', () => {
  it('frame → 一次性緩動 fit 當前 bbox，到位後恢復自動跟隨', () => {
    const target = targetAt(0, 0);
    // 先手動甩到離譜的地方
    let s = updateCamera(
      createCameraState(target, CANVAS),
      target,
      CANVAS,
      [
        { type: 'panBy', dxScreen: 5000, dyScreen: 3000 },
        { type: 'zoomBy', factor: 0.2, pivotScreen: { x: 400, y: 300 } },
      ],
      0,
    );
    expect(s.transform.x).not.toBeCloseTo(0, 1);

    // 按「框住果凍」，跑 2s
    s = updateCamera(s, target, CANVAS, [{ type: 'frame' }], 1 / 60);
    expect(s.framing).toBe(true);
    s = run(s, target, 2);

    const fit = fitTransform(target.bbox, CANVAS);
    expect(s.transform.x).toBeCloseTo(fit.x, 3);
    expect(s.transform.y).toBeCloseTo(fit.y, 3);
    expect(s.transform.scale).toBeCloseTo(fit.scale, 3);
    expect(s.framing).toBe(false);

    // 恢復跟隨：質心移動 → 相機跟上
    s = run(s, targetAt(200, 0), 1.5);
    expect(s.transform.x).toBeGreaterThan(150);
  });

  it('frame 即使在鎖定狀態也重新啟用自動跟隨', () => {
    const target = targetAt(0, 0);
    let s = createCameraState(target, CANVAS);
    s = updateCamera(s, target, CANVAS, [{ type: 'setFollow', enabled: false }], 1 / 60);
    expect(s.followEnabled).toBe(false);
    s = updateCamera(s, target, CANVAS, [{ type: 'frame' }], 1 / 60);
    expect(s.followEnabled).toBe(true);
  });
});

describe('updateCamera — 自訂 config', () => {
  it('config 可覆寫（如關掉硬上限、放寬跟隨速度），不用改預設值', () => {
    const target = targetAt(0, 0);
    const loose = { ...DEFAULT_CAMERA_FOLLOW_CONFIG, keepInFrameFrac: 1e6, followLambda: 0.001 };
    const s0 = createCameraState(target, CANVAS, loose);
    const s = updateCamera(s0, targetAt(300, 0), CANVAS, [], 1 / 60, loose);
    // 跟隨速度放到極慢、硬上限關掉 → 幾乎不動
    expect(s.transform.x).toBeGreaterThan(0);
    expect(s.transform.x).toBeLessThan(1);
  });
});

describe('updateCamera — 防禦', () => {
  it('dt ≤ 0 不動、不產生 NaN（即使目標離硬上限很遠）', () => {
    const s0 = createCameraState(targetAt(0, 0), CANVAS);
    const s = updateCamera(s0, targetAt(999999, 999999), CANVAS, [], 0);
    expect(s.transform).toEqual(s0.transform);
    const s2 = updateCamera(s0, targetAt(999999, 999999), CANVAS, [], -1);
    expect(Number.isFinite(s2.transform.x)).toBe(true);
    expect(s2.transform).toEqual(s0.transform);
  });

  it('不變異傳入的 state', () => {
    const s0 = createCameraState(targetAt(0, 0), CANVAS);
    const snapshot = JSON.parse(JSON.stringify(s0));
    updateCamera(
      s0,
      targetAt(300, 0),
      CANVAS,
      [{ type: 'panBy', dxScreen: 5, dyScreen: 5 }],
      1 / 60,
    );
    expect(s0).toEqual(snapshot);
  });
});
