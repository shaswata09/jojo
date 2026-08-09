import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarPlus,
  Copy,
  ExternalLink,
  FileQuestion,
  Flag,
  MoreHorizontal,
  PenLine,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { OfferBlock } from '@/components/applications/OfferBlock'
import type { OfferDecision } from '@/components/applications/OfferBlock'
import { STAGE_LABEL, StageMenu } from '@/components/applications/StageMenu'
import {
  StageTransitionDialog,
  stageNeedsDetails,
} from '@/components/applications/StageTransitionDialog'
import { Chip } from '@/components/common/Chip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Panel, PanelScroll, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { displayName } from '@/data/seed'
import type { Application, OfferApplication, Stage } from '@/data/seed'
import { TODAY, bucketOf, compareItems, shortDate, timeLabel, whenLabel } from '@/data/timeline'
import type { TimelineBucket, TimelineItem } from '@/data/timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { refKey } from '@/lib/ids'
import { appPath, applicationsPath, useTitle } from '@/lib/links'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import type { TimelineDraft } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

const bucketText: Record<TimelineBucket, string> = {
  overdue: 'text-danger',
  today: 'text-warning',
  upcoming: 'text-text-3',
  done: 'text-text-3',
}

const menuItem =
  'flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-2'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * The id on the record's heading.
 *
 * A constant rather than a `useId`, because its whole purpose is to be named
 * from outside: the sheet that wraps this owns the `role="dialog"` and needs an
 * `aria-labelledby` pointing at the record's name. Only one record renders at a
 * time, so a fixed id cannot collide.
 */
export const DETAIL_TITLE_ID = 'application-detail-title'

