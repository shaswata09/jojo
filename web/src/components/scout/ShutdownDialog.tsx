import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Pipeline } from '@jojo/service/core/model'

/**
 * Asked when a pipeline has run twice with nothing to show for it.
 *
 * The wording avoids "finished", which a pipeline never is — the graph will
 * have gaps again next week. What has actually happened is narrower and is what
 * the copy says: two rounds in a row found nothing, so leaving it on is
 * spending model time on a question that is currently answered.
 *
 * "Not yet" is not a no-op. It resets the idle counter, so the same question
 * cannot come back on the next round — a modal that reappears immediately after
 * being dismissed teaches people to dismiss it without reading, which is the
 * failure mode of every confirmation that cries wolf.
 */
export function ShutdownDialog({
  pipeline,
  onConfirm,
  onDismiss,
}: {
  /** The pipeline offering to stop, or null when nothing is asking. */
  pipeline: Pipeline | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <Dialog
      open={pipeline !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Switch off {pipeline?.name}?</DialogTitle>
          <DialogDescription>
            It has run twice without finding anything to suggest, and there is nothing waiting for
            you to answer. Switching it off stops it looking; everything it has already found stays
            where it is. You can turn it back on whenever you like.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDismiss}>
            Keep it running
          </Button>
          <Button type="button" onClick={onConfirm}>
            Switch it off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
