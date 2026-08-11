import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { usage } from '@/components/common/label-display'
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
  const { labels, removeLabel, countFor } = useLabels()
  const { toast } = useToast()

  const label = id ? (labels.find((l) => l.id === id) ?? null) : null
  const used = label ? countFor(label.id) : 0

  const onConfirm = () => {
    if (!label) return
    const { restore } = removeLabel(label.id)
    toast({
      title: `${label.name} deleted`,
      description:
        used === 0
          ? 'It was not on any record.'
          : `Taken off ${usage(used)}, and out of the keyword filter.`,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  return (
    <ConfirmDialog
      open={label !== null}
      onOpenChange={onOpenChange}
      title={label ? `Delete ${label.name}?` : 'Delete keyword?'}
      description={
        used === 0
          ? 'Not on any record yet, so nothing else changes.'
          : `Used on ${usage(used)}. Those records stay — they lose this keyword.`
      }
      confirmLabel="Delete keyword"
      tone="danger"
      onConfirm={onConfirm}
    />
  )
}
