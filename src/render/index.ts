/** Renderer 對外介面（issue #10 / T9）。 */

export { JellyRenderer } from './JellyRenderer';
export type { JellyRendererOptions } from './JellyRenderer';
export {
  createRenderBuffers,
  validateRenderMesh,
  writePositions,
  containerPosition,
} from './meshBuffers';
export type { RenderBuffers, RenderMesh } from './meshBuffers';
