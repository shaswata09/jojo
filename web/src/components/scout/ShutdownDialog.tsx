import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('scout')
  return (
    <Dialog
      open={pipeline !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('shutdown.title', { name: pipeline?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('shutdown.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDismiss}>
            {t('shutdown.keep')}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t('shutdown.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
