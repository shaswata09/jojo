import { Search } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { LabelFilter } from '@/components/common/LabelFilter'
import { Segment } from '@/components/common/Segment'
import { RoleFilter } from '@/components/layout/RoleFilter'
import { Input } from '@/components/ui/input'
import { STAGES, STAGE_LABEL, type Application } from '@/data/seed'
import { refKey } from '@/lib/ids'
import type { ApplicationsView, useApplicationsParams } from '@/lib/links'

const VIEWS = [
  { value: 'table', label: 'Table' },
  { value: 'board', label: 'Board' },
] as const satisfies readonly { value: ApplicationsView; label: string }[]

/**
 * Search, roles, keywords, stage and layout — the controls that decide what the
 * table and the board are looking at.
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
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1 basis-[220px]">
          <label htmlFor="applications-search" className="sr-only">
            Search applications
          </label>
          <Search
            aria-hidden
            strokeWidth={1.8}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
          />
          <Input
            id="applications-search"
            type="search"
            value={params.q}
            onChange={(e) => params.set({ q: e.target.value })}
            placeholder="Search position, note or stage"
            className="pl-8"
          />
        </div>

        {/* Was pinned to the top bar, where it changed two of a dozen
            surfaces and left every number on the dashboard ambiguous. It
            belongs to the list it actually filters. */}
        <RoleFilter />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {/* Scoped to the pool on screen. Without `scopeIds` a chip here
            would count every reminder and vault file carrying that keyword
            too, and report 32 for a word only six applications have. */}
        <LabelFilter scopeIds={pool.map((a) => refKey('app', a.id))} />

        {/* Stage chips are table-only: the board is already grouped by
            stage, so filtering there blanks five columns rather than
            shortening a list. Switching to Board clears the filter instead
            of hiding it — a filter you cannot see is the thing this page
            was worst at. */}
        {params.view === 'table' ? (
          <BucketFilter
            label="Filter by stage"
            options={STAGES.map((st) => st.id)}
            labels={STAGE_LABEL}
            counts={stageCounts}
            value={params.stage}
            onChange={(next) => params.set({ stage: next })}
            total={pool.length}
          />
        ) : null}

        <Segment
          label="Layout"
          options={VIEWS}
          value={params.view}
          // Only the board branch touches `stage`: `set` treats a key that
          // is present-but-undefined as "delete it", so passing it either
          // way would drop the stage filter on the way back to the table.
          onChange={(next) =>
            params.set(next === 'board' ? { view: next, stage: 'all' } : { view: next })
          }
          className="ml-auto shrink-0"
        />
      </div>
    </div>
  )
}
