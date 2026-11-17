import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'

/**
 * The confirmation and the undo for deleting a keyword.
 *
 * Both, deliberately. The keyword itself is cheap — retype the name — but its
 * edges are not: putting "Referral" back by hand means finding the nine records
 * it was on again, which is exactly what `restore` rebuilds. So the dialog
 * guards the mis-click, and the toast guards the change of mind.
 *
 * Driven by an id rather than owning the pending state, so one dialog serves a
 * whole row of chips instead of mounting a copy per keyword.
 */
export function DeleteKeywordDialog({
  id,
  onOpenChange,
}: {
  /** The keyword awaiting confirmation, or null when nothing is pending. */
  id: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { labels, removeLabel, countFor } = useLabels()
  const { toast } = useToast()

  const label = id ? (labels.find((l) => l.id === id) ?? null) : null
  const used = label ? countFor(label.id) : 0

  const onConfirm = () => {
    if (!label) return
    const removed = removeLabel(label.id)
    if (!removed.ok) {
      toast({
        title: t('deleteKeyword.failed'),
        description: removed.refusal ?? t('deleteKeyword.stillThere', { name: label.name }),
        tone: 'danger',
      })
      return
    }
    const { restore } = removed
    toast({
      title: t('deleteKeyword.deleted', { name: label.name }),
      description:
        used === 0 ? t('deleteKeyword.wasUnused') : t('deleteKeyword.takenOff', { count: used }),
      tone: 'danger',
      action: { label: t('actions.undo'), onClick: restore },
    })
  }

  return (
    <ConfirmDialog
      open={label !== null}
      onOpenChange={onOpenChange}
      title={
        label
          ? t('deleteKeyword.confirmTitle', { name: label.name })
          : t('deleteKeyword.confirmTitleAny')
      }
      description={
        used === 0 ? t('deleteKeyword.unused') : t('deleteKeyword.usedOn', { count: used })
      }
      confirmLabel={t('deleteKeyword.confirm')}
      tone="danger"
      onConfirm={onConfirm}
    />
  )
}
