/**
 * Q021: the Statistics page has a radar chart with improvement suggestions.
 * Q186: the page gives ranked recommendations from outcome data, with their
 *       uncertainty (Wilson intervals) and their strength stated. The rules are
 *       tested in `service/kg/core/recommend.test.ts` and `segments.test.ts`;
 *       the last block here pins that the page renders them.
 *
 * The axes and their suggestions are `searchHealthFor`, tested in
 * `service/kg/core/statistics.test.ts`; the radar's geometry is tested in
 * `components/charts/Radar.test.ts`. This pins the join neither can see: that
 * the page mounts the panel, and the panel draws the radar from those axes
 * and lists their suggestions. D20 bans mounting, so it is a source read.
 */

import { describe, expect, it } from 'vitest'
import statisticsEn from '@/i18n/locales/en/statistics.json'

const sources = import.meta.glob(
  [
    '/src/routes/Statistics.tsx',
    '/src/components/dashboard/SearchHealth.tsx',
    '/src/components/statistics/NextSteps.tsx',
    '/src/components/statistics/WhatIsWorking.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const page = sources['/src/routes/Statistics.tsx'] ?? ''
const health = sources['/src/components/dashboard/SearchHealth.tsx'] ?? ''

describe('the radar on the Statistics page (Q021)', () => {
  it('is mounted on the page', () => {
    expect(page).toContain("import { SearchHealth } from '@/components/dashboard/SearchHealth'")
    expect(page).toContain('<SearchHealth />')
  })

  it('is drawn from the measured search-health axes', () => {
    expect(health).toMatch(/searchHealthFor\(\{ applications: all, timeline, today: TODAY \}\)/)
    expect(health).toMatch(/<Radar\s+axes=\{measured\.map\(\(a\) => advice\.axis\(a\.id\)\)\}/)
  })

  it('lists a suggestion for each axis beside it', () => {
    expect(health).toMatch(/\{ranked\.map\(\(a, i\) => \{/)
    expect(health).toContain('const said = advice.health(a)')
    expect(health).toContain('{said.suggestion}</p>')
  })
})

describe('recommendations on the Statistics page (Q186)', () => {
  const next = sources['/src/components/statistics/NextSteps.tsx'] ?? ''
  const working = sources['/src/components/statistics/WhatIsWorking.tsx'] ?? ''

  it('are both mounted on the page', () => {
    expect(page).toContain('<NextSteps />')
    expect(page).toContain('<WhatIsWorking />')
  })

  it('list the ranked recommendations with each one’s strength', () => {
    expect(next).toMatch(
      /recommendationsFor\(\{ applications: all, timeline, background, today: TODAY \}\)/,
    )
    expect(next).toContain('const badge = BADGE[item.strength]')
  })

  it('state each rate with its interval and say whether a difference is real', () => {
    expect(working).toContain('const comparisons = useMemo(() => comparisonsFor(all), [all])')
    expect(working).toContain("t('whatIsWorking.rate', { rate: arm.rate, range: rangeLabel(arm) })")
    expect(statisticsEn.whatIsWorking.rate).toBe('{{rate}}% · likely {{range}}')
    expect(working).toMatch(/\{c\.confident\s*\?/)
  })
})
