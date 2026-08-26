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
/**
 * dnd-kit's draggable attributes, minus the two that promise a keyboard drag.
 *
 * `useDraggable` returns `aria-roledescription: 'draggable'` and an
 * `aria-describedby` pointing at dnd-kit's own instructions — "press space bar
 * to start a drag". On the board that is true. Here it is not: `Calendar.tsx`
 * registers the pointer sensor ONLY, and deliberately, because the
 * `KeyboardSensor`'s activator is Space/Enter and it calls `preventDefault` —
 * on a chip that is also the way in to editing an event, registering it would
 * eat the very keypress this control exists to deliver.
 *
 * So the sensor stays out and the CLAIM goes with it. A screen reader was being
 * told to press a key that did nothing, on the only part of this grid that
 * announced itself at all — which is worse than saying nothing, because a
 * person who cannot see the chip has no way to discover that it did not work.
 * The keyboard route to a new date is the date field inside the event, and the
 * hint under the grid says so out loud.
 *
 * `role` and the drag state are kept: `aria-disabled` and `aria-pressed` are
 * about the button, not about a gesture it cannot offer.
 */
function draggableAria(
  attributes: DraggableAttributes | undefined,
): Partial<DraggableAttributes> | undefined {
  if (!attributes) return undefined
  const { 'aria-roledescription': _role, 'aria-describedby': _describedBy, ...rest } = attributes
  return rest
}

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
      {...draggableAria(handle?.attributes)}
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
