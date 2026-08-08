import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
} from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { ArrowDown, ArrowUp, ClipboardList, GripVertical, Search, X } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { AddByUrl } from '@/components/common/AddByUrl'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelScroll } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { STAGES, applications as seedApplications, type Application, type Stage } from '@/data/seed'
import { useFillViewport } from '@/lib/use-fill-viewport'
import { useRoles } from '@/lib/roles-context'
import { cn } from '@/lib/utils'

const VIEWS = [
  { value: 'table', label: 'Table' },
  { value: 'board', label: 'Board' },
] as const
type View = (typeof VIEWS)[number]['value']

const stageTone: Record<Stage, 'teal' | 'amber' | 'green' | 'gray'> = {
  draft: 'gray',
  submitted: 'teal',
  screen: 'teal',
  interview: 'amber',
  offer: 'green',
  closed: 'gray',
}

const stageLabel = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>

type SortKey = 'role' | 'stage' | 'daysAgo'

/* ------------------------------- board ---------------------------------- */

/**
 * The card itself, with no drag wiring.
 *
 * Shared by the card sitting in its column and by the copy rendered in the drag
 * overlay, so the thing you pick up is identical to the thing you put down.
 */
function BoardCardBody({
  app,
  handle,
  className,
}: {
  app: Application
  /** Grip props from useDraggable. Omitted for the overlay copy, which is inert. */
  handle?: {
    attributes: DraggableAttributes
    listeners: ReturnType<typeof useDraggable>['listeners']
  }
  className?: string
}) {
  return (
    <div className={cn('surface group rounded-md p-2.5', className)}>
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          // The overlay copy is decorative; the real one is the drag handle.
          tabIndex={handle ? undefined : -1}
          aria-hidden={handle ? undefined : true}
          className={cn(
            '-ml-1 cursor-grab touch-none rounded-sm p-0.5 text-text-3 active:cursor-grabbing',
            handle ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : 'opacity-100',
          )}
          aria-label={handle ? `Move ${app.role}` : undefined}
          {...handle?.attributes}
          {...handle?.listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{app.role}</div>
          <div className="mt-0.5 text-xs text-text-3">{app.note}</div>
        </div>
        {app.flagged ? (
          <span
            className="mt-1 size-1.5 shrink-0 rounded-full bg-danger"
            aria-label="Needs attention"
          />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Chip tone="teal" size="sm">
          {app.roleTag}
        </Chip>
        {app.chips?.map((c) => (
          <Chip key={c.label} tone={c.tone} size="sm">
            {c.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

/**
 * A card in its column.
 *
 * It no longer moves with the pointer — DragOverlay does that. The card used to
 * carry the drag transform itself, which meant it was still a child of the
 * column's `overflow-y-auto` list and got clipped the moment it left that box.
 * No z-index fixes an overflow clip; the element has to leave the container
 * entirely, which is exactly what the overlay is for. What stays behind is a
 * dimmed placeholder holding the slot open.
 */
function BoardCard({ app }: { app: Application }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id })

  return (
    <div ref={setNodeRef}>
      <BoardCardBody
        app={app}
        handle={{ attributes, listeners }}
        className={isDragging ? 'opacity-35' : undefined}
      />
    </div>
  )
}

function BoardColumn({ stage, items }: { stage: (typeof STAGES)[number]; items: Application[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[240px] shrink-0 flex-col rounded-lg border p-2 transition-colors',
        isOver ? 'border-accent-border bg-accent-soft' : 'border-hairline bg-well',
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={cn('size-1.5 rounded-full', stage.dot)} aria-hidden />
        <h3 className="text-xs font-medium text-text-2">{stage.label}</h3>
        <span className="tabular ml-auto rounded-sm border border-hairline bg-panel px-1.5 text-xs text-text-3">
          {items.length}
        </span>
      </div>

      {/* The column is as tall as the board; only the cards scroll, so every
          stage header stays visible however uneven the stages are. `tight`
          because the column's gutter is p-2, not a Panel's. */}
      <PanelScroll axis="y" inset="tight" className="flex min-h-16 flex-col gap-2">
        {items.map((app) => (
          <BoardCard key={app.id} app={app} />
        ))}
      </PanelScroll>
    </div>
  )
}

/* -------------------------------- page ---------------------------------- */

export function Applications() {
  const { matches } = useRoles()
  // Board first: the stage of each application is the thing you come here to
  // read, and the table sorts by last activity rather than showing it.
  const [view, setView] = useState<View>('board')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'daysAgo',
    dir: 'asc',
  })
  // Stage moves live here until persistence lands, so dragging is real rather
  // than decorative.
  const [stageById, setStageById] = useState<Record<string, Stage>>({})
  /** The card currently in the pointer's hand, rendered in the overlay. */
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    // A small activation distance so a click on the handle isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  // Table-only, deliberately: the board is already grouped by stage, so a stage
  // filter there would just blank out columns, and searching a kanban you are
  // dragging things around in is not a thing anyone wants.
  // Caps whichever panel is showing at the room left below it.
  const fill = useFillViewport()

  // Page options. Real toggles rather than placeholders — both change what the
  // table renders, so the control is worth the space it takes.
  const [showNotes, setShowNotes] = useState(true)
  const [compact, setCompact] = useState(false)

  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all')

  const rows = useMemo(() => {
    const withStage = seedApplications.map((a) => ({ ...a, stage: stageById[a.id] ?? a.stage }))
    return withStage.filter((a) => matches(a.roleTag))
  }, [matches, stageById])

  /** How many of the role-filtered rows sit in each stage, for the chip counts. */
  const stageCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of rows) map[a.stage] = (map[a.stage] ?? 0) + 1
    return map
  }, [rows])

  const tableRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((a) => {
      if (stageFilter !== 'all' && a.stage !== stageFilter) return false
      if (!q) return true
      // Searches what is on screen plus the stage name, so typing "offer"
      // finds the row whose only mention of it is a chip.
      return [a.role, a.note, a.roleTag, stageLabel[a.stage]].join(' ').toLowerCase().includes(q)
    })
  }, [rows, query, stageFilter])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...tableRows].sort((a, b) => {
      if (sort.key === 'daysAgo') return (a.daysAgo - b.daysAgo) * dir
      if (sort.key === 'stage')
        return (
          (STAGES.findIndex((s) => s.id === a.stage) - STAGES.findIndex((s) => s.id === b.stage)) *
          dir
        )
      return a.role.localeCompare(b.role) * dir
    })
  }, [tableRows, sort])

  const activeCard = activeId ? rows.find((a) => a.id === activeId) : undefined

  const toggleSort = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }))

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const stage = event.over?.id as Stage | undefined
    if (stage) setStageById((prev) => ({ ...prev, [String(event.active.id)]: stage }))
  }

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: 'right' }) => (
    <th scope="col" className={cn('py-2 pr-3 font-medium', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
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
    <>
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
                <Switch checked={compact} onCheckedChange={setCompact} aria-label="Compact rows" />
              }
            />
          </>
        }
        subtitle={
          view === 'table'
            ? `${sorted.length} shown · ${seedApplications.length} total`
            : `${rows.length} shown · ${seedApplications.length} total`
        }
        actions={
          <>
            <Segment label="Layout" options={VIEWS} value={view} onChange={setView} />
            {/* Same control as the dashboard's quick-add, with a shorter
                placeholder for a header row. Fixed width rather than the
                dashboard's `flex-1`: left to grow, the field ate the row and
                pushed the button onto a second line. */}
            <AddByUrl fieldClassName="w-[210px] flex-none" placeholder="Paste a posting URL" />
          </>
        }
      />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ClipboardList}
            title="Nothing matches this filter"
            description="No applications carry the selected roles. Clear the role filter in the top bar to see everything."
          />
        </Panel>
      ) : view === 'table' ? (
        // Same flex chain the board uses: min-h-0 turns flex-1 into "the space
        // that is left" so the rows scroll inside the panel rather than growing
        // it down the page.
        <Panel
          ref={fill.ref}
          style={{ maxHeight: fill.maxHeight }}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-0 flex-1 basis-[200px]">
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search position, note or stage"
                className="pl-8"
              />
            </div>

            <BucketFilter
              label="Filter by stage"
              options={STAGES.map((st) => st.id)}
              labels={Object.fromEntries(STAGES.map((st) => [st.id, st.label]))}
              counts={stageCounts}
              value={stageFilter}
              onChange={setStageFilter}
              total={rows.length}
            />
          </div>

          {sorted.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No applications match"
              description="Nothing here carries both that search and that stage."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                    setStageFilter('all')
                  }}
                >
                  <X className="size-3.5" strokeWidth={2} aria-hidden />
                  Clear filters
                </Button>
              }
            />
          ) : (
            <PanelScroll>
              <table className="w-full min-w-[680px] text-sm">
                <caption className="sr-only">Applications, sortable</caption>
                <thead>
                  {/* Sticky so the column labels survive scrolling. Needs its own
                    background or rows show through as they pass under it. */}
                  <tr className="sticky top-0 z-[1] border-b border-hairline bg-panel text-left text-xs">
                    <SortHeader label="Position" k="role" />
                    <th scope="col" className="py-2 pr-3 font-medium text-text-3">
                      Role
                    </th>
                    <SortHeader label="Stage" k="stage" />
                    <SortHeader label="Last activity" k="daysAgo" align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {sorted.map((a) => (
                    <tr key={a.id} className="hover:bg-row-hover">
                      <th
                        scope="row"
                        className={cn('pr-3 text-left font-normal', compact ? 'py-1.5' : 'py-2.5')}
                      >
                        <div className="truncate">{a.role}</div>
                        {showNotes ? (
                          <div className="mt-0.5 text-xs text-text-3">{a.note}</div>
                        ) : null}
                      </th>
                      <td className={cn('pr-3', compact ? 'py-1.5' : 'py-2.5')}>
                        <Chip tone="teal">{a.roleTag}</Chip>
                      </td>
                      <td className={cn('pr-3', compact ? 'py-1.5' : 'py-2.5')}>
                        <Chip tone={stageTone[a.stage]}>{stageLabel[a.stage]}</Chip>
                      </td>
                      <td
                        className={cn(
                          'tabular text-right text-xs whitespace-nowrap text-text-3',
                          compact ? 'py-1.5' : 'py-2.5',
                        )}
                      >
                        {a.daysAgo === 1 ? 'yesterday' : `${a.daysAgo}d ago`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PanelScroll>
          )}
        </Panel>
      ) : (
        // min-h-0 is what makes flex-1 mean "the space that is left" rather
        // than "at least my content" — without it a tall column grows the
        // panel instead of scrolling inside it.
        <Panel
          ref={fill.ref}
          style={{ maxHeight: fill.maxHeight }}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <p className="mb-3 text-xs text-text-3">
            Drag a card by its handle to move it between stages. Keyboard: focus a handle, then
            Space and the arrow keys.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <PanelScroll axis="x" className="flex gap-3">
              {STAGES.map((stage) => (
                <BoardColumn
                  key={stage.id}
                  stage={stage}
                  items={rows.filter((a) => a.stage === stage.id)}
                />
              ))}
            </PanelScroll>

            {/* Rendered outside every column, so it is clipped by nothing and
                stays above the board while it travels. */}
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {activeCard ? (
                <BoardCardBody
                  app={activeCard}
                  className="w-[224px] cursor-grabbing shadow-[var(--shadow-raised)]"
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </Panel>
      )}
    </>
  )
}
