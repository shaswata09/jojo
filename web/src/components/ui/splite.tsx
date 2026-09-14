import { Suspense, lazy, type ReactNode } from 'react'
import type { Application } from '@splinetool/runtime'

// Lazy so the ~2MB Spline runtime is a separate chunk and never touches the
// initial bundle — nothing loads until the brand card actually mounts.
const Spline = lazy(() => import('@splinetool/react-spline'))

interface SplineSceneProps {
  scene: string
  className?: string
  /**
   * Where the runtime looks for its WebAssembly helpers.
   *
   * Left unset it hardcodes unpkg.com, and it reaches for one the moment a
   * scene uses procedural geometry — so a scene served from this origin still
   * pulled half a megabyte off a CDN on load. The caller vendors the file and
   * names the folder; see SplineRobot.
   */
  wasmPath?: string
  /** Route pointer events from the whole page, not just the canvas. */
  globalEvents?: boolean
  /** Handed the loaded Application so callers can drive scene objects. */
  onLoad?: (app: Application) => void
  fallback?: ReactNode
}

export function SplineScene({
  scene,
  className,
  wasmPath,
  globalEvents = false,
  onLoad,
  fallback,
}: SplineSceneProps) {
  return (
    <Suspense fallback={fallback}>
      <Spline
        scene={scene}
        className={className}
        {...(wasmPath === undefined ? {} : { wasmPath })}
        onLoad={(app: Application) => {
          if (globalEvents) app.setGlobalEvents(true)
          onLoad?.(app)
        }}
      />
    </Suspense>
  )
}