/** 'a', 'a and b', 'a, b and c'. */
function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

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
  const { id = '' } = useParams()
  const { get } = useApplications()
  const application = get(id)

  // The missing case first, because it is a real destination rather than an
  // error: a bookmark, a shared link, or the back button after a delete all
  // arrive here, and the alternative to this panel is a crash on `a.org`.
  if (!application) {
    return (
      <Panel className="min-w-0">
        <EmptyState
          icon={FileQuestion}
          title="This application no longer exists"
          description="It was deleted, or the link points at an id that never existed. Nothing else was removed with it."
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
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  // The record's own name, so a tab left open on one application is
  // distinguishable from the list it came from.
  useTitle(displayName(a))

  const [note, setNote] = useState(a.note)
  const [noteSaved, setNoteSaved] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const [target, setTarget] = useState<Stage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /** Set while the overflow menu is handing off to the stage menu — see below. */
  const handingOff = useRef(false)

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

  const labelKey = refKey('app', a.id)
  const items = useMemo(() => [...forApplication(a.id)].sort(compareItems), [forApplication, a.id])

  const openCount = items.filter((i) => !i.completedOn).length
  const reminderCount = items.filter((i) => i.remind).length
  const savedCount = [links, files, snippets, postings, matches].reduce(
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
   * The note is stored as plain text, and the field has to be one too.
   *
   * Six surfaces read this string — the board card, the table row, the ⌘K
   * result, the edit dialog's own Note box, the list's search haystack and the
   * seed — and every one of them prints it straight out. A rich-text box here
   * wrote its `innerHTML` into the field, so bolding a word left literal
   * `<span style="font-weight: bold;">` sitting on the board.
   *
   * Trimmed on the way in, and the field follows, so whitespace alone is not a
   * note and blurring twice does not write twice.
   */
  const commitNote = () => {
    const next = note.trim()
    if (next === a.note) return
    setNote(next)
    update(a.id, { note: next, lastAction: 'Note edited' })
    setNoteSaved(true)
  }

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
    applyStageMove({ stage, lastAction: `Moved to ${STAGE_LABEL[stage]}` })
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
          navigate(appPath(a.id))
        },
      },
    })
    navigate(appPath(copy.id))
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
          navigate(appPath(a.id))
        },
      },
    })
    navigate(applicationsPath())
  }

  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Source', value: a.source },
    { label: 'Location', value: a.location },
    // Falls through to the offer. Baylor's record states "$112k + $15k startup"
    // in the offer block and printed "Compensation —" 200px underneath it,
    // because the number was typed into the stage form and `a.comp` was never
    // the field it landed in.
    { label: 'Compensation', value: a.comp ?? a.offer?.comp },
    {
      label: 'Posting',
      value: a.url ? (
        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-info underline underline-offset-2"
        >
          {hostOf(a.url)}
          <ExternalLink className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        </a>
      ) : undefined,
    },
    { label: 'Applied on', value: a.appliedOn ? shortDate(a.appliedOn) : undefined },
    { label: 'Submitted on', value: a.submittedOn ? shortDate(a.submittedOn) : undefined },
  ]

  // One <h1> per route. Above `lg` the list beside this owns it — the record is
  // a sheet over that page, not the page — so the record's name is an h2 there
  // and the page's h1 below `lg`, where the list header steps aside entirely.
  const Heading = isDesktop ? 'h2' : 'h1'

  return (
    // A container query, not a viewport one: this renders at ~460px inside the
    // sheet and at ~900px when the sheet is the whole screen, and `sm:` cannot
    // tell those apart — it would put the fact list in two columns inside a
    // 420px sheet.
    <div className="@container flex min-w-0 flex-col gap-4">
      <Panel className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Only where there is no sheet to close. On a wide screen the X in
                the corner and escape are the way out, and a back link there
                would point at the list already on screen behind this. */}
            <Link
              to={applicationsPath()}
              className="inline-flex items-center gap-1 text-xs text-text-3 transition-colors hover:text-text-1 lg:hidden"
            >
              <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
              Applications
            </Link>
            <Heading
              id={DETAIL_TITLE_ID}
              className="mt-1.5 text-xl font-semibold break-words lg:mt-0"
            >
              {displayName(a)}
            </Heading>
            {/* The app's one relative vocabulary. "yesterday" was a sixth word
                for a gap the rest of the app spells "1 day ago". */}
            <p className="mt-0.5 text-xs text-text-3">
              {a.lastAction} · {a.daysAgo === 0 ? 'Today' : `${plural(a.daysAgo, 'day')} ago`}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {/* Neutral. The role is a category, not a status, and colour law
                  spends colour on the user's own keywords — which sit on the
                  row below this one and have to stay the loud thing.
                  The hand-authored `a.chips` are gone with it: they made this
                  header say "Offer" beside a stage pill already saying Offer. */}
              <Chip>{a.roleTag}</Chip>
              <StageMenu
                value={a.stage}
                onSelect={onPickStage}
                open={stageOpen}
                onOpenChange={(open) => {
                  setStageOpen(open)
                  if (!open) handingOff.current = false
                }}
              />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <LabelChips recordId={labelKey} />
              <LabelPicker recordId={labelKey} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-pressed={Boolean(a.flagged)}
              title={a.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'}
              aria-label={a.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'}
              onClick={() =>
                update(a.id, {
                  flagged: !a.flagged,
                  lastAction: a.flagged ? 'Flag cleared' : 'Flagged for follow-up',
                })
              }
              className={cn(
                'grid size-8 place-items-center rounded-lg border transition-colors',
                a.flagged
                  ? 'border-danger-border bg-danger-soft text-danger'
                  : 'border-hairline bg-well text-text-3 hover:border-hairline-strong hover:text-text-1',
              )}
            >
              <Flag className="size-3.5" strokeWidth={1.9} aria-hidden />
            </button>

            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                aria-label="More actions"
                title="More actions"
                className="grid size-8 place-items-center rounded-lg border border-hairline bg-well text-text-3 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.9} aria-hidden />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-52 gap-1 p-1.5"
                // Radix returns focus to this trigger as the popover closes,
                // which would pull it straight back off the stage menu we just
                // opened. Suppressed only for that one hand-off.
                onCloseAutoFocus={(event) => {
                  if (handingOff.current) event.preventDefault()
                }}
              >
                <button
                  type="button"
                  className={menuItem}
                  disabled={!onEdit}
                  // The old blocker said the edit dialog was not mounted yet.
                  // It is — App.tsx wires both handlers at the one place this
                  // page is rendered, so this branch is unreachable today. It
                  // stays as the prop contract, and now names something that
                  // would actually be true if a second caller ever omitted it.
                  title={
                    onEdit
                      ? undefined
                      : 'Editing is unavailable here — open this record from Applications'
                  }
                  onClick={() => {
                    onEdit?.(a.id)
                    setMenuOpen(false)
                  }}
                >
                  <Pencil className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                  Edit
                </button>

                {/* The record's own way into a message. Until this existed the
                    only route to a filled thank-you was: add a reminder, go to
                    the Vault, find its row, press the Draft button on it. */}
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    onDraft()
                  }}
                >
                  <PenLine className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                  Draft a message
                </button>

                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    onDuplicate()
                  }}
                >
                  <Copy className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                  Duplicate
                </button>

                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    handingOff.current = true
                    setMenuOpen(false)
                    setStageOpen(true)
                  }}
                >
                  <ArrowRightLeft className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                  Move to…
                </button>

                <button
                  type="button"
                  className={cn(menuItem, 'text-danger hover:bg-danger-soft hover:text-danger')}
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmDelete(true)
                  }}
                >
                  <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                  Delete
                </button>
              </PopoverContent>
            </Popover>

            {/* Last in the cluster, where a dismiss belongs. Escape does the
                same thing; both hand off to the container, which owns whatever
                the sheet has to do on the way out. */}
            <button
              type="button"
              onClick={close}
              title="Close this record"
              aria-label="Close this record"
              className="grid size-8 place-items-center rounded-lg border border-transparent text-text-3 transition-colors hover:border-hairline hover:bg-well hover:text-text-1"
            >
              <X className="size-4" strokeWidth={1.9} aria-hidden />
            </button>
          </div>
        </div>
      </Panel>

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

      <Panel className="min-w-0">
        <PanelTitle>Details</PanelTitle>
        <dl className="grid gap-x-5 gap-y-3 @md:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-text-3">{f.label}</dt>
              <dd className="mt-0.5 truncate text-sm text-text-1">
                {f.value ?? <span className="text-text-3">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      {/* Second, not last.
          The record's dates and the only Add button on the page used to sit
          79px below the fold, underneath an empty rich-text editor and its
          eight-button toolbar — so the one thing this page is opened to check
          was the one thing you had to scroll for. */}
      <Panel className="flex min-w-0 flex-col">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <PanelTitle
            className="mb-0"
            hint={items.length > 0 ? `${openCount} open · ${items.length} total` : undefined}
          >
            {/* Not "Upcoming": this list holds overdue and completed rows too,
                and a heading that promised the future while showing a thing you
                missed last week was the least trustworthy word on the page. */}
            Dates and reminders
          </PanelTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={!onAddItem}
            // Same stale-blocker fix as Edit above: the dialog is mounted.
            title={
              onAddItem
                ? undefined
                : 'Adding is unavailable here — open this record from Applications'
            }
            onClick={() => onAddItem?.(a.id)}
          >
            <CalendarPlus className="size-3.5" strokeWidth={2} aria-hidden />
            Add a date
          </Button>
        </div>

        {items.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description="Deadlines, interviews and follow-ups filed against this application show up here."
            action={
              onAddItem ? (
                <Button size="sm" variant="outline" onClick={() => onAddItem(a.id)}>
                  <CalendarPlus className="size-3.5" strokeWidth={2} aria-hidden />
                  Add a date
                </Button>
              ) : undefined
            }
          />
        ) : (
          // Bounded rather than free-growing: an application in its fifth round
          // can carry a dozen rows, and they should not push the rest of the
          // column off the screen.
          <PanelScroll axis="y" className="max-h-80">
            <ul className="divide-y divide-hairline">
              {items.map((item) => (
                <UpcomingRow
                  key={item.id}
                  item={item}
                  onDraft={() => openDialog('draft', { itemId: item.id })}
                />
              ))}
            </ul>
          </PanelScroll>
        )}
      </Panel>

      <Panel className="min-w-0">
        <PanelTitle hint="Saves when you click away">Note</PanelTitle>
        {/* Commits on blur rather than on every keystroke: a dispatch behind
            each character would reset `daysAgo` while you typed. The box starts
            at ~120px and grows with what is typed — `field-sizing-content` on
            the shared Textarea — because the note is empty on ten of twelve
            records and a permanent tall box for it would be all promise. */}
        <Textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
            setNoteSaved(false)
          }}
          onBlur={commitNote}
          placeholder="What is still outstanding, who you spoke to, what to ask next"
          aria-label={`Note on ${displayName(a)}`}
          className="min-h-[7.5rem]"
        />
        <p role="status" className="mt-1.5 text-xs text-text-3">
          {noteSaved ? 'Note saved' : null}
        </p>
      </Panel>

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

