import { describe, expect, it } from 'vitest'
import { VAULT_DEFAULTS } from '@/lib/links'
import appSource from './App.tsx?raw'

/**
 * Q046: the Reminders page became the Vault, and an old link still lands.
 *
 * Read as source because D20 rules out mounting `<App />`. The redirect is the
 * whole of the promise to a bookmark, and nothing else in the suite reads the
 * route table, so deleting it would fail nothing.
 */

/** Comments stripped, so prose describing a route cannot stand in for one. */
const code = appSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('the reminders page, now the Vault (Q046)', () => {
  it('routes /vault to the Vault page', () => {
    expect(code).toMatch(/<Route\s+path="vault"\s+element=\{<Vault\s*\/>\}/)
  })

  it('redirects /reminders to /vault, replacing the history entry', () => {
    expect(code).toMatch(
      /<Route\s+path="reminders"\s+element=\{<Navigate\s+to="\/vault"\s+replace\s*\/>\}/,
    )
  })

  it('lands a redirected bookmark on the reminders tool', () => {
    // `/vault` with no `tool` opens the default tab, so the redirect above only
    // keeps its promise while that default is still reminders.
    expect(VAULT_DEFAULTS.tool).toBe('reminders')
  })
})

describe('the guide is not in the chunk every page waits on (perf-2)', () => {
  const guide = import.meta.glob('/src/routes/Guide.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  it.each([
    'GuideOverview',
    'GuideScreens',
    'GuideGraph',
    'GuideTools',
    'GuideBuiltWith',
    'GuideControlFlow',
    'GuideLicence',
  ])('loads %s lazily, never by a static import', (page) => {
    // GuideTools pulls the benchmark report and its conversations — about a
    // third of a megabyte gzipped — into whichever chunk imports it.
    expect(code).not.toMatch(new RegExp(`^import \\{ ${page} \\}`, 'm'))
    expect(code).toMatch(
      new RegExp(
        `const ${page} = lazy\\(async \\(\\) => \\(\\{\\s*default: \\(await import\\('@/components/guide/${page}'\\)\\)\\.${page},`,
      ),
    )
  })

  it('suspends a page under the guide’s rail, not the whole app', () => {
    expect(guide['/src/routes/Guide.tsx']).toMatch(
      /<Suspense fallback=\{<GuidePageFallback \/>\}>\s*<Outlet \/>\s*<\/Suspense>/,
    )
  })
})
