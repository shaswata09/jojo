/**
 * Q023: clicking a legend entry hides or shows that series.
 *
 * The rule is `toggledIn` and `visibleOf`, the two pure halves of
 * `useSeriesToggle`. D20 bans mounting the hook, so these are tested directly,
 * and a narrow source read pins that each chart's legend calls the hook's
 * `toggle` and draws only what `isHidden` lets through.
 *
 * The pipeline pie is the one chart left out on purpose: its legend rows
 * navigate to the applications list filtered by stage (see `PipelineBreakdown`).
 */

import { describe, expect, it } from 'vitest'
import { toggledIn, visibleOf } from './use-series-toggle'

const sources = import.meta.glob(
  [
    '/src/components/charts/ChartLegend.tsx',
    '/src/components/charts/Donut.tsx',
    '/src/components/dashboard/ApplicationFrequency.tsx',
    '/src/components/dashboard/ApplicationSources.tsx',
    '/src/components/dashboard/SearchHealth.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const source = (path: string) => sources[`/src/components/${path}`] ?? ''

describe('a legend press', () => {
  it('hides a shown series and shows a hidden one', () => {
    const once = toggledIn(new Set<string>(), 'Industry')
    expect([...once]).toEqual(['Industry'])
    const twice = toggledIn(once, 'Industry')
    expect([...twice]).toEqual([])
  })

  it('touches only the series pressed', () => {
    const next = toggledIn(new Set(['Postdoc']), 'Industry')
    expect([...next].sort()).toEqual(['Industry', 'Postdoc'])
  })

  it('returns a new set rather than editing the old one', () => {
    const before = new Set(['Postdoc'])
    const after = toggledIn(before, 'Postdoc')
    expect(after).not.toBe(before)
    expect([...before]).toEqual(['Postdoc'])
  })

  it('leaves a hidden series out of what is drawn, in the chart order', () => {
    expect(visibleOf(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c'])
    expect(visibleOf(['a', 'b'], new Set(['a', 'b']))).toEqual([])
  })
})

describe('the legends wired to it', () => {
  it('ChartLegend hands the pressed key to onToggle', () => {
    expect(source('charts/ChartLegend.tsx')).toMatch(/onClick=\{\(\) => onToggle\(item\.key\)\}/)
  })

  it('application frequency draws only the series the legend leaves on', () => {
    const src = source('dashboard/ApplicationFrequency.tsx')
    expect(src).toMatch(/useSeriesToggle\(series\.map\(\(s\) => s\.key\)\)/)
    expect(src).toMatch(/const visible = series\.filter\(\(s\) => !isHidden\(s\.key\)\)/)
    expect(src).toMatch(/<ChartLegend[\s\S]*?onToggle=\{toggle\}/)
  })

  it('the donut and the source bars toggle the same slices', () => {
    expect(source('charts/Donut.tsx')).toMatch(/const visible = slices\.filter\(\(s\) => !isHidden\(s\.key\)\)/)
    expect(source('charts/Donut.tsx')).toMatch(/onClick=\{\(\) => onToggle\(s\.key\)\}/)
    const sourcesPanel = source('dashboard/ApplicationSources.tsx')
    expect(sourcesPanel).toMatch(/<Donut[^>]*onToggle=\{toggle\}/)
    expect(sourcesPanel).toMatch(/onClick=\{\(\) => toggle\(s\.key\)\}/)
  })

  it('the radar plots only the series its legend leaves on', () => {
    const src = source('dashboard/SearchHealth.tsx')
    expect(src).toMatch(/series=\{RADAR_SERIES\.filter\(\(s\) => !isHidden\(s\.key\)\)/)
    expect(src).toMatch(/<ChartLegend[\s\S]*?onToggle=\{toggle\}/)
  })
})
