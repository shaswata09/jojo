import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
} from '@dnd-kit/core'
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Copy,
  Flag,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { STAGE_LABEL, StageMenu } from '@/components/applications/StageMenu'
import { Chip } from '@/components/common/Chip'
import { AddByUrl } from '@/components/common/AddByUrl'
import { BucketFilter } from '@/components/common/BucketFilter'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LabelChips, LabelFilter, LabelPicker } from '@/components/common/LabelFilter'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelScroll } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { RoleFilter } from '@/components/layout/RoleFilter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { STAGES, displayName, type Application, type Stage } from '@/data/seed'
import { addDays, agoLabel, compareItems, daysBetween, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useApplications } from '@/kg/react/use-applications'
import { useTimeline } from '@/kg/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import {
  appPath,
  formatSort,
  parseSort,
  useApplicationsParams,
  useTitle,
  type ApplicationsSortKey,
  type ApplicationsView,
} from '@/lib/links'
import { TODAY } from '@/lib/today'
import { useFillViewport } from '@/lib/use-fill-viewport'
import { DESKTOP_QUERY, useMediaQuery, useReducedMotion } from '@/lib/use-media-query'
import { useRoles } from '@/lib/roles-context'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

const VIEWS = [
  { value: 'table', label: 'Table' },
  { value: 'board', label: 'Board' },
] as const satisfies readonly { value: ApplicationsView; label: string }[]

const menuItem =
  'flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-well hover:text-text-1'

/**
 * The one marker for "this is the record open beside the list".
 *
 * A left rail rather than a background tint: `.surface` sets `background` in the
 * same cascade layer Tailwind emits utilities into, so `bg-accent-soft` on a
 * board card silently loses. A pseudo-element owes nothing to that fight.
 */
const openRail =
  'before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent before:content-[""]'

/**
 * The words come from `agoLabel`, so this column speaks the same past tense as
 * "Completed 3 days ago" in the Vault and "saved 5 days ago" in the profile —
 * including its two-week cut-off, past which a count of days stops being
 * information and the plain date is what you would say out loud.
 *
 * Capitalised here and nowhere else: `agoLabel` leads lowercase because every
 * other consumer uses it mid-phrase, and this is the one place it stands alone
 * as a cell value.
 */
function activityLabel(daysAgo: number) {
  const ago = agoLabel(addDays(TODAY, -daysAgo), TODAY)
  return ago.charAt(0).toUpperCase() + ago.slice(1)
}

/* ------------------------------ row actions ------------------------------ */

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
function useRowActions() {
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

type RowActions = ReturnType<typeof useRowActions>

/** Edit · Duplicate · Delete, behind one overflow button. */
function RowMenu({ app, actions }: { app: Application; actions: RowActions }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`More actions for ${displayName(app)}`}
        title="More actions"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 transition-colors hover:border-hairline hover:bg-well hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
      >
        <MoreHorizontal className="size-4" strokeWidth={1.9} aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 gap-1 p-1.5">
        <button
          type="button"
          className={menuItem}
          onClick={() => {
            setOpen(false)
            actions.onEdit(app)
          }}
        >
          <Pencil className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          Edit
        </button>
        <button
          type="button"
          className={menuItem}
          onClick={() => {
            setOpen(false)
            actions.onDuplicate(app)
          }}
        >
          <Copy className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          Duplicate
        </button>
        <button
          type="button"
          className={cn(menuItem, 'text-danger hover:bg-danger-soft hover:text-danger')}
          onClick={() => {
            setOpen(false)
            actions.requestDelete(app)
          }}
        >
          <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          Delete
        </button>
      </PopoverContent>
    </Popover>
  )
}

function FlagButton({ app, onFlag }: { app: Application; onFlag: (a: Application) => void }) {
  const label = app.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'
  return (
    <button
      type="button"
      aria-pressed={Boolean(app.flagged)}
      aria-label={`${label} on ${displayName(app)}`}
      title={label}
      onClick={() => onFlag(app)}
      className={cn(
        'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border transition-colors',
        app.flagged
          ? 'border-danger-border bg-danger-soft text-danger'
          : 'border-transparent text-text-3 hover:border-hairline hover:bg-well hover:text-text-1',
      )}
    >
      <Flag className="size-3.5" strokeWidth={1.9} aria-hidden />
    </button>
  )
}

/* --------------------------------- dates --------------------------------- */

/**
 * The next thing this application owes, if anything does.
 *
 * Overdue first, then soonest: an application whose deadline passed on Friday
 * has nothing more urgent than that, so the column has to lead with it rather
 * than skip ahead to next month's interview.
 */
