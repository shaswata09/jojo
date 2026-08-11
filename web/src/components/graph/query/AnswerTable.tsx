import { ArrowUpRight, SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { PanelScroll } from '@/components/common/Panel'
import { TypeSwatch } from '@/components/graph/NodeGlyph'
import { Button } from '@/components/ui/button'
import { NODE_TYPE_LABEL, REL_LABEL } from '@/lib/graph/model'
import type { QueryResult, QueryRow } from '@/lib/graph/query'
import { cn } from '@/lib/utils'
import { truncate } from './truncate'

/**
 * The answer, as rows.
 *
 * The highlighted subgraph beside it says where the matches are; this says what
 * they are and opens them. Pressing a row selects the node in the canvas rather
 * than navigating, so the two halves of the panel stay pointed at one record.
 */

/** Long tables stop being an answer and become a second graph. */
const MAX_ROWS = 40

function matchedSummary(row: QueryRow) {
  if (row.via) return `via ${REL_LABEL[row.via]}`
  if (row.matched.length === 0) return '—'
  const names = row.matched.slice(0, 3).map((n) => n.label)
  const rest = row.matched.length - names.length
  return rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ')
}

export function AnswerTable({
  result,
  selectedId,
  onSelectNode,
  onClear,
}: {
  /** Null until the first question is asked. */
  result: QueryResult | null
  selectedId: string | null
  onSelectNode: (id: string) => void
  onClear: () => void
}) {
  const rows = result ? result.rows.slice(0, MAX_ROWS) : []

  return (
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
            <Button size="sm" variant="outline" onClick={onClear}>
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
                <tr key={row.node.id} className={cn(selectedId === row.node.id && 'bg-row-hover')}>
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
          Showing the first {rows.length} of {result.rows.length}. Every one of them is lit in the
          graph above.
        </p>
      ) : null}
    </div>
  )
}
