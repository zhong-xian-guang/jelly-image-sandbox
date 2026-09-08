/**
 * 秒 ↔ 固定 sim step 計數的換算（60Hz，見 `JellySandbox` 主迴圈）。
 *
 * 內部一律用 step 計數當時間單位，`60` 是唯一的 60Hz 事實來源；UI 對使用者顯示
 * 「秒」，進出時經這裡換算。`scripts.ts` 的 `at()` 與 `JellySandbox` 的 Track
 * 起始秒數欄位共用這一份，免得兩邊各留一個 `1/60`／`* 60` 常數會漂移
 * （issue #33 code review）。
 */

/** 一個固定 sim step 的秒數。 */
export const STEP_SECONDS = 1 / 60;

const STEPS_PER_SECOND = 60;

/** 秒 → step 計數（四捨五入到最近的整數 step）。 */
export const secondsToStep = (seconds: number): number => Math.round(seconds * STEPS_PER_SECOND);

/** step 計數 → 秒。 */
export const stepToSeconds = (step: number): number => step * STEP_SECONDS;
