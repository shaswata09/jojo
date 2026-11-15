import { describe, expect, it } from 'vitest'
import { GUIDE_PAGES } from '@/lib/links'
import appSource from './App.tsx?raw'

/**
 * Owner requests about the app's page set and its copy (G6, the shell).
 *
 * Read as source because D20 rules out mounting `<App />`. The route table is
 * the only place a page exists, so a deleted route fails nothing else.
 */

/** Comments stripped, so prose describing a route cannot stand in for one. */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const code = strip(appSource)

/** `<Route path="x" element={<Y />} />`, attributes in either order. */
const routes = (path: string, element: string) =>
  new RegExp(
    `<Route\\s+(?:path="${path}"\\s+element=\\{<${element}\\s*\\/>\\}|element=\\{<${element}\\s*\\/>\\}\\s+path="${path}")`,
  )

describe('the pages the app has (Q007)', () => {
  it('routes the dashboard as the index page', () => {
    expect(code).toMatch(/<Route\s+index\s+element=\{<Dashboard\s*\/>\}/)
  })

  it.each([
    ['applications', 'Applications'],
    ['calendar', 'Calendar'],
    ['statistics', 'Statistics'],
    ['vault', 'Vault'],
    ['scout', 'JobScout'],
    ['profile', 'Profile'],
    ['assistant', 'Assistant'],
    ['settings', 'Settings'],
    ['guide', 'Guide'],
  ])('routes /%s to %s', (path, element) => {
    // `applications` and `guide` open a nested <Route> rather than closing.
    expect(code).toMatch(
      new RegExp(`<Route\\s+path="${path}"\\s+element=\\{<${element}\\s*\\/>\\}`),
    )
  })
})

describe('the guide is separate pages (Q075, Q148, Q310)', () => {
  it('has the overview, screens, graph, tools, built-with, control flow and licence pages', () => {
    expect([...GUIDE_PAGES].sort()).toEqual(
      ['overview', 'screens', 'graph', 'tools', 'built-with', 'control-flow', 'licence'].sort(),
    )
  })

  it.each([
    ['screens', 'GuideScreens'],
    ['graph', 'GuideGraph'],
    ['tools', 'GuideTools'],
    ['built-with', 'GuideBuiltWith'],
    ['control-flow', 'GuideControlFlow'],
    ['licence', 'GuideLicence'],
  ])('routes /guide/%s to its own page, %s', (path, element) => {
    expect(code).toMatch(routes(path, element))
  })

  it('opens the overview at /guide itself', () => {
    expect(code).toMatch(/<Route\s+index\s+element=\{<GuideOverview\s*\/>\}/)
  })

  it('redirects the old FAQ page to the Control flow graph', () => {
    expect(code).toMatch(
      /<Route\s+path="faq"\s+element=\{<Navigate\s+to="\/guide\/control-flow"\s+replace\s*\/>\}/,
    )
  })
})

/**
 * Copy the owner asked to have removed (Q009, Q056).
 *
 * Every source file in both apps, comments stripped: a sentence explaining why
 * a line was removed is not the line coming back.
 */
const everySource = {
  ...(import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob(['../../mobile/src/**/*.{ts,tsx}', '!../../mobile/src/**/*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>),
}

const saying = (pattern: RegExp) =>
  Object.entries(everySource)
    .filter(([, src]) => pattern.test(strip(src)))
    .map(([file]) => file)

describe('copy that was removed stays removed', () => {
  it('read both apps, so an empty result below means something', () => {
    const files = Object.keys(everySource)
    expect(files.some((f) => f.includes('/components/layout/Sidebar.tsx'))).toBe(true)
    expect(files.some((f) => f.includes('mobile/src/'))).toBe(true)
  })

  it('never says "jojo - everything runs on your machine." (Q009)', () => {
    expect(saying(/jojo\s*[-–—·:]\s*everything runs on your machine/i)).toEqual([])
  })

  it('never says "works offline" or "Has keyboard support" (Q056)', () => {
    expect(saying(/works offline/i)).toEqual([])
    expect(saying(/has keyboard support/i)).toEqual([])
  })
})
