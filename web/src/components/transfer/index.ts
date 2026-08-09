/**
 * Import from here. `LazyDataTransferScene` is the one to reach for — naming
 * `DataTransferScene` directly pulls `three/webgpu` into whatever chunk you are
 * in, which defeats the split.
 */
export { LazyDataTransferScene } from './LazyDataTransferScene'
export { TransferFallback } from './TransferFallback'
export { TransferTitle } from './TransferTitle'
export type { TransferTitleProps } from './TransferTitle'
export type { DataTransferSceneProps } from './DataTransferScene'
