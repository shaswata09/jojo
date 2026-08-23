import type { Ref } from 'react'
import { Link } from 'react-router'
import { Check, Copy, Pencil, Trash2 } from 'lucide-react'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { Button } from '@/components/ui/button'
import { MenuItem, MenuSection, RowMenu } from '@/components/common/RowMenu'
import { COLLAPSE_MS } from '@/components/vault/reminders/model'
import type { RowActions, Transit } from '@/components/vault/reminders/model'
import { DateLines, SnoozeMenu } from '@/components/vault/reminders/SnoozeMenu'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import type { TimelineItem } from '@/data/timeline'
import { appPath } from '@/lib/links'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { cn } from '@/lib/utils'

export function ReminderRow({
  item,
  related,
  focused,
  rowRef,
  transit,
  actions,
}: {
  item: TimelineItem
  /**
   * The application it hangs off — the record, not a name spelled from it.
   *
   * It was a string, and the link beside it was built from `item.applicationId`.
   * That id is minted per session, so the reminder's one way back to its
   * application was a URL that died on the next reload; `appPath` needs the
   * record to reach for its slug.
   */
  /** Every application it hangs off. Empty, never absent. */
  related: readonly Application[]
  /** Arrived here from a link that named this row — see `focus` in links.ts. */
  focused?: boolean
  /** Set on the focused row only, so the tool can scroll it into view. */
  rowRef?: Ref<HTMLLIElement>
  /** Set while this row is playing out the click that will move or remove it. */
  transit?: Transit
  actions: RowActions
}) {
  // Everything below reads the previewed record, so the outcome is on the row
  // before the store knows about it.
  const shown = transit?.preview ? { ...item, ...transit.preview } : item
  const Icon = KIND_ICON[shown.kind]
  const done = Boolean(shown.completedOn)
  const collapsed = transit?.phase === 'leaving' || transit?.phase === 'arriving'

  return (
    // The collapse is a grid track, not a height: `1fr → 0fr` animates without
    // anyone having to measure the row first, and everything below slides up
    // continuously instead of jumping when the row is finally gone.
    <li
      ref={rowRef}
      className={cn(
        'grid border-b border-hairline transition-[grid-template-rows,opacity] ease-out last:border-b-0',
        collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
      )}
      style={{ transitionDuration: `${COLLAPSE_MS}ms` }}
    >
      <div
        className={cn(
          'overflow-hidden',
          // A row on its way out must not take a second click: the store write
          // has not happened yet, so a double-tick would fire twice.
          transit && 'pointer-events-none',
        )}
      >
        <div
          className={cn(
            // Wraps below `sm`. The trailing cluster is `shrink-0` and runs to
            // ~220px (Draft a reply, the date, the keyword picker, the ⋯), which
            // on a 390px screen left the title about 90px — it rendered as "C…",
            // and at 360px as nothing at all, so the row said a reminder was
            // overdue without saying which. On one line the actions now drop
            // underneath and the title gets the width.
            'flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 sm:flex-nowrap',
            // Marks the row a link pointed at. `.arrival-highlight` fades the
            // tint out rather than holding it — see use-arrival-highlight.ts,
            // which drops the URL parameter on the same beat and scrolls the
            // row into view, because a tint below the fold answers nothing.
            focused && 'arrival-highlight -mx-2 rounded-md px-2',
          )}
        >
          {/* A real checkbox role, so screen readers get the state and Space works. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            onClick={() => actions.toggle(item)}
            aria-label={done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" done`}
            className={cn(
              // `touch-target` for the catch area: an 18px arbitrary size
              // matches none of the `size-6/7/8` selectors in `index.css`, so
              // this was an 18×18 target on a phone — for the one control that
              // completes a reminder.
              'touch-target grid size-[18px] shrink-0 place-items-center rounded-sm border transition-colors',
              done
                ? 'border-accent-border bg-accent-soft text-accent'
                : 'border-hairline-strong hover:border-accent-border',
            )}
          >
            {done ? <Check className="size-3" strokeWidth={2.5} /> : null}
          </button>

          <div className="min-w-0 flex-1 basis-[calc(100%-1.875rem)] sm:basis-auto">
            {/* The title is the way in to editing it. A row you can tick but not
                correct is where every wrong date in this list came from. */}
            <button
              type="button"
              onClick={() => actions.edit(item)}
              className={cn(
                // `hover:underline` as well as the colour. In the dark theme
                // --accent and --text-1 are the same #fafafa (see index.css),
                // so an undone title — which is --text-1 — changed nothing at
                // all under the pointer. A done one is --text-3 and did move,
                // which is exactly why this went unnoticed.
                'block max-w-full cursor-pointer truncate text-left text-sm underline-offset-2 transition-colors hover:text-accent hover:underline',
                done && 'text-text-3 line-through',
              )}
            >
              {shown.title}
            </button>
            {/* One line, not three. The keyword chips used to sit under this and
                made every row a different height, which is why eight reminders
                did not fit on a screen. */}
            <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs text-text-3">
              {/* Named out loud: the icon is the only thing on the row that
                  says whether this is a chase or a piece of prep. */}
              <Icon
                role="img"
                aria-label={KIND_LABEL[shown.kind]}
                className="size-3.5 shrink-0"
                strokeWidth={1.7}
              />
              {/* The edge back to the application — the reason every dated thing
                  became one record with an `applicationId` instead of five lists
                  that could only name a job in prose. */}
              {/* One link per application: a reference deadline covering three
                  jobs is reachable from all three, and naming one would be
                  picking a favourite the record does not have. */}
              {related.length > 0 ? (
                related.map((app) => (
                  <Link
                    key={app.id}
                    to={appPath(app)}
                    className="min-w-0 truncate underline-offset-2 transition-colors hover:text-accent hover:underline"
                  >
                    {displayName(app)}
                  </Link>
                ))
              ) : (
                <span className="shrink-0">Unfiled</span>
              )}
              {shown.note ? <span className="truncate">· {shown.note}</span> : null}
              <LabelChips recordId={item.id} className="shrink-0" />
            </div>
          </div>

          <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:justify-start">
            {/* Ahead of the date, not after the ⋯. Sitting last, it pushed the
                overflow button 56px sideways on follow-up rows only, so ⋯ was in
                a different place on every other row of the list. */}
            {shown.kind === 'follow-up' && !done ? (
              <Button variant="ghost" size="sm" onClick={() => actions.draft(item)}>
                Draft a reply
              </Button>
            ) : null}

            {/* A completed row keeps the date it was done on, and nothing to
                snooze: moving a finished reminder into next week is not a thing
                anyone means to do. Untick it first and the menu comes back. */}
            {done ? (
              <div className="px-1.5 py-0.5 text-right">
                <DateLines item={shown} />
              </div>
            ) : (
              <SnoozeMenu item={shown} actions={actions} />
            )}

            <LabelPicker recordId={item.id} />
            <RowMenu name={item.title}>
              <MenuItem icon={Pencil} onSelect={() => actions.edit(item)}>
                Edit
              </MenuItem>
              <MenuItem icon={Copy} onSelect={() => actions.duplicate(item)}>
                Duplicate
              </MenuItem>
              <MenuSection>
                <MenuItem icon={Trash2} danger onSelect={() => actions.remove(item)}>
                  Delete
                </MenuItem>
              </MenuSection>
            </RowMenu>
          </div>
        </div>
      </div>
    </li>
  )
}
