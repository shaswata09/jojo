import { cn } from '@/lib/utils'

/**
 * A row of category chips with counts, plus an "All" reset.
 *
 * Shared by the vault's three tools and the applications table — filters that
 * behave identically have no business being written four times.
 *
 * Buttons in a `radiogroup` rather than a `<select>`: the set is small, and
 * seeing the counts without opening anything is most of the value.
 */
export function BucketFilter<T extends string>({
  label,
  options,
  labels,
  counts,
  value,
  onChange,
  total,
}: {
  label: string
  options: readonly T[]
  /** Display text per option, when the value is a slug rather than a label. */
  labels?: Record<string, string>
  /** How many items sit in each bucket, so an empty one reads as empty. */
  counts: Record<string, number>
  value: T | 'all'
  onChange: (next: T | 'all') => void
  total: number
}) {
  const chip = (key: T | 'all', text: string, count: number) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={value === key}
      onClick={() => onChange(key)}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
        value === key
          ? 'border-accent-border bg-accent-soft font-medium text-accent'
          : 'border-hairline bg-well text-text-2 hover:text-text-1',
      )}
    >
      {text}
      <span className={cn('tabular text-xs', value === key ? 'text-accent' : 'text-text-3')}>
        {count}
      </span>
    </button>
  )

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {chip('all', 'All', total)}
      {options.map((o) => chip(o, labels?.[o] ?? o, counts[o] ?? 0))}
    </div>
  )
}