function nextDateOf(items: TimelineItem[] | undefined) {
  if (!items || items.length === 0) return undefined
  return [...items].filter((i) => !i.completedOn).sort(compareItems)[0]
}

function NextDateCell({ item }: { item?: TimelineItem }) {
  if (!item) {
    return (
      <span className="text-text-3" aria-label="No date">
        —
      </span>
    )
  }

  // Colour law: red is past due and nothing else, amber is the next 48 hours
  // and nothing else. Everything further out is plain text, however important.
  const gap = daysBetween(TODAY, item.date)
  const tone = gap < 0 ? 'text-danger' : gap <= 1 ? 'text-warning' : 'text-text-3'

  return (
    <span className={tone}>
      {shortDate(item.date)}
      {/* The colour carries this for anyone who can see it; the gap itself is
          only spoken, so the cell stays one date wide. */}
      <span className="sr-only"> — {whenLabel(item, TODAY).toLowerCase()}</span>
    </span>
  )
}

/* ------------------------------- board ---------------------------------- */

/**
 * The card itself, with no drag wiring.
 *
 * Shared by the card sitting in its column and by the copy rendered in the drag
 * overlay, so the thing you pick up is near enough identical to the thing you
 * put down. The overlay copy passes no `handle` and no `onMoveStage`: it is a
 * picture of a card in transit, and a live popover trigger inside it would be a
 * focusable control the user cannot reach.
 */
function BoardCardBody({
  app,
  handle,
  onMoveStage,
  open,
  lifted,
  className,
  ref,
}: {
  app: Application
  /** Grip props from useDraggable. Omitted for the overlay copy, which is inert. */
  handle?: {
    attributes: DraggableAttributes
    listeners: ReturnType<typeof useDraggable>['listeners']
  }
  onMoveStage?: (a: Application, stage: Stage) => void
  /** True when this record is the one showing in the detail sheet. */
  open?: boolean
  /** Raises the card off the board while it is being carried. */
  lifted?: boolean
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    // `relative`, because the title's link stretches across the whole card.
    // The left padding is the grip's gutter: the grip is positioned out of the
    // flow so the title starts at the same x as the chips under it.
    <div
      ref={ref}
      className={cn(
        'surface group relative rounded-md py-2.5 pr-2.5 pl-5',
        open && openRail,
        className,
      )}
      // Inline, not `shadow-[…]`: `.surface` sets box-shadow from the same
      // cascade layer Tailwind emits utilities into, and wins by source order —
      // which is why the drag overlay used to travel with no lift at all.
      style={lifted ? { boxShadow: 'var(--shadow-raised)' } : undefined}
    >
      <button
        type="button"
        // The overlay copy is decorative; the real one is the drag handle.
        tabIndex={handle ? undefined : -1}
        aria-hidden={handle ? undefined : true}
        className={cn(
          // z-[1] lifts the grip over the stretched link. Without it the link
          // covers the handle and a drag becomes a navigation — which is the
          // click-versus-drag fight, settled by stacking order rather than by
          // stopping propagation between two controls that now never overlap.
          'absolute top-1/2 left-0.5 z-[1] -translate-y-1/2 cursor-grab touch-none rounded-sm p-0.5 text-text-3 transition-opacity active:cursor-grabbing',
          // It was `opacity-0` until hover: the board's core gesture had no
          // visible affordance at all, and on touch there is no hover to
          // reveal it with.
          handle ? 'opacity-40 group-hover:opacity-100 focus-visible:opacity-100' : 'opacity-100',
        )}
        aria-label={handle ? `Move ${displayName(app)} to another stage` : undefined}
        title={handle ? 'Drag to another stage' : undefined}
        {...handle?.attributes}
        {...handle?.listeners}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* One accessible name, one hit area the size of the card. The
              alternative — wrapping the card in an anchor — puts a button and a
              set of chips inside a link, which is invalid and makes the grip
              draggable as a link rather than as a card. The overlay copy is not
              a link: it is a picture of the card being carried. */}
          {handle ? (
            <Link
              to={appPath(app)}
              draggable={false}
              aria-current={open ? 'page' : undefined}
              className="block truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:text-accent"
            >
              {displayName(app)}
            </Link>
          ) : (
            <div className="truncate text-sm font-semibold">{displayName(app)}</div>
          )}
          <div className="mt-0.5 text-xs text-text-3">{app.note}</div>
        </div>
        {app.flagged ? (
          <Flag
            className="mt-0.5 size-3.5 shrink-0 text-danger"
            strokeWidth={1.9}
            aria-label="Flagged for follow-up"
          />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {/* The board's only stage control that a finger or a keyboard can
            operate. Dragging with the keyboard is Space plus twenty arrow
            presses to cross two columns; this is two. */}
        {onMoveStage ? (
          <StageMenu
            value={app.stage}
            onSelect={(stage) => onMoveStage(app, stage)}
            className="relative z-[1]"
          />
        ) : (
          <Chip stage={app.stage} className="font-normal">
            {STAGE_LABEL[app.stage]}
          </Chip>
        )}
        {/* Neutral, per colour law: the role is a category, not a status, and
            the only coloured pills on a record are the keywords the user chose
            themselves. */}
        <Chip size="sm" className="font-normal">
          {app.roleTag}
        </Chip>
        {/* Applications are keyed `app:<id>` in the label store while timeline
            items and vault records use the bare id — the asymmetry is in the
            seed, see data/labels.ts. Capsules rather than the squared `Chip`
            beside them, so a keyword you chose reads apart from the fixed tags
            the app assigns. */}
        <LabelChips recordId={refKey('app', app.id)} />
      </div>
    </div>
  )
}

/**
 * A card in its column.
 *
 * It no longer moves with the pointer — DragOverlay does that. The card used to
 * carry the drag transform itself, which meant it was still a child of the
 * column's `overflow-y-auto` list and got clipped the moment it left that box.
 * No z-index fixes an overflow clip; the element has to leave the container
 * entirely, which is exactly what the overlay is for. What stays behind is a
 * dimmed placeholder holding the slot open.
 */
function BoardCard({
  app,
  onMoveStage,
  open,
  ref,
}: {
  app: Application
  onMoveStage: (a: Application, stage: Stage) => void
  open?: boolean
  ref?: Ref<HTMLDivElement>
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id })

  return (
    <div ref={setNodeRef}>
      <BoardCardBody
        ref={ref}
        app={app}
        handle={{ attributes, listeners }}
        onMoveStage={onMoveStage}
        open={open}
        className={isDragging ? 'opacity-35' : undefined}
      />
    </div>
  )
}

