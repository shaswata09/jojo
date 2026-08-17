import { useCallback, useState } from 'react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { STAGE_LABEL, displayName, type Application, type Stage } from '@/data/seed'
import { useApplications } from '@/kg/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
import { useToast } from '@/lib/toast-context'

/**
 * Everything a row or card can do to its record, in one place.
 *
 * The table row and the board card offer the same four things, and when each
 * owned its own copy of the delete confirmation the two dialogs said different
 * things about what survives. The board's drag now lands here too — it used to
 * write the stage straight into the store with no toast and no way back, which
 * made the page's one direct-manipulation gesture also its one unrecoverable
 * one.
 */
export function useRowActions() {
  const { open } = useDialogs()
  const { update, remove, duplicate, setStage } = useApplications()
  const { toast } = useToast()
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null)

  const onEdit = (a: Application) => open('application', { mode: 'edit', id: a.id })

  const onDuplicate = (a: Application) => {
    const copy = duplicate(a.id)
    if (!copy) return
    toast({
      title: `${displayName(copy)} duplicated`,
      description: 'The copy starts as a draft — the original stage, dates and offer stay behind.',
      action: { label: 'Undo', onClick: () => remove(copy.id) },
    })
  }

  // No toast: `aria-pressed` and the filled icon say it on the row itself, and
  // the same click undoes it. A toast per flag would fire twice a minute.
  const onFlag = (a: Application) =>
    update(a.id, {
      flagged: !a.flagged,
      lastAction: a.flagged ? 'Flag cleared' : 'Flagged for follow-up',
    })

  /** The single path a stage change takes — drag, board pill and table chip. */
  const onMoveStage = useCallback(
    (a: Application, stage: Stage) => {
      if (a.stage === stage) return
      // Snapshot all three fields the move rewrites. `update` stamps daysAgo 0
      // on every edit unless the patch overrides it, so an undo that put back
      // only the stage would leave the row claiming it was touched today — and
      // daysAgo is the list's default sort.
      const before = { stage: a.stage, lastAction: a.lastAction, daysAgo: a.daysAgo }
      setStage(a.id, stage)
      toast({
        title: `${displayName(a)} moved to ${STAGE_LABEL[stage]}`,
        description: `It was in ${STAGE_LABEL[before.stage]}. The dashboard pipeline and the funnel count it under ${STAGE_LABEL[stage]} from now on.`,
        action: { label: 'Undo', onClick: () => update(a.id, before) },
      })
    },
    [setStage, update, toast],
  )

  const onDelete = () => {
    const a = pendingDelete
    if (!a) return
    const { restore } = remove(a.id)
    // The confirmation and the undo do different jobs, so this record gets
    // both: the dialog guards against the mis-click, the toast against the
    // change of mind. `restore` puts back the row at its old index *and*
    // re-applies every edge the delete unlinked, which is not something the
    // user could reconstruct by adding the application again.
    toast({
      title: `${displayName(a)} deleted`,
      description: 'Reminders, files and saved postings filed under it were kept, unlinked.',
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  /** Render once per page — a dialog per row would mount six copies of it. */
  const confirmDialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      onOpenChange={(open) => {
        if (!open) setPendingDelete(null)
      }}
      title={pendingDelete ? `Delete ${displayName(pendingDelete)}?` : 'Delete application?'}
      description="The application and its note go. Anything filed under it — reminders, files, saved postings — is kept but unlinked."
      confirmLabel="Delete application"
      tone="danger"
      onConfirm={onDelete}
    />
  )

  return {
    onEdit,
    onDuplicate,
    onFlag,
    onMoveStage,
    requestDelete: setPendingDelete,
    confirmDialog,
  }
}

export type RowActions = ReturnType<typeof useRowActions>
