import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { cn } from '@/lib/utils'
import { useWebGPU } from '@/lib/use-webgpu'
import type { PulseFrame } from '@jojo/service/core/pulse'
import type { DataTransferSceneProps } from './DataTransferScene'
import { PulseOverlay } from './PulseOverlay'
import { COLOR_MAP } from './textures'
import './transfer.css'

/**
 * The split point. `three/webgpu` plus the TSL node graph is by a wide margin
 * the largest thing this app can load, and it is worth nothing on a device
 * without an adapter — so the import lives behind both a `lazy()` and the
 * capability check below, and a browser that cannot run it never fetches it.
 */
const Scene = lazy(() => import('./DataTransferScene'))

/**
 * The transfer scene with every way it can fail already handled.
 *
 * Three separate failures, three separate guards, because they happen at
 * different moments:
 *
 * - No adapter at all (Safari, older Chrome, a blocklisted GPU). Caught before
 *   mount by `useWebGPU`, so the chunk is never requested.
 * - Chunk still in flight. Covered by Suspense, showing the same still image
 *   the fallback uses, so there is no reflow when the canvas takes over.
 * - `init()` rejects anyway, or a shader fails to compile on this particular
 *   driver. Caught by the boundary — the same rule the 3D mascot (`JojoRobot`)
 *   follows: a decorative canvas must never be able to take a route down with it.
 *
 * `frames` goes to all three fallbacks as well as to the scene. The scene is not
 * only decoration while a key is up — it is how the phone pairs — so a fallback
 * that dropped the frames left a device without WebGPU, or offline (the scene's
 * chunk is not precached), with nothing on screen to scan. Each fallback draws
 * the key with `PulseOverlay` instead; the scene, once it mounts, draws its own
 * and the overlay goes with the fallback, so there is never a second one.
 */
export function LazyDataTransferScene({ className, ...props }: DataTransferSceneProps) {
  const status = useWebGPU()
  const frames = props.frames ?? null

  if (status !== 'supported') return <TransferFallback className={className} frames={frames} />

  const fallback = <TransferFallback className={className} frames={frames} />
  return (
    <ErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Scene className={className} {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}

/**
 * What the scene degrades to when there is no WebGPU adapter.
 *
 * Deliberately the same *picture*, not a spinner and not an apology: the point
 * of the panel is the image, and the shader's contribution is motion. So this
 * shows the colour texture with a CSS approximation of the dot grid and the red
 * scan band, and loses only the depth parallax and the bloom.
 *
 * Also used as the Suspense fallback while the `three/webgpu` chunk downloads,
 * which means the layout never reflows when the real scene arrives.
 *
 * The picture is hidden from assistive technology and the key is not: the
 * overlay is the one thing here a person has to act on, and its label says how.
 */
export function TransferFallback({
  className,
  frames = null,
}: {
  className?: string
  /** The key, drawn over the picture while one is offered. */
  frames?: readonly PulseFrame[] | null
}) {
  return (
    <div className={cn('transfer-scope relative overflow-hidden', className)}>
      <img src={COLOR_MAP} alt="" aria-hidden className="transfer-fallback-img" />
      <span aria-hidden className="transfer-fallback-dots" />
      <span aria-hidden className="transfer-fallback-scan" />
      <PulseOverlay frames={frames} />
    </div>
  )
}
