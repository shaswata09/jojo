/**
 * The graph panel's counts line (review 3, translation leftovers).
 *
 * It was one string, plural on the records, with the connections spliced in:
 * "12 of 40 records · 1 connections". Each count is its own plural now, framed
 * by `pages:graph.counts`; the composition lives inline in `Graph.tsx`, so the
 * call is read as text and the same keys are rendered here through i18next.
 */
import { describe, expect, it } from 'vitest'
import { i18next, loadLocale } from '@/i18n/i18n'
import graph from './Graph.tsx?raw'

const countsLine = (language: string, shown: number, count: number, edges: number) => {
  const t = i18next.getFixedT(language, 'pages')
  return t('graph.counts', {
    records: t('graph.countsRecords', { shown, count }),
    connections: t('graph.countsConnections', { count: edges }),
  })
}

describe('the graph’s record and connection counts', () => {
  it('frames two plurals in Graph.tsx rather than splicing a count into one', () => {
    expect(graph).toMatch(
      /t\('graph\.counts', \{\s*records: t\('graph\.countsRecords', \{\s*shown: view\.nodes\.length,\s*count: graph\.nodes\.length,\s*\}\),\s*connections: t\('graph\.countsConnections', \{ count: view\.edges\.length \}\),/,
    )
  })

  it('says one record and one connection in the singular, two in the plural', () => {
    expect(countsLine('en', 1, 1, 1)).toBe('1 of 1 record · 1 connection')
    expect(countsLine('en', 2, 2, 2)).toBe('2 of 2 records · 2 connections')
  })

  it('uses Arabic’s dual for two', async () => {
    await loadLocale('ar')
    expect(countsLine('ar', 2, 2, 2)).toBe('2 من 2 سجلين · 2 اتصالان')
  })
})
