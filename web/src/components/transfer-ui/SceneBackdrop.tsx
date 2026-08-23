import { LazyDataTransferScene } from '@/components/transfer'
import type { PulseFrame } from '@jojo/service/core/pulse'
import { cn } from '@/lib/utils'

/**
 * The transfer scene, placed behind the words.
 *
 * `LazyDataTransferScene` rather than `DataTransferScene`: it does the WebGPU
 * capability check, the code split and the error boundary, so a device with no
 * adapter never fetches several hundred kilobytes of `three/webgpu` and still
 * gets the picture. Naming the scene directly would pull that chunk into this
 * route's own bundle.
 *
 * The scene renders into a filled box, so it needs one — a Canvas sizes itself
 * to its parent and would otherwise collapse or, worse, take part in the flex
 * column and push the copy off the bottom of the panel.
 *
 * `fullScreenEffect` is off: the scan line sweeping the whole canvas would run
 * straight through the progress bar and the step list, which is exactly the
 * kind of movement that makes a status readout hard to trust.
 *
 * `frames` goes straight down to the scene, which is the whole point of this
 * component existing between the two. The key is drawn out of the same cell
 * lattice the picture is already made of — the dots do not sit on top of the
 * animation, they ARE the animation, brightened and dimmed in blocks. See the
 * note above `PULSE_DIM` in `DataTransferScene` for what that costs the picture
 * while a key is up.
 *
 * The gradient below lightens at the same moment, and for the same reason it
 * exists at all. It is there to keep copy legible over a photograph; a region
 * it has veiled is a region a camera cannot measure, so a key showing through a
 * full-strength gradient would be a key that never decodes.
 */
export function SceneBackdrop({
  className,
  frames = null,
}: {
  className?: string
  /**
   * The key, as frames of the animation, or null when nothing is being sent.
   *
   * The scene's own dots carry it — see `core/pulse.ts`.
   */
  frames?: readonly PulseFrame[] | null
}) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <LazyDataTransferScene
        /*
         * Held back to 85% normally, so the picture sits behind the copy rather
         * than competing with it — and taken to full while a key is up, for the
         * same reason the gradient lifts. Opacity here is compositing against
         * the panel underneath, so 85% pulls every region toward one background
         * colour and closes exactly the gap between lit and dim that the reader
         * measures.
         */
        className={cn('size-full', frames === null && 'opacity-85')}
        fullScreenEffect={false}
        frames={frames}
      />
      {/* Legibility, not decoration: the scene is a photograph and the copy on
          top of it has to stay readable on a laptop with the brightness down.
          Weighted to the left, where the text is, so the picture survives on
          the side that has nothing over it. */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-r',
          frames === null
            ? 'from-panel/95 via-panel/70 to-panel/10'
            : 'from-panel/70 via-panel/20 to-transparent',
        )}
      />
    </div>
  )
}
