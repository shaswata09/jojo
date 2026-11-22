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
 * The scene's motion stays on the picture — packets of light along the arc of
 * cards between the two devices — and never crosses the copy on the reading
 * side, the progress bar or the step list.
 *
 * Decoration only. The pairing key is the QR code `TransferStage` draws in its
 * own column (Q329); nothing here is read by a camera, so the whole box is
 * hidden from assistive technology.
 */
export function SceneBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 isolate overflow-hidden', className)}
    >
      {/* Held back to 85%, so the picture sits behind the copy rather than
          competing with it. */}
      <LazyDataTransferScene className="size-full opacity-85" />
      {/* Legibility, not decoration: the scene is a photograph and the copy on
          top of it has to stay readable on a laptop with the brightness down.
          Weighted to the left, where the text is, so the picture survives on
          the side that has nothing over it. */}
      <div className="absolute inset-0 bg-gradient-to-r from-panel/95 via-panel/70 to-panel/10 rtl:bg-gradient-to-l" />
    </div>
  )
}
