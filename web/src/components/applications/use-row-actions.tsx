import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { displayName, type Application, type Stage } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { ACTION_PHRASES } from '@jojo/service/core/domain-text'
import { useDialogs } from '@/lib/dialogs-context'
import { useToast } from '@/lib/toast-context'
import { useUndoable } from '@/lib/undo'
import { report } from '@/lib/analytics'
import { stageGesture } from '@/lib/mascot-cues'
import { useMascot } from '@/lib/mascot-context'
import { announceRefusal } from '@/components/common/write-result'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const { open } = useDialogs()
  const { update, remove, duplicate, setStage } = useApplications()
  const { toast } = useToast()
  const undoable = useUndoable()
  const { play } = useMascot()
  const [pendingDelete, setPendingDelete] = useState<Application | null>(null)

  const onEdit = (a: Application) => open('application', { mode: 'edit', id: a.id })

  const onDuplicate = (a: Application) => {
    const copy = duplicate(a.id)
    if (!copy) return
    toast({
      title: t('rowActions.duplicated', { name: displayName(copy) }),
      description: t('rowActions.duplicatedBody'),
      action: { label: t('common.undo'), onClick: () => remove(copy.id) },
    })
  }

  // No toast: `aria-pressed` and the filled icon say it on the row itself, and
  // the same click undoes it. A toast per flag would fire twice a minute.
  const onFlag = (a: Application) =>
    update(a.id, {
      flagged: !a.flagged,
      lastAction: a.flagged ? ACTION_PHRASES.flagCleared : ACTION_PHRASES.flagged,
    })

  /** The single path a stage change takes — drag, board pill and table chip. */
  const onMoveStage = useCallback(
    (a: Application, stage: Stage) => {
      if (a.stage === stage) return
      // The journal's Undo, not a hand-built patch: `application.update` also
      // stamps `stageDates` and `submittedOn` on a stage change, so putting back
      // only stage/lastAction/daysAgo left a Draft→Submitted→Undo record
      // counted as sent, dated for a stage it never reached.
      const from = a.stage
      const { value: moved, restore } = undoable(() => setStage(a.id, stage))
      if (announceRefusal(moved, toast)) return
      /*
       * Moving BACK to draft is not an advance and the vocabulary has no value
       * for it, so it is not reported. That is the vocabulary being right rather
       * than incomplete: the question this event answers is how far people get,
       * and a correction back to draft is not an answer to it.
       */
      if (stage !== 'draft') report('application_advanced', { to: stage })
      /*
       * The mascot reacts to the move with the gesture that stage earns — a
       * draft sent off dances, an interview powers up (lib/mascot-cues.ts).
       * Here rather than in the board's drop handler because the board pill
       * and the table's stage menu do the same thing by a different gesture,
       * and a robot that only answered the drag would read as the other two
       * not having landed.
       *
       * Nothing to guard. A page with no `MascotProvider` gets a no-op `play` by
       * design, and both renderers drop the animation themselves under
       * `prefers-reduced-motion`.
       */
      const gesture = stageGesture(from, stage, a.outcome)
      if (gesture) play(gesture)
      toast({
        title: t('rowActions.moved', { name: displayName(a), stage: domain.stage(stage) }),
        description: t('rowActions.movedBody', {
          from: domain.stage(from),
          stage: domain.stage(stage),
        }),
        ...(restore ? { action: { label: t('common.undo'), onClick: restore } } : {}),
      })
    },
    [setStage, undoable, toast, play, t, domain],
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
      title: t('rowActions.deleted', { name: displayName(a) }),
      description: t('rowActions.deletedBody'),
      tone: 'danger',
      action: { label: t('common.undo'), onClick: restore },
    })
  }

  /** Render once per page — a dialog per row would mount six copies of it. */
  const confirmDialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      onOpenChange={(open) => {
        if (!open) setPendingDelete(null)
      }}
      title={
        pendingDelete
          ? t('rowActions.confirmTitle', { name: displayName(pendingDelete) })
          : t('rowActions.confirmTitleFallback')
      }
      description={t('rowActions.confirmBody')}
      confirmLabel={t('rowActions.confirmLabel')}
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
