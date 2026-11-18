import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { ShowMoreRows } from '@/components/common/ShowMoreRows'
import { NODE_TYPE_LABEL } from '@/lib/graph/model'
import type { Graph, GraphNode } from '@/lib/graph/model'
import { TypeSwatch } from './NodeGlyph'
import { LEGEND_ORDER } from './visuals'

const PAGE = 60

/**
 * The records linked to nothing, as a list — what the overview's one counted
 * "Not linked to anything" node opens, in the place the detail panel goes.
 *
 * The overview draws them as one node rather than two hundred dots, so this is
 * where each of them stays findable: every row selects its record, and the
 * detail panel takes over from there.
 */
export function GraphLoosePanel({
  graph,
  ids,
  onSelect,
}: {
  graph: Graph
  ids: readonly string[]
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('graph')
  const [shown, setShown] = useState(PAGE)

  const nodes = useMemo(() => {
    const rank = (n: GraphNode) => LEGEND_ORDER.indexOf(n.type)
    return ids
      .map((id) => graph.byId.get(id))
      .filter((n): n is GraphNode => n !== undefined)
      .sort((a, b) => rank(a) - rank(b) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  }, [graph, ids])

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={t('common.records', { count: nodes.length })}>
        {t('view.group.loose')}
      </PanelTitle>
      <p className="text-xs text-text-3">{t('view.looseHint')}</p>
      <ul className="mt-3 space-y-0.5">
        {nodes.slice(0, shown).map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className="pressable-row flex w-full items-center gap-2 rounded-sm px-1 py-1 text-start text-sm text-text-2 transition-colors hover:bg-row-hover hover:text-text-1"
            >
              <TypeSwatch type={node.type} />
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              <span className="shrink-0 text-xs text-text-3">{NODE_TYPE_LABEL[node.type]}</span>
            </button>
          </li>
        ))}
      </ul>
      <ShowMoreRows
        shown={Math.min(shown, nodes.length)}
        hidden={Math.max(0, nodes.length - shown)}
        onMore={() => setShown((n) => n + PAGE)}
      />
    </Panel>
  )
}
