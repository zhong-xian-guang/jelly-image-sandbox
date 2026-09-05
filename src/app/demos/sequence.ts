/** Demo 腳本用的插值小工具——把「從 A 點移到 B 點」展開成一串排定的 `moveGrab`。 */

import type { PointerId, Point } from '../../sim';
import type { DemoStep } from './types';

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * 每隔 `sampleEvery` 個 sim step 排一次 `moveGrab`，target 依 `ease` 從 `from`
 * 插值到 `to`；最後一格精準落在 `to`（不受 `sampleEvery` 整除誤差影響）。
 */
export function easeMoveSteps(
  id: PointerId,
  from: Point,
  to: Point,
  startStep: number,
  durationSteps: number,
  ease: Easing,
  sampleEvery = 2,
): DemoStep[] {
  const steps: DemoStep[] = [];
  for (let s = sampleEvery; s < durationSteps; s += sampleEvery) {
    const t = ease(s / durationSteps);
    steps.push({
      atStep: startStep + s,
      event: {
        type: 'moveGrab',
        id,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      },
    });
  }
  steps.push({
    atStep: startStep + durationSteps,
    event: { type: 'moveGrab', id, x: to.x, y: to.y },
  });
  return steps;
}
