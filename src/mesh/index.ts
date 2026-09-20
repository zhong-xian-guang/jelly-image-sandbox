/** Mesh pipeline 對外介面（T2 / issue #3）。 */

export { buildSimMesh, MeshPipelineError } from './buildSimMesh';
export {
  decodeImageAlpha,
  decodePngAlpha,
  sniffImageFormat,
  imageFormatToMime,
} from './decodeImage';
export { positionsBbox, scaleMeshToLongestEdge } from './scaleMesh';
export { DEFAULT_PARAMS } from './types';
export { mulberry32 } from './prng';
export type { BuildSimMeshParams, SimMesh, Mask, Point } from './types';
export type { DecodedAlpha, ImageFormat } from './decodeImage';
