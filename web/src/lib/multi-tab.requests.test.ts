import { describe, expect, it } from 'vitest'
import mcpLinkProvider from '@/lib/mcp-link-provider.tsx?raw'
import modelSettings from '@/lib/model-settings.tsx?raw'
import pipelines from '@/lib/pipelines.tsx?raw'
import vault from '@/routes/Vault.tsx?raw'
import calendar from '@/routes/Calendar.tsx?raw'
import jobScout from '@/routes/JobScout.tsx?raw'
import arrival from '@/lib/use-arrival-highlight.ts?raw'

/**
 * Review 2: what one tab does has to reach the others (web-lib-1, -2, -3), and
 * a second pick of the same search result has to light its row again
 * (web-lib-4). Source reads (D20): these are providers and routes, and the
 * behaviour was measured with two tabs of one browser context.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('settings changed in another tab (web-lib-1, web-lib-2)', () => {
  it('the MCP link re-reads its switch and token when another tab writes them', () => {
    const code = strip(mcpLinkProvider)
    expect(code).toMatch(/addEventListener\('storage'/)
    expect(code).toMatch(
      /event\.key === STORAGE_KEY \|\| event\.key === null\) setStored\(load\(\)\)/,
    )
  })

  it('the saved servers change the list in storage, not this tab’s copy of it', () => {
    const code = strip(modelSettings)
    expect(code).toMatch(/change\(readStored\(SERVERS_KEY\) === null \? list : readServers\(\)\)/)
    expect(code).toMatch(/addEventListener\('storage'/)
    for (const key of ['SERVERS_KEY', 'STORAGE_KEY', 'READER_KEY']) {
      expect(code).toContain(`event.key === ${key}`)
    }
  })
})

describe('one tab runs the scout (web-lib-3)', () => {
  it('schedules rounds and reads suggestions only in the elected tab', () => {
    const code = strip(pipelines)
    expect(code).toMatch(/const leader = useTabLeader\(SCOUT_LOCK\)/)
    expect(code).toMatch(/schedule: leader/)
    expect(code).toMatch(/\{leader \? <ScoutReader \/> : null\}/)
  })
})

describe('picking the same result twice (web-lib-4)', () => {
  it.each([
    [
      'Vault',
      vault,
      /useArrivalHighlight\(focus, \(\) => set\(\{ focus: undefined \}\), arrival\)/,
    ],
    [
      'Calendar',
      calendar,
      /useArrivalHighlight\(focus, \(\) => set\(\{ focus: undefined \}\), arrival\)/,
    ],
    [
      'JobScout',
      jobScout,
      /useArrivalHighlight\(token, \(\) => set\(\{ focus: undefined \}\), arrival\)/,
    ],
  ])('%s restarts the highlight on every arrival', (_name, source, call) => {
    const code = strip(source)
    expect(code).toMatch(/const \{ key: arrival \} = useLocation\(\)/)
    expect(code).toMatch(call)
  })

  it('replays the fade of a row already wearing the class', () => {
    expect(strip(arrival)).toMatch(/requestAnimationFrame\(\(\) => replayArrivalHighlights\(\)\)/)
  })

  it('keeps the lit row in view while the page above it grows (web-a11y-1)', () => {
    const code = strip(arrival)
    expect(code).toMatch(/settle = keepInView\(element, ARRIVAL_HIGHLIGHT_MS\)/)
    expect(code).toMatch(/new ResizeObserver/)
  })
})
