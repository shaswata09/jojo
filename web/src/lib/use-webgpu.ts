import { useEffect, useState } from 'react'

/**
 * `checking` is a real state, not a nicety: `requestAdapter()` is async, so the
 * first paint genuinely does not know yet. Callers should show the still
 * fallback during it rather than an empty box that pops into a canvas.
 */
export type WebGPUStatus = 'checking' | 'supported' | 'unsupported'

/**
 * The slice of the WebGPU API we actually touch.
 *
 * `navigator.gpu` is not in TypeScript's DOM lib, and pulling `@webgpu/types` in
 * would put a global `GPUDevice` etc. into every file in the app for the sake of
 * one feature check. This is the whole surface we need.
 */
type NavigatorWithGPU = Navigator & {
  gpu?: { requestAdapter(): Promise<unknown | null> }
}

let pending: Promise<boolean> | null = null

/**
 * Does this browser have a *usable* WebGPU adapter?
 *
 * `'gpu' in navigator` is not enough. Chrome on a machine with a blocklisted or
 * software-only GPU exposes `navigator.gpu` and then hands back `null` from
 * `requestAdapter()` — and that is exactly the case where `WebGPURenderer.init()`
 * rejects, after the canvas has already mounted. Asking for the adapter up front
 * is the only check that predicts the outcome, so the heavy `three/webgpu`
 * chunk is never even fetched on a device that cannot run it.
 *
 * Memoised on the module: the answer cannot change within a page life, and the
 * probe is shared by every scene that asks.
 */
export function probeWebGPU(): Promise<boolean> {
  if (pending) return pending
  pending = (async () => {
    const gpu = (navigator as NavigatorWithGPU).gpu
    if (!gpu) return false
    try {
      return (await gpu.requestAdapter()) != null
    } catch {
      // Some embedders throw here rather than resolving null (sandboxed
      // iframes, headless runners). Same answer either way.
      return false
    }
  })()
  return pending
}

/** Subscribes a component to {@link probeWebGPU}. */
export function useWebGPU(): WebGPUStatus {
  const [status, setStatus] = useState<WebGPUStatus>(() =>
    'gpu' in navigator ? 'checking' : 'unsupported',
  )

  useEffect(() => {
    if (status !== 'checking') return
    let alive = true
    void probeWebGPU().then((ok) => {
      if (alive) setStatus(ok ? 'supported' : 'unsupported')
    })
    return () => {
      alive = false
    }
  }, [status])

  return status
}
