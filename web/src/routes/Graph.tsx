import { useCallback, useEffect, useMemo, useState } from 'react'
import { Network, Plus, RotateCcw, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { FocusCanvas } from '@/components/graph/FocusCanvas'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { GraphDetail } from '@/components/graph/GraphDetail'
import { GraphLegend } from '@/components/graph/GraphLegend'
import { GraphLoosePanel } from '@/components/graph/GraphLoosePanel'
import { GraphViewBar } from '@/components/graph/GraphViewBar'
import type { GraphMode } from '@/components/graph/GraphViewBar'
import { OverviewCanvas } from '@/components/graph/OverviewCanvas'
import { QueryPanel } from '@/components/graph/QueryPanel'
import { MAX_DRAWN } from '@/components/graph/structure'
import { toQueryResult } from '@/lib/graph/from-agent'
import type { GraphQueryResult } from '@jojo/service/agent/graph-query'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useDialogs } from '@/lib/dialogs-context'
import { buildGraph } from '@/lib/graph/build'
import type { GraphNodeType } from '@/lib/graph/model'
import { runQuery } from '@/lib/graph/query'
import type { GraphQuery, QueryResult } from '@/lib/graph/query'
import { filterGraph } from '@/lib/graph/traversal'
import { useGraph } from '@jojo/service/react/kg-context'
import { GROUP_LOOSE, wantsOverview } from '@jojo/service/core/graph-view'
import { useTitle } from '@/lib/links'
import { useFocusParam } from '@/lib/link-params'
import { foldGraph, toViewGraph } from '@/lib/graph/view'
import type { GroupDimension } from '@/lib/graph/view'
import { useStableView } from '@/lib/graph/use-stable-view'

/**
 * The knowledge graph, as a preview.
 *
 * The real product will keep records in a graph rather than in seven lists.
 * This page is the argument for that: the same records you already have, drawn
 * as what they actually are — a network — plus the questions that only become
 * answerable once they are one. Nothing here is a new dataset. Everything is
 * derived from the session store on every render, so a record deleted on the
 * board is gone from this canvas before you get back to it.
 */
