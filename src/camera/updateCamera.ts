/**
 * `updateCamera`（issue #13 / T12）——每幀推進相機的純函式。
 *
 * `updateCamera(state, target, viewport, commands, dt) → state'`
 *
 * `state'.transform` 是給算繪與 picking 用的世界→螢幕變換；其餘欄位回餵下一幀。
 * 決定性、無 DOM、不讀 wall-clock（同 ADR-0005 對求解器的要求，讓 v2 能錄放相機）。
 *
 * 行為：
 *  - **自動跟隨**：平移分量對 `target.centroid`、縮放對 `target.bbox` 的 zoom-to-fit
 *    做指數平滑（frame-rate 無關：`α = 1 − e^(−λ·dt)`）。
 *  - **手動平移／縮放**（`panBy` / `zoomBy`）：立即套用，並把 `sinceManualSeconds`
 *    歸零 → 暫停自動跟隨；閒置到 `RESUME_DELAY_SECONDS` 後緩動回歸。
 *  - **鎖定跟隨**（`setFollow { enabled:false }`）：自動跟隨關，手動仍可動。
 *  - **框住果凍**（`frame`）：忽略暫停與鎖定，一次性緩動到 fit，到位後恢復跟隨。
 */

import type {
  CameraCommand,
  CameraState,
  CameraTarget,
  CameraTransform,
  CameraViewport,
} from './types';

export type {
  CameraCommand,
  CameraState,
  CameraTarget,
  CameraTransform,
  CameraViewport,
} from './types';

export const CAMERA_CONSTANTS = {
  /** zoom-to-fit 從可用視窗尺寸總共扣掉的螢幕邊距（CSS px，兩側均分）。與 T10 暫代 `fit()` 一致。 */
  FIT_MARGIN_PX: 80,
  /** scale 下限（防呆：極大 bbox 不會把 Jelly 縮成看不見）。 */
  MIN_SCALE: 0.02,
  /** scale 上限（防呆：極小 bbox 不會爆放大）。 */
  MAX_SCALE: 20,
  /** 最後一次手動輸入後，自動跟隨回歸前的閒置秒數。 */
  RESUME_DELAY_SECONDS: 2,
  /** 自動跟隨指數平滑率 λ（1/s）。越大越貼。 */
  FOLLOW_LAMBDA: 5,
  /** 「框住果凍」緩動的指數平滑率 λ（1/s）。 */
  FRAME_LAMBDA: 8,
  /** 「框住果凍」視為到位的世界座標誤差（x / y）。 */
  FRAME_DONE_EPS: 0.5,
  /** 「框住果凍」視為到位的 scale 誤差。 */
  FRAME_DONE_SCALE_EPS: 1e-3,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * 把 `bbox` 置中、縮放到含邊距塞進 `viewport` 的變換。bbox 邊長 clamp 到 ≥ 1（退化
 * 尺寸不會除以零），scale clamp 到 `[MIN_SCALE, MAX_SCALE]`。
 */
export function fitTransform(
  bbox: CameraTarget['bbox'],
  viewport: CameraViewport,
): CameraTransform {
  const { FIT_MARGIN_PX, MIN_SCALE, MAX_SCALE } = CAMERA_CONSTANTS;
  const bw = Math.max(bbox.maxX - bbox.minX, 1);
  const bh = Math.max(bbox.maxY - bbox.minY, 1);
  const usableW = Math.max(viewport.width - FIT_MARGIN_PX, 1);
  const usableH = Math.max(viewport.height - FIT_MARGIN_PX, 1);
  const scale = clamp(Math.min(usableW / bw, usableH / bh), MIN_SCALE, MAX_SCALE);
  return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2, scale };
}

/** 已 fit 到 `target`、自動跟隨開、未暫停、未框住的起始狀態。 */
export function createCameraState(target: CameraTarget, viewport: CameraViewport): CameraState {
  return {
    transform: fitTransform(target.bbox, viewport),
    followEnabled: true,
    framing: false,
    sinceManualSeconds: CAMERA_CONSTANTS.RESUME_DELAY_SECONDS,
  };
}

/** 畫布局部座標 → 世界座標（給定變換）。zoom-to-cursor 的定點換算用。 */
function screenToWorld(
  t: CameraTransform,
  viewport: CameraViewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: (sx - viewport.width / 2) / t.scale + t.x,
    y: (sy - viewport.height / 2) / t.scale + t.y,
  };
}

export function updateCamera(
  state: CameraState,
  target: CameraTarget,
  viewport: CameraViewport,
  commands: readonly CameraCommand[],
  dt: number,
): CameraState {
  const { RESUME_DELAY_SECONDS, MIN_SCALE, MAX_SCALE, FOLLOW_LAMBDA, FRAME_LAMBDA } =
    CAMERA_CONSTANTS;

  let { x, y, scale } = state.transform;
  let followEnabled = state.followEnabled;
  let framing = state.framing;
  let sinceManual = state.sinceManualSeconds;

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'panBy': {
        x -= cmd.dxScreen / scale;
        y -= cmd.dyScreen / scale;
        sinceManual = 0;
        framing = false;
        break;
      }
      case 'zoomBy': {
        const world = screenToWorld(
          { x, y, scale },
          viewport,
          cmd.pivotScreen.x,
          cmd.pivotScreen.y,
        );
        scale = clamp(scale * cmd.factor, MIN_SCALE, MAX_SCALE);
        // 反解相機焦點，讓 pivot 螢幕點底下的世界座標不變。
        x = world.x - (cmd.pivotScreen.x - viewport.width / 2) / scale;
        y = world.y - (cmd.pivotScreen.y - viewport.height / 2) / scale;
        sinceManual = 0;
        framing = false;
        break;
      }
      case 'setFollow': {
        followEnabled = cmd.enabled;
        break;
      }
      case 'frame': {
        framing = true;
        followEnabled = true;
        break;
      }
    }
  }

  const step = dt > 0 ? dt : 0;
  sinceManual = Math.min(sinceManual + step, RESUME_DELAY_SECONDS);

  const fit = fitTransform(target.bbox, viewport);

  if (framing) {
    const a = 1 - Math.exp(-FRAME_LAMBDA * step);
    x += (fit.x - x) * a;
    y += (fit.y - y) * a;
    scale += (fit.scale - scale) * a;
    const { FRAME_DONE_EPS, FRAME_DONE_SCALE_EPS } = CAMERA_CONSTANTS;
    if (
      Math.abs(fit.x - x) < FRAME_DONE_EPS &&
      Math.abs(fit.y - y) < FRAME_DONE_EPS &&
      Math.abs(fit.scale - scale) < FRAME_DONE_SCALE_EPS
    ) {
      x = fit.x;
      y = fit.y;
      scale = fit.scale;
      framing = false;
      sinceManual = RESUME_DELAY_SECONDS; // 到位即恢復跟隨（不再暫停）
    }
  } else if (followEnabled && sinceManual >= RESUME_DELAY_SECONDS) {
    const a = 1 - Math.exp(-FOLLOW_LAMBDA * step);
    x += (target.centroid.x - x) * a;
    y += (target.centroid.y - y) * a;
    scale += (fit.scale - scale) * a;
  }

  return {
    transform: { x, y, scale },
    followEnabled,
    framing,
    sinceManualSeconds: sinceManual,
  };
}
