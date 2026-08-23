import { useCallback, useEffect, useMemo, useState } from 'react'
import { Network, Plus, Shuffle } from 'lucide-react'
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
  useTitle('Graph')

  // The snapshot itself, not eight projections of it. The page used to rebuild
  // ~400 nodes and edges whenever any record OR any keyword changed, because it
  // depended on eight arrays and a closure; it now depends on one reading that
  // changes once per commit.
  const memory = useGraph()
  const { open } = useDialogs()

  const graph = useMemo(() => buildGraph(memory), [memory])

  const [hidden, setHidden] = useState<ReadonlySet<GraphNodeType>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState<GraphQuery | null>(null)
  /** Bumped by "Reset layout" — the canvas reshuffles when this changes. */
  const [layoutNonce, setLayoutNonce] = useState(0)
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
        <PageHeader
          title="Graph"
          subtitle="Nothing to draw yet — the graph is built from the records in your store."
        />
        <Panel>
          <EmptyState
            icon={Network}
            title="No records to connect"
            description="Applications, reminders, files and keywords become nodes here, and the pointers between them become edges. Add the first application and the graph starts drawing itself."
            action={
              <Button size="sm" onClick={() => open('application')}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                New application
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
        title="Graph"
        subtitle="The knowledge graph your records are stored in, drawn. Every node is a record in this browser and every edge is a pointer between two of them."
        settings={
          <>
            <PageOption
              label="Label every record"
              // The old hint ended "— the rest collide", which was a fair
              // warning while they did. The canvas now drops any label that
              // would land on another one, so the honest trade is the opposite:
              // this switch is how you get a name onto a node the crowd hid.
              hint="Off, hubs and whatever you are pointing at are named, and anything that would overlap is dropped"
              control={
                <Switch
                  checked={showAllLabels}
                  onCheckedChange={setShowAllLabels}
                  aria-label="Label every record"
                />
              }
            />
            <PageOption
              label="Hide unconnected records"
              hint="Drops anything with no edges — usually a file or link filed under nothing"
              control={
                <Switch
                  checked={hideLoners}
                  onCheckedChange={setHideLoners}
                  aria-label="Hide unconnected records"
                />
              }
            />
          </>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => setLayoutNonce((n) => n + 1)}>
            <Shuffle className="size-3.5" strokeWidth={2} aria-hidden />
            Reset layout
          </Button>
        }
      />

      <div className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="flex min-w-0 flex-col">
          <PanelTitle
            hint={
              noMatches ? (
                <>
                  No records match this question ·{' '}
                  <button
                    type="button"
                    onClick={() => setQuery(null)}
                    className="cursor-pointer underline underline-offset-2 transition-colors hover:text-text-1"
                  >
                    clear the query
                  </button>
                </>
              ) : (
                `${view.nodes.length} of ${graph.nodes.length} records · ${view.edges.length} connections`
              )
            }
          >
            Everything, connected
          </PanelTitle>

          <div className="well h-[380px] overflow-hidden rounded-md sm:h-[460px] lg:h-[560px]">
            <GraphCanvas
              graph={view}
              showAllLabels={showAllLabels}
              selectedId={selectedId}
              onSelect={setSelectedId}
              result={result}
              layoutNonce={layoutNonce}
            />
          </div>

          <p className="mt-2 text-xs text-text-3">
            Hover or tab to a node to trace its neighbourhood, press to select it, drag to move it.
            Node colour is its kind, size is how much points at it.
          </p>

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
        selectedId={selectedId}
        onSelectNode={setSelectedId}
      />
    </>
  )
}
