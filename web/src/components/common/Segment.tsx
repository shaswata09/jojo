import { useRef } from 'react'
import { cn } from '@/lib/utils'

export type SegmentOption<T extends string> = { value: T; label: string }

/**
 * Pill-style segmented control. Used for the Academia/Industry mode,
 * the Table/Kanban switch, and the board's track filter.
 *
 * Implements the ARIA radiogroup pattern properly: a roving tabindex (one
 * stop for the whole group, not one per option) plus arrow-key selection.
 * Marking children `role="radio"` without those is worse than no role at
 * all, because assistive tech then promises behaviour that isn't there.
 */
export function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group, e.g. "Career track". */
  label: string
  className?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)

  const focusAndSelect = (index: number) => {
    const next = options[(index + options.length) % options.length]
    onChange(next.value)
    const buttons = groupRef.current?.querySelectorAll('button')
    buttons?.[(index + options.length) % options.length]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = options.findIndex((o) => o.value === value)
    if (current === -1) return
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        focusAndSelect(current + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        focusAndSelect(current - 1)
        break
      case 'Home':
        event.preventDefault()
        focusAndSelect(0)
        break
      case 'End':
        event.preventDefault()
        focusAndSelect(options.length - 1)
        break
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex rounded-full border border-hairline bg-well p-[3px] text-xs', className)}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: Tab enters the group once, arrows move within it.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              // A 25px pill is the shortest tap target in the app. It grows to
              // 44px on a coarse pointer, but the rule lives in index.css
              // against `[role='radio']` so `BucketFilter`'s chips — the app's
              // other segmented control, with the same problem — are covered by
              // the same declaration rather than a second copy of it. Height
              // only: the Vault's segment carries five options and the page
              // header has no room to widen them at 390px.
              'pressable rounded-full px-[15px] py-[5px] transition-colors duration-150',
              // The thumb returns to the card's own colour while the track stays
              // recessed — the segmented-control model, and the only pairing
              // that reads in both themes: --panel is lighter than --well in
              // light and darker in dark, so any fixed tint works in one and
              // disappears in the other. `bg-accent-soft` was exactly that
              // mistake: it is byte-identical to --well in both palettes, so
              // the active pill rendered no pill at all.
              // Ring rather than border, so selecting an option cannot shift
              // the width of its neighbours by a pixel.
              active
                ? 'bg-panel font-medium text-accent ring-1 ring-hairline'
                : 'text-text-2 hover:text-text-1',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
