/**
 * Import the scene from here. Naming `DataTransferScene` directly pulls
 * `three/webgpu` into whatever chunk you are in, which defeats the split — this
 * barrel exists so that mistake takes a deliberate deeper import.
 *
 * One export, deliberately. It used to re-export five, and four of them had no
 * consumer through it: `DataTransferSceneProps` is imported straight from its
 * own module by `LazyDataTransferScene`, and `TransferTitle` was an 83-line
 * component nothing ever rendered.
 *
 * `TransferFallback` used to be a third file in this folder with exactly one
 * importer — the module below, which renders it in all three of its branches.
 * A 24-line component reachable from one place is not a seam, so it now lives
 * beside the only thing that mounts it.
 */
export { LazyDataTransferScene } from './LazyDataTransferScene'
