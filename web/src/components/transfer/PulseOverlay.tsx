import { useEffect, useRef } from 'react'
import { PULSE_FPS, type PulseFrame } from '@jojo/service/core/pulse'
import { cn } from '@/lib/utils'
import { paintPulse } from './pulse-paint'

/**
 * The pairing key, drawn with Canvas2D for wherever the WebGPU scene cannot.
 *
 * The scene draws the key out of its own dots, and for a long time it was the
 * only thing that did. Everywhere it could not run — no adapter (GPU
 * acceleration off, a blocklisted GPU, a VM, Safari or Firefox without WebGPU),
 * its chunk failing to load offline, the page's "Show the animation" switch off
 * — there was nothing on screen for the phone to read, and nothing saying why.
 * This is the same signal from `core/pulse.ts`, drawn by `paintPulse`, whose
 * output `pulse-paint.test.ts` puts through the phone's reader.
 *
 * Mounted by `LazyDataTransferScene`'s three fallbacks and by `TransferStage`
 * when the animation is off, never beside a scene that is drawing the key
 * itself: two keys in one camera view are two bright shapes, and the reader
 * takes only the larger.
 *
 * Lives in the Transfer route's own bundle, not in the scene's lazy chunk —
 * `precache-guard.mjs` leaves that chunk out of the offline cache, and offline
 * is one of the cases this exists for.
 *
 * ## It keeps cycling under reduced motion
 *
 * For the reason `DataTransferScene` gives: an offer is ten frames, the reader
 * needs every one, and it runs because the person asked to pair. Frozen, it
 * would be a tenth of a key forever. It is a flat tile changing a few times a
 * second, with no travel and no easing — the least motion that still says it.
 */
export function PulseOverlay({
  frames,
  className,
}: {
  /** The key, as frames, or null when nothing is being offered. */
  frames: readonly PulseFrame[] | null
  className?: string
}) {
  if (frames === null || frames.length === 0) return null
  return <PulseCanvas frames={frames} className={className} />
}

/** A device-pixel edge past which a sharper canvas buys the camera nothing. */
const MAX_EDGE = 768

function PulseCanvas({ frames, className }: { frames: readonly PulseFrame[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    // A new key starts at its first frame, like the scene's.
    const start = performance.now()
    let shown = -1
    /** Reused between frames: a canvas's worth of pixels, six times a second. */
    let image: ImageData | undefined
    let raf = 0

    const paint = (index: number) => {
      const frame = frames[index]
      if (frame === undefined || canvas.width === 0 || canvas.height === 0) return
      image ??= context.createImageData(canvas.width, canvas.height)
      paintPulse(frame, image.width, image.height, image.data)
      context.putImageData(image, 0, 0)
      shown = index
    }

    /** Backing store to the element's size in device pixels, then repaint. */
    const fit = () => {
      const box = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const scale = Math.min(dpr, MAX_EDGE / Math.max(1, box.width, box.height))
      const width = Math.max(1, Math.round(box.width * scale))
      const height = Math.max(1, Math.round(box.height * scale))
      if (width === canvas.width && height === canvas.height) return
      canvas.width = width
      canvas.height = height
      image = undefined
      paint(shown < 0 ? 0 : shown)
    }

    const tick = (now: number) => {
      const index = Math.floor(((now - start) / 1000) * PULSE_FPS) % frames.length
      if (index !== shown) paint(index)
      raf = requestAnimationFrame(tick)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [frames])

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Pairing code. Point your phone's camera at this square and hold it there while it cycles through ${String(frames.length)} frames; the phone then shows a short code to type here.`}
      className={cn(
        // Above the backdrop's legibility gradient — a veil over the code is
        // contrast the camera loses — and never taking a pointer.
        'pointer-events-none absolute top-1/2 right-4 z-10 aspect-square w-[min(40%,17rem)] -translate-y-1/2 rounded-md shadow-lg sm:right-5',
        className,
      )}
    />
  )
}
