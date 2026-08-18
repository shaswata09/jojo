import { useState } from 'react'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import type { Application, Stage } from '@jojo/service/data/seed'
import { useSheets } from '@/lib/sheets-context'
import { useApplications } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'

/**
 * Everything a row or card can do to its record, in one place.
 *
 * The list row and the board card offer the same four things, and when each
 * owned its own copy of the delete confirmation the two said different things
 * about what survives.
 */
export function useRowActions() {
  const { open } = useSheets()
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
      action: { label: 'Undo', onPress: () => remove(copy.id) },
    })
  }

  // No toast: the filled icon says it on the row itself, and the same tap undoes
  // it. A toast per flag would fire twice a minute.
  const onFlag = (a: Application) =>
    update(a.id, {
      flagged: !a.flagged,
      lastAction: a.flagged ? 'Flag cleared' : 'Flagged for follow-up',
    })

  /** The single path a stage change takes — board pill and list chip alike. */
  const onMoveStage = (a: Application, stage: Stage) => {
    if (a.stage === stage) return
    // Snapshot all three fields the move rewrites. `update` stamps daysAgo 0 on
    // every edit unless the patch overrides it, so an undo that put back only
    // the stage would leave the row claiming it was touched today.
    const before = { stage: a.stage, lastAction: a.lastAction, daysAgo: a.daysAgo }
    setStage(a.id, stage)
    toast({
      title: `${displayName(a)} moved to ${STAGE_LABEL[stage]}`,
      description: `It was in ${STAGE_LABEL[before.stage]}. The pipeline and the funnel count it under ${STAGE_LABEL[stage]} from now on.`,
      action: { label: 'Undo', onPress: () => update(a.id, before) },
    })
  }

  const onDelete = () => {
    const a = pendingDelete
    if (!a) return
    const { restore } = remove(a.id)
    // The confirmation and the undo do different jobs: the sheet guards against
    // the mis-tap, the toast against the change of mind. `restore` puts back the
    // row at its old index *and* re-applies every edge the delete unlinked.
    toast({
      title: `${displayName(a)} deleted`,
      description: 'Reminders, files and saved postings filed under it were kept, unlinked.',
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  /** Rendered once per screen — a sheet per row would mount twelve copies. */
  const confirmSheet = (
    <ConfirmSheet
      open={pendingDelete !== null}
      onClose={() => setPendingDelete(null)}
      title={pendingDelete ? `Delete ${displayName(pendingDelete)}?` : 'Delete application?'}
      description="The application and its note go. Anything filed under it — reminders, files, saved postings — is kept but unlinked."
      confirmLabel="Delete"
      tone="danger"
      onConfirm={onDelete}
    />
  )

  return { onEdit, onDuplicate, onFlag, onMoveStage, requestDelete: setPendingDelete, confirmSheet }
}

export type RowActions = ReturnType<typeof useRowActions>
