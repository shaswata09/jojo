import { Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * "Unfiled" — the files not filed under any application.
 *
 * A TOGGLE beside the bucket chips, not another chip inside them. The bucket
 * row is a `radiogroup`: exactly one of it is on, because a file is in exactly
 * one bucket. Whether a file is filed under an application is a different
 * question about the same file, and folding it into the radiogroup would make
 * "Admin" and "unfiled" mutually exclusive — so the one thing a person is
 * likeliest to want, the loose documents in one drawer, would be the one thing
 * they could not ask for.
 *
 * It is drawn to match the chips exactly — same size, radius and border — since
 * it sits in the same row and does the same kind of job. `aria-pressed` rather
 * than `role="radio"` is what says it is independent of them.
 */
export function UnfiledChip({
  on,
  count,
  onChange,
}: {
  on: boolean
  /** How many files are unfiled at all, before the other filters. */
  count: number
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title="Files not filed under any application"
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
        // The bucket chips' rule, and for the bucket chips' reason: a chip wraps
        // to the next row, never inside itself.
        'shrink-0 whitespace-nowrap',
        on
          ? 'border-accent-border bg-accent-soft font-medium text-accent'
          : 'border-hairline bg-well text-text-2 hover:text-text-1',
      )}
    >
      <Unlink className="size-3" aria-hidden />
      Unfiled
      <span className={cn('tabular text-xs', on ? 'text-accent' : 'text-text-3')}>{count}</span>
    </button>
  )
}
