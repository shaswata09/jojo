import { Link, NavLink } from 'react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { GUIDE_PAGE_META } from '@/components/guide/pages'
import { GUIDE_PAGES, guidePath, useGuidePage } from '@/lib/links'
import { cn } from '@/lib/utils'

/**
 * The rail across the top of every guide page.
 *
 * Wrapping pills rather than a horizontal scroller, which is the other thing
 * this could have been. A scroller keeps one line at 390px, but it hides the
 * pages that do not fit, and the one fact a documentation section has to give a
 * reader on arrival is how many pages there are — a section whose shape you
 * have to discover by dragging is a section you assume you have already seen
 * all of. Four short labels wrap to two lines at 390 and sit on one from 480 up.
 *
 * Numbered, because the order carries an argument: anyone can stop after the
 * first page and still use the app, and the reader who is deciding whether to
 * keep going deserves to know where they are in the sequence. The numbers are
 * `aria-hidden` — the list is already an <ol>, so a screen reader counts them
 * itself, and reading "one one How to use" is the cost of saying it twice.
 *
 * `end` on the landing page only. '/guide' is a prefix of all three others, so
 * without it the first pill stays lit on every page in the section and the rail
 * claims you are in two places.
 */
export function GuideNav() {
  return (
    <nav aria-label="Guide pages">
      <ol className="flex flex-wrap gap-1.5">
        {GUIDE_PAGE_META.map((page, index) => (
          <li key={page.id}>
            <NavLink
              to={guidePath(page.id)}
              end={page.id === 'overview'}
              className={({ isActive }) =>
                cn(
                  'pressable flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors duration-150',
                  isActive
                    ? 'border-accent-border bg-accent-soft font-medium text-accent'
                    : 'border-hairline bg-well text-text-2 hover:border-hairline-strong hover:text-text-1',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={cn('tabular', isActive ? 'text-accent' : 'text-text-3')}
                  >
                    {index + 1}
                  </span>
                  {page.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/**
 * The contents list — every page with the question it answers.
 *
 * Separate from the rail on purpose. The rail is "where am I", which has to be
 * cheap enough to repeat on all four pages; this is "what is in here", which is
 * worth a paragraph each and is only worth showing where someone is choosing.
 * Any of the four pages may render it; the current one is marked rather than
 * dropped, so the list is the same length wherever it appears and a reader
 * cannot mistake three cards for the whole section.
 */
export function GuideContents() {
  const current = useGuidePage()

  return (
    <nav aria-label="Guide contents">
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5">
        {GUIDE_PAGE_META.map((page, index) => {
          const here = page.id === current
          return (
            <li key={page.id}>
              <Link
                to={guidePath(page.id)}
                aria-current={here ? 'page' : undefined}
                className={cn(
                  'surface group block h-full rounded-lg p-4 transition-colors duration-150',
                  here ? 'border-accent-border' : 'hover:border-hairline-strong',
                )}
              >
                <p className="flex items-baseline gap-2">
                  <span aria-hidden className="tabular text-xs text-text-3">
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-medium',
                      here ? 'text-accent' : 'group-hover:text-accent',
                    )}
                  >
                    {page.label}
                  </span>
                  {here ? <span className="ml-auto text-xs text-text-3">you are here</span> : null}
                </p>
                <p className="mt-1.5 text-sm text-text-2">{page.blurb}</p>
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * Previous and next, at the foot of every page.
 *
 * Rendered by the layout rather than by each page, for the reason the rail is:
 * a pager one content author forgets to add is a dead end in the middle of a
 * sequence, and nothing about the page above it decides what comes next.
 *
 * `basis-40` with `flex-wrap` is what makes 390px work — all three want about
 * 420px between them, so below that something has to give a line up. The
 * counter is the thing that gives: `order` puts the two links together on the
 * first row and drops the counter full-width underneath, rather than leaving
 * Previous stranded beside a page number with Next alone on the row below.
 * Order is visual only, so the reading order stays previous → where you are →
 * next either way.
 *
 * `min-w-0` and `truncate` on the labels because a flex item's default
 * `min-width: auto` refuses to shrink below its own text, which is the usual
 * way a page like this ends up scrolling sideways on a phone.
 */
export function GuidePager() {
  const current = useGuidePage()
  const index = GUIDE_PAGES.indexOf(current)
  const previous = index > 0 ? GUIDE_PAGE_META[index - 1] : undefined
  const next = index < GUIDE_PAGE_META.length - 1 ? GUIDE_PAGE_META[index + 1] : undefined

  return (
    <nav
      aria-label="More guide pages"
      className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4 sm:pt-5"
    >
      <div className="order-1 min-w-0 flex-1 basis-40">
        {previous ? (
          <Link
            to={guidePath(previous.id)}
            className="group flex items-center gap-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            <ArrowLeft className="size-4 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs text-text-3">Previous</span>
              <span className="block truncate text-sm group-hover:text-accent">
                {previous.label}
              </span>
            </span>
          </Link>
        ) : null}
      </div>

      <p className="tabular order-3 w-full shrink-0 text-center text-xs text-text-3 sm:order-2 sm:w-auto sm:text-left">
        Page {index + 1} of {GUIDE_PAGES.length}
      </p>

      <div className="order-2 flex min-w-0 flex-1 basis-40 justify-end sm:order-3">
        {next ? (
          <Link
            to={guidePath(next.id)}
            className="group flex items-center gap-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            <span className="min-w-0 text-right">
              <span className="block text-xs text-text-3">Next</span>
              <span className="block truncate text-sm group-hover:text-accent">{next.label}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  )
}
