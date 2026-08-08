import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A legend entry identifies itself by a colour swatch or by an icon — charts
 * use the first, the calendar the second. One component either way, so the
 * toggle semantics cannot drift between them.
 */
export type LegendItem = { key: string; label: string; color?: string; icon?: LucideIcon }

/**
 * Interactive chart legend — each entry toggles its series.
 *
 * Real buttons with `aria-pressed`, so the state is exposed rather than
 * implied by opacity. A hidden series keeps its swatch as a hollow outline
 * rather than vanishing, so you can still see it exists and turn it back on.
 */
export function ChartLegend({
  items,
  isHidden,
  onToggle,
  className,
}: {
  items: readonly LegendItem[]
  isHidden: (key: string) => boolean
  onToggle: (key: string) => void
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      {items.map((item) => {
        const off = isHidden(item.key)
        return (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              aria-pressed={!off}
              title={off ? `Show ${item.label}` : `Hide ${item.label}`}
              className={cn(
                'flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs transition-colors',
                off ? 'text-text-3 hover:text-text-2' : 'text-text-2 hover:text-text-1',
              )}
            >
              {item.icon ? (
                <item.icon
                  aria-hidden
                  strokeWidth={1.7}
                  className={cn('size-3.5 shrink-0', off && 'opacity-45')}
                />
              ) : (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px] border"
                  style={{
                    // Hollow rather than gone, so a hidden series is still
                    // visibly something you can switch back on.
                    background: off ? 'transparent' : item.color,
                    borderColor: item.color,
                  }}
                />
              )}
              <span className={cn(off && 'line-through decoration-1')}>{item.label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Shown when every series has been switched off. */
export function AllHidden({ className }: { className?: string }) {
  return (
    <p className={cn('py-10 text-center text-sm text-text-3', className)}>
      All series hidden — pick one from the legend to bring it back.
    </p>
  )
}
