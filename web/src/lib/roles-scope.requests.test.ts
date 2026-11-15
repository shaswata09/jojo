import { describe, expect, it } from 'vitest'
import frequency from '@/components/dashboard/ApplicationFrequency.tsx?raw'
import pipeline from '@/components/dashboard/PipelineBreakdown.tsx?raw'
import sources from '@/components/dashboard/ApplicationSources.tsx?raw'
import statsCard from '@/components/dashboard/StatsCard.tsx?raw'
import statistics from '@/routes/Statistics.tsx?raw'
import nextSteps from '@/components/statistics/NextSteps.tsx?raw'
import whatIsWorking from '@/components/statistics/WhatIsWorking.tsx?raw'
import filters from '@/components/applications/ApplicationsFilters.tsx?raw'
import applications from '@/routes/Applications.tsx?raw'
import scope from '@/lib/roles-scope.ts?raw'
import headlineRates from '@/components/dashboard/HeadlineRates.tsx?raw'
import searchHealth from '@/components/dashboard/SearchHealth.tsx?raw'

/**
 * Q024 — the charts follow the role filter in the top bar.
 *
 * Source reads, because D20 forbids mounting. What is counted is pinned in
 * `roles-context.requests.test.ts` (`scopeByRoles`); this file pins that each
 * chart counts from it rather than from the whole store.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CHARTS = {
  ApplicationFrequency: frequency,
  PipelineBreakdown: pipeline,
  ApplicationSources: sources,
  StatsCard: statsCard,
  'routes/Statistics': statistics,
  NextSteps: nextSteps,
  WhatIsWorking: whatIsWorking,
  HeadlineRates: headlineRates,
  SearchHealth: searchHealth,
}

describe('the dashboard and Statistics charts (Q024)', () => {
  it.each(Object.entries(CHARTS))(
    '%s counts the records the role filter lets through',
    (_name, src) => {
      const code = strip(src)
      expect(code).toMatch(/= useScopedApplications\(\)/)
      expect(code).not.toMatch(/\buseApplications\(\)/)
    },
  )

  it('narrow by the shared top-bar selection, through scopeByRoles', () => {
    const code = strip(scope)
    expect(code).toMatch(/const \{ selected \} = useRoles\(\)/)
    expect(code).toMatch(/scopeByRoles\(\{ all, stageCounts, sourceCounts \}, selected\)/)
  })

  it('say the filter is hiding everything, rather than "add your first"', () => {
    for (const src of [frequency, pipeline, sources, statistics]) {
      expect(strip(src)).toMatch(/<RoleScopeEmpty \/>/)
    }
  })
})

describe('the Applications page (Q024)', () => {
  it('reads the one shared selection and no longer shows a filter of its own', () => {
    expect(strip(applications)).toMatch(/= useRoles\(\)/)
    expect(strip(filters)).not.toMatch(/RoleFilter|useRoles/)
  })
})
