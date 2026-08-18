import { SNOOZE_STEPS, snoozeAnchor } from '@/components/common/snooze'
import { menuItemClass } from '@/components/common/RowMenu'
import { addDays, shortDate } from '@/data/timeline'
import { TODAY } from '@/lib/today'

/**
 * The step rows themselves: label on the left, the date it writes on the right.
 *
 * `spell` picks the vocabulary above, so a caller states which kind of menu it
 * is rather than restating the words. The popover, its trigger and its width
 * stay with the caller — those are the parts that genuinely differ, and folding
 * them in here would need a `variant` prop describing three call sites.
 */
export function SnoozeSteps({
  date,
  spell,
  onPick,
}: {
  /** The item's current date. The anchor is derived, never passed in. */
  date: string
  spell: 'dated' | 'duration'
  onPick: (days: number) => void
}) {
  const anchor = snoozeAnchor(date)
  const soon = anchor === TODAY

  return (
    <>
      {SNOOZE_STEPS.map((step) => (
        <button
          key={step.days}
          type="button"
          className={menuItemClass}
          onClick={() => onPick(step.days)}
        >
          <span className="flex-1 text-left">
            {spell === 'duration' ? step.duration : soon ? step.soon : step.later}
          </span>
          <span className="font-mono text-text-3">{shortDate(addDays(anchor, step.days))}</span>
        </button>
      ))}
    </>
  )
}
