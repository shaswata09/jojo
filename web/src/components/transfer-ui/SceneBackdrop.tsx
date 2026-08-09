import { LazyDataTransferScene } from '@/components/transfer'
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
 */
export function SceneBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <LazyDataTransferScene className="size-full opacity-85" fullScreenEffect={false} />
      {/* Legibility, not decoration: the scene is a photograph and the copy on
          top of it has to stay readable on a laptop with the brightness down.
          Weighted to the left, where the text is, so the picture survives on
          the side that has nothing over it. */}
      <div className="absolute inset-0 bg-gradient-to-r from-panel/95 via-panel/70 to-panel/10" />
    </div>
  )
}
