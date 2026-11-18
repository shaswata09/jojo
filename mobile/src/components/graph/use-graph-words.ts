import { adjacency, foldedSummary } from '@jojo/service/core/graph-view'
import type { Folding, ViewGraph, ViewNode } from '@jojo/service/core/graph-view'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { NODE_TYPE_LABEL } from '@/lib/graph'
import type { GraphNodeType } from '@/lib/graph'
import { TYPE_ORDER, foldedPhrase, listJoiner } from '@/lib/graph-view'
import type { Say } from '@/lib/graph-view'

/**
 * Names for the overview's records, worded once per distinct phrase.
 *
 * A store's records share a handful of shapes ("2 timeline items, 1 employer
 * and 1 file", "5 connections"), so each phrase is put into words once and
 * reused — on the web, naming three thousand records uncached was most of the
 * page's first render, all of it in i18next.
 */
export function useGraphWords(viewGraph: ViewGraph, folding: Folding | null) {
  const { t: translate, i18n } = useTranslation('screens')
  const t = translate as unknown as Say
  const language = i18n.language

  const byId = useMemo(() => new Map(viewGraph.nodes.map((n) => [n.id, n])), [viewGraph])
  const typeOf = useCallback((id: string) => byId.get(id)?.type, [byId])

  const words = useMemo(() => {
    void language
    const join = listJoiner(t)
    const cache = new Map<string, string>()
    const once = (key: string, make: () => string) => {
      let hit = cache.get(key)
      if (hit === undefined) {
        hit = make()
        cache.set(key, hit)
      }
      return hit
    }
    return {
      t,
      connections: (count: number) =>
        once(`c${count}`, () => t('graph.view.connections', { count })),
      /** "2 timeline items and 1 file" for any list of ids, counted by type. */
      counted: (summary: readonly { type: string; count: number }[]) =>
        once(`f${summary.map((s) => `${s.type}:${s.count}`).join('|')}`, () =>
          foldedPhrase(summary, (type, count) => t(`graph.view.folded.${type}`, { count }), join),
        ),
    }
    // `t` changes identity with the language; `language` says so explicitly.
  }, [t, language])

  /** What is counted on a record, in words; empty when nothing is. */
  const foldedText = useCallback(
    (id: string) => (folding ? words.counted(foldedSummary(folding, typeOf, id, TYPE_ORDER)) : ''),
    [folding, typeOf, words],
  )

  /** A record's accessible name, with what is counted on it. */
  const nameOf = useCallback(
    (node: ViewNode) => {
      const connections = words.connections(adjacency(viewGraph).get(node.id)?.length ?? 0)
      const base = { label: node.label, type: typeLabel(node.type), connections }
      const folded = folding?.folded.get(node.id)
      return folded && folded.length > 0
        ? t('graph.view.node.folded', { ...base, folded: foldedText(node.id) })
        : t('graph.view.node.plain', base)
    },
    [viewGraph, folding, foldedText, words, t],
  )

  return { t, language, byId, typeOf, words, foldedText, nameOf }
}

export const typeLabel = (type: string) => NODE_TYPE_LABEL[type as GraphNodeType] ?? type
