/**
 * Softness 滑桿 → `SimParams` 映射（issue #14 / T13）。
 *
 * 純函式：把控制面板一條 0–1 的滑桿值換成 `cellFrac`（Region cell 邊長係數）+
 * `alphaSm`（shape-matching 混合係數）的一組值——兩者一起決定 Jelly 的軟硬（見
 * `docs/design/simulation-and-mesh.md`「求解器」一節）。單一滑桿而非兩條獨立
 * 滑桿，對照 issue #14「Softness 滑桿（內部對應 Region cell 邊長 + α_sm 的一條
 * 曲線）」。
 *
 * `t = 0` → 很軟很黏（小 Region、弱 shape-matching 拉力）；`t = 1` → 很硬挺
 * （大 Region、幾乎貼死 goal）。兩個範圍刻意選在 `t = 0.5` 精確落在
 * `DEFAULT_SIM_PARAMS` 上——滑桿還沒被使用者動過時，中點顯示的值就是實際生效
 * 的手感基準，不會出現「面板顯示的值跟物理不一致」的落差。輸入 clamp 到 `[0, 1]`。
 */

export interface SoftnessParams {
  cellFrac: number;
  alphaSm: number;
}

/** 滑桿兩端對應的 `cellFrac` 範圍；中點 = `DEFAULT_SIM_PARAMS.cellFrac`（0.15）。 */
const CELL_FRAC_RANGE = { min: 0.05, max: 0.25 };
/** 滑桿兩端對應的 `alphaSm` 範圍；中點 = `DEFAULT_SIM_PARAMS.alphaSm`（0.7）。 */
const ALPHA_SM_RANGE = { min: 0.4, max: 1.0 };

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

export function softnessToParams(t: number): SoftnessParams {
  const clamped = Math.min(Math.max(t, 0), 1);
  return {
    cellFrac: lerp(CELL_FRAC_RANGE.min, CELL_FRAC_RANGE.max, clamped),
    alphaSm: lerp(ALPHA_SM_RANGE.min, ALPHA_SM_RANGE.max, clamped),
  };
}
