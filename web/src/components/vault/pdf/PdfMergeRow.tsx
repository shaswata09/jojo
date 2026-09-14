import { useDraggable, useDroppable } from '@dnd-kit/core'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { PdfChoice } from './use-pdf-files'

/** One document in the merge, and which of its pages to take. */
export type MergeRow = { readonly key: string; readonly choice: PdfChoice; readonly range: string }

/**
 * A row in the merge list, draggable by the rail down its left side.
 *
 * The grip is the board card's, deliberately: same rail, same dotted texture,
 * same `opacity-40` until hover. Order is the whole point of a merge, so the
 * gesture that sets it should be the one already learned one screen over, and a
 * second visual language for "pick this up and move it" would be a worse answer
 * than a slightly awkward reuse.
 *
 * Draggable AND droppable. `@dnd-kit/sortable` exists for exactly this and is
 * not installed; the board is built on `@dnd-kit/core` alone, and a list where
 * every row is both ends of the gesture needs nothing more.
 */
export function PdfMergeRow({
  row,
  position,
  total,
  onRange,
  onRemove,
}: {
  row: MergeRow
  /** 1-based, for what is shown and said. */
  position: number
  total: number
  onRange: (range: string) => void
  onRemove: () => void
}) {
  const { setNodeRef: dropRef, isOver, active } = useDroppable({ id: row.key })
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: row.key })

  // Only while something is actually travelling: `isOver` is true of whatever
  // the pointer rests on, and a row that lit up on an idle hover would be
  // promising a drop nobody is making.
  const landing = isOver && active !== null && String(active.id) !== row.key

  return (
    <li
      ref={dropRef}
      className={cn(
        'relative rounded-lg transition-colors',
        // A line where the row would land, rather than tinting the row itself:
        // the question a person is asking mid-drag is "between which two", and
        // a filled row answers "on top of which".
        landing
          ? 'before:absolute before:-top-1 before:right-0 before:left-0 before:h-0.5 before:rounded-full before:bg-accent'
          : '',
      )}
    >
      <div
        ref={dragRef}
        className={cn(
          'group flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-hairline bg-well py-2 pr-2 pl-7 transition-opacity',
          isDragging ? 'opacity-40' : '',
        )}
      >
        <button
          type="button"
          className={cn(
            'touch-target absolute inset-y-0 left-0 z-[1] w-5 cursor-grab touch-none rounded-l-lg py-1.5 text-text-3 transition-opacity active:cursor-grabbing',
            'opacity-40 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          aria-label={`Move ${row.choice.name}, ${position} of ${total}`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          {/* The board card's rail, as a repeating background rather than an
              icon, so one paint step fits any row height. */}
          <span
            className="mx-auto block h-full w-2 bg-[radial-gradient(currentColor_1px,transparent_1.5px)] bg-[length:4px_4px]"
            aria-hidden
          />
        </button>

        <span className="w-4 shrink-0 text-center text-xs text-text-3 tabular-nums">
          {position}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm" title={row.choice.name}>
          {row.choice.name}
          {row.choice.kind === 'device' ? (
            <span className="ml-1.5 text-xs text-text-3">· from this device</span>
          ) : null}
        </span>
        <Input
          className="h-8 w-32 shrink-0"
          value={row.range}
          placeholder="All pages"
          aria-label={`Pages to take from ${row.choice.name}`}
          onChange={(event) => onRange(event.target.value)}
        />
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Take ${row.choice.name} out of the merge`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>
    </li>
  )
}

/**
 * The copy that travels under the pointer. Inert — no handle, no inputs.
 *
 * Laid out like the row it came from rather than as a bare label, because
 * `DragOverlay` sizes itself to the element being dragged: a label alone leaves
 * a card-width bar with a word in the corner, which reads as a bug rather than
 * as the row in transit.
 */
export function PdfMergeRowGhost({ row, position }: { row: MergeRow; position: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent bg-panel py-2 pr-2 pl-7 text-sm shadow-lg">
      <span className="w-4 shrink-0 text-center text-xs text-text-3 tabular-nums">{position}</span>
      <span className="min-w-0 flex-1 truncate">
        {row.choice.name}
        {row.choice.kind === 'device' ? (
          <span className="ml-1.5 text-xs text-text-3">· from this device</span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs text-text-3">
        {row.range.trim() === '' ? 'All pages' : row.range.trim()}
      </span>
    </div>
  )
}
