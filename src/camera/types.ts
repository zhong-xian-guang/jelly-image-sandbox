/**
 * Camera（issue #13 / T12）的型別。
 *
 * Camera 與求解器無關：它只吃 Jelly 的質心／bounding box（`CameraTarget`）＋一串
 * 手動輸入指令（`CameraCommand`），吐世界→螢幕變換（`CameraTransform`）。求解器
 * 不知道 Camera 存在（見 `docs/design/simulation-and-mesh.md`「模組邊界」）。
 *
 * `updateCamera` 是純函式、決定性（不碰 DOM、不讀 wall-clock）——同 ADR-0005 對
 * 求解器的要求，這樣 v2 素材工具也能錄放相機操作。
 */

import type { Bbox, Point } from '../sim';

/** 世界→螢幕變換：`screen = (world − {x, y}) · scale + 畫布中心`。 */
export interface CameraTransform {
  /** 對準畫布中心的世界座標 X。 */
  x: number;
  /** 對準畫布中心的世界座標 Y。 */
  y: number;
  /** 每單位世界長度對應的螢幕像素數（> 0）。 */
  scale: number;
}

/** 畫布尺寸（CSS 像素），zoom-to-fit 與正／逆投影用。 */
export interface CanvasSize {
  width: number;
  height: number;
}

/** 自動跟隨的驅動來源：Jelly 目前的質心（平移）＋ bounding box（zoom-to-fit）。 */
export interface CameraTarget {
  centroid: Point;
  bbox: Bbox;
}

/**
 * 自動跟隨的手感參數（對照求解器的 `SimParams`）。全部有預設值
 * （`DEFAULT_CAMERA_FOLLOW_CONFIG`），`updateCamera` / `createCameraState` 可只帶想改的欄位。
 */
export interface CameraFollowConfig {
  /** 自動跟隨的指數平滑率 λ（1/s）：`α = 1 − e^(−λ·dt)`。越大越貼。 */
  followLambda: number;
  /** 「框住果凍」一次性緩動的指數平滑率 λ（1/s）。 */
  frameLambda: number;
  /** 最後一次手動平移／縮放後，自動跟隨回歸前的閒置秒數。 */
  resumeDelaySeconds: number;
  /** zoom-to-fit 從可用畫布尺寸總共扣掉的邊距（CSS px，兩側均分）。 */
  fitMarginPx: number;
  /**
   * 自動跟隨時，質心離畫面中心的硬上限＝短邊 × 此比例。甩太快、跟隨還沒補上時
   * 由它保證 Jelly 不跑出畫面（一般跟隨誤差遠小於此、不會觸發）。
   */
  keepInFrameFrac: number;
  /** scale 下限（防呆：極大 bbox 不會把 Jelly 縮成看不見）。 */
  minScale: number;
  /** scale 上限（防呆：極小 bbox 不會爆放大）。 */
  maxScale: number;
}

/**
 * 一次 `updateCamera` 呼叫後的完整相機狀態。`transform` 是給算繪／picking 用的
 * 世界→螢幕變換；其餘欄位是下一次呼叫要回餵的內部狀態。
 */
export interface CameraState {
  /** 目前世界→螢幕變換。所有繪製與 picking 都經過它。 */
  transform: CameraTransform;
  /**
   * 自動跟隨是否啟用。「鎖定跟隨」開關＝把這個設 false：相機定住，手動仍可動。
   */
  followEnabled: boolean;
  /**
   * 距最後一次手動平移／縮放的秒數，上限 `resumeDelaySeconds`。小於上限代表
   * 自動跟隨正暫停中；到達上限即緩動回歸。`setFollow` 切換不影響它（切鎖定不算手動移動）。
   */
  sinceManualSeconds: number;
  /**
   * 「框住果凍」進行中：忽略暫停與鎖定，一次性緩動到當前 bbox + 邊距，到位後
   * 清除此旗標並恢復自動跟隨。
   */
  framing: boolean;
}

/**
 * 手動相機指令。即時輸入層（`CameraInput`）把滾輪／背景拖曳／雙指手勢翻成這些；
 * 內建 Demo 以程式碼產生同樣的序列；v2 錄製器包在外層（同 `InputEvent`，ADR-0005）。
 *
 * - `panBy`：平移，位移量是**螢幕 CSS 像素**（除以 scale 換到世界）。
 * - `zoomBy`：以 `pivotScreen`（畫布局部座標）為定點縮放 `factor` 倍——該螢幕點
 *   底下的世界座標在縮放前後不變（滾輪對準游標縮放）。
 * - `setFollow`：切「鎖定跟隨」——`enabled = false` 即自動跟隨關。
 * - `frame`：「框住果凍」按鈕——一次性緩動 fit 當前 bbox 後恢復跟隨。
 */
export type CameraCommand =
  | { type: 'panBy'; dxScreen: number; dyScreen: number }
  | { type: 'zoomBy'; factor: number; pivotScreen: Point }
  | { type: 'setFollow'; enabled: boolean }
  | { type: 'frame' };
