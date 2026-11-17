/**
 * Owner requests about the application-frequency chart.
 *
 * Q020: the card switches between bars and a line from a control inside it.
 * Q022: the periods are week, month and quarter; the year option was added and
 *       then taken out again (M046, M086).
 * Q122: the bars/line switch sits at the right edge of its row.
 *
 * The period list is data (`PERIODS`, `PERIOD_VALUES`) and is tested as data.
 * The rest only exists in the JSX, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import { PERIOD_VALUES } from '@jojo/service/core/model'
import { PERIODS } from '@/data/seed'
import en from '@/i18n/locales/en/dashboard.json'

const sources = import.meta.glob('/src/components/dashboard/ApplicationFrequency.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/ApplicationFrequency.tsx'] ?? ''

describe('the frequency periods (Q022)', () => {
  it('are week, month and quarter, with no year', () => {
    expect([...PERIOD_VALUES]).toEqual(['week', 'month', 'quarter'])
    expect(PERIODS.map((p) => p.value)).toEqual(['week', 'month', 'quarter'])
    expect(PERIODS.map((p) => p.label.toLowerCase())).not.toContain('year')
  })

  it('are the options the period switch offers', () => {
    // Each period is labelled from the catalog, keyed by its value.
    expect(source).toContain(
      'const periods = PERIODS.map((p) => ({ ...p, label: t(`frequency.periods.${p.value}`) }))',
    )
    expect(Object.keys(en.frequency.periods)).toEqual([...PERIOD_VALUES])
    expect(source).toMatch(/<Segment\s+label=\{t\('frequency\.period'\)\}\s+options=\{periods\}/)
    // The noun table is keyed by exactly those three, so a fourth cannot be
    // spoken in the chart's label without a compile error here first.
    expect(source).toMatch(
      /const PERIOD_NOUN: Record<Period, string> = \{ week: 'week', month: 'month', quarter: 'quarter' \}/,
    )
  })
})

describe('the chart type switch (Q020)', () => {
  it('offers bars and a line', () => {
    expect(source).toMatch(/const CHARTS = \['bar', 'line'\] as const/)
    expect(en.frequency.charts).toEqual({ bar: 'Bars', line: 'Line' })
  })

  it('is a control in the card that sets what is drawn', () => {
    expect(source).toMatch(
      /label=\{t\('frequency\.chartType'\)\}\s+options=\{charts\}\s+value=\{chart\}\s+onChange=\{setChart\}/,
    )
    // Bars when 'bar', the polyline otherwise.
    expect(source).toMatch(/\{chart === 'bar'\s*\?\s*data\.map/)
    expect(source).toContain('<polyline')
  })
})

describe('where the chart type switch sits (Q122)', () => {
  it('is pushed to the right edge of its row', () => {
    const control =
      /<Segment\s+className="([^"]*)"\s+label=\{t\('frequency\.chartType'\)\}/.exec(source)?.[1] ??
      ''
    expect(control.split(/\s+/)).toContain('ms-auto')
  })
})
