import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
} from '@dnd-kit/core'
import {
  CalendarDays,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Plus,
  Trash2,
} from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { MONTH_LABELS, WEEKDAYS, buildMonth, stepMonth } from '@/data/calendar'
import { compareItems, isoOf, partsOf, shortDate, timeLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useTimeline } from '@/kg/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { useCalendarParams, useTitle } from '@/lib/links'
import { KIND_ICON, KIND_LABEL, MARK_DOT, MARK_TEXT, markOf } from '@/lib/timeline-visuals'
import type { Mark } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { TODAY_PARTS } from '@/lib/today'
import { useArrivalHighlight } from '@/lib/use-arrival-highlight'
import { useReducedMotion } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/**
 * Revealed by hover, by keyboard focus landing anywhere in the cell — or
 * permanently, on a device that cannot hover at all.
 *
 * `pointer-events-none` while hidden is the load-bearing half: an
 * invisible-but-tappable control would sit in the corner of every cell
 * swallowing taps meant for the day underneath. But that also meant a touch
 * reader never saw thirty-one add buttons, because nothing on a touch screen
 * ever fires the hover that reveals them. The `(hover: none)` clause inverts
 * the whole pattern there: always visible, always tappable. It has to be an
 * arbitrary media variant — Tailwind ships `pointer-*` variants but no
 * hover-capability one, and a class naming a variant that does not exist emits
 * no CSS and fails silently.
 */
const REVEAL_IN_CELL =
  'pointer-events-none opacity-0 transition-opacity group-hover/cell:pointer-events-auto group-hover/cell:opacity-100 group-focus-within/cell:pointer-events-auto group-focus-within/cell:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100'

/** The same trick on a list row. Written out twice because Tailwind scans for
    whole class names — a group name spliced in at runtime emits no CSS. */
const REVEAL_IN_ROW =
  'pointer-events-none opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100'

/** Namespaced so a droppable day can never collide with a timeline item's id. */
const DAY_DROP_PREFIX = 'day:'

/** The mock's fixed "today", spelled the two ways the copy below needs it. */
const TODAY_ISO = isoOf(TODAY_PARTS.year, TODAY_PARTS.month, TODAY_PARTS.day)
const TODAY_MONTH = `${MONTH_LABELS[TODAY_PARTS.month - 1]} ${TODAY_PARTS.year}`

/**
 * What the grid draws on an item — and the only thing the key under it has to
 * explain.
 *
 * `markOf` is derived from the date, not read off `item.urgency`. That field is
 * a hand-authored priority in the seed: it paints the UT Austin deadline red
 * three days before it falls, the same red as a follow-up missed a week ago,
 * and paints an already-overdue chase amber. Under the colour law red is past
 * due and nothing else and amber is inside 48 hours and nothing else — so a key
 * reading "Overdue / Due within 48 hours" beside those colours would have been
 * a second mismatch replacing the one it was sent to fix.
 *
 * The rule itself now lives in `lib/timeline-visuals.ts`, with the dashboard's
 * three copies of it. This route had the fourth.
 *
 * The chip body: only the two marks the key names carry a fill — everything
 * else is bare text, so a filled chip always means one of the two things
 * printed under the grid. `bg-well` on a `bg-well` cell was the same pixels
 * with none of that guarantee, and it turned into a visible box the moment the
 * cell changed colour under a drag.
 */
const MARK_CHIP: Record<Mark, string> = {
  done: 'bg-transparent text-text-3',
  overdue: 'bg-danger-soft text-danger',
  soon: 'bg-warning-soft text-warning',
  none: 'bg-transparent text-text-2',
}

/** The dot the grid falls back to when a cell is too narrow for a chip. */
const DAY_DOT: Record<Mark, string> = {
  ...MARK_DOT,
  done: 'border border-text-3 bg-transparent',
}

/** The kind icon in the day list. Green for done — the glance panel greys it. */
const DAY_TEXT: Record<Mark, string> = {
  ...MARK_TEXT,
  done: 'text-success',
}

/**
 * '09:30' out of '09:30 – 10:15'.
 *
 * Sliced off the shared label rather than reformatted from `startMins`, so the
 * chip in the grid and the row in the day list cannot disagree about when
 * something starts. An item with no duration already reads as just the start,
 * and `split` hands that back whole.
 */
