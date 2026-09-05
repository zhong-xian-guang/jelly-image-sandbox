/**
 * 內建示範腳本（issue #15 / T14）。每個 `build` 只吃「目前」Jelly 的 Particle
 * 位置（`sim.positions`），用 `../geometry` 的角／中心／對角線量測算出座標——
 * 不寫死數字，任何已匯入的形狀都能跑，且同一個形狀每次 `build` 結果一致
 * （純函式、無隨機），滿足「決定性」驗收條件。
 *
 * 涵蓋 issue 列出的五種情境：拖到極限並放開、用力甩、放 Pin + 拉一角、雙點
 * 扭轉、輕拍——各自獨立成一個 Demo，按鈕一次播一個。
 */

import type { PointerId } from '../../sim';
import { centroidOf, dragTargetFromCorner, extremeParticle, rotateAround } from './geometry';
import { easeInOutCubic, easeMoveSteps, easeOutCubic, linear } from './sequence';
import type { DemoDefinition, DemoStep } from './types';

const STEPS_PER_SECOND = 60;
const at = (seconds: number): number => Math.round(seconds * STEPS_PER_SECOND);

const GRAB_ID: PointerId = 'demo-grab';
const GRAB_ID_B: PointerId = 'demo-grab-b';
const PIN_ID: PointerId = 'demo-pin';

/** 拖到極限並放開：抓一角，緩緩拉到遠超對角線的距離再放手，看回彈。 */
function buildStretchRelease(positions: Float64Array): DemoStep[] {
  const { corner, target } = dragTargetFromCorner(positions, { x: 1, y: 1 }, 1.2);
  const stretchDuration = at(1.2);
  return [
    { atStep: at(0), event: { type: 'grab', id: GRAB_ID, x: corner.x, y: corner.y } },
    ...easeMoveSteps(GRAB_ID, corner, target, at(0), stretchDuration, easeOutCubic),
    { atStep: at(0) + stretchDuration + at(0.3), event: { type: 'release', id: GRAB_ID } },
  ];
}

/**
 * 用力甩：抓一角後在短時間內加速拉開、拉開後立刻放手（不停留）——放開時被抓
 * 的 Particle 仍帶著高速度，即是甩動的 Fling（同 `SimCore.test.ts` 的 `fling`
 * 手法）。用 `linear` 而非 ease-out，是要讓速度一路撐到放手那一刻，不提早減速。
 */
function buildWhip(positions: Float64Array): DemoStep[] {
  const { corner, target } = dragTargetFromCorner(positions, { x: -1, y: 1 }, 1.4);
  const whipDuration = at(0.25);
  return [
    { atStep: at(0), event: { type: 'grab', id: GRAB_ID, x: corner.x, y: corner.y } },
    ...easeMoveSteps(GRAB_ID, corner, target, at(0), whipDuration, linear),
    { atStep: at(0) + whipDuration, event: { type: 'release', id: GRAB_ID } },
  ];
}

/** 放 Pin + 拉一角：先在一角落下 Pin 固定住，再抓對角拉開，看果凍被撐開但釘住的角不動。 */
function buildPinAndPull(positions: Float64Array): DemoStep[] {
  const anchor = extremeParticle(positions, -1, -1);
  const { corner, target } = dragTargetFromCorner(positions, { x: 1, y: 1 }, 1);
  const pullStart = at(0.3);
  const pullDuration = at(1.2);
  const releaseStep = pullStart + pullDuration + at(0.3);
  return [
    { atStep: at(0), event: { type: 'pin', id: PIN_ID, x: anchor.x, y: anchor.y } },
    { atStep: pullStart, event: { type: 'grab', id: GRAB_ID, x: corner.x, y: corner.y } },
    ...easeMoveSteps(GRAB_ID, corner, target, pullStart, pullDuration, easeOutCubic),
    { atStep: releaseStep, event: { type: 'release', id: GRAB_ID } },
    { atStep: releaseStep + at(0.2), event: { type: 'unpin', id: PIN_ID } },
  ];
}

/** 雙點扭轉：同時抓兩個對角，繞中心朝相反方向轉一段弧再放開，擰出扭轉形變。 */
function buildTwist(positions: Float64Array): DemoStep[] {
  const center = centroidOf(positions);
  const cornerA = extremeParticle(positions, 1, 1);
  const cornerB = extremeParticle(positions, -1, -1);
  const armA = { x: cornerA.x - center.x, y: cornerA.y - center.y };
  const armB = { x: cornerB.x - center.x, y: cornerB.y - center.y };

  const twistDuration = at(1.6);
  const totalAngle = Math.PI * 0.6;
  const sampleEvery = 2;

  const steps: DemoStep[] = [
    { atStep: at(0), event: { type: 'grab', id: GRAB_ID, x: cornerA.x, y: cornerA.y } },
    { atStep: at(0), event: { type: 'grab', id: GRAB_ID_B, x: cornerB.x, y: cornerB.y } },
  ];

  for (let s = sampleEvery; s < twistDuration; s += sampleEvery) {
    const angle = totalAngle * easeInOutCubic(s / twistDuration);
    const pointA = rotateAround(armA, angle, center);
    const pointB = rotateAround(armB, -angle, center);
    steps.push({ atStep: at(0) + s, event: { type: 'moveGrab', id: GRAB_ID, x: pointA.x, y: pointA.y } });
    steps.push({
      atStep: at(0) + s,
      event: { type: 'moveGrab', id: GRAB_ID_B, x: pointB.x, y: pointB.y },
    });
  }

  const endStep = at(0) + twistDuration;
  steps.push({ atStep: endStep, event: { type: 'release', id: GRAB_ID } });
  steps.push({ atStep: endStep, event: { type: 'release', id: GRAB_ID_B } });
  return steps;
}

/** 輕拍：對中心拍一下，再對另一角拍一下——都是一次性徑向脈衝，no drag。 */
function buildTap(positions: Float64Array): DemoStep[] {
  const center = centroidOf(positions);
  const corner = extremeParticle(positions, 1, -1);
  return [
    { atStep: at(0), event: { type: 'tap', x: center.x, y: center.y } },
    { atStep: at(0.9), event: { type: 'tap', x: corner.x, y: corner.y } },
  ];
}

export const DEMOS: DemoDefinition[] = [
  { id: 'stretch-release', label: '拉到極限放開', build: buildStretchRelease },
  { id: 'whip', label: '用力甩', build: buildWhip },
  { id: 'pin-and-pull', label: 'Pin 定住＋拉一角', build: buildPinAndPull },
  { id: 'twist', label: '雙點扭轉', build: buildTwist },
  { id: 'tap', label: '輕拍', build: buildTap },
];
