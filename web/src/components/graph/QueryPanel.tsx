import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowUpRight, SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { FormField } from '@/components/common/Field'
import { Panel, PanelScroll, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import {
  GRAPH_RELS,
  ITEM_FACETS,
  NODE_TYPE_LABEL,
  QUERY_EXAMPLES,
  REL_LABEL,
  describeQuery,
} from '@/lib/graph'
import type {
  Graph,
  GraphNode,
  GraphNodeType,
  GraphQuery,
  ItemFacet,
  PathQuery,
  PatternQuery,
  QueryResult,
  QueryRow,
} from '@/lib/graph'
import { KIND_LABEL } from '@/lib/timeline-visuals'
import { cn } from '@/lib/utils'
import { LEGEND_ORDER, TypeSwatch } from './visuals'

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
 */

const SELECT_CLASS =
  'h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/** Long tables stop being an answer and become a second graph. */
const MAX_ROWS = 40

const DEFAULT_PATTERN: PatternQuery = {
  kind: 'pattern',
  start: 'application',
  quantifier: 'has',
  rel: 'any',
  end: 'any',
}

const facetLabel = (facet: ItemFacet) =>
  facet === 'any' ? 'Any kind' : facet === 'reminder' ? 'Reminder' : KIND_LABEL[facet]

const truncate = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

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

function matchedSummary(row: QueryRow) {
  if (row.via) return `via ${REL_LABEL[row.via]}`
  if (row.matched.length === 0) return '—'
  const names = row.matched.slice(0, 3).map((n) => n.label)
  const rest = row.matched.length - names.length
  return rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ')
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

  const examples = useMemo(
    () => QUERY_EXAMPLES.map((example) => ({ ...example, built: example.build(graph) })),
    [graph],
  )

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

  const rows = result ? result.rows.slice(0, MAX_ROWS) : []

  return (
    <Panel className="min-w-0">
      <PanelTitle hint="A preview of the query view — illustrative, not a language jojo runs">
        Ask the graph
      </PanelTitle>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-5">
        <div className="min-w-0 space-y-3">
          <div>
            <h3 className="mb-1.5 text-xs text-text-3">Worked examples</h3>
            <ul className="flex flex-wrap gap-1.5">
              {examples.map((example) => {
                const on =
                  query !== null && example.built !== null && sameQuery(query, example.built)
                return (
                  <li key={example.id}>
                    <button
                      type="button"
                      disabled={example.built === null}
                      title={
                        example.built === null
                          ? 'This session has nothing to ask that of'
                          : example.hint
                      }
                      onClick={() => example.built && onQueryChange(example.built)}
                      className={cn(
                        'pressable rounded-full border px-2.5 py-1 text-xs transition-colors',
                        on
                          ? 'border-accent-border bg-accent-soft text-accent'
                          : 'border-hairline bg-well text-text-2 hover:border-hairline-strong hover:text-text-1',
                        example.built === null && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {example.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

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
            <div className="grid gap-2.5 sm:grid-cols-2">
              <FormField label="Records" htmlFor={`${fieldId}-start`}>
                <select
                  id={`${fieldId}-start`}
                  className={SELECT_CLASS}
                  value={pattern.start}
                  onChange={(event) =>
                    editPattern({ start: event.target.value as PatternQuery['start'] })
                  }
                >
                  <option value="any">Any record</option>
                  {presentTypes.map((type) => (
                    <option key={type} value={type}>
                      {NODE_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </FormField>

              {pattern.start === 'item' ? (
                <FormField label="Of kind" htmlFor={`${fieldId}-start-facet`}>
                  <select
                    id={`${fieldId}-start-facet`}
                    className={SELECT_CLASS}
                    value={pattern.startFacet ?? 'any'}
                    onChange={(event) =>
                      editPattern({ startFacet: event.target.value as ItemFacet })
                    }
                  >
                    {ITEM_FACETS.map((facet) => (
                      <option key={facet} value={facet}>
                        {facetLabel(facet)}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}

              <FormField label="Condition" htmlFor={`${fieldId}-quantifier`}>
                <select
                  id={`${fieldId}-quantifier`}
                  className={SELECT_CLASS}
                  value={pattern.quantifier}
                  onChange={(event) =>
                    editPattern({ quantifier: event.target.value as PatternQuery['quantifier'] })
                  }
                >
                  <option value="has">has</option>
                  <option value="missing">has no</option>
                  <option value="atLeast">has at least</option>
                </select>
              </FormField>

              {pattern.quantifier === 'atLeast' ? (
                <FormField label="How many" htmlFor={`${fieldId}-at-least`}>
                  <select
                    id={`${fieldId}-at-least`}
                    className={SELECT_CLASS}
                    value={pattern.atLeast ?? 2}
                    onChange={(event) => editPattern({ atLeast: Number(event.target.value) })}
                  >
                    {[2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} or more
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}

              <FormField label="Relationship" htmlFor={`${fieldId}-rel`}>
                <select
                  id={`${fieldId}-rel`}
                  className={SELECT_CLASS}
                  value={pattern.rel}
                  onChange={(event) =>
                    editPattern({ rel: event.target.value as PatternQuery['rel'] })
                  }
                >
                  <option value="any">any relationship</option>
                  {GRAPH_RELS.map((rel) => (
                    <option key={rel} value={rel}>
                      {REL_LABEL[rel]} ({rel})
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Connected to" htmlFor={`${fieldId}-end`}>
                <select
                  id={`${fieldId}-end`}
                  className={SELECT_CLASS}
                  value={pattern.end}
                  onChange={(event) =>
                    editPattern({ end: event.target.value as PatternQuery['end'] })
                  }
                >
                  <option value="any">anything</option>
                  {presentTypes.map((type) => (
                    <option key={type} value={type}>
                      {NODE_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </FormField>

              {pattern.end === 'item' ? (
                <FormField label="Of kind" htmlFor={`${fieldId}-end-facet`}>
                  <select
                    id={`${fieldId}-end-facet`}
                    className={SELECT_CLASS}
                    value={pattern.endFacet ?? 'any'}
                    onChange={(event) => editPattern({ endFacet: event.target.value as ItemFacet })}
                  >
                    {ITEM_FACETS.map((facet) => (
                      <option key={facet} value={facet}>
                        {facetLabel(facet)}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}

              {keywords.length > 0 ? (
                <FormField label="Carrying keyword" htmlFor={`${fieldId}-keyword`}>
                  <select
                    id={`${fieldId}-keyword`}
                    className={SELECT_CLASS}
                    value={pattern.keywordId ?? ''}
                    onChange={(event) =>
                      editPattern({ keywordId: event.target.value || undefined })
                    }
                  >
                    <option value="">any keyword</option>
                    {keywords.map((keyword) => (
                      <option key={keyword.id} value={keyword.id}>
                        {keyword.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <FormField label="From" htmlFor={`${fieldId}-from`}>
                <NodePicker
                  id={`${fieldId}-from`}
                  types={presentTypes}
                  nodesByType={nodesByType}
                  value={safePath.from}
                  onChange={(id) => editPath({ from: id })}
                />
              </FormField>
              <FormField label="To" htmlFor={`${fieldId}-to`}>
                <NodePicker
                  id={`${fieldId}-to`}
                  types={presentTypes}
                  nodesByType={nodesByType}
                  value={safePath.to}
                  onChange={(id) => editPath({ to: id })}
                />
              </FormField>
            </div>
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

        {/* The answer, as rows. The highlighted subgraph beside it says where
            they are; the table says what they are and opens them. */}
        <div className="min-w-0">
          <h3 className="mb-1.5 flex flex-wrap items-baseline gap-2 text-xs text-text-3">
            Answer
            {result ? (
              <span className="tabular font-mono">
                {result.rows.length} {result.rows.length === 1 ? 'record' : 'records'}
              </span>
            ) : null}
          </h3>

          {!result ? (
            <p className="px-1 py-8 text-center text-xs text-text-3">
              Pick an example, or build a pattern, and the answer appears here and lights up in the
              graph above.
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No records match"
              description={result.emptyNote}
              action={
                <Button size="sm" variant="outline" onClick={() => onQueryChange(null)}>
                  Clear the query
                </Button>
              }
            />
          ) : (
            <PanelScroll axis="x" inset="tight" className="flex-none">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">Records matching the pattern</caption>
                <thead>
                  <tr className="text-left text-xs text-text-3">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Record
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Kind
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {result.countLabel}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Matched
                    </th>
                    <th scope="col" className="py-2">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.map((row) => (
                    <tr
                      key={row.node.id}
                      className={cn(selectedId === row.node.id && 'bg-row-hover')}
                    >
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => onSelectNode(row.node.id)}
                          title="Select in the graph"
                          className="pressable-row flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left transition-colors hover:bg-row-hover"
                        >
                          <TypeSwatch type={row.node.type} />
                          <span className="min-w-0 truncate">{truncate(row.node.label)}</span>
                        </button>
                      </th>
                      <td className="py-1.5 pr-3 text-xs text-text-3">
                        {NODE_TYPE_LABEL[row.node.type]}
                      </td>
                      <td className="tabular py-1.5 pr-3 text-right font-mono">{row.count}</td>
                      <td className="py-1.5 pr-3 text-xs text-text-2">
                        {truncate(matchedSummary(row), 40)}
                      </td>
                      <td className="py-1.5 text-right">
                        {row.node.href ? (
                          <Link
                            to={row.node.href}
                            className="inline-flex items-center gap-0.5 rounded-sm text-xs text-text-2 transition-colors hover:text-text-1"
                          >
                            Open
                            <ArrowUpRight className="size-3" strokeWidth={2} aria-hidden />
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PanelScroll>
          )}

          {result && result.rows.length > rows.length ? (
            <p className="mt-2 text-xs text-text-3">
              Showing the first {rows.length} of {result.rows.length}. Every one of them is lit in
              the graph above.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}

/** One record out of the whole graph, grouped by kind so the list is scannable. */
function NodePicker({
  id,
  types,
  nodesByType,
  value,
  onChange,
}: {
  id: string
  types: GraphNodeType[]
  nodesByType: ReadonlyMap<GraphNodeType, GraphNode[]>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <select
      id={id}
      className={SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {types.map((type) => (
        <optgroup key={type} label={NODE_TYPE_LABEL[type]}>
          {(nodesByType.get(type) ?? []).map((node) => (
            <option key={node.id} value={node.id}>
              {truncate(node.label, 38)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** Cheap structural equality — enough to light up the example you pressed. */
function sameQuery(a: GraphQuery, b: GraphQuery) {
  return JSON.stringify(a) === JSON.stringify(b)
}