function BoardColumn({
  stage,
  items,
  onAdd,
  onMoveStage,
  openId,
  openRef,
}: {
  stage: (typeof STAGES)[number]
  items: Application[]
  onAdd: (stage: Stage) => void
  onMoveStage: (a: Application, stage: Stage) => void
  openId?: string
  openRef: Ref<HTMLDivElement>
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[240px] shrink-0 flex-col rounded-lg border p-2 transition-colors',
        // Mirrors the calendar's day cell: the target lifts to the card colour
        // and takes the accent border, so the column you are about to drop into
        // is the brightest thing on the board. It painted nothing at all until
        // --accent-soft stopped being an alias of --well.
        isOver ? 'border-accent bg-panel' : 'border-hairline bg-well',
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={cn('size-1.5 rounded-full', stage.dot)} aria-hidden />
        <h3 className="min-w-0 truncate text-xs font-medium text-text-2">{stage.label}</h3>
        <span className="tabular ml-auto rounded-sm border border-hairline bg-panel px-1.5 text-xs text-text-3">
          {items.length}
        </span>
      </div>

      {/* The column is as tall as the board; only the cards scroll, so every
          stage header stays visible however uneven the stages are. `tight`
          because the column's gutter is p-2, not a Panel's. */}
      <PanelScroll axis="y" inset="tight" className="flex min-h-16 flex-col gap-2">
        {items.map((app) => (
          <BoardCard
            key={app.id}
            app={app}
            onMoveStage={onMoveStage}
            open={app.id === openId}
            ref={app.id === openId ? openRef : undefined}
          />
        ))}

        {/* Where the card will land. The column tint alone says "this one" but
            not "and it goes here", which is the half people read as the drag
            having done nothing.

            A zero-height element still eats the list's `gap-2`, so the closed
            state cancels that gap with a negative margin — otherwise every
            column carries 8px of dead space forever. */}
        <div
          aria-hidden
          className={cn(
            'shrink-0 overflow-hidden rounded-md border border-dashed border-accent-border bg-accent-soft transition-all duration-200 ease-out',
            isOver ? 'mt-0 h-[84px] opacity-100' : '-mt-2 h-0 opacity-0',
          )}
        />

        {/* Per column, so the stage is already chosen: logging a job you have
            already interviewed for should not mean adding it as a draft and
            then dragging it four columns to the right. */}
        <button
          type="button"
          onClick={() => onAdd(stage.id)}
          className="flex w-full shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-hairline-strong py-1.5 text-xs text-text-3 transition-colors hover:border-accent-border hover:bg-panel hover:text-text-1"
        >
          <Plus className="size-3" strokeWidth={2} aria-hidden />
          Add here
        </button>
      </PanelScroll>
    </div>
  )
}

