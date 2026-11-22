import { Suspense, lazy } from 'react'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { useWebGPU } from '@/lib/use-webgpu'
import { cn } from '@/lib/utils'
import type { DataTransferSceneProps } from './DataTransferScene'
import { COLOR_MAP } from './textures'
import './transfer.css'

/*
 * The only dynamic import of the scene: Vite names its chunk after the module,
 * and the precache guard keeps that chunk out of the service worker.
 */
const DataTransferScene = lazy(() => import('./DataTransferScene'))

/**
 * The transfer scene behind three guards.
 *
 * - **Capability.** Without a usable WebGPU adapter the scene's chunk is never
 *   requested, and while the probe is still asking, the still shows rather
 *   than an empty box.
 * - **Loading.** The still covers the wait for the chunk.
 * - **Failure.** A renderer that fails to start, or loses its device, falls
 *   back to the still.
 */
export function LazyDataTransferScene(props: DataTransferSceneProps) {
  const status = useWebGPU()
  const still = <TransferFallback className={props.className} />
  if (status !== 'supported') return still
  return (
    <ErrorBoundary fallback={still}>
      <Suspense fallback={still}>
        <DataTransferScene {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}

/**
 * The scene as a still: the same picture, framed and grounded exactly as the
 * live canvas draws it, with two soft lights drifting along the arc of cards
 * (none under reduced motion). Decoration only.
 */
export function TransferFallback({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('transfer-scene', className)}>
      <div className="transfer-scene__frame">
        <img className="transfer-scene__picture" src={COLOR_MAP} alt="" draggable={false} />
        <span className="transfer-scene__relay" />
        <span className="transfer-scene__relay" />
      </div>
    </div>
  )
}
