import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { openRail } from '@/components/applications/open-rail'
import { StageMenu } from '@/components/applications/StageMenu'
import { FlagButton, RowMenu } from '@/components/applications/table/RowControls'
import type { RowActions } from '@/components/applications/use-row-actions'
import { Chip } from '@/components/common/Chip'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { PanelScroll } from '@/components/common/Panel'
import { STAGE_LABEL, displayName, type Application } from '@/data/seed'
import { addDays, agoLabel, compareItems, daysBetween, shortDate, whenLabel } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { useTimeline } from '@/kg/react/use-timeline'
import { refKey } from '@/lib/ids'
import { appPath, type ApplicationsSortKey } from '@/lib/links'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/**
 * The words come from `agoLabel`, so this column speaks the same past tense as
 * "Completed 3 days ago" in the Vault and "saved 5 days ago" in the profile —
 * including its two-week cut-off, past which a count of days stops being
 * information and the plain date is what you would say out loud.
 *
 * Capitalised here and nowhere else: `agoLabel` leads lowercase because every
 * other consumer uses it mid-phrase, and this is the one place it stands alone
 * as a cell value.
 */
function activityLabel(daysAgo: number) {
  const ago = agoLabel(addDays(TODAY, -daysAgo), TODAY)
  return ago.charAt(0).toUpperCase() + ago.slice(1)
}

/**
 * The next thing this application owes, if anything does.
 *
 * Overdue first, then soonest: an application whose deadline passed on Friday
 * has nothing more urgent than that, so the column has to lead with it rather
 * than skip ahead to next month's interview.
 */
function nextDateOf(items: TimelineItem[] | undefined) {
  if (!items || items.length === 0) return undefined
  return [...items].filter((i) => !i.completedOn).sort(compareItems)[0]
}

function NextDateCell({ item }: { item?: TimelineItem }) {
  if (!item) {
    return (
      <span className="text-text-3" aria-label="No date">
        —
      </span>
    )
  }

  // Colour law: red is past due and nothing else, amber is the next 48 hours
  // and nothing else. Everything further out is plain text, however important.
  const gap = daysBetween(TODAY, item.date)
  const tone = gap < 0 ? 'text-danger' : gap <= 1 ? 'text-warning' : 'text-text-3'

  return (
    <span className={tone}>
      {shortDate(item.date)}
      {/* The colour carries this for anyone who can see it; the gap itself is
          only spoken, so the cell stays one date wide. */}
      <span className="sr-only"> — {whenLabel(item, TODAY).toLowerCase()}</span>
    </span>
  )
}

