import { useEffect, useId, useMemo, useState } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import type { Graph, GraphNode, GraphNodeType } from '@/lib/graph/model'
import { describeQuery } from '@/lib/graph/pseudo-query'
import type { GraphQuery, PathQuery, PatternQuery, QueryResult } from '@/lib/graph/query'
import { AnswerTable } from './query/AnswerTable'
import { ExampleChips } from './query/ExampleChips'
import { PathFields, PatternFields } from './query/QueryFields'
import { LEGEND_ORDER } from './visuals'

/**
 * Asking the graph something.
 *
 * A visual pattern builder rather than a query language: pick what you are
 * looking for, whether it has a relationship or is missing one, and what sits
 * on the other end. Every change runs immediately — a Run button would add a
 * state where the table on screen and the controls above it disagree.
 *
 * The pseudo-query underneath is illustrative and labelled as such. It is there
 * so the concept lands: seeing `WHERE NOT (a)-[:ABOUT]-(:Timeline item)` beside
 * the words "applications with no follow-up" is what makes the builder legible.
 * Nothing parses it.
 *
 * This file holds the question — the two draft queries, and which of them is
 * live. The controls that edit them are in `query/QueryFields`, the answer is
 * in `query/AnswerTable`, and both drafts stay here because switching modes has
 * to leave the other one untouched.
 */

const DEFAULT_PATTERN: PatternQuery = {
  kind: 'pattern',
  start: 'application',
  quantifier: 'has',
  rel: 'any',
  end: 'any',
}

/** Falls back to whatever the graph still holds — a filtered-out node id would
 *  otherwise leave the two pickers pointing at records that are not there. */
function normalisePath(graph: Graph, path: PathQuery): PathQuery {
  const first = graph.nodes[0]?.id ?? ''
  const second = graph.nodes[1]?.id ?? first
  return {
    kind: 'path',
    from: graph.byId.has(path.from) ? path.from : first,
    to: graph.byId.has(path.to) ? path.to : second,
  }
}

export function QueryPanel({
  graph,
  query,
  onQueryChange,
  result,
  selectedId,
  onSelectNode,
}: {
  graph: Graph
  /** Null until the first question is asked, so the canvas starts undimmed. */
  query: GraphQuery | null
  onQueryChange: (query: GraphQuery | null) => void
  result: QueryResult | null
  selectedId: string | null
  onSelectNode: (id: string) => void
}) {
  const fieldId = useId()
  const [mode, setMode] = useState<'pattern' | 'path'>('pattern')
  const [pattern, setPattern] = useState<PatternQuery>(DEFAULT_PATTERN)
  const [path, setPath] = useState<PathQuery>({ kind: 'path', from: '', to: '' })

  // An example press arrives as a new `query` from above; the controls have to
  // follow it or the builder would describe a pattern that is not running.
  useEffect(() => {
    if (!query) return
    setMode(query.kind)
    if (query.kind === 'pattern') setPattern(query)
    else setPath(query)
  }, [query])

  const safePath = useMemo(() => normalisePath(graph, path), [graph, path])

  const keywords = useMemo(
    () =>
      graph.nodes
        .filter((n) => n.type === 'keyword')
        .sort((a, b) => a.label.localeCompare(b.label)),
    [graph],
  )

  const presentTypes = useMemo(() => {
    const seen = new Set(graph.nodes.map((n) => n.type))
    return LEGEND_ORDER.filter((type) => seen.has(type))
  }, [graph])

  const nodesByType = useMemo(() => {
    const map = new Map<GraphNodeType, GraphNode[]>()
    for (const node of graph.nodes) {
      const list = map.get(node.type)
      if (list) list.push(node)
      else map.set(node.type, [node])
    }
    return map
  }, [graph])

  const active: GraphQuery = query ?? (mode === 'pattern' ? pattern : safePath)

  const editPattern = (patch: Partial<PatternQuery>) => {
    const next: PatternQuery = { ...pattern, ...patch }
    setPattern(next)
    onQueryChange(next)
  }

  const editPath = (patch: Partial<PathQuery>) => {
    const next: PathQuery = { ...safePath, ...patch }
    setPath(next)
    onQueryChange(next)
  }

  const switchMode = (next: 'pattern' | 'path') => {
    setMode(next)
    if (query) onQueryChange(next === 'pattern' ? pattern : safePath)
  }

  return (
    <Panel className="min-w-0">
      <PanelTitle hint="A preview of the query view — illustrative, not a language jojo runs">
        Ask the graph
      </PanelTitle>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-5">
        <div className="min-w-0 space-y-3">
          <ExampleChips graph={graph} query={query} onQueryChange={onQueryChange} />

          <Segment
            label="Question shape"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'pattern', label: 'Pattern' },
              { value: 'path', label: 'Path' },
            ]}
            className="w-fit"
          />

          {mode === 'pattern' ? (
            <PatternFields
              fieldId={fieldId}
              pattern={pattern}
              presentTypes={presentTypes}
              keywords={keywords}
              onEdit={editPattern}
            />
          ) : (
            <PathFields
              fieldId={fieldId}
              path={safePath}
              presentTypes={presentTypes}
              nodesByType={nodesByType}
              onEdit={editPath}
            />
          )}

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs text-text-3">Generated query</h3>
              {query ? (
                <button
                  type="button"
                  onClick={() => onQueryChange(null)}
                  className="pressable cursor-pointer rounded-sm border border-hairline bg-well px-2 py-0.5 text-xs text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {/* Wrapped rather than scrolled: this is prose about the pattern,
                and a line of it hidden behind a horizontal scrollbar is the one
                line that carries the WHERE clause. */}
            <pre className="mt-1 rounded-md border border-hairline bg-well p-2.5 font-mono text-xs break-words whitespace-pre-wrap text-text-2">
              {describeQuery(graph, active)}
            </pre>
            <p className="mt-1 text-xs text-text-3">
              Illustrative — it shows the shape of the question, and nothing here parses it.
            </p>
          </div>
        </div>

        <AnswerTable
          result={result}
          selectedId={selectedId}
          onSelectNode={onSelectNode}
          onClear={() => onQueryChange(null)}
        />
      </div>
    </Panel>
  )
}
