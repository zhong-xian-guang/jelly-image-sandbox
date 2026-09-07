/** Demo 對外介面（issue #15 / T14）。 */

export { DemoRunner } from './DemoRunner';
export { isCameraCommand } from './eventKind';
export { mergeTracks } from './overlay';
export type { OverlayTrack } from './overlay';
export { DEMOS } from './scripts';
export { STEP_SECONDS, secondsToStep, stepToSeconds } from './time';
export type { DemoDefinition, DemoStep } from './types';
