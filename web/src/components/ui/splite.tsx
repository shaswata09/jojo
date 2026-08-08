import { Suspense, lazy, type ReactNode } from 'react'
import type { Application } from '@splinetool/runtime'

// Lazy so the ~2MB Spline runtime is a separate chunk and never touches the
// initial bundle — nothing loads until the brand card actually mounts.
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  scene: string
  className?: string
  /** Route pointer events from the whole page, not just the canvas. */
  globalEvents?: boolean
  /** Handed the loaded Application so callers can drive scene objects. */
  onLoad?: (app: Application) => void
  fallback?: ReactNode
}

export function SplineScene({
  scene,
  className,
  globalEvents = false,
  onLoad,
  fallback,
}: SplineSceneProps) {
  return (
    <Suspense fallback={fallback}>
      <Spline
        scene={scene}
        className={className}
        onLoad={(app: Application) => {
          if (globalEvents) app.setGlobalEvents(true)
          onLoad?.(app)
        }}
      />
    </Suspense>
  )
}
