import { useState } from 'react'
import { CalendarSearch, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TODAY_PARTS } from '@/lib/today'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

/**
 * Jump straight to a month.
 *
 * Stepping a year at a time and picking from twelve is faster than clicking an
 * arrow twelve times, which was the only route to next March before this.
 * Its own year state, so browsing forward in the picker does not move the
 * calendar behind it until a month is actually chosen.
 */
export function MonthPicker({
  year,
  month,
  onPick,
}: {
  year: number
  month: number
  onPick: (next: { year: number; month: number }) => void
}) {
  const { t } = useTranslation('calendar')
  const domain = useDomain()
  const [open, setOpen] = useState(false)
  const [draftYear, setDraftYear] = useState(year)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Reopening should start from where the calendar actually is, not from
        // wherever the last browse left off.
        if (next) setDraftYear(year)
      }}
    >
      <PopoverTrigger
        aria-label={t('monthPicker.goTo')}
        title={t('monthPicker.goTo')}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
      >
        <CalendarSearch className="size-3.5" strokeWidth={1.8} aria-hidden />
        {/* The label goes below `sm` and the aria-label carries the name: the
            month heading, this trigger and a text Today button no longer fit on
            one 321px row, and a wrapped header is a worse trade than an icon
            with a tooltip on the control you press least. */}
        <span className="hidden sm:inline">{t('monthPicker.goTo')}</span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-60">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDraftYear((y) => y - 1)}
            aria-label={t('monthPicker.previousYear')}
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
          >
            <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2} aria-hidden />
          </button>
          <span className="tabular text-sm font-medium">{draftYear}</span>
          <button
            type="button"
            onClick={() => setDraftYear((y) => y + 1)}
            aria-label={t('monthPicker.nextYear')}
            className="grid size-6 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
          >
            <ChevronRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {/* The language's own abbreviation (CLDR's: 'juin', 'juil.',
              '11月'), never the first three letters — French juin and juillet
              would both come out "jui". The full name is the accessible one. */}
          {Array.from({ length: 12 }, (_, i) => {
            const m = i + 1
            const label = domain.monthShort(m)
            const isCurrent = draftYear === year && m === month
            const isToday = draftYear === TODAY_PARTS.year && m === TODAY_PARTS.month
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onPick({ year: draftYear, month: m })
                  setOpen(false)
                }}
                aria-current={isCurrent ? 'date' : undefined}
                aria-label={domain.month(m)}
                className={cn(
                  'cursor-pointer truncate rounded-sm px-1 py-1.5 text-xs transition-colors',
                  isCurrent
                    ? 'bg-accent font-medium text-[color:var(--accent-fg)]'
                    : 'text-text-2 hover:bg-well hover:text-text-1',
                  // A quiet mark on the real current month, so the picker says
                  // where "today" is even while browsing another year.
                  !isCurrent && isToday && 'font-medium text-accent',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
