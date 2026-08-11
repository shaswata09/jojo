import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { TimelineKind } from '@/data/timeline'
import { KIND_ICON, KIND_LABEL, TIMELINE_KINDS } from '@/lib/timeline-visuals'
import { cn } from '@/lib/utils'

/**
 * Kind, as a grid you can read rather than a row that wraps.
 *
 * `Segment` takes a plain string per option, so seven kinds became seven pills
 * that wrapped at this width and stranded "Follow-up" alone on a second line,
 * inside a track that still drew its own border around the gap. Four columns
 * fits the seven exactly — three on the second row, left-aligned — and the icon
 * that used to live in the hint sits on the option it belongs to.
 *
 * Roving tabindex like `Segment`'s, extended for two dimensions: left/right step
 * by one, up/down by a row. Marking children `role="radio"` without that is
 * worse than no role at all.
 */
export function KindGrid({
  value,
  onChange,
  describedBy,
}: {
  value: TimelineKind
  onChange: (next: TimelineKind) => void
  describedBy?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const COLUMNS = 4

  const move = (to: number) => {
    const index = (to + TIMELINE_KINDS.length) % TIMELINE_KINDS.length
    onChange(TIMELINE_KINDS[index])
    groupRef.current?.querySelectorAll('button')[index]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = TIMELINE_KINDS.indexOf(value)
    if (current === -1) return
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    }
    if (event.key in step) {
      event.preventDefault()
      move(current + step[event.key])
    } else if (event.key === 'Home') {
      event.preventDefault()
      move(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      move(TIMELINE_KINDS.length - 1)
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Kind"
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      className="grid grid-cols-4 gap-1.5"
    >
      {TIMELINE_KINDS.map((k) => {
        const Icon = KIND_ICON[k]
        const on = k === value
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(k)}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-2 text-xs transition-colors',
              on
                ? 'border-accent-border bg-accent-soft font-medium text-accent'
                : 'border-hairline bg-well text-text-2 hover:text-text-1',
            )}
          >
            <Icon aria-hidden className="size-4" strokeWidth={1.7} />
            <span className="truncate">{KIND_LABEL[k]}</span>
          </button>
        )
      })}
    </div>
  )
}