/** The kinds a message is the obvious next move on. */
const DRAFTABLE: readonly TimelineItem['kind'][] = ['interview', 'follow-up', 'call', 'visit']

function UpcomingRow({ item, onDraft }: { item: TimelineItem; onDraft: () => void }) {
  const Icon = KIND_ICON[item.kind]
  const bucket = bucketOf(item, TODAY)
  const done = Boolean(item.completedOn)
  const draftable = !done && DRAFTABLE.includes(item.kind)

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm', done && 'text-text-3 line-through')}>{item.title}</div>
        <div className="mt-0.5 truncate text-xs text-text-3">
          {KIND_LABEL[item.kind]}
          {item.detail ? ` · ${item.detail}` : ''}
        </div>
        {/* Under the row rather than beside the date, so a row that has a
            message to write does not shunt the date column sideways from the
            rows above and below it. */}
        {draftable ? (
          <Button
            size="xs"
            variant="outline"
            className="mt-1.5"
            onClick={onDraft}
            aria-label={`Draft a message for ${item.title}`}
          >
            <PenLine className="size-3" strokeWidth={2} aria-hidden />
            Draft a message
          </Button>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <div className={cn('text-xs font-medium whitespace-nowrap', bucketText[bucket])}>
          {whenLabel(item, TODAY)}
        </div>
        <div className="mt-0.5 font-mono text-xs whitespace-nowrap text-text-3">
          {timeLabel(item) ?? shortDate(item.date)}
        </div>
      </div>
    </li>
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

/**
 * 'stripe.com' out of a posting URL, so the link reads as a destination rather
 * than as 180 characters of tracking parameters. A URL the user typed by hand
 * may not parse at all, in which case the raw string is still the honest thing
 * to show.
 */
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
