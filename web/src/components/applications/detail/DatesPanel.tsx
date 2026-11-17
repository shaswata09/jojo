import { CalendarPlus, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelScroll, PanelTitle } from '@/components/common/Panel'
import { BUCKET_TEXT } from '@/components/common/timeline-buckets'
import { Button } from '@/components/ui/button'
import { bucketOf, timeLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { KIND_ICON } from '@/lib/timeline-visuals'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

/**
 * Everything dated that points at this record — overdue, due and done.
 *
 * Second on the page, not last. The record's dates and the only Add button on
 * the page used to sit 79px below the fold, underneath an empty rich-text
 * editor and its eight-button toolbar — so the one thing this page is opened to
 * check was the one thing you had to scroll for.
 */
export function DatesPanel({
  applicationId,
  items,
  onAddItem,
}: {
  applicationId: string
  /** Already sorted by the record, which also counts them for the delete copy. */
  items: TimelineItem[]
  onAddItem?: (applicationId: string) => void
}) {
  const { t } = useTranslation('applications')
  const { open: openDialog } = useDialogs()
  const openCount = items.filter((i) => !i.completedOn).length

  return (
    <Panel className="flex min-w-0 flex-col">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle
          className="mb-0"
          hint={
            items.length > 0 ? t('dates.hint', { open: openCount, total: items.length }) : undefined
          }
        >
          {/* Not "Upcoming": this list holds overdue and completed rows too,
              and a heading that promised the future while showing a thing you
              missed last week was the least trustworthy word on the page. */}
          {t('dates.title')}
        </PanelTitle>
        <Button
          size="sm"
          variant="outline"
          disabled={!onAddItem}
          // Same stale-blocker fix as the header's Edit item: the dialog is
          // mounted, and this names what would be true if it were not.
          title={onAddItem ? undefined : t('dates.addUnavailable')}
          onClick={() => onAddItem?.(applicationId)}
        >
          <CalendarPlus className="size-3.5" strokeWidth={2} aria-hidden />
          {t('dates.add')}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={t('dates.emptyTitle')}
          description={t('dates.emptyBody')}
          action={
            onAddItem ? (
              <Button size="sm" variant="outline" onClick={() => onAddItem(applicationId)}>
                <CalendarPlus className="size-3.5" strokeWidth={2} aria-hidden />
                {t('dates.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        // Bounded rather than free-growing: an application in its fifth round
        // can carry a dozen rows, and they should not push the rest of the
        // column off the screen.
        <PanelScroll axis="y" className="max-h-80">
          <ul className="divide-y divide-hairline">
            {items.map((item) => (
              <UpcomingRow
                key={item.id}
                item={item}
                onDraft={() => openDialog('draft', { itemId: item.id })}
              />
            ))}
          </ul>
        </PanelScroll>
      )}
    </Panel>
  )
}

/** The kinds a message is the obvious next move on. */
const DRAFTABLE: readonly TimelineItem['kind'][] = ['interview', 'follow-up', 'call', 'visit']

function UpcomingRow({ item, onDraft }: { item: TimelineItem; onDraft: () => void }) {
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const Icon = KIND_ICON[item.kind]
  const bucket = bucketOf(item, TODAY)
  const done = Boolean(item.completedOn)
  const draftable = !done && DRAFTABLE.includes(item.kind)

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-text-3" strokeWidth={1.7} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm', done && 'text-text-3 line-through')}>{item.title}</div>
        <div className="mt-0.5 truncate text-xs text-text-3">
          {domain.kind(item.kind)}
          {item.detail ? ` · ${item.detail}` : ''}
        </div>
        {/* Under the row rather than beside the date, so a row that has a
            message to write does not shunt the date column sideways from the
            rows above and below it. */}
        {draftable ? (
          <Button
            size="xs"
            variant="outline"
            className="mt-1.5"
            onClick={onDraft}
            aria-label={t('dates.draftFor', { title: item.title })}
          >
            <PenLine className="size-3" strokeWidth={2} aria-hidden />
            {t('common.draftMessage')}
          </Button>
        ) : null}
      </div>
      <div className="shrink-0 text-end">
        <div className={cn('text-xs font-medium whitespace-nowrap', BUCKET_TEXT[bucket])}>
          {domain.when(item, TODAY)}
        </div>
        <div className="mt-0.5 font-mono text-xs whitespace-nowrap text-text-3">
          {timeLabel(item) ?? domain.shortDate(item.date)}
        </div>
      </div>
    </li>
  )
}
