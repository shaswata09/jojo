import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router'
import { ClipboardList, Plus, X } from 'lucide-react'
import { ApplicationsFilters } from '@/components/applications/ApplicationsFilters'
import { ApplicationsBoard } from '@/components/applications/board/ApplicationsBoard'
import { DetailSheet } from '@/components/applications/detail/DetailSheet'
import { STAGE_LABEL } from '@/components/applications/StageMenu'
import { ApplicationsTable } from '@/components/applications/table/ApplicationsTable'
import { useRowActions } from '@/components/applications/use-row-actions'
import { AddByUrl } from '@/components/common/AddByUrl'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { STAGES, displayName, type Stage } from '@/data/seed'
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

  /**
   * Everything the page filters by *except* the stage — the pool both views
   * draw from.
   *
   * The board used to read straight from `all`, so a search that emptied the
   * table left the board showing every record and no sign that a filter was
   * on at all. Stage is the one exception, below: the board is already grouped
   * by it.
   */
  const pool = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((a) => {
      if (!matches(a.roleTag)) return false
      if (!keywordMatches(refKey('app', a.id))) return false
      if (!q) return true
      // Searches what is on screen plus the stage name, so typing "offer"
      // finds the row whose only mention of it is a chip.
      return [a.org, a.role, a.note, a.roleTag, STAGE_LABEL[a.stage]]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [all, query, matches, keywordMatches])

  /**
   * Stage counts over the pool, not over everything.
   *
   * They were counted before the search and the keyword chips ran, so `All 8`
   * sat above four rows and each stage chip promised records the table would
   * not show.
   */
  const stageCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of pool) map[a.stage] = (map[a.stage] ?? 0) + 1
    return map
  }, [pool])

  const tableRows = useMemo(
    () => (stageFilter === 'all' ? pool : pool.filter((a) => a.stage === stageFilter)),
    [pool, stageFilter],
  )

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...tableRows].sort((a, b) => {
      if (sort.key === 'daysAgo') return (a.daysAgo - b.daysAgo) * dir
      if (sort.key === 'stage')
        return (
          (STAGES.findIndex((s) => s.id === a.stage) - STAGES.findIndex((s) => s.id === b.stage)) *
          dir
        )
      return displayName(a).localeCompare(displayName(b)) * dir
    })
  }, [tableRows, sort])

  const shown = view === 'table' ? sorted.length : pool.length
  const anyFilter =
    query.trim() !== '' ||
    stageFilter !== 'all' ||
    selectedKeywords.size > 0 ||
    selectedRoles.size > 0

  /**
   * Which filters are holding the list empty, named out loud.
   *
   * Four controls can blank it — the search box, the stage chips, the keyword
   * row and the role filter — and "nothing matches" without saying which one is
   * doing it leaves the reader hunting across the toolbar for the switch to
   * flip. The role filter is the one that used to be unnameable here: it lived
   * in the top bar, so the page could say "nothing carries the Offer stage"
   * while ten records sat hidden behind a control this page could not reach.
   */
  const emptyReason = useMemo(() => {
    const on = [
      query.trim() ? 'that search' : '',
      stageFilter === 'all' ? '' : `the ${STAGE_LABEL[stageFilter]} stage`,
      selectedKeywords.size > 0 ? 'the selected keywords' : '',
      selectedRoles.size > 0 ? 'the selected roles' : '',
    ].filter(Boolean)
    if (on.length === 0) return 'Nothing here to show.'
    const joined = on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`
    return `Nothing carries ${joined}.`
  }, [query, stageFilter, selectedKeywords, selectedRoles])

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
