import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { ClipboardList, Plus, X } from 'lucide-react'
import { ApplicationsFilters } from '@/components/applications/ApplicationsFilters'
import { ApplicationsBoard } from '@/components/applications/board/ApplicationsBoard'
import { DetailSheet } from '@/components/applications/detail/DetailSheet'
import { ApplicationsTable } from '@/components/applications/table/ApplicationsTable'
import {
  compareApplications,
  countByStage,
  emptyReason as emptyReasonFor,
  filterApplications,
} from '@/components/applications/list-query'
import { useRowActions } from '@/components/applications/use-row-actions'
import { AddByUrl } from '@/components/applications/AddByUrl'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { Stage } from '@/data/seed'
import { useApplications } from '@/kg/react/use-applications'
import { useDialogs } from '@/lib/dialogs-context'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import {
  formatSort,
  parseSort,
  useApplicationsParams,
  useTitle,
  type ApplicationsSortKey,
} from '@/lib/links'
import { useFillViewport } from '@/lib/use-fill-viewport'
import { DESKTOP_QUERY, useMediaQuery, useReducedMotion } from '@/lib/use-media-query'
import { useRoles } from '@/lib/roles-context'

export function Applications() {
  const { matches, selected: selectedRoles, clear: clearRoles } = useRoles()
  const { matches: keywordMatches, selected: selectedKeywords, clearSelected } = useLabels()
  const { all, get } = useApplications()
  const { open } = useDialogs()
  const actions = useRowActions()
  const navigate = useNavigate()
  const location = useLocation()

  // Whether a record is open beside the list. Read from the path rather than
  // from state, so a bookmarked /applications/rice lays out correctly on the
  // very first render.
  //
  // Resolved to the record's id before anything compares it. The segment is a
  // slug, and the four comparisons below are all against `a.id` — so on
  // '/applications/rice', the URL that already worked, the panel rendered the
  // right record while the card behind it was not marked open, the row never
  // scrolled into view, and the mobile sheet was titled "Application".
  const detail = useMatch('/applications/:key')
  const openKey = detail?.params.key
  const openId = openKey ? get(openKey)?.id : undefined

  // View, search, stage and sort live in the URL. They were four useStates, so
  // the one page in the app you would actually want to send someone ("look at
  // my offers") was the one page that could not be linked to, and Back stepped
  // out of the whole route rather than out of the filter.
  const params = useApplicationsParams()
  const view = params.view
  const query = params.q
  const stageFilter = params.stage
  const sort = useMemo(() => parseSort(params.sort), [params.sort])

  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const reducedMotion = useReducedMotion()

  // Caps whichever panel is showing at the room left below it.
  const fill = useFillViewport()

  // Page options. Real toggles rather than placeholders — both change what the
  // table renders, so the control is worth the space it takes.
  const [showNotes, setShowNotes] = useState(true)
  // Compact by default: at the roomy height only nine of twelve rows fit on a
  // 900px screen, and the first thing this page owes is the whole search.
  const [compact, setCompact] = useState(true)

  /** The pool both views draw from — every filter except the stage. */
  const pool = useMemo(
    () =>
      filterApplications({
        all,
        query,
        matchesRole: matches,
        matchesKeyword: (a) => keywordMatches(refKey('app', a.id)),
      }),
    [all, query, matches, keywordMatches],
  )

  const stageCounts = useMemo(() => countByStage(pool), [pool])

  const tableRows = useMemo(
    () => (stageFilter === 'all' ? pool : pool.filter((a) => a.stage === stageFilter)),
    [pool, stageFilter],
  )

  const sorted = useMemo(() => [...tableRows].sort(compareApplications(sort)), [tableRows, sort])

  const shown = view === 'table' ? sorted.length : pool.length
  const anyFilter =
    query.trim() !== '' ||
    stageFilter !== 'all' ||
    selectedKeywords.size > 0 ||
    selectedRoles.size > 0

  const emptyReason = useMemo(
    () =>
      emptyReasonFor({
        query,
        stageFilter,
        keywordCount: selectedKeywords.size,
        roleCount: selectedRoles.size,
      }),
    [query, stageFilter, selectedKeywords, selectedRoles],
  )

  const clearFilters = () => {
    params.set({ q: '', stage: 'all' })
    clearSelected()
    clearRoles()
  }

  const toggleSort = (key: ApplicationsSortKey) =>
    params.set({
      sort: formatSort(key, sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc'),
    })

  /** New application, optionally landing in a stage the user already picked. */
  const onNew = (stage?: Stage) =>
    open('application', { mode: 'create', initial: stage ? { stage } : undefined })

  const closeDetail = useCallback(
    // Keeps the query string, so closing a record does not silently reset the
    // search and the stage chips you opened it from.
    () => navigate({ pathname: '/applications', search: location.search }),
    [navigate, location.search],
  )

  /**
   * Brings the open record into view.
   *
   * On the board that means the horizontal scroller too: a record opened from
   * the dashboard can be in a column two screens to the right, and the sheet
   * would otherwise be the only evidence anything happened.
   */
  const openRowRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!openId) return
    openRowRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }, [openId, view, reducedMotion])

  const setOpenRow = useCallback((node: HTMLElement | null) => {
    openRowRef.current = node
  }, [])

  const empty = all.length === 0
  /** Below `lg` the record takes the whole column, as it always has. */
  const inlineDetail = Boolean(detail) && !isDesktop

  /**
   * The record replaces this page below `lg` rather than sitting over it, so it
   * owns the h1 and the tab name and this header stands down entirely — leaving
   * it rendered put two `<h1>`s on the page and titled a bookmarked record
   * "Applications", because the parent's title effect runs after the child's.
   */
  useTitle(inlineDetail ? null : 'Applications')

  return (
    <>
      {inlineDetail ? null : (
        <PageHeader
          title="Applications"
          settings={
            <>
              <PageOption
                label="Show notes"
                hint="The second line under each position"
                control={
                  <Switch
                    checked={showNotes}
                    onCheckedChange={setShowNotes}
                    aria-label="Show notes"
                  />
                }
              />
              <PageOption
                label="Compact rows"
                hint="Tighter row height in the table"
                control={
                  <Switch
                    checked={compact}
                    onCheckedChange={setCompact}
                    aria-label="Compact rows"
                  />
                }
              />
            </>
          }
          subtitle={
            empty
              ? 'Nothing tracked yet — everything you add stays on this machine.'
              : `${shown} shown · ${all.length} total`
          }
          actions={
            <>
              {/* Same control as the dashboard's quick-add, with a shorter
                  placeholder for a header row. Fixed width rather than the
                  dashboard's `flex-1`: left to grow, the field ate the row and
                  pushed the button onto a second line. */}
              <AddByUrl
                fieldClassName="w-[210px] flex-none"
                placeholder="Paste a posting URL"
                submitLabel="From link"
              />
              <Button size="sm" onClick={() => onNew()}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                New application
              </Button>
            </>
          }
        />
      )}

      {/* At a real zero the whole toolbar goes: a row of controls that filter
          nothing is scenery on the one screen where the user has nothing yet. */}
      {empty || inlineDetail ? null : (
        <ApplicationsFilters params={params} pool={pool} stageCounts={stageCounts} />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {inlineDetail ? (
          <Outlet />
        ) : empty ? (
          <Panel>
            <EmptyState
              icon={ClipboardList}
              title="No applications yet"
              description="Track a job you are applying for and it shows up here, on the calendar and in the week ahead."
              action={
                <Button size="sm" onClick={() => onNew()}>
                  <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                  New application
                </Button>
              }
            />
          </Panel>
        ) : shown === 0 ? (
          <Panel>
            <EmptyState
              icon={ClipboardList}
              title="No applications match"
              description={emptyReason}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {anyFilter ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      <X className="size-3.5" strokeWidth={2} aria-hidden />
                      Show all {all.length}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={() => onNew(stageFilter === 'all' ? undefined : stageFilter)}
                  >
                    <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                    New application
                  </Button>
                </div>
              }
            />
          </Panel>
        ) : view === 'table' ? (
          // min-h-0 is what makes flex-1 mean "the space that is left" rather
          // than "at least my content" — without it a tall column grows the
          // panel instead of scrolling inside it.
          <Panel
            ref={fill.ref}
            style={{ maxHeight: fill.maxHeight }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <ApplicationsTable
              rows={sorted}
              sort={sort}
              toggleSort={toggleSort}
              openId={openId}
              setOpenRow={setOpenRow}
              showNotes={showNotes}
              compact={compact}
              actions={actions}
            />
          </Panel>
        ) : (
          <Panel
            ref={fill.ref}
            style={{ maxHeight: fill.maxHeight }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <ApplicationsBoard
              apps={pool}
              onAdd={onNew}
              onMoveStage={actions.onMoveStage}
              openId={openId}
              openRef={setOpenRow}
              reducedMotion={reducedMotion}
            />
          </Panel>
        )}
      </div>

      {detail && isDesktop ? (
        <DetailSheet
          name={openId ? (all.find((a) => a.id === openId)?.org ?? 'Application') : 'Application'}
          onClose={closeDetail}
        >
          <Outlet />
        </DetailSheet>
      ) : null}

      {actions.confirmDialog}
    </>
  )
}
