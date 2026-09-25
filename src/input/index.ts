/** 輸入層對外介面（issue #11 / T10）。 */

export { GestureTracker, DEFAULT_GESTURE_CONFIG } from './GestureTracker';
export type { GestureConfig, GestureTrackerOptions } from './GestureTracker';
export {
  ToolRouter,
  DEFAULT_TOOL,
  DEFAULT_FAN_WIDTH,
  DEFAULT_FAN_STRENGTH,
  DEFAULT_FAN_FALLOFF_EXPONENT,
  DEFAULT_FAN_FREQUENCY,
  DEFAULT_PIN_BRUSH_RADIUS,
  DEFAULT_SPRAY_SPACING,
  DEFAULT_HANDFUL_RADIUS,
  PIN_BRUSH_RADIUS_RANGE,
  HANDFUL_RADIUS_RANGE,
  FAN_WIDTH_RANGE,
  FAN_STRENGTH_RANGE,
  FAN_FALLOFF_RANGE,
  FAN_FREQUENCY_RANGE,
  TOOL_IDS,
  TOOL_MODES,
  MODE_VALUE_RANGES,
  isModalTool,
  modesOf,
} from './ToolRouter';
export type {
  ToolId,
  ToolRouterOptions,
  FanParams,
  PinBrushParams,
  HandfulParams,
  ModalToolId,
  ToolMode,
  ToolModeOf,
  GrabMode,
  PinMode,
  FanMode,
  ModeValueKey,
  ModeValue,
} from './ToolRouter';
export { PointerInput } from './PointerInput';
export type { PointerInputOptions } from './PointerInput';
