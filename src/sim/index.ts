/** 模擬核心對外介面（GitHub issue #5 起）。 */

export { SimCore } from './SimCore';
export { InfiniteBoundary, WalledBoundary } from './boundary';
export type { Boundary, WalledBoundaryOptions } from './boundary';
export { DEFAULT_SIM_PARAMS } from './types';
export type {
  SimParams,
  InputEvent,
  PointerId,
  Bbox,
  StretchStats,
  AreaStats,
  Point,
  SurfacePoint,
} from './types';