export function Graph() {
  const { t, i18n } = useTranslation('pages')
  const { t: tGraph } = useTranslation('graph')
  useTitle(t('graph.title'))

  // The snapshot itself, not eight projections of it. The page used to rebuild
  // ~400 nodes and edges whenever any record OR any keyword changed, because it
  // depended on eight arrays and a closure; it now depends on one reading that
  // changes once per commit.
  const memory = useGraph()
  const { open } = useDialogs()

  // Rebuilt when the language changes too: a node's detail line ("Saved 3 days
  // ago") and every count label downstream are worded when the graph is built.
  const language = i18n.language
  const graph = useMemo(() => {
    void language
    return buildGraph(memory)
  }, [memory, language])

  const [hidden, setHidden] = useState<ReadonlySet<GraphNodeType>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState<GraphQuery | null>(null)
  /** Bumped by "Reset layout" — the canvas reshuffles when this changes. */
  const [layoutNonce, setLayoutNonce] = useState(0)
  /**
   * Which arrangement of the same records to draw. Bumped by "Reorganize".
   *
   * The layout is deterministic — the same records always settle the same way —
   * which is what makes a graph worth reasoning about, and also what makes a
   * tangle permanent: pressing "Reset layout" gives back the identical picture,
   * because that is what resetting means. The seed is the way out: it changes
   * where the nodes START, so the same forces find a different arrangement,
   * while staying repeatable for any given seed. See `force.ts`.
   */
  const [layoutSeed, setLayoutSeed] = useState(0)
  const [showAllLabels, setShowAllLabels] = useState(false)
  const [hideLoners, setHideLoners] = useState(false)

  const view = useMemo(
    () =>
      filterGraph(graph, (node) => !hidden.has(node.type) && !(hideLoners && node.degree === 0)),
    [graph, hidden, hideLoners],
  )

  /*
   * The calm overview (`kg/core/graph-view.ts`). Folded, grouped and placed from
   * a view graph that keeps its identity across commits that change nothing
   * it reads — rule 1 of `GraphCanvas`, for the same reason: `view` is a fresh
   * object on every commit anywhere in the app, and the overview is thousands
   * of elements.
   */
  const viewGraph = useStableView(useMemo(() => toViewGraph(view), [view]))
  const folding = useMemo(() => foldGraph(viewGraph), [viewGraph])
  const large = wantsOverview(folding)
  const freeAllowed = view.nodes.length <= MAX_DRAWN
  /** The picture asked for; 'auto' follows the store's size. */
  const [layout, setLayout] = useState<'auto' | 'overview' | 'free'>('auto')
  const [groupBy, setGroupBy] = useState<GroupDimension>('role')
  /** Records focused on, oldest first. Non-empty means the focus view is showing. */
  const [trail, setTrail] = useState<string[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const centre = trail.at(-1)
  const base: 'overview' | 'free' =
    layout === 'auto'
      ? large
        ? 'overview'
        : 'free'
      : layout === 'free' && !freeAllowed
        ? 'overview'
        : layout
  const mode: GraphMode = centre !== undefined && view.byId.has(centre) ? 'focus' : base

  const focusOn = useCallback((id: string) => {
    setTrail((current) => {
      const at = current.indexOf(id)
      // Focusing on a record already on the trail goes back to it, rather than
      // growing a trail that runs in a circle.
      return at === -1 ? [...current, id] : current.slice(0, at + 1)
    })
    setExpanded(new Set())
    setSelectedId(id)
  }, [])

  const backToOverview = useCallback(() => {
    setTrail([])
    setExpanded(new Set())
  }, [])

  // `/graph?focus=<id>` — arriving from a link opens the focus view on it.
  const { focus: arrivalFocus, clearFocus, arrival } = useFocusParam()
  useEffect(() => {
    if (!arrivalFocus) return
    if (graph.byId.has(arrivalFocus)) {
      setHidden(new Set())
      setTrail([arrivalFocus])
      setExpanded(new Set())
      setSelectedId(arrivalFocus)
    }
    clearFocus()
  }, [arrivalFocus, arrival, graph, clearFocus])

  const counts = useMemo(() => {
    const map = new Map<GraphNodeType, number>()
    for (const node of graph.nodes) map.set(node.type, (map.get(node.type) ?? 0) + 1)
    return map
  }, [graph])

  /**
   * Queries run against the whole graph, never the filtered view.
   *
   * "Files not used by any application" has to be true of your files, not of
   * the files you happen to have left visible — an answer that changed when you
   * pressed a legend row would be worse than no answer.
   */
  const built = useMemo(() => (query ? runQuery(graph, query) : null), [graph, query])

  /**
   * The answer to a question asked in words, which outranks the builder's.
   *
   * Held here rather than in the panel because the CANVAS needs it: the lit
   * subgraph and the answer table are two readings of one result, and putting
   * them on different sources is how they come to disagree. Asking a new
   * question through the builder clears it, because two answers on screen with
   * one table between them is worse than either.
   */
  const [asked, setAsked] = useState<{ result: QueryResult; question: string } | null>(null)
  /**
   * Bumped to tell the Ask box to drop its trace. The box keeps its run under a
   * fixed key so an answer survives leaving the page, so remounting it would
   * not clear anything; it has to be asked.
   */
  const [askReset, setAskReset] = useState(0)
  const result = asked?.result ?? built

  const onAsk = useCallback(
    (answer: GraphQueryResult, question: string) => {
      setAsked({ result: toQueryResult(graph, answer), question })
      setQuery(null)
    },
    [graph],
  )

  // A record can be deleted from another page while this one is mounted.
  useEffect(() => {
    setSelectedId((id) => (id && (graph.byId.has(id) || id === GROUP_LOOSE) ? id : null))
    setTrail((current) => {
      const kept = current.filter((id) => graph.byId.has(id))
      return kept.length === current.length ? current : kept
    })
  }, [graph])

  const switchMode = useCallback(
    (next: GraphMode) => {
      if (next === 'focus') {
        // The selected record, else the last one focused, else the most
        // connected record in view — Focus never opens on nothing.
        const target =
          (selectedId && selectedId !== GROUP_LOOSE && view.byId.has(selectedId)
            ? selectedId
            : null) ?? [...view.nodes].sort((a, b) => b.degree - a.degree)[0]?.id
        if (target) focusOn(target)
        return
      }
      backToOverview()
      setLayout(next)
    },
    [selectedId, view, focusOn, backToOverview],
  )

  /** Opening a query answer: in the overview or focus, it opens in focus. */
  const selectFromAnswer = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (mode !== 'free') focusOn(id)
    },
    [mode, focusOn],
  )

  const toggleType = useCallback((type: GraphNodeType) => {
    setHidden((current) => {
      const next = new Set(current)
      if (!next.delete(type)) next.add(type)
      return next
    })
  }, [])

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null
  const viewAction =
    mode === 'free' || !selected
      ? null
      : {
          label: selected.label,
          canFocus: selected.id !== centre && view.byId.has(selected.id),
          onFocus: () => focusOn(selected.id),
          ...(mode === 'focus' && selected.id !== centre && view.byId.has(selected.id)
            ? {
                expand: {
                  expanded: expanded.has(selected.id),
                  onToggle: () =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (!next.delete(selected.id)) next.add(selected.id)
                      return next
                    }),
                },
              }
            : {}),
        }

  /**
   * A query that matched nothing has to be said next to the picture.
   *
   * The canvas no longer dims when the answer is empty, so it stays legible —
   * but "92 of 92 records" beside an unchanged graph does not tell you the
   * question came back empty either. The Answer panel is a scroll away; the
   * heading is where the eye already is.
   */
  const noMatches = result !== null && result.rows.length === 0

  if (graph.nodes.length === 0) {
    return (
      <>
        <PageHeader title={t('graph.title')} subtitle={t('graph.emptySubtitle')} />
        <Panel>
          <EmptyState
            icon={Network}
            title={t('graph.emptyTitle')}
            description={t('graph.emptyDescription')}
            action={
              <Button size="sm" onClick={() => open('application')}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                {t('graph.newApplication')}
              </Button>
            }
          />
        </Panel>
      </>
    )
  }

  return (
    <>
      {/* The subtitle was "a preview of the knowledge graph jojo WILL store
          records in. Built from THIS SESSION'S records" — two claims that were
          true while the store was compiled into memory on every load, and are
          now the wrong way round in both halves. This is not a preview of the
          store; it is the store, drawn. */}
      <PageHeader
        title={t('graph.title')}
        subtitle={t('graph.subtitle')}
        settings={
          <>
            <PageOption
              label={t('graph.labelEvery')}
              // The old hint ended "— the rest collide", which was a fair
              // warning while they did. The canvas now drops any label that
              // would land on another one, so the honest trade is the opposite:
              // this switch is how you get a name onto a node the crowd hid.
              hint={t('graph.labelEveryHint')}
              control={
                <Switch
                  checked={showAllLabels}
                  onCheckedChange={setShowAllLabels}
                  aria-label={t('graph.labelEvery')}
                />
              }
            />
            <PageOption
              label={t('graph.hideLoners')}
              hint={t('graph.hideLonersHint')}
              control={
                <Switch
                  checked={hideLoners}
                  onCheckedChange={setHideLoners}
                  aria-label={t('graph.hideLoners')}
                />
              }
            />
          </>
        }
        actions={
          mode !== 'free' ? null : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLayoutSeed((seed) => seed + 1)}
                title={t('graph.reorganizeHint')}
              >
                <Shuffle className="size-3.5" strokeWidth={2} aria-hidden />
                {t('graph.reorganize')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  /*
                   * The seed goes back to 0 with the nonce, or "Reset" would hand
                   * back whatever "Reorganize" last produced — which is a reset to
                   * nowhere in particular. Reset means the canonical arrangement.
                   */
                  setLayoutSeed(0)
                  setLayoutNonce((n) => n + 1)
                }}
                title={t('graph.resetHint')}
              >
                <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden />
                {t('graph.reset')}
              </Button>
            </>
          )
        }
      />

      <div
        data-tour="graph"
        className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
      >
        <Panel className="flex min-w-0 flex-col">
          <PanelTitle
            hint={
              noMatches ? (
                <>
                  {t('graph.noMatches')} ·{' '}
                  <button
                    type="button"
                    onClick={() => {
                      // Both ways of asking: a question asked in words outranks
                      // the builder's, so clearing only `query` left an Ask
                      // answer (and its "no records match") exactly where it was.
                      setQuery(null)
                      setAsked(null)
                      setAskReset((n) => n + 1)
                    }}
                    className="cursor-pointer underline underline-offset-2 transition-colors hover:text-text-1"
                  >
                    {t('graph.clearQuery')}
                  </button>
                </>
              ) : (
                t('graph.counts', {
                  shown: view.nodes.length,
                  count: graph.nodes.length,
                  edges: view.edges.length,
                })
              )
            }
          >
            {t('graph.panelTitle')}
          </PanelTitle>

          <GraphViewBar
            mode={mode}
            onMode={switchMode}
            freeAllowed={freeAllowed}
            by={groupBy}
            onBy={setGroupBy}
            trail={trail}
            labelOf={(id) => graph.byId.get(id)?.label ?? id}
            onCrumb={(index) => {
              const id = trail[index]
              if (id) focusOn(id)
            }}
            onBack={backToOverview}
            action={viewAction}
          />

          <div className="well h-[380px] overflow-hidden rounded-md sm:h-[460px] lg:h-[560px]">
            {mode === 'free' ? (
              <GraphCanvas
                graph={view}
                showAllLabels={showAllLabels}
                selectedId={selectedId}
                onSelect={setSelectedId}
                result={result}
                layoutNonce={layoutNonce}
                layoutSeed={layoutSeed}
              />
            ) : mode === 'focus' && centre !== undefined ? (
              <FocusCanvas
                viewGraph={viewGraph}
                centreId={centre}
                expanded={expanded}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onFocus={focusOn}
                onExpand={(id) =>
                  setExpanded((current) => {
                    const next = new Set(current)
                    if (!next.delete(id)) next.add(id)
                    return next
                  })
                }
                result={result}
                showAllLabels={showAllLabels}
              />
            ) : (
              <OverviewCanvas
                viewGraph={viewGraph}
                folding={folding}
                by={groupBy}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onFocus={focusOn}
                result={result}
                showAllLabels={showAllLabels}
              />
            )}
          </div>

          <p className="mt-2 text-xs text-text-3">
            {mode === 'free'
              ? t('graph.help')
              : mode === 'focus'
                ? tGraph('view.focusHelp')
                : tGraph('view.overviewHelp')}
          </p>

          <GraphLegend
            counts={counts}
            hidden={hidden}
            onToggle={toggleType}
            onShowAll={() => setHidden(new Set())}
          />
        </Panel>

        {selectedId === GROUP_LOOSE && mode === 'overview' ? (
          <GraphLoosePanel graph={graph} ids={folding.loose} onSelect={setSelectedId} />
        ) : (
          <GraphDetail graph={graph} node={selected} onSelect={setSelectedId} />
        )}
      </div>

      <QueryPanel
        graph={graph}
        query={query}
        onQueryChange={(next) => {
          // The builder and the model are two ways to ask, and only one answer
          // can be on screen. Touching the builder means you meant the builder.
          setAsked(null)
          setQuery(next)
        }}
        result={result}
        onAsk={onAsk}
        onAskClear={() => {
          setAsked(null)
        }}
        askReset={askReset}
        selectedId={selectedId}
        onSelectNode={selectFromAnswer}
      />
    </>
  )
}
