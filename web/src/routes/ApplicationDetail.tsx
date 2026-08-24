import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { FileQuestion } from 'lucide-react'
import { DatesPanel } from '@/components/applications/detail/DatesPanel'
import { FiledPanel } from '@/components/applications/detail/FiledPanel'
import { DetailFacts } from '@/components/applications/detail/DetailFacts'
import { DetailHeader } from '@/components/applications/detail/DetailHeader'
import { NotePanel } from '@/components/applications/detail/NotePanel'
import { plainStageMove, stageNeedsDetails } from '@jojo/service/core/stage-policy'
import { OfferBlock } from '@/components/applications/OfferBlock'
import type { OfferDecision } from '@/components/applications/OfferBlock'
import { StageTransitionDialog } from '@/components/applications/StageTransitionDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { listJoin, plural } from '@/components/common/text'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, OfferApplication, Stage } from '@/data/seed'
import { compareItems } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useScout } from '@jojo/service/react/use-scout'
import type { TimelineDraft } from '@jojo/service/react/use-timeline'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { useDialogs } from '@/lib/dialogs-context'
import { appPath, applicationsPath, useTitle } from '@/lib/links'
import { useToast } from '@/lib/toast-context'

export type ApplicationDetailProps = {
  /**
   * Opens the timeline-item dialog, which another surface owns. Passed in
   * rather than imported so this page does not depend on a component it does
   * not control — and so the Add button can honestly disable itself when
   * nothing has been wired up yet.
   */
  onAddItem?: (applicationId: string) => void
  /** Opens the application dialog in edit mode. Same reasoning as `onAddItem`. */
  onEdit?: (applicationId: string) => void
  /**
   * Dismisses the record.
   *
   * The container owns this because the record is now an overlay sheet over the
   * list: the sheet has an animation to run out and a scroll position to hand
   * back, and neither is this component's to know. Left off, closing falls back
   * to navigating to the list, which is what the route did before there was a
   * sheet at all.
   */
  onClose?: () => void
}

/**
 * One application, at its own address.
 *
 * Nine surfaces link to an application — the board card, the table row, the
 * dashboard's recent list, a reminder's "related to", the spotlight results —
 * and until this existed every one of them pointed at nothing.
 */
export function ApplicationDetail({ onAddItem, onEdit, onClose }: ApplicationDetailProps) {
  // The path segment, which is a slug ('/applications/rice') or — for a link
  // built before the builder emitted slugs — a NodeId. `get` is the one place
  // that knows the difference; nothing here may compare it to `a.id`.
  const { key = '' } = useParams()
  const { get } = useApplications()
  const application = get(key)

  // The missing case first, because it is a real destination rather than an
  // error: a bookmark, a shared link, or the back button after a delete all
  // arrive here, and the alternative to this panel is a crash on `a.org`.
  if (!application) {
    return (
      <Panel className="min-w-0">
        <EmptyState
          icon={FileQuestion}
          title="This application no longer exists"
          description="It was deleted, or the link points at a record that never existed. Nothing else was removed with it."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={applicationsPath()}>Back to applications</Link>
            </Button>
          }
        />
      </Panel>
    )
  }

  // Keyed so the note draft below belongs to one record. Without it, navigating
  // between two applications would carry the first one's unsaved note across.
  return (
    <Detail
      key={application.id}
      application={application}
      onAddItem={onAddItem}
      onEdit={onEdit}
      onClose={onClose}
    />
  )
}