const startLabel = (item: TimelineItem) => timeLabel(item)?.split(' – ')[0] ?? null

/** The grid's `gap-1`, in px. How far a release may miss a cell and still count. */
const CELL_GAP = 4

/**
 * The cell under the pointer, falling back to the nearest one you nearly hit.
 *
 * `pointerWithin` alone answers nothing while the pointer sits in the 4px gutter
 * between two cells, so a drop released there would be silently discarded — the
 * event snaps back and the user is told nothing. `closestCenter` catches those.
 *
 * But `closestCenter` measures from the dragged chip, not the pointer, and it
 * always names a winner — so releasing over the aria-hidden blanks that pad the
 * last row (or anywhere else off the grid) rescheduled the event to a day
 * nobody had pointed at: a drop in the corner right of Oct 31 landed on Oct 25,
 * a row up and five days early. Bounding it to cells the pointer is actually
 * touching keeps the gutter case and makes a drop on dead space a no-op, which
 * is the only honest reading of a release over nothing.
 */
const dropTarget: CollisionDetection = (args) => {
  const under = pointerWithin(args)
  if (under.length > 0) return under

  const pointer = args.pointerCoordinates
  if (!pointer) return []

  return closestCenter(args).filter((collision) => {
    const rect = args.droppableRects.get(collision.id)
    if (!rect) return false
    return (
      pointer.x >= rect.left - CELL_GAP &&
      pointer.x <= rect.left + rect.width + CELL_GAP &&
      pointer.y >= rect.top - CELL_GAP &&
      pointer.y <= rect.top + rect.height + CELL_GAP
    )
  })
}

/**
 * Jump straight to a month.
 *
 * Stepping a year at a time and picking from twelve is faster than clicking an
 * arrow twelve times, which was the only route to next March before this.
 * Its own year state, so browsing forward in the picker does not move the
 * calendar behind it until a month is actually chosen.
 */
