import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { cn } from '@/lib/utils'
import { useWebGPU } from '@/lib/use-webgpu'
import type { DataTransferSceneProps } from './DataTransferScene'
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
 *   driver. Caught by the boundary — the same rule the Spline mascot follows: a
 *   decorative canvas must never be able to take a route down with it.
 */
export function LazyDataTransferScene({ className, ...props }: DataTransferSceneProps) {
  const status = useWebGPU()

  if (status !== 'supported') return <TransferFallback className={className} />

  return (
    <ErrorBoundary fallback={<TransferFallback className={className} />}>
      <Suspense fallback={<TransferFallback className={className} />}>
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
 */
export function TransferFallback({ className }: { className?: string }) {
  return (
    <div className={cn('transfer-scope relative overflow-hidden', className)} aria-hidden>
      <img src={COLOR_MAP} alt="" className="transfer-fallback-img" />
      <span className="transfer-fallback-dots" />
      <span className="transfer-fallback-scan" />
    </div>
  )
}