/** The sorted, stage-filtered list as a table — one row per application. */
export function ApplicationsTable({
  rows,
  sort,
  toggleSort,
  openId,
  setOpenRow,
  showNotes,
  compact,
  actions,
}: {
  rows: Application[]
  sort: { key: ApplicationsSortKey; dir: 'asc' | 'desc' }
  toggleSort: (key: ApplicationsSortKey) => void
  openId?: string
  setOpenRow: (node: HTMLElement | null) => void
  showNotes: boolean
  compact: boolean
  actions: RowActions
}) {
  const { all: timelineItems } = useTimeline()

  /**
   * The next dated thing per application, built once rather than filtered per
   * row — twelve rows each scanning the whole timeline is the shape that gets
   * slow the moment a real store is behind it.
   */
  const nextDates = useMemo(() => {
    const byApp = new Map<string, TimelineItem[]>()
    for (const item of timelineItems) {
      if (!item.applicationId) continue
      const list = byApp.get(item.applicationId)
      if (list) list.push(item)
      else byApp.set(item.applicationId, [item])
    }
    return new Map([...byApp].map(([id, items]) => [id, nextDateOf(items)]))
  }, [timelineItems])

  const SortHeader = ({
    label,
    k,
    align,
  }: {
    label: string
    k: ApplicationsSortKey
    align?: 'right'
  }) => (
    <th
      scope="col"
      // aria-sort belongs to the column, not to the control inside it — on the
      // button it described a button rather than a column of data.
      aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('py-2 pr-3 font-medium', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 rounded-sm text-text-3 hover:text-text-1"
      >
        {label}
        {sort.key === k ? (
          sort.dir === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  )

  return (
    <PanelScroll>
      <table className="w-full min-w-[780px] text-sm">
        <caption className="sr-only">Applications, sortable</caption>
        {/* Fixed widths for the four short columns, so Position keeps
            every pixel neither of them needs. */}
        <colgroup>
          <col />
          <col className="w-[130px]" />
          <col className="w-[132px]" />
          <col className="w-[104px]" />
          <col className="w-[112px]" />
          <col className="w-[96px]" />
        </colgroup>
        <thead>
          {/* Sticky so the column labels survive scrolling. Needs its own
              background or rows show through as they pass under it. */}
          <tr className="sticky top-0 z-[1] border-b border-hairline bg-panel text-left text-xs">
            <SortHeader label="Position" k="role" />
            <th scope="col" className="py-2 pr-3 font-medium text-text-3">
              Role
            </th>
            <SortHeader label="Stage" k="stage" />
            <th scope="col" className="py-2 pr-3 font-medium text-text-3">
              Next date
            </th>
            <SortHeader label="Last activity" k="daysAgo" align="right" />
            <th scope="col" className="py-2 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((a) => {
            const isOpen = a.id === openId
            return (
              <tr
                key={a.id}
                ref={isOpen ? setOpenRow : undefined}
                className={cn('pressable-row hover:bg-row-hover', isOpen && 'bg-accent-soft')}
              >
                <th
                  scope="row"
                  className={cn(
                    'relative pr-3 pl-2 text-left font-normal',
                    compact ? 'py-1.5' : 'py-2.5',
                    isOpen && openRail,
                  )}
                >
                  <Link
                    to={appPath(a)}
                    aria-current={isOpen ? 'page' : undefined}
                    className="block truncate hover:text-accent hover:underline"
                  >
                    {displayName(a)}
                  </Link>
                  {showNotes ? (
                    <div className="mt-0.5 truncate text-xs text-text-3">{a.note}</div>
                  ) : null}
                  {/* Returns null with no keywords on the record, so
                      an untagged row costs no extra height. */}
                  <LabelChips recordId={refKey('app', a.id)} className="mt-1" />
                </th>
                <td className={cn('pr-3', compact ? 'py-1.5' : 'py-2.5')}>
                  <Chip className="font-normal">{a.roleTag}</Chip>
                </td>
                <td className={cn('pr-3', compact ? 'py-1.5' : 'py-2.5')}>
                  {/* The chip was only ever a label; it is the control
                      now, so the stage can be changed without a drag. */}
                  <StageMenu
                    value={a.stage}
                    onSelect={(stage) => actions.onMoveStage(a, stage)}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Stage of ${displayName(a)}: ${STAGE_LABEL[a.stage]}. Change stage`}
                        className="cursor-pointer rounded-sm"
                      >
                        <Chip stage={a.stage} className="font-normal">
                          {STAGE_LABEL[a.stage]}
                        </Chip>
                      </button>
                    }
                  />
                </td>
                <td className={cn('pr-3 text-xs whitespace-nowrap', compact ? 'py-1.5' : 'py-2.5')}>
                  <NextDateCell item={nextDates.get(a.id)} />
                </td>
                <td
                  className={cn(
                    'tabular pr-3 text-right text-xs whitespace-nowrap text-text-3',
                    compact ? 'py-1.5' : 'py-2.5',
                  )}
                >
                  {/* Anything the user just added or edited is stamped
                      daysAgo 0, so this column is the one people read
                      straight after acting — "0d ago" was the answer
                      every time. */}
                  {activityLabel(a.daysAgo)}
                </td>
                <td className={cn(compact ? 'py-1.5' : 'py-2.5')}>
                  <div className="flex items-center justify-end gap-0.5">
                    {/* `size-7 rounded-md` matches the two controls
                        beside it; tailwind-merge collapses it against
                        the picker's baked-in `size-6 rounded-full`. */}
                    <LabelPicker
                      recordId={refKey('app', a.id)}
                      name={displayName(a)}
                      className="size-7 rounded-md"
                    />
                    <FlagButton app={a} onFlag={actions.onFlag} />
                    <RowMenu app={a} actions={actions} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </PanelScroll>
  )
}
