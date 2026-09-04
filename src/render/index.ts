/** Renderer 對外介面（issue #10 / T9）。 */

export { JellyRenderer } from './JellyRenderer';
export type { JellyRendererOptions } from './JellyRenderer';
export {
  createTextureBuffers,
  validateTextureMesh,
  writePositions,
  containerPosition,
  screenToWorld,
} from './meshBuffers';
export type { TextureBuffers, TextureMesh, CameraTransform } from './meshBuffers';