function MonthPicker({
  year,
  month,
  onPick,
}: {
  year: number
  month: number
  onPick: (next: { year: number; month: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftYear, setDraftYear] = useState(year)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Reopening should start from where the calendar actually is, not from
        // wherever the last browse left off.
        if (next) setDraftYear(year)
      }}
    >
      <PopoverTrigger
        aria-label="Go to month"
        title="Go to month"
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
      >
        <CalendarSearch className="size-3.5" strokeWidth={1.8} aria-hidden />
        {/* The label goes below `sm` and the aria-label carries the name: the
            month heading, this trigger and a text Today button no longer fit on
            one 321px row, and a wrapped header is a worse trade than an icon
            with a tooltip on the control you press least. */}
        <span className="hidden sm:inline">Go to month</span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-60">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDraftYear((y) => y - 1)}
            aria-label="Previous year"
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
          <span className="tabular text-sm font-medium">{draftYear}</span>
          <button
            type="button"
            onClick={() => setDraftYear((y) => y + 1)}
            aria-label="Next year"
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
          >
            <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {MONTH_LABELS.map((label, i) => {
            const m = i + 1
            const isCurrent = draftYear === year && m === month
            const isToday = draftYear === TODAY_PARTS.year && m === TODAY_PARTS.month
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onPick({ year: draftYear, month: m })
                  setOpen(false)
                }}
                aria-current={isCurrent ? 'date' : undefined}
                className={cn(
                  'cursor-pointer rounded-sm px-1 py-1.5 text-xs transition-colors',
                  isCurrent
                    ? 'bg-accent font-medium text-[color:var(--accent-fg)]'
                    : 'text-text-2 hover:bg-well hover:text-text-1',
                  // A quiet mark on the real current month, so the picker says
                  // where "today" is even while browsing another year.
                  !isCurrent && isToday && 'font-medium text-accent',
                )}
              >
                {label.slice(0, 3)}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* --------------------------------- chips --------------------------------- */

/**
 * One event as it sits in a day cell.
 *
 * Shared by the chip in the grid and by the copy the DragOverlay carries, so
 * the thing you pick up is identical to the thing you put down.
 *
 * A day cell is ~135px wide. A leading '09:30' spends a quarter of that saying
 * something the day list beside the grid already says in full, and what was
 * left truncated to 'Nudge on …'. The time moves to the tooltip and to the
 * screen-reader text; the width goes to the title.
 *
 * The fill is urgency and nothing else. It used to be suppressed on any timed
 * item, so a whole-day 'due soon' reminder painted amber while an overdue
 * interview at 14:00 stayed transparent — the grid drew the more urgent of the
 * two as the fainter one.
 */
function EventChip({
  item,
  handle,
  className,
}: {
  item: TimelineItem
  /** Drag wiring plus the click that opens the item. Omitted for the inert overlay copy. */
  handle?: {
    attributes: DraggableAttributes
    listeners: ReturnType<typeof useDraggable>['listeners']
    onOpen: () => void
  }
  className?: string
}) {
  const mark = markOf(item)
  const done = mark === 'done'
  const start = startLabel(item)

  return (
    <button
      type="button"
      // The overlay copy is a picture of the chip in flight, not a control.
      tabIndex={handle ? undefined : -1}
      aria-hidden={handle ? undefined : true}
      onClick={handle?.onOpen}
      title={handle ? `${start ?? 'All day'} — ${item.title}` : undefined}
      {...handle?.attributes}
      {...handle?.listeners}
      className={cn(
        // z-[1] lifts the chip over the date button's stretched ::after, which
        // covers the whole cell so empty space still selects the day. Same fix
        // the board uses for its drag handle: two controls that never overlap,
        // settled by stacking order rather than by stopping propagation.
        // `touch-none` is what lets a finger drag the chip instead of scrolling
        // the page — chips only exist from `sm` up, so no scroll is lost below.
        'relative z-[1] block w-full min-w-0 cursor-pointer touch-none rounded-sm px-1 py-px text-left text-xs transition-colors hover:underline hover:decoration-1 hover:underline-offset-2 active:cursor-grabbing',
        MARK_CHIP[mark],
        className,
      )}
    >
      {/* The time and the done-ness are in the tooltip and the day list, not in
          the 135px the title needs. They still have to be spoken. */}
      <span className="sr-only">
        {start ?? 'All day'}
        {done ? ', done' : ''} —{' '}
      </span>
      {/* Still a character-level ellipsis, and deliberately so. `line-clamp-1`
          was tried here to cut at a word boundary instead: Chrome blockifies it
          to `flow-root`, wraps the text, and then ellipsises the clamped line
          by character anyway — measured 'Chase recruit…' from 'Chase recruiter
          reply' in an 84px chip, the same place `truncate` lands. Word-boundary
          truncation needs a measured character budget in JS; the width the chip
          just gained is worth more than the last two letters. */}
      {/* `block` is load-bearing: `overflow` and `text-overflow` do nothing on a
          non-replaced inline box, so a bare <span class="truncate"> inside a
          block button renders the title in full and simply overflows the cell.
          It only worked before because the button was a flex row. */}
      <span className={cn('block truncate', done && 'line-through decoration-1')}>
        {item.title}
      </span>
    </button>
  )
}

/** A chip in its cell. It stays put while dragging — the overlay does the travelling. */
function DraggableChip({
  item,
  onOpen,
}: {
  item: TimelineItem
  onOpen: (item: TimelineItem) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })

  return (
    <div ref={setNodeRef} className={cn('min-w-0', isDragging && 'opacity-35')}>
      <EventChip item={item} handle={{ attributes, listeners, onOpen: () => onOpen(item) }} />
    </div>
  )
}

/* ------------------------------- day cells -------------------------------- */

function DayCell({
  day,
  iso,
  label,
  items,
  isToday,
  isSelected,
  dotsOnly,
  tall,
  onSelect,
  onAdd,
  onOpen,
}: {
  day: number
  iso: string
  /** 'October 14' — the spoken name of the cell, reused by both its buttons. */
  label: string
  items: TimelineItem[]
  isToday: boolean
  isSelected: boolean
  dotsOnly: boolean
  tall: boolean
  onSelect: () => void
  onAdd: () => void
  onOpen: (item: TimelineItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${DAY_DROP_PREFIX}${iso}` })

  // A compact cell has room for one chip and the count; a second would push the
  // row taller than the density switch just promised.
  const maxChips = tall ? 2 : 1

  return (
    // A div, not a button: it now holds the date, a chip per event and an add
    // control, and a button inside a button is invalid markup the browser
    // recovers from by dropping the inner click.
    //
    // flex-col fixes the date to the top corner whether or not the day has
    // anything on it; `items-stretch` (the default) is load-bearing — items-start
    // would shrink the chips to their content and break their truncate.
    <div
      ref={setNodeRef}
      className={cn(
        'group/cell relative flex flex-col rounded-md border p-1.5 text-left transition-colors',
        tall ? 'min-h-[56px] sm:min-h-[76px]' : 'min-h-[38px] sm:min-h-[48px]',
        // The drop target cannot be a background swap: --accent-soft is
        // byte-identical to --well in both themes, so the "selected" fill you
        // see below is really just its border. A cell being dropped on goes the
        // other way — up to the panel colour with a hard accent border — which
        // is the one combination visibly different from both other states.
        isOver
          ? 'border-accent bg-panel'
          : isSelected
            ? 'border-accent-border bg-accent-soft'
            : 'border-hairline bg-well hover:border-hairline-strong',
      )}
    >
      {/* `grid`, not `inline-grid`: an inline box sits on the line box's
          baseline, which was adding ~20px of leading above it and pushing the
          date away from the corner.

          `shrink-0` is not decoration. The add button used to share a flex row
          with this one, and at 390px a 42px cell could not hold both — flex
          took the difference out of the circle, which collapsed to an 11px oval
          with the digits of '12' hanging out of both ends. The add button is
          absolutely positioned now, so it competes for nothing; `shrink-0`
          keeps that true for whatever lands in this corner next.

          The ::after stretches this button across the whole cell, so empty
          space still selects the day while the chips keep their own clicks.

          The colour is --accent-fg. It was --primary-foreground, which is not
          a variable this project defines — the theme maps
          --color-primary-foreground, and Tailwind inlines that into its own
          utilities rather than emitting the shorter name. The declaration was
          therefore invalid, the digit inherited its colour, and today rendered
          as a white glyph on a white circle. */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        aria-label={`${label}, ${items.length} ${items.length === 1 ? 'event' : 'events'}`}
        className={cn(
          "grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-xs font-medium after:absolute after:inset-0 after:content-['']",
          isToday ? 'bg-accent text-[color:var(--accent-fg)]' : 'text-text-2',
        )}
      >
        {day}
      </button>

      {/* `tabIndex={-1}`: thirty-one of these sat in the tab order ahead of the
          day list, and every one of them repeated an action the header's Add
          event button already performs on whichever day is selected. Hidden
          below `sm`, where the cell is 42px of dots and there is no corner to
          put it in. */}
      <button
        type="button"
        onClick={onAdd}
        tabIndex={-1}
        aria-label={`Add an event on ${label}`}
        title={`Add an event on ${label}`}
        className={cn(
          'absolute top-1.5 right-1.5 z-[1] hidden size-5 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-panel hover:text-text-1 sm:grid',
          REVEAL_IN_CELL,
        )}
      >
        <Plus className="size-3" strokeWidth={2} aria-hidden />
      </button>

      {/* Dots on phones where chips cannot fit; titles from sm up — unless the
          reader has asked for dots everywhere. A completed item goes hollow, the
          same way a switched-off series does in the legend. */}
      <div className={cn('mt-1 flex items-center gap-0.5', !dotsOnly && 'sm:hidden')}>
        {items.slice(0, 3).map((e) => (
          <span key={e.id} aria-hidden className={cn('size-1 rounded-full', DAY_DOT[markOf(e)])} />
        ))}
        {items.length > 3 ? (
          <span aria-hidden className="ml-0.5 text-[10px] leading-none text-text-3">
            +{items.length - 3}
          </span>
        ) : null}
      </div>

      <div className={cn('mt-1 hidden min-w-0 flex-col gap-0.5', !dotsOnly && 'sm:flex')}>
        {items.slice(0, maxChips).map((e) => (
          <DraggableChip key={e.id} item={e} onOpen={onOpen} />
        ))}
        {/* Static, so the stretched ::after takes the click: the way to see the
            rest of a busy day is to select it. Counting is worth more than a
            third stub — a chip clipped to 'Book trave…' tells you less than the
            fact that two more things exist. */}
        {items.length > maxChips ? (
          <span className="px-1 text-xs text-text-3">+{items.length - maxChips} more</span>
        ) : null}
      </div>
    </div>
  )
}

/* ---------------------------------- page ---------------------------------- */

export function Calendar() {
  // The month and the selected day live in the URL, not in state: a search
  // result for an interview links to the day it falls on, and a calendar that
  // held its position locally would open on today and leave the reader to find
  // it. `useCalendarParams` also clamps '?m=2&d=31' to something real.
  const { y, m, d, focus, set } = useCalendarParams()
  // Same contract as the Vault's: the tint decays, then the parameter goes.
  useArrivalHighlight(focus, () => set({ focus: undefined }))
  const view = useMemo(() => ({ year: y, month: m }), [y, m])
  // The month is the whole point of this tab — 'Calendar' alone tells a
  // person with three tabs open nothing about which one they left here.
  useTitle(`Calendar — ${MONTH_LABELS[m - 1]} ${y}`)
  const selected = d
  const { open } = useDialogs()
  const { toast } = useToast()

  // Page options, both wired straight into the grid below.
  const [dotsOnly, setDotsOnly] = useState(false)
  const [tallCells, setTallCells] = useState(true)
  const reducedMotion = useReducedMotion()
  const month = useMemo(() => buildMonth(view.year, view.month, TODAY_PARTS), [view])
  const { forMonth, get, remove, reschedule } = useTimeline()

  /** The chip currently in the pointer's hand, rendered in the overlay. */
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeItem = activeId ? get(activeId) : undefined

  // A small activation distance so a click on a chip is not read as a drag.
  // Pointer only, deliberately: the KeyboardSensor's activator is Space/Enter,
  // and it calls preventDefault — bound to a chip that is also the way in to
  // editing, it would eat the very click this page exists to deliver. The
  // keyboard route to a new date is the date field inside the event, which the
  // hint under the grid says out loud.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // `forMonth` matches the 'YYYY-MM' prefix, year included — checked, because a
  // month-only match would list next October's deadlines under this one.
  const monthItems = useMemo(() => forMonth(view.year, view.month), [forMonth, view])

  const eventsFor = useMemo(() => {
    const map = new Map<number, TimelineItem[]>()
    for (const e of monthItems) {
      const day = partsOf(e.date).d
      map.set(day, [...(map.get(day) ?? []), e])
    }
    // All-day above timed, then by start time — the order the day is lived in.
    for (const list of map.values()) list.sort(compareItems)
    return map
  }, [monthItems])

  // Leading blanks so the 1st lands on its weekday, the days, then enough
  // trailing blanks to finish the week. Both ends render as real (empty) cells:
  // October 2026 starts on a Thursday and ends on a Saturday, and with nothing
  // drawn in those slots the grid lost its top-left and bottom-right corners —
  // MON/TUE/WED headed thin air and the frame read as a rendering fault.
  const trailing = (7 - ((month.startsOn + month.days) % 7)) % 7
  const cells = [
    ...Array.from({ length: month.startsOn }, () => null),
    ...Array.from({ length: month.days }, (_, i) => i + 1),
    ...Array.from({ length: trailing }, () => null),
  ]

  /** Keeps the day you were looking at, clamped; snaps to today on the way home. */
  const goTo = (next: { year: number; month: number }) => {
    const day =
      next.year === TODAY_PARTS.year && next.month === TODAY_PARTS.month
        ? TODAY_PARTS.day
        : Math.min(selected, buildMonth(next.year, next.month).days)
    // `focus` is dropped: it names an item on a day you have just left.
    set({ y: next.year, m: next.month, d: day, focus: undefined })
  }

  const isCurrentMonth = view.year === TODAY_PARTS.year && view.month === TODAY_PARTS.month
  const nextMonth = stepMonth(view.year, view.month, 1)

  const selectedEvents = eventsFor.get(selected) ?? []
  const selectedISO = isoOf(view.year, view.month, selected)
  const isLastDay = selected === month.days

  const restOfMonth = useMemo(
    () => monthItems.filter((e) => partsOf(e.date).d > selected),
    [monthItems, selected],
  )

  /**
   * The key under the grid, built from what this month actually contains.
   *
   * It replaces a legend of seven kind icons — none of which the grid ever
   * drew — with the marks that are really on it. Filtered by presence rather
   * than listed unconditionally: a key promising an overdue colour in a month
   * that has nothing overdue is the same invented data the empty-state law
   * bans, one step removed.
   */
  const marksPresent = new Set(monthItems.map(markOf))
  const markKey = [
    {
      key: 'overdue',
      swatch: 'border-danger-border bg-danger-soft',
      label: 'Overdue',
      struck: false,
    },
    {
      key: 'soon',
      swatch: 'border-warning-border bg-warning-soft',
      label: 'Due within 48 hours',
      struck: false,
    },
    {
      key: 'done',
      swatch: 'border-hairline-strong bg-transparent',
      label: 'Done',
      struck: true,
    },
  ].filter((entry) => marksPresent.has(entry.key as Mark))

  const openItem = (item: TimelineItem) =>
    open('timelineItem', { mode: item.remind ? 'reminder' : 'event', initial: item })

  const addOn = (iso: string) => open('timelineItem', { mode: 'event', initial: { date: iso } })

  const onDelete = (item: TimelineItem) => {
    const { restore } = remove(item.id)
    // A calendar entry is a cheap record — a title, a date and a kind, all of
    // them retyped in seconds. An undo is the right guard; a confirmation
    // dialog on every row of a day list would be a tax on the common case.
    toast({
      title: 'Event deleted',
      description: `${item.title} — ${shortDate(item.date)}`,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const over = String(event.over?.id ?? '')
    if (!over.startsWith(DAY_DROP_PREFIX)) return

    const iso = over.slice(DAY_DROP_PREFIX.length)
    const item = get(String(event.active.id))
    // Dropped back where it started: no write, and no toast claiming a move.
    if (!item || item.date === iso) return

    const from = item.date
    reschedule(item.id, iso)
    toast({
      title: `Moved to ${shortDate(iso)}`,
      description: item.title,
      action: { label: 'Undo', onClick: () => reschedule(item.id, from) },
    })
  }

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Deadlines, interviews and prep in one view"
        settings={
          <>
            <PageOption
              label="Dots instead of titles"
              hint="Denser month grid — detail and dragging move to the day you select"
              control={
                <Switch
                  checked={dotsOnly}
                  onCheckedChange={setDotsOnly}
                  aria-label="Dots instead of titles"
                />
              }
            />
            <PageOption
              label="Tall day cells"
              hint="More room per day in the grid"
              control={
                <Switch
                  checked={tallCells}
                  onCheckedChange={setTallCells}
                  aria-label="Tall day cells"
                />
              }
            />
          </>
        }
        actions={
          <Button
            size="sm"
            // Prefilled with the day on screen: on a calendar, "add" almost
            // always means "add to the day I am looking at".
            onClick={() => addOn(selectedISO)}
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            Add event
          </Button>
        }
      />

      <DndContext
        sensors={sensors}
        collisionDetection={dropTarget}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* A fixed 320px rail, not a proportional one. The rail holds a day's
            worth of rows and never needed more than that, while `1.6fr / 1fr`
            spent 434px of a 1440px window on it and left the grid's day cells
            at 90px — under two words of a title. A fixed second track hands
            every pixel above 320px to the grid, so the cells grow with the
            window instead of the empty column doing it. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-base font-medium">
                {month.label} <span className="text-text-3">{month.year}</span>
              </h2>
              <MonthPicker year={view.year} month={view.month} onPick={goTo} />

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goTo(stepMonth(view.year, view.month, -1))}
                  aria-label="Previous month"
                  className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.8} />
                </button>

                {/* A word, not a 6px dot between two arrows. The dot carried
                    its whole meaning in a tooltip, and the one state it did
                    show — filled or hollow — was indistinguishable from a
                    decorative separator.

                    It is not disabled on the current month: from October 20 it
                    still walks you back to October 12, which is the more common
                    reason to press it. Recessed instead, so "already here"
                    reads as a pressed control rather than a dead one. */}
                <button
                  type="button"
                  onClick={() => goTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
                  aria-current={isCurrentMonth ? 'date' : undefined}
                  title={
                    isCurrentMonth
                      ? `Back to ${shortDate(TODAY_ISO)}`
                      : `Go to ${MONTH_LABELS[TODAY_PARTS.month - 1]} ${TODAY_PARTS.year}`
                  }
                  className={cn(
                    'h-7 cursor-pointer rounded-full border px-2.5 text-xs transition-colors',
                    isCurrentMonth
                      ? 'border-accent-border bg-accent-soft text-accent'
                      : 'border-hairline bg-well text-text-2 hover:border-hairline-strong hover:text-text-1',
                  )}
                >
                  Today
                </button>

                <button
                  type="button"
                  onClick={() => goTo(stepMonth(view.year, view.month, 1))}
                  aria-label="Next month"
                  className="grid size-7 cursor-pointer place-items-center rounded-full border border-hairline bg-well text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
                >
                  <ChevronRight className="size-4" strokeWidth={1.8} />
                </button>
              </div>
            </div>

            {/* Two versions, because the long one described a room the reader
                is not in below `lg`: there is no grid "beside" anything when
                the panels are stacked, no pointer to drag with, and no keyboard
                to fall back to. */}
            <p className="mb-3 text-xs text-text-3 lg:hidden">Tap a day to see what is on it.</p>
            <p className="mb-3 hidden text-xs text-text-3 lg:block">
              Pick a day to list it beside the grid. Click an event to edit it, or drag it onto
              another day — dragging needs a pointer, so the date field inside the event is the
              keyboard route.
            </p>

            <div className="grid grid-cols-7 gap-1" role="presentation">
              {WEEKDAYS.map((label) => (
                <div key={label} className="pb-1 text-center text-xs text-text-3 uppercase">
                  {label.slice(0, 1)}
                  <span className="hidden sm:inline">{label.slice(1)}</span>
                </div>
              ))}

              {cells.map((day, i) => {
                // Outline only, no fill: it completes the frame without
                // offering itself as a day you could drop something on.
                if (day === null)
                  return (
                    <div
                      key={`blank-${i}`}
                      aria-hidden
                      className="rounded-md border border-hairline"
                    />
                  )

                const iso = isoOf(view.year, view.month, day)
                return (
                  <DayCell
                    key={day}
                    day={day}
                    iso={iso}
                    label={`${month.label} ${day}`}
                    items={eventsFor.get(day) ?? []}
                    isToday={day === month.today}
                    isSelected={day === selected}
                    dotsOnly={dotsOnly}
                    tall={tallCells}
                    onSelect={() => set({ d: day, focus: undefined })}
                    onAdd={() => addOn(iso)}
                    onOpen={openItem}
                  />
                )
              })}
            </div>

            {/* A key to the grid, not a filter of it. The divider goes with the
                key when the month has none of these marks, rather than ruling a
                line under nothing. */}
            {markKey.length > 0 ? (
              <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline pt-3.5">
                {markKey.map((entry) => (
                  <li key={entry.key} className="flex items-center gap-1.5 text-xs text-text-2">
                    <span
                      aria-hidden
                      className={cn('size-2.5 shrink-0 rounded-[2px] border', entry.swatch)}
                    />
                    <span className={cn(entry.struck && 'line-through decoration-1')}>
                      {entry.label}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel className="min-w-0">
            <PanelTitle hint={shortDate(selectedISO)}>
              {selected === month.today ? 'Today' : 'Selected day'}
            </PanelTitle>

            {selectedEvents.length === 0 ? (
              <EmptyState
                className="py-6"
                icon={CalendarDays}
                title={`Nothing on ${shortDate(selectedISO)}`}
                description="Add an interview, a deadline or a block of prep and it shows up here and on the grid."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button size="sm" onClick={() => addOn(selectedISO)}>
                      <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                      Add event
                    </Button>
                    {/* An empty day in a month you paged to is the easiest place
                        to get lost: nothing on screen names where "now" is. */}
                    {isCurrentMonth ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => goTo({ year: TODAY_PARTS.year, month: TODAY_PARTS.month })}
                      >
                        Back to {TODAY_MONTH}
                      </Button>
                    )}
                  </div>
                }
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {selectedEvents.map((e) => {
                  const mark = markOf(e)
                  const done = mark === 'done'
                  const Icon = done ? CircleCheck : KIND_ICON[e.kind]
                  return (
                    <li
                      key={e.id}
                      className={cn(
                        'group/row flex items-start gap-3 py-3',
                        // Marks the item a link named, so arriving from search or
                        // from a reminder lands on something, not just on a date.
                        // The tint decays and the parameter clears with it — see
                        // use-arrival-highlight.ts.
                        e.id === focus && 'arrival-highlight -mx-2 rounded-md px-2',
                      )}
                    >
                      <Icon
                        className={cn('mt-0.5 size-4 shrink-0', DAY_TEXT[mark])}
                        strokeWidth={1.7}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        {/* The way in to editing it. Everything on this grid was
                            read-only before, so a wrong time could only be fixed
                            from a list on another page. */}
                        <button
                          type="button"
                          onClick={() => openItem(e)}
                          className={cn(
                            'block max-w-full cursor-pointer truncate text-left text-sm transition-colors hover:text-accent',
                            done && 'text-text-3 line-through decoration-1',
                          )}
                        >
                          {e.title}
                        </button>
                        <div className="mt-0.5 text-xs text-text-3">
                          {[timeLabel(e) ?? 'All day', done ? 'Done' : null, e.detail]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-xs text-text-3">{KIND_LABEL[e.kind]}</span>
                        <button
                          type="button"
                          onClick={() => onDelete(e)}
                          aria-label={`Delete ${e.title}`}
                          title="Delete event"
                          className={cn(
                            'grid size-7 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 hover:border-danger-border hover:bg-danger-soft hover:text-danger',
                            REVEAL_IN_ROW,
                          )}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.9} aria-hidden />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="mt-4 border-t border-hairline pt-3.5">
              <div className="mb-2 text-xs tracking-wide text-text-3 uppercase">
                Rest of {month.label}
              </div>

              {restOfMonth.length === 0 ? (
                <EmptyState
                  className="py-6"
                  icon={CalendarDays}
                  title={
                    isLastDay
                      ? `${shortDate(selectedISO)} is the last day of the month`
                      : `Nothing after ${shortDate(selectedISO)}`
                  }
                  description={
                    isLastDay
                      ? `Nothing sits after it. Page forward to plan into ${MONTH_LABELS[nextMonth.month - 1]}.`
                      : `The rest of ${month.label} is clear. Anything you add after this day lands here.`
                  }
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {/* An "add" here has to land on a day this list would show,
                          or pressing it leaves the same empty state on screen.
                          On the last day of the month no such day exists, so the
                          honest offer is the next month rather than a new event. */}
                      {isLastDay ? (
                        <Button size="sm" onClick={() => goTo(nextMonth)}>
                          <ChevronRight className="size-3.5" strokeWidth={2} aria-hidden />
                          Go to {MONTH_LABELS[nextMonth.month - 1]}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => addOn(isoOf(view.year, view.month, selected + 1))}
                        >
                          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                          Add event
                        </Button>
                      )}
                    </div>
                  }
                />
              ) : (
                <ul className="space-y-1">
                  {restOfMonth.slice(0, 4).map((e) => {
                    const day = partsOf(e.date).d
                    const mark = markOf(e)
                    const done = mark === 'done'
                    const start = startLabel(e)
                    return (
                      <li key={e.id}>
                        {/* Selects the day and names the item, so the row leads
                            somewhere rather than reporting that a date exists. */}
                        <button
                          type="button"
                          onClick={() => set({ d: day, focus: e.id })}
                          title={`Go to ${month.label} ${day}`}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-left text-xs transition-colors hover:bg-row-hover"
                        >
                          <span
                            className={cn('size-1.5 shrink-0 rounded-full', DAY_DOT[mark])}
                            aria-hidden
                          />
                          {start ? (
                            <span className="tabular shrink-0 text-text-3">{start}</span>
                          ) : null}
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-text-2',
                              done && 'text-text-3 line-through decoration-1',
                            )}
                          >
                            {e.title}
                          </span>
                          <span className="tabular shrink-0 font-mono text-xs text-text-3">
                            {month.label.slice(0, 3)} {day}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {restOfMonth.length > 4 ? (
                    <li className="px-1 pt-1 text-xs text-text-3">
                      +{restOfMonth.length - 4} more later this month
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          </Panel>
        </div>

        {/* Rendered outside every cell, so it is clipped by nothing and stays
            above the grid while it travels. A transform on the chip itself would
            be clipped the moment it left its cell, and no z-index fixes that. */}
        <DragOverlay
          dropAnimation={
            reducedMotion ? null : { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
          }
        >
          {activeItem ? (
            // Opaque and raised: a timed chip is transparent in its cell, and a
            // transparent thing floating over the grid reads as a rendering fault.
            <EventChip
              item={activeItem}
              className="cursor-grabbing border border-hairline bg-panel shadow-[var(--shadow-raised)]"
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}
