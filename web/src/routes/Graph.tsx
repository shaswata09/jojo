import { useCallback, useEffect, useMemo, useState } from 'react'
import { Network, Plus, RotateCcw, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { GraphDetail } from '@/components/graph/GraphDetail'
import { GraphLegend } from '@/components/graph/GraphLegend'
import { QueryPanel } from '@/components/graph/QueryPanel'
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
import { useTitle } from '@/lib/links'

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
    setSelectedId((id) => (id && graph.byId.has(id) ? id : null))
  }, [graph])

  const toggleType = useCallback((type: GraphNodeType) => {
    setHidden((current) => {
      const next = new Set(current)
      if (!next.delete(type)) next.add(type)
      return next
    })
  }, [])

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null

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

          <div className="well h-[380px] overflow-hidden rounded-md sm:h-[460px] lg:h-[560px]">
            <GraphCanvas
              graph={view}
              showAllLabels={showAllLabels}
              selectedId={selectedId}
              onSelect={setSelectedId}
              result={result}
              layoutNonce={layoutNonce}
              layoutSeed={layoutSeed}
            />
          </div>

          <p className="mt-2 text-xs text-text-3">{t('graph.help')}</p>

          <GraphLegend
            counts={counts}
            hidden={hidden}
            onToggle={toggleType}
            onShowAll={() => setHidden(new Set())}
          />
        </Panel>

        <GraphDetail graph={graph} node={selected} onSelect={setSelectedId} />
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
        onSelectNode={setSelectedId}
      />
    </>
  )
}
