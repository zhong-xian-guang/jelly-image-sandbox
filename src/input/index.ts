/** 輸入層對外介面（issue #11 / T10）。 */

export { GestureTracker, DEFAULT_GESTURE_CONFIG } from './GestureTracker';
export type { GestureConfig, GestureTrackerOptions } from './GestureTracker';
export { ToolRouter, DEFAULT_TOOL, TOOL_IDS, TOOL_MODES, isModalTool, modesOf } from './ToolRouter';
export type {
  BackdropCommand,
  ToolId,
  ToolRouterOptions,
  FormationParams,
  FormationControls,
  FormationActiveGroup,
  ModalToolId,
  ToolMode,
  ToolModeOf,
  GrabMode,
  PinMode,
  FanMode,
  BackdropMode,
  ModeValue,
} from './ToolRouter';
export {
  ToolParams,
  DEFAULT_FAN_WIDTH,
  DEFAULT_FAN_STRENGTH,
  DEFAULT_FAN_FALLOFF_EXPONENT,
  DEFAULT_FAN_FREQUENCY,
  DEFAULT_PIN_BRUSH_RADIUS,
  DEFAULT_SPRAY_SPACING,
  DEFAULT_HANDFUL_RADIUS,
  PIN_BRUSH_RADIUS_RANGE,
  SPRAY_SPACING_RANGE,
  HANDFUL_RADIUS_RANGE,
  FAN_WIDTH_RANGE,
  FAN_STRENGTH_RANGE,
  FAN_FALLOFF_RANGE,
  FAN_FREQUENCY_RANGE,
  FAN_PARAM_KEYS,
} from './ToolParams';
export type { ModeValueKey, ToolParamKey, ToolParamListener, ValueRange } from './ToolParams';
export { PointerInput } from './PointerInput';
export type { PointerInputOptions } from './PointerInput';
