import { useDraggable, type DraggableAttributes } from '@dnd-kit/core'
import { MARK_CHIP, startLabel } from '@/components/calendar/marks'
import type { TimelineItem } from '@/data/timeline'
import { markOf } from '@/lib/timeline-visuals'
import { cn } from '@/lib/utils'

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
export function EventChip({
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
export function DraggableChip({
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
