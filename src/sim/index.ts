/** 模擬核心對外介面（GitHub issue #5 起）。 */

export { SimCore } from './SimCore';
export { compareJellyIds, World } from './World';
export type { JellyView, MeshProvider, WorldPinInfo, WorldSurfacePoint } from './World';
export { contourEdges, surfaceParticles } from './contour';
export type { ContourEdge } from './contour';
export { BOUNDARY_MODES, FloorBoundary, InfiniteBoundary, WalledBoundary } from './boundary';
export type {
  Boundary,
  BoundaryMode,
  ContactOptions,
  FloorBoundaryOptions,
  WalledBoundaryOptions,
} from './boundary';
export { softnessToParams } from './softness';
export type { SoftnessParams } from './softness';
export { DEFAULT_SIM_PARAMS, isPointInFanRect } from './types';
export type {
  SimParams,
  InputEvent,
  PointerId,
  Bbox,
  StretchStats,
  AreaStats,
  Point,
  SurfacePoint,
  PinInfo,
  FanState,
  SceneEntry,
} from './types';