/* ------------------------------ detail sheet ----------------------------- */

/**
 * The open record, over the board rather than beside it.
 *
 * It used to be a flex sibling of the list, which squeezed a six-column board
 * into ~650px — two and a half stages on the page whose entire job is showing
 * all six. As a sheet the board keeps its width, and Escape and a backdrop
 * click get the meaning every user already expects them to have.
 *
 * Radix rather than a hand-rolled overlay, and this is the load-bearing part:
 * the record mounts its own dialogs — edit, stage transition, delete confirm —
 * and a bespoke focus trap listening on `document` would fight the trap Radix
 * puts around those, yanking Tab out of the confirm dialog and back into the
 * sheet. Radix keeps one layer stack, so Escape closes only the top of it.
 *
 * `modal={false}` is deliberate and costs a focus trap. A modal Radix layer
 * sets `pointer-events: none` on `document.body` and `aria-hidden` on
 * everything outside its portal — and the toast viewport lives in the React
 * tree under `#root`, not in a portal of its own. Modal, every Undo raised from
 * inside the record would be un-clickable and unspoken for as long as the sheet
 * stayed open, on the surface that mutates more than any other. A sheet you can
 * Tab out of is a smaller failure than an undo you cannot press.
 *
 * Built here rather than as `components/ui/sheet.tsx`: it has exactly one
 * caller, and a primitive with one caller is a guess about the second.
 */
