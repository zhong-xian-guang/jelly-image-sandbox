/**
 * `updateCamera`（issue #13 / T12）——每幀推進相機的純函式。
 *
 * `updateCamera(state, target, canvasSize, commands, dt, config?) → state'`
 *
 * `state'.transform` 是給算繪與 picking 用的世界→螢幕變換；其餘欄位回餵下一幀。
 * 決定性、無 DOM、不讀 wall-clock（同 ADR-0005 對求解器的要求，讓 v2 能錄放相機）。
 *
 * 行為：
 *  - **自動跟隨**：平移分量對 `target.centroid`、縮放對 `target.bbox` 的 zoom-to-fit
 *    做指數平滑（frame-rate 無關：`α = 1 − e^(−λ·dt)`）。追不上時（用力甩遠、bbox
 *    突然變大）有硬上限頂住，保證 Jelly 不會跑出畫面／被縮放裁掉（見
 *    `keepInFrameFrac`）——一般跟隨誤差遠小於此上限、不會觸發。
 *  - **手動平移／縮放**（`panBy` / `zoomBy`）：立即套用，並把 `sinceManualSeconds`
 *    歸零 → 暫停自動跟隨；閒置到 `resumeDelaySeconds` 後緩動回歸。
 *  - **鎖定跟隨**（`setFollow { enabled:false }`）：自動跟隨關，手動仍可動。
 *  - **框住果凍**（`frame`）：忽略暫停與鎖定，一次性緩動到 fit，到位後恢復跟隨。
 */

import type {
  CameraCommand,
  CameraFollowConfig,
  CameraState,
  CameraTarget,
  CameraTransform,
  CanvasSize,
} from './types';
import { screenToWorld } from './project';

/** 手感預設值（藍本沿用 T10 暫代 `fit()` 的 80px 邊距）。可在呼叫端整包／部分覆寫。 */
export const DEFAULT_CAMERA_FOLLOW_CONFIG: CameraFollowConfig = {
  followLambda: 5,
  frameLambda: 8,
  resumeDelaySeconds: 2,
  fitMarginPx: 80,
  keepInFrameFrac: 0.45,
  minScale: 0.02,
  maxScale: 20,
};

/** 「框住果凍」視為到位的世界座標誤差（x / y）；到位就 snap、不再無限逼近。 */
const FRAME_DONE_EPS = 0.5;
/** 「框住果凍」視為到位的 scale 誤差。 */
const FRAME_DONE_SCALE_EPS = 1e-3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * 把 `bbox` 置中、縮放到含邊距塞進 `canvasSize` 的變換。bbox 邊長 clamp 到 ≥ 1（退化
 * 尺寸不會除以零），scale clamp 到 `[config.minScale, config.maxScale]`。
 */
export function fitTransform(
  bbox: CameraTarget['bbox'],
  canvasSize: CanvasSize,
  config: CameraFollowConfig = DEFAULT_CAMERA_FOLLOW_CONFIG,
): CameraTransform {
  const { fitMarginPx, minScale, maxScale } = config;
  const bw = Math.max(bbox.maxX - bbox.minX, 1);
  const bh = Math.max(bbox.maxY - bbox.minY, 1);
  const usableW = Math.max(canvasSize.width - fitMarginPx, 1);
  const usableH = Math.max(canvasSize.height - fitMarginPx, 1);
  const scale = clamp(Math.min(usableW / bw, usableH / bh), minScale, maxScale);
  return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2, scale };
}

/** 已 fit 到 `target`、自動跟隨開、未暫停、未框住的起始狀態。 */
export function createCameraState(
  target: CameraTarget,
  canvasSize: CanvasSize,
  config: CameraFollowConfig = DEFAULT_CAMERA_FOLLOW_CONFIG,
): CameraState {
  return {
    transform: fitTransform(target.bbox, canvasSize, config),
    followEnabled: true,
    framing: false,
    sinceManualSeconds: config.resumeDelaySeconds,
  };
}

export function updateCamera(
  state: CameraState,
  target: CameraTarget,
  canvasSize: CanvasSize,
  commands: readonly CameraCommand[],
  dt: number,
  config: CameraFollowConfig = DEFAULT_CAMERA_FOLLOW_CONFIG,
): CameraState {
  const { resumeDelaySeconds, minScale, maxScale, followLambda, frameLambda, keepInFrameFrac } =
    config;

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
          canvasSize,
          cmd.pivotScreen.x,
          cmd.pivotScreen.y,
        );
        scale = clamp(scale * cmd.factor, minScale, maxScale);
        // 反解相機焦點，讓 pivot 螢幕點底下的世界座標不變（= worldToScreen 在新 scale 下的逆）。
        x = world.x - (cmd.pivotScreen.x - canvasSize.width / 2) / scale;
        y = world.y - (cmd.pivotScreen.y - canvasSize.height / 2) / scale;
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
  sinceManual = Math.min(sinceManual + step, resumeDelaySeconds);

  const fit = fitTransform(target.bbox, canvasSize, config);

  if (framing) {
    const a = 1 - Math.exp(-frameLambda * step);
    x += (fit.x - x) * a;
    y += (fit.y - y) * a;
    scale += (fit.scale - scale) * a;
    if (
      Math.abs(fit.x - x) < FRAME_DONE_EPS &&
      Math.abs(fit.y - y) < FRAME_DONE_EPS &&
      Math.abs(fit.scale - scale) < FRAME_DONE_SCALE_EPS
    ) {
      x = fit.x;
      y = fit.y;
      scale = fit.scale;
      framing = false;
      sinceManual = resumeDelaySeconds; // 到位即恢復跟隨（不再暫停）
    }
  } else if (followEnabled && sinceManual >= resumeDelaySeconds && step > 0) {
    const a = 1 - Math.exp(-followLambda * step);
    x += (target.centroid.x - x) * a;
    y += (target.centroid.y - y) * a;
    scale += (fit.scale - scale) * a;

    // 縮放裁不到：bbox 已比目前畫面塞不下時立即跟上（不等 ease），跟丟就先看見全貌。
    if (scale > fit.scale) scale = fit.scale;
    // 平移追不上：質心離畫面中心的距離頂住硬上限，甩多遠都不會把 Jelly 帶出畫面。
    const maxOffX = canvasSize.width * keepInFrameFrac;
    const maxOffY = canvasSize.height * keepInFrameFrac;
    const offX = (target.centroid.x - x) * scale;
    const offY = (target.centroid.y - y) * scale;
    if (Math.abs(offX) > maxOffX) x = target.centroid.x - Math.sign(offX) * (maxOffX / scale);
    if (Math.abs(offY) > maxOffY) y = target.centroid.y - Math.sign(offY) * (maxOffY / scale);
  }

  return {
    transform: { x, y, scale },
    followEnabled,
    framing,
    sinceManualSeconds: sinceManual,
  };
}
