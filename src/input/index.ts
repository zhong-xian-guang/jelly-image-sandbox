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
  DEFAULT_SPRAY_RADIUS,
  DEFAULT_SPRAY_SPACING,
  DEFAULT_ERASE_RADIUS,
  DEFAULT_HANDFUL_RADIUS,
  SPRAY_RADIUS_RANGE,
  ERASE_RADIUS_RANGE,
  HANDFUL_RADIUS_RANGE,
  CLICK_TOOL_IDS,
  TOOL_IDS,
  TOOL_MODES,
  MODE_VALUE_RANGES,
  isModalTool,
  modesOf,
} from './ToolRouter';
export type {
  ToolId,
  ClickToolId,
  ToolRouterOptions,
  FanParams,
  SprayParams,
  EraseParams,
  HandfulParams,
  ModalToolId,
  ToolMode,
  ToolModeOf,
  GrabMode,
  ModeValueKey,
  ModeValue,
} from './ToolRouter';
export { PointerInput } from './PointerInput';
export type { PointerInputOptions } from './PointerInput';
export { routeForPinTool } from './pinToolRouting';
