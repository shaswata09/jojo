import { describe, expect, it } from 'vitest'
import statisticsSource from '@/routes/Statistics.tsx?raw'
import { statisticsFocusFallback } from './focus-fallback'

/**
 * Review round 3 (webui-11): the ⌘K row "What's working" lands somewhere drawn
 * even while the panel keeps its silence for want of anything to compare.
 */
describe('a search result for What’s working (webui-11)', () => {
  it('falls back to the headline rates when the panel is not drawn', () => {
    expect(statisticsFocusFallback('stats-what-is-working')).toBe('stats-headline')
    expect(statisticsFocusFallback('stats-funnel')).toBeUndefined()
    expect(statisticsSource).toMatch(
      /useFocusArrival\(focus, \{ fallbackOf: statisticsFocusFallback, arrival \}\)/,
    )
  })
})
