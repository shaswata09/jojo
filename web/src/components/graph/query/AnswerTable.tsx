import { ArrowUpRight, SearchX } from 'lucide-react'
import { Link } from 'react-router'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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

function matchedSummary(row: QueryRow, t: TFunction<'graph'>) {
  if (row.via) return t('answer.via', { rel: REL_LABEL[row.via] })
  if (row.matched.length === 0) return '—'
  const names = row.matched.slice(0, 3).map((n) => n.label)
  const rest = row.matched.length - names.length
  return rest > 0 ? t('answer.more', { names: names.join(', '), count: rest }) : names.join(', ')
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
  const { t } = useTranslation('graph')
  const rows = result ? result.rows.slice(0, MAX_ROWS) : []

  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 flex flex-wrap items-baseline gap-2 text-xs text-text-3">
        {t('answer.title')}
        {result ? (
          <span className="tabular font-mono">
            {t('answer.records', { count: result.rows.length })}
          </span>
        ) : null}
      </h3>

      {!result ? (
        <p className="px-1 py-8 text-center text-xs text-text-3">{t('answer.prompt')}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t('answer.emptyTitle')}
          description={result.emptyNote}
          action={
            <Button size="sm" variant="outline" onClick={onClear}>
              {t('answer.clear')}
            </Button>
          }
        />
      ) : (
        <PanelScroll axis="x" inset="tight" className="flex-none">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">{t('answer.caption')}</caption>
            <thead>
              <tr className="text-start text-xs text-text-3">
                <th scope="col" className="py-2 pe-3 font-medium">
                  {t('answer.columns.record')}
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  {t('answer.columns.kind')}
                </th>
                <th scope="col" className="py-2 pe-3 text-end font-medium">
                  {result.countLabel}
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  {t('answer.columns.matched')}
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">{t('answer.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row) => (
                <tr key={row.node.id} className={cn(selectedId === row.node.id && 'bg-row-hover')}>
                  <th scope="row" className="py-1.5 pe-3 text-start font-normal">
                    <button
                      type="button"
                      onClick={() => onSelectNode(row.node.id)}
                      title={t('answer.select')}
                      className="pressable-row flex w-full items-center gap-2 rounded-sm px-1 py-1 text-start transition-colors hover:bg-row-hover"
                    >
                      <TypeSwatch type={row.node.type} />
                      <span className="min-w-0 truncate">{truncate(row.node.label)}</span>
                    </button>
                  </th>
                  <td className="py-1.5 pe-3 text-xs text-text-3">
                    {NODE_TYPE_LABEL[row.node.type]}
                  </td>
                  <td className="tabular py-1.5 pe-3 text-end font-mono">{row.count}</td>
                  <td className="py-1.5 pe-3 text-xs text-text-2">
                    {truncate(matchedSummary(row, t), 40)}
                  </td>
                  <td className="py-1.5 text-end">
                    {row.node.href ? (
                      <Link
                        to={row.node.href}
                        className="inline-flex items-center gap-0.5 rounded-sm text-xs text-text-2 transition-colors hover:text-text-1"
                      >
                        {t('answer.open')}
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
          {t('answer.showing', { shown: rows.length, total: result.rows.length })}
        </p>
      ) : null}
    </div>
  )
}
