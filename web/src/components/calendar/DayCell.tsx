import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { DraggableChip } from '@/components/calendar/EventChip'
import { DAY_DROP_PREFIX } from '@/components/calendar/drop-target'
import { DAY_DOT } from '@/components/calendar/marks'
import type { TimelineItem } from '@/data/timeline'
import { markOf } from '@/lib/timeline-visuals'
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

export function DayCell({
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