function Detail({
  application: a,
  onAddItem,
  onEdit,
  onClose,
}: { application: Application } & ApplicationDetailProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { open: openDialog } = useDialogs()
  const { update, remove, duplicate } = useApplications()
  const { forApplication, add: addItem, remove: removeItem } = useTimeline()
  const { links, files, snippets } = useVault()
  const { postings, matches } = useScout()
  // The record's own name, so a tab left open on one application is
  // distinguishable from the list it came from.
  useTitle(displayName(a))

  const [target, setTarget] = useState<Stage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const close = useCallback(() => {
    if (onClose) onClose()
    else navigate(applicationsPath())
  }, [onClose, navigate])

  /**
   * Escape closes the record.
   *
   * The record renders as a sheet over the list, so escape has to mean what it
   * means over any other overlay. Two guards, because escape is a shared key:
   * a dialog or a popover on top of this — the stage form, the delete
   * confirmation, the ⋯ menu — owns the press first, and dismissing the whole
   * record out from under the dialog the user was cancelling would be the
   * rudest thing on the page. `defaultPrevented` catches the layers that mark
   * the event; the DOM query catches Radix, which does not.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role=dialog], [data-radix-popper-content-wrapper]')) return
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  const items = useMemo(() => [...forApplication(a.id)].sort(compareItems), [forApplication, a.id])

  const reminderCount = items.filter((i) => i.remind).length
  /*
   * Two shapes in one count, because two relations became many and two did not.
   *
   * Links, files and snippets carry `applicationIds` — `FILED_UNDER` is
   * many-to-many, so a CV counts for every job it was sent to. Postings and
   * matches carry a scalar `applicationId` from `BECAME`, which is genuinely
   * one: a posting becomes at most one application.
   */
  const savedCount =
    [links, files, snippets].reduce(
      (n, list) => n + list.filter((r) => r.applicationIds.includes(a.id)).length,
      0,
    ) +
    [postings, matches].reduce(
      (n, list) => n + list.filter((r) => r.applicationId === a.id).length,
      0,
    )

  /**
   * What survives the delete, counted rather than guessed.
   *
   * `remove()` unlinks and never cascades, so the confirmation has to say so —
   * "delete Rice" cannot fairly be read as consent to delete the four files
   * someone spent an evening on, and a dialog that stayed vague about it would
   * be asking for consent to something the user has not been told.
   */
  const kept = listJoin(
    [
      reminderCount > 0 ? plural(reminderCount, 'reminder') : '',
      items.length - reminderCount > 0 ? plural(items.length - reminderCount, 'event') : '',
      savedCount > 0 ? plural(savedCount, 'saved item') : '',
    ].filter(Boolean),
  )

  /**
   * Every write that changes the stage, and the only one that can undo itself.
   *
   * A stage move rewrites up to five fields in one go and can drop the offer
   * the user typed — while merely *deleting* the record gets both a confirm
   * dialog and an undo. Snapshotting first is what closes that gap: `a` is the
   * record as it stands this render, so the revert is a fact rather than a
   * reconstruction, and the minted timeline row goes back out with it.
   */
  const applyStageMove = (
    patch: Partial<Application>,
    extraItem?: TimelineDraft,
    consequences: string[] = [],
  ) => {
    const before = a
    const to = patch.stage ?? a.stage

    update(a.id, patch)
    const minted = extraItem ? addItem(extraItem) : undefined

    toast({
      title: `${displayName(a)} moved to ${STAGE_LABEL[to]}`,
      description: consequences.length > 0 ? consequences.join(' ') : undefined,
      action: {
        label: 'Undo',
        onClick: () => {
          update(before.id, revertOf(before, patch))
          if (minted) removeItem(minted.id)
        },
      },
    })
  }

  const onPickStage = (stage: Stage) => {
    if (stageNeedsDetails(a, stage)) {
      setTarget(stage)
      return
    }
    applyStageMove(plainStageMove(stage))
  }

  const onDecide = (decision: OfferDecision) => {
    const before = a
    const patch: Partial<Application> = {
      stage: 'closed',
      outcome: decision,
      lastAction: decision === 'accepted' ? 'Offer accepted' : 'Offer declined',
    }
    update(a.id, patch)
    toast({
      title: `${displayName(a)} closed`,
      description: `Recorded as ${decision}. The offer details and its reminders were kept.`,
      action: { label: 'Undo', onClick: () => update(before.id, revertOf(before, patch)) },
    })
  }

  const onDuplicate = () => {
    const copy = duplicate(a.id)
    if (!copy) return
    toast({
      title: `${displayName(copy)} duplicated`,
      description: 'The copy starts at Draft, with the note and details carried over.',
      action: {
        label: 'Undo',
        onClick: () => {
          remove(copy.id)
          navigate(appPath(a))
        },
      },
    })
    navigate(appPath(copy))
  }

  const onDraft = () => openDialog('draft', { applicationId: a.id })

  const onDelete = () => {
    const { restore } = remove(a.id)
    // Both guards, because they catch different mistakes: the dialog catches
    // the mis-click, the undo catches the change of mind. `restore` also puts
    // back every edge the delete unlinked, which the user could not rebuild by
    // simply adding the application again.
    toast({
      title: `${displayName(a)} deleted`,
      description: kept ? `${kept} were kept, unlinked.` : undefined,
      tone: 'danger',
      action: {
        label: 'Undo',
        onClick: () => {
          restore()
          navigate(appPath(a))
        },
      },
    })
    navigate(applicationsPath())
  }

  return (
    // A container query, not a viewport one: this renders at ~460px inside the
    // sheet and at ~900px when the sheet is the whole screen, and `sm:` cannot
    // tell those apart — it would put the fact list in two columns inside a
    // 420px sheet.
    <div className="@container flex min-w-0 flex-col gap-4">
      <DetailHeader
        application={a}
        onPickStage={onPickStage}
        onEdit={onEdit}
        onDraft={onDraft}
        onDuplicate={onDuplicate}
        onRequestDelete={() => setConfirmDelete(true)}
        onClose={close}
      />

      {/* Above the facts on purpose: a respond-by countdown is the most
          perishable thing on this page, and the one you came to check.
          Rendered from the offer rather than from the stage, so the details the
          confirmation promised to keep survive the move to closed instead of
          vanishing with the block that displayed them. */}
      {a.offer ? (
        <OfferBlock
          application={a as OfferApplication}
          onDecide={onDecide}
          settled={a.stage === 'closed' ? (a.outcome ?? 'withdrawn') : undefined}
        />
      ) : null}

      <DetailFacts application={a} />

      <DatesPanel applicationId={a.id} items={items} onAddItem={onAddItem} />

      <NotePanel application={a} />

      <FiledPanel applicationId={a.id} />

      {target ? (
        <StageTransitionDialog
          open
          onOpenChange={(open) => {
            if (!open) setTarget(null)
          }}
          application={a}
          target={target}
          onApply={applyStageMove}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${displayName(a)}?`}
        description={
          kept
            ? `The application and its note go. ${kept} will be kept but unlinked — nothing you filed under it is deleted.`
            : 'The application and its note go. Nothing else points at it.'
        }
        confirmLabel="Delete application"
        tone="danger"
        onConfirm={onDelete}
      />
    </div>
  )
}

/**
 * The patch that puts `before` back, given the patch that changed it.
 *
 * Keyed off the patch rather than off a hand-written field list on purpose: the
 * stage form writes a different set of fields for each destination — six today
 * — and a list here would be a seventh place to remember when one of them grows
 * a field. `undefined` values count: `{ offer: undefined }` is how the form
 * clears an offer, and `Object.keys` sees it, which is exactly the write that
 * most needs undoing.
 *
 * `daysAgo` rides along because `update` stamps it to 0 on every write, so
 * without it an undone move would still claim the record was touched today.
 */
function revertOf(before: Application, patch: Partial<Application>): Partial<Application> {
  const revert: Record<string, unknown> = { daysAgo: before.daysAgo }
  for (const key of Object.keys(patch)) revert[key] = before[key as keyof Application]
  return revert as Partial<Application>
}
