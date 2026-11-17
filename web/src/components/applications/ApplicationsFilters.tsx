import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BucketFilter } from '@/components/common/BucketFilter'
import { LabelFilter } from '@/components/common/LabelFilter'
import { Segment } from '@/components/common/Segment'
import { Input } from '@/components/ui/input'
import { STAGES, type Application } from '@/data/seed'
import { refKey } from '@/lib/ids'
import type { ApplicationsView } from '@/lib/links'
import type { useApplicationsParams } from '@/lib/link-params'
import { useDomain } from '@/i18n/domain'
import { urlEcho } from '@/lib/url-echo'

/** The two layouts; each label is a catalog key, translated where it is drawn. */
const VIEWS = [
  { value: 'table', label: 'filters.table' },
  { value: 'board', label: 'filters.board' },
] as const satisfies readonly { value: ApplicationsView; label: string }[]

/**
 * Search, keywords, stage and layout — the controls that decide what the table
 * and the board are looking at. The role filter narrows them too, but it lives
 * in the top bar, because it narrows the dashboard and Statistics as well and
 * a control that changes three pages belongs on none of them.
 *
 * The filters belong to the page, not to the table — they lived inside the
 * table panel, which is why switching to Board silently dropped every one of
 * them. Every one of them is a URL parameter, so the page you would actually
 * want to send someone ("look at my offers") is the page you can link to.
 */
export function ApplicationsFilters({
  params,
  pool,
  stageCounts,
}: {
  params: ReturnType<typeof useApplicationsParams>
  /** Everything the page shows before the stage filter, for the counts below. */
  pool: Application[]
  stageCounts: Record<string, number>
}) {
  /*
   * Memoised, and that is what makes the count map below it worth having.
   *
   * Built inline in the JSX this was a new array on every render, so
   * `LabelFilter`'s `useMemo` never held and the whole pool was re-counted on
   * every keystroke in the search box.
   */
  const scopeIds = useMemo(() => pool.map((a) => refKey('app', a.id)), [pool])
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const views = VIEWS.map((v) => ({ value: v.value, label: t(v.label) }))
  const { set } = params
  const search = useCallback((q: string) => set({ q }), [set])

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1 basis-[220px]">
          <label htmlFor="applications-search" className="sr-only">
            {t('filters.searchLabel')}
          </label>
          <Search
            aria-hidden
            strokeWidth={1.8}
            className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-3"
          />
          <SearchInput
            q={params.q}
            onSearch={search}
            placeholder={t('filters.searchPlaceholder')}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/* Scoped to the pool on screen. Without `scopeIds` a chip here
            would count every reminder and vault file carrying that keyword
            too, and report 32 for a word only six applications have. */}
        <LabelFilter scopeIds={scopeIds} />

        {/* Stage chips are table-only: the board is already grouped by
            stage, so filtering there blanks five columns rather than
            shortening a list. Switching to Board clears the filter instead
            of hiding it — a filter you cannot see is the thing this page
            was worst at. */}
        {params.view === 'table' ? (
          <BucketFilter
            label={t('filters.byStage')}
            options={STAGES.map((st) => st.id)}
            labels={Object.fromEntries(STAGES.map((st) => [st.id, domain.stage(st.id)]))}
            counts={stageCounts}
            value={params.stage}
            onChange={(next) => params.set({ stage: next })}
            total={pool.length}
          />
        ) : null}

        {/* Wrapped only to carry the guided tour's mark (components/tour). */}
        <div data-tour="layout" className="ms-auto shrink-0">
          <Segment
            label={t('filters.layout')}
            options={views}
            value={params.view}
            // Only the board branch touches `stage`: `set` treats a key that
            // is present-but-undefined as "delete it", so passing it either
            // way would drop the stage filter on the way back to the table.
            onChange={(next) =>
              params.set(next === 'board' ? { view: next, stage: 'all' } : { view: next })
            }
          />
        </div>
      </div>
    </div>
  )
}

/** Long enough to coalesce a burst of typing, short enough to read as live. */
const SEARCH_DEBOUNCE_MS = 150

/**
 * The search box: its own text, with the URL written behind it.
 *
 * Bound straight to `?q=` it dropped keystrokes. The router applies every
 * location change inside a transition, React holds a controlled input at the
 * last committed value until that transition lands, and re-rendering the
 * whole pool takes long enough on a big record set or a slow device that the
 * next key arrives first — "position 1" became "pition 1". Holding the text
 * here keeps every keystroke; the URL, and the filtering it drives, follow a
 * beat behind. A change from outside (Back, Clear filters) is still adopted —
 * `urlEcho` is what tells it from the box's own writes landing late.
 */
function SearchInput({
  q,
  onSearch,
  placeholder,
}: {
  q: string
  onSearch: (q: string) => void
  placeholder: string
}) {
  const [text, setText] = useState(q)
  const [echo] = useState(urlEcho)

  useEffect(() => {
    if (!echo.isEcho(q)) setText(q)
  }, [q, echo])

  useEffect(() => {
    if (text === q) return
    const timer = setTimeout(() => {
      echo.sent(text)
      onSearch(text)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, q, onSearch, echo])

  return (
    <Input
      id="applications-search"
      type="search"
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={placeholder}
      className="ps-8"
    />
  )
}