function DetailSheet({
  name,
  onClose,
  children,
}: {
  /** The record's own name — the sheet's accessible name. */
  name: string
  onClose: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      // index.css flattens every CSS animation and transition to 0.01ms under
      // this preference, so a CSS cross-fade would be no motion at all here.
      // A script animation is the one thing that reset cannot reach — the same
      // trick, for the same reason, as ui/dialog.tsx.
      if (node && reducedMotion) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
      }
    },
    [reducedMotion],
  )

  return (
    <DialogPrimitive.Root
      open
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        {/* A plain div, not `DialogPrimitive.Overlay`: Radix renders that one
            only in modal mode, so a non-modal sheet gets no backdrop from it at
            all. `data-slot` is not decoration — index.css swaps this wash for a
            solid scrim under prefers-reduced-transparency, keyed on exactly
            that attribute. A pointer-down here lands outside the content, which
            is what closes the sheet. */}
        <div
          aria-hidden
          data-slot="dialog-overlay"
          className={cn(
            'fixed inset-0 z-40 bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
            !reducedMotion && 'animate-in duration-150 fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          ref={setRef}
          data-slot="dialog-content"
          // The record has no description element of its own, and Radix logs a
          // warning for a missing one rather than leaving it out.
          aria-describedby={undefined}
          // Only Escape, the backdrop and the X close this. Focus leaving the
          // sheet must not: a toast that grabs its own Undo, or a popover the
          // record opens into a portal, would otherwise dismiss the record the
          // user is working in.
          onFocusOutside={(event) => event.preventDefault()}
          className={cn(
            'fixed top-0 right-0 bottom-0 z-40 flex w-[520px] max-w-[calc(100vw-3rem)] flex-col overflow-y-auto border-l border-hairline bg-page px-4 pb-5 shadow-[var(--shadow-raised)] outline-none sm:px-5',
            !reducedMotion &&
              'duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-open:animate-in data-open:slide-in-from-right-16 data-closed:animate-out data-closed:duration-150 data-closed:slide-out-to-right-16',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{name}</DialogPrimitive.Title>

          {/* No close button here. The record's own header ends in one, and it
              already hands back through `onClose`, so the sheet adding a second
              put two dismissals sixty pixels apart — which reads as two
              different scopes ("close the record" versus "close the panel")
              when there is only one. The container keeps Escape and the
              backdrop; the visible control belongs in the record's own cluster,
              beside the flag and the overflow it shares a job with. */}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/* -------------------------------- page ---------------------------------- */

export function Applications() {
  const { matches, selected: selectedRoles, clear: clearRoles } = useRoles()
  const { matches: keywordMatches, selected: selectedKeywords, clearSelected } = useLabels()
  const { all, get } = useApplications()
  const { all: timelineItems } = useTimeline()
  const { open } = useDialogs()
  const actions = useRowActions()
  const navigate = useNavigate()
  const location = useLocation()

  // Whether a record is open beside the list. Read from the path rather than
  // from state, so a bookmarked /applications/rice lays out correctly on the
  // very first render.
  //
  // Resolved to the record's id before anything compares it. The segment is a
  // slug, and the four comparisons below are all against `a.id` — so on
  // '/applications/rice', the URL that already worked, the panel rendered the
  // right record while the card behind it was not marked open, the row never
  // scrolled into view, and the mobile sheet was titled "Application".
  const detail = useMatch('/applications/:key')
  const openKey = detail?.params.key
  const openId = openKey ? get(openKey)?.id : undefined

  // View, search, stage and sort live in the URL. They were four useStates, so
  // the one page in the app you would actually want to send someone ("look at
  // my offers") was the one page that could not be linked to, and Back stepped
  // out of the whole route rather than out of the filter.
  const params = useApplicationsParams()
  const view = params.view
  const query = params.q
  const stageFilter = params.stage
  const sort = useMemo(() => parseSort(params.sort), [params.sort])

  /** The card currently in the pointer's hand, rendered in the overlay. */
  const [activeId, setActiveId] = useState<string | null>(null)

  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const reducedMotion = useReducedMotion()

  const sensors = useSensors(
    // A small activation distance so a click on the handle isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  // Caps whichever panel is showing at the room left below it.
  const fill = useFillViewport()

  // Page options. Real toggles rather than placeholders — both change what the
  // table renders, so the control is worth the space it takes.
  const [showNotes, setShowNotes] = useState(true)
  // Compact by default: at the roomy height only nine of twelve rows fit on a
  // 900px screen, and the first thing this page owes is the whole search.
  const [compact, setCompact] = useState(true)

  /**
   * The next dated thing per application, built once rather than filtered per
   * row — twelve rows each scanning the whole timeline is the shape that gets
   * slow the moment a real store is behind it.
   */
  const nextDates = useMemo(() => {
    const byApp = new Map<string, TimelineItem[]>()
    for (const item of timelineItems) {
      if (!item.applicationId) continue
      const list = byApp.get(item.applicationId)
      if (list) list.push(item)
      else byApp.set(item.applicationId, [item])
    }
    return new Map([...byApp].map(([id, items]) => [id, nextDateOf(items)]))
  }, [timelineItems])

  /**
   * Everything the page filters by *except* the stage — the pool both views
   * draw from.
   *
   * The board used to read straight from `all`, so a search that emptied the
   * table left the board showing every record and no sign that a filter was
   * on at all. Stage is the one exception, below: the board is already grouped
   * by it.
   */
  const pool = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((a) => {
      if (!matches(a.roleTag)) return false
      if (!keywordMatches(refKey('app', a.id))) return false
      if (!q) return true
      // Searches what is on screen plus the stage name, so typing "offer"
      // finds the row whose only mention of it is a chip.
      return [a.org, a.role, a.note, a.roleTag, STAGE_LABEL[a.stage]]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [all, query, matches, keywordMatches])

  /**
   * Stage counts over the pool, not over everything.
   *
   * They were counted before the search and the keyword chips ran, so `All 8`
   * sat above four rows and each stage chip promised records the table would
   * not show.
   */
  const stageCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of pool) map[a.stage] = (map[a.stage] ?? 0) + 1
    return map
  }, [pool])

  const tableRows = useMemo(
    () => (stageFilter === 'all' ? pool : pool.filter((a) => a.stage === stageFilter)),
    [pool, stageFilter],
  )

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...tableRows].sort((a, b) => {
      if (sort.key === 'daysAgo') return (a.daysAgo - b.daysAgo) * dir
      if (sort.key === 'stage')
        return (
          (STAGES.findIndex((s) => s.id === a.stage) - STAGES.findIndex((s) => s.id === b.stage)) *
          dir
        )
      return displayName(a).localeCompare(displayName(b)) * dir
    })
  }, [tableRows, sort])

  const activeCard = activeId ? pool.find((a) => a.id === activeId) : undefined
  const shown = view === 'table' ? sorted.length : pool.length
  const anyFilter =
    query.trim() !== '' ||
    stageFilter !== 'all' ||
    selectedKeywords.size > 0 ||
    selectedRoles.size > 0

  /**
   * Which filters are holding the list empty, named out loud.
   *
   * Four controls can blank it — the search box, the stage chips, the keyword
   * row and the role filter — and "nothing matches" without saying which one is
   * doing it leaves the reader hunting across the toolbar for the switch to
   * flip. The role filter is the one that used to be unnameable here: it lived
   * in the top bar, so the page could say "nothing carries the Offer stage"
   * while ten records sat hidden behind a control this page could not reach.
   */
  const emptyReason = useMemo(() => {
    const on = [
      query.trim() ? 'that search' : '',
      stageFilter === 'all' ? '' : `the ${STAGE_LABEL[stageFilter]} stage`,
      selectedKeywords.size > 0 ? 'the selected keywords' : '',
      selectedRoles.size > 0 ? 'the selected roles' : '',
    ].filter(Boolean)
    if (on.length === 0) return 'Nothing here to show.'
    const joined = on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`
    return `Nothing carries ${joined}.`
  }, [query, stageFilter, selectedKeywords, selectedRoles])

  const clearFilters = () => {
    params.set({ q: '', stage: 'all' })
    clearSelected()
    clearRoles()
  }

  const toggleSort = (key: ApplicationsSortKey) =>
    params.set({
      sort: formatSort(key, sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc'),
    })

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const stage = event.over?.id as Stage | undefined
    const app = pool.find((a) => a.id === String(event.active.id))
    // Through the same call as the stage pill and the table chip, so the drag
    // gets the toast and the undo it never had. A mis-drop is the likeliest
    // slip on this page and it used to be the only one with no way back.
    if (stage && app) actions.onMoveStage(app, stage)
  }

  /** New application, optionally landing in a stage the user already picked. */
  const onNew = (stage?: Stage) =>
    open('application', { mode: 'create', initial: stage ? { stage } : undefined })

  const closeDetail = useCallback(
    // Keeps the query string, so closing a record does not silently reset the
    // search and the stage chips you opened it from.
    () => navigate({ pathname: '/applications', search: location.search }),
    [navigate, location.search],
  )

  /**
   * Brings the open record into view.
   *
   * On the board that means the horizontal scroller too: a record opened from
   * the dashboard can be in a column two screens to the right, and the sheet
   * would otherwise be the only evidence anything happened.
   */
  const openRowRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!openId) return
    openRowRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }, [openId, view, reducedMotion])

  const setOpenRow = useCallback((node: HTMLElement | null) => {
    openRowRef.current = node
  }, [])

  const SortHeader = ({
    label,
    k,
    align,
  }: {
    label: string
    k: ApplicationsSortKey
    align?: 'right'
  }) => (
    <th
      scope="col"
      // aria-sort belongs to the column, not to the control inside it — on the
      // button it described a button rather than a column of data.
      aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('py-2 pr-3 font-medium', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 rounded-sm text-text-3 hover:text-text-1"
      >
        {label}
        {sort.key === k ? (
          sort.dir === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  )

  const empty = all.length === 0
  /** Below `lg` the record takes the whole column, as it always has. */
  const inlineDetail = Boolean(detail) && !isDesktop

  /**
   * The record replaces this page below `lg` rather than sitting over it, so it
   * owns the h1 and the tab name and this header stands down entirely — leaving
   * it rendered put two `<h1>`s on the page and titled a bookmarked record
   * "Applications", because the parent's title effect runs after the child's.
   */
  useTitle(inlineDetail ? null : 'Applications')

  return (
    <>
      {inlineDetail ? null : (
        <PageHeader
          title="Applications"
          settings={
            <>
              <PageOption
                label="Show notes"
                hint="The second line under each position"
                control={
                  <Switch
                    checked={showNotes}
                    onCheckedChange={setShowNotes}
                    aria-label="Show notes"
                  />
                }
              />
              <PageOption
                label="Compact rows"
                hint="Tighter row height in the table"
                control={
                  <Switch
                    checked={compact}
                    onCheckedChange={setCompact}
                    aria-label="Compact rows"
                  />
                }
              />
            </>
          }
          subtitle={
            empty
              ? 'Nothing tracked yet — everything you add stays on this machine.'
              : `${shown} shown · ${all.length} total`
          }
          actions={
            <>
              {/* Same control as the dashboard's quick-add, with a shorter
                  placeholder for a header row. Fixed width rather than the
                  dashboard's `flex-1`: left to grow, the field ate the row and
                  pushed the button onto a second line. */}
              <AddByUrl
                fieldClassName="w-[210px] flex-none"
                placeholder="Paste a posting URL"
                submitLabel="From link"
              />
              <Button size="sm" onClick={() => onNew()}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                New application
              </Button>
            </>
          }
        />
      )}

      {/* The filters belong to the page, not to the table — they lived inside
          the table panel, which is why switching to Board silently dropped
          every one of them. At a real zero the whole toolbar goes: a row of
          controls that filter nothing is scenery on the one screen where the
          user has nothing yet. */}
      {empty || inlineDetail ? null : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-0 flex-1 basis-[220px]">
              <label htmlFor="applications-search" className="sr-only">
                Search applications
              </label>
              <Search
                aria-hidden
                strokeWidth={1.8}
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
              />
              <Input
                id="applications-search"
                type="search"
                value={query}
                onChange={(e) => params.set({ q: e.target.value })}
                placeholder="Search position, note or stage"
                className="pl-8"
              />
            </div>

            {/* Was pinned to the top bar, where it changed two of a dozen
                surfaces and left every number on the dashboard ambiguous. It
                belongs to the list it actually filters. */}
            <RoleFilter />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            {/* Scoped to the pool on screen. Without `scopeIds` a chip here
                would count every reminder and vault file carrying that keyword
                too, and report 32 for a word only six applications have. */}
            <LabelFilter scopeIds={pool.map((a) => refKey('app', a.id))} />

            {/* Stage chips are table-only: the board is already grouped by
                stage, so filtering there blanks five columns rather than
                shortening a list. Switching to Board clears the filter instead
                of hiding it — a filter you cannot see is the thing this page
                was worst at. */}
            {view === 'table' ? (
              <BucketFilter
                label="Filter by stage"
                options={STAGES.map((st) => st.id)}
                labels={Object.fromEntries(STAGES.map((st) => [st.id, st.label]))}
                counts={stageCounts}
                value={stageFilter}
                onChange={(next) => params.set({ stage: next })}
                total={pool.length}
              />
            ) : null}

            <Segment
              label="Layout"
              options={VIEWS}
              value={view}
              // Only the board branch touches `stage`: `set` treats a key that
              // is present-but-undefined as "delete it", so passing it either
              // way would drop the stage filter on the way back to the table.
              onChange={(next) =>
                params.set(next === 'board' ? { view: next, stage: 'all' } : { view: next })
              }
              className="ml-auto shrink-0"
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {inlineDetail ? (
          <Outlet />
        ) : empty ? (
          <Panel>
            <EmptyState
              icon={ClipboardList}
              title="No applications yet"
              description="Track a job you are applying for and it shows up here, on the calendar and in the week ahead."
              action={
                <Button size="sm" onClick={() => onNew()}>
                  <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                  New application
                </Button>
              }
            />
          </Panel>
        ) : shown === 0 ? (
          <Panel>
            <EmptyState
              icon={ClipboardList}
              title="No applications match"
              description={emptyReason}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {anyFilter ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      <X className="size-3.5" strokeWidth={2} aria-hidden />
                      Show all {all.length}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={() => onNew(stageFilter === 'all' ? undefined : stageFilter)}
                  >
                    <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                    New application
                  </Button>
                </div>
              }
            />
          </Panel>
        ) : view === 'table' ? (
          // min-h-0 is what makes flex-1 mean "the space that is left" rather
          // than "at least my content" — without it a tall column grows the
          // panel instead of scrolling inside it.
          <Panel
            ref={fill.ref}
            style={{ maxHeight: fill.maxHeight }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <PanelScroll>
              <table className="w-full min-w-[780px] text-sm">
                <caption className="sr-only">Applications, sortable</caption>
                {/* Fixed widths for the four short columns, so Position keeps
                    every pixel neither of them needs. */}
                <colgroup>
                  <col />
                  <col className="w-[130px]" />
                  <col className="w-[132px]" />
                  <col className="w-[104px]" />
                  <col className="w-[112px]" />
                  <col className="w-[96px]" />
                </colgroup>
                <thead>
                  {/* Sticky so the column labels survive scrolling. Needs its own
                      background or rows show through as they pass under it. */}
                  <tr className="sticky top-0 z-[1] border-b border-hairline bg-panel text-left text-xs">
                    <SortHeader label="Position" k="role" />
                    <th scope="col" className="py-2 pr-3 font-medium text-text-3">
                      Role
                    </th>
                    <SortHeader label="Stage" k="stage" />
                    <th scope="col" className="py-2 pr-3 font-medium text-text-3">
                      Next date
                    </th>
                    <SortHeader label="Last activity" k="daysAgo" align="right" />
                    <th scope="col" className="py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {sorted.map((a) => {
                    const isOpen = a.id === openId
                    return (
                      <tr
                        key={a.id}
                        ref={isOpen ? setOpenRow : undefined}
                        className={cn(
                          'pressable-row hover:bg-row-hover',
                          isOpen && 'bg-accent-soft',
                        )}
                      >
                        <th
                          scope="row"
                          className={cn(
                            'relative pr-3 pl-2 text-left font-normal',
                            compact ? 'py-1.5' : 'py-2.5',
                            isOpen && openRail,
                          )}
                        >
                          <Link
                            to={appPath(a)}
                            aria-current={isOpen ? 'page' : undefined}
                            className="block truncate hover:text-accent hover:underline"
                          >
                            {displayName(a)}
                          </Link>
                          {showNotes ? (
                            <div className="mt-0.5 truncate text-xs text-text-3">{a.note}</div>
                          ) : null}
                          {/* Returns null with no keywords on the record, so
                              an untagged row costs no extra height. */}
                          <LabelChips recordId={refKey('app', a.id)} className="mt-1" />
                        </th>
                        <td className={cn('pr-3', compact ? 'py-1.5' : 'py-2.5')}>
                          <Chip className="font-normal">{a.roleTag}</Chip>
                        </td>
                        <td className={cn('pr-3', compact ? 'py-1.5' : 'py-2.5')}>
                          {/* The chip was only ever a label; it is the control
                              now, so the stage can be changed without a drag. */}
                          <StageMenu
                            value={a.stage}
                            onSelect={(stage) => actions.onMoveStage(a, stage)}
                            trigger={
                              <button
                                type="button"
                                aria-label={`Stage of ${displayName(a)}: ${STAGE_LABEL[a.stage]}. Change stage`}
                                className="cursor-pointer rounded-sm"
                              >
                                <Chip stage={a.stage} className="font-normal">
                                  {STAGE_LABEL[a.stage]}
                                </Chip>
                              </button>
                            }
                          />
                        </td>
                        <td
                          className={cn(
                            'pr-3 text-xs whitespace-nowrap',
                            compact ? 'py-1.5' : 'py-2.5',
                          )}
                        >
                          <NextDateCell item={nextDates.get(a.id)} />
                        </td>
                        <td
                          className={cn(
                            'tabular pr-3 text-right text-xs whitespace-nowrap text-text-3',
                            compact ? 'py-1.5' : 'py-2.5',
                          )}
                        >
                          {/* Anything the user just added or edited is stamped
                              daysAgo 0, so this column is the one people read
                              straight after acting — "0d ago" was the answer
                              every time. */}
                          {activityLabel(a.daysAgo)}
                        </td>
                        <td className={cn(compact ? 'py-1.5' : 'py-2.5')}>
                          <div className="flex items-center justify-end gap-0.5">
                            {/* `size-7 rounded-md` matches the two controls
                                beside it; tailwind-merge collapses it against
                                the picker's baked-in `size-6 rounded-full`. */}
                            <LabelPicker
                              recordId={refKey('app', a.id)}
                              name={displayName(a)}
                              className="size-7 rounded-md"
                            />
                            <FlagButton app={a} onFlag={actions.onFlag} />
                            <RowMenu app={a} actions={actions} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </PanelScroll>
          </Panel>
        ) : (
          <Panel
            ref={fill.ref}
            style={{ maxHeight: fill.maxHeight }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {/* The two-line paragraph explaining the drag to a mouse and a
                keyboard is gone: the grip is visible now and every card carries
                a stage menu, so the gesture explains itself and the alternative
                is a control rather than a sentence. */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveId(null)}
            >
              <PanelScroll axis="x" className="flex gap-3">
                {STAGES.map((stage) => (
                  <BoardColumn
                    key={stage.id}
                    stage={stage}
                    items={pool.filter((a) => a.stage === stage.id)}
                    onAdd={onNew}
                    onMoveStage={actions.onMoveStage}
                    openId={openId}
                    openRef={setOpenRow}
                  />
                ))}
              </PanelScroll>

              {/* Rendered outside every column, so it is clipped by nothing and
                  stays above the board while it travels. `dropAnimation={null}`
                  because the ghost used to fly to the card's *old* position and
                  hover there, misaligned, for 180ms after the drop — the one
                  moment the user is checking whether the move took.

                  dnd-kit builds this overlay with the Web Animations API on a
                  cloned node, which is exactly what the `*` reset in index.css
                  cannot reach — hence the hook rather than a CSS rule. The
                  scale goes with it: under reduced motion the card being
                  carried is already distinguished by its shadow and its cursor,
                  and a card that changes size on pick-up is the movement the
                  preference is asking us not to make. */}
              <DragOverlay dropAnimation={null}>
                {activeCard ? (
                  <BoardCardBody
                    app={activeCard}
                    lifted
                    className={cn('w-[224px] cursor-grabbing', !reducedMotion && 'scale-[1.03]')}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </Panel>
        )}
      </div>

      {detail && isDesktop ? (
        <DetailSheet
          name={openId ? (all.find((a) => a.id === openId)?.org ?? 'Application') : 'Application'}
          onClose={closeDetail}
        >
          <Outlet />
        </DetailSheet>
      ) : null}

      {actions.confirmDialog}
    </>
  )
}
