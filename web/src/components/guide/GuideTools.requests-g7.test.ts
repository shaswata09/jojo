import { describe, expect, it } from 'vitest'
import { CATALOG } from '@jojo/service/agent/catalog'
import pageSource from './GuideTools.tsx?raw'
import pagesSource from './pages.ts?raw'

/**
 * Q133 — the guide's Tools page stays up to date with every tool.
 *
 * The page describes the catalog rather than listing it by hand, and the
 * numbers it prints are counted from the catalog at render time. A count typed
 * into the JSX is how it would fall behind: it was 82 when the page was written
 * and the catalog has moved since. (The citations half of the request is
 * `credits.test.ts`.)
 */

/** Code only: the page's comments quote old counts on purpose. */
const code = pageSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('Q133: the Tools page counts the catalog', () => {
  it('reads the tool total from the catalog it describes', () => {
    expect(code).toMatch(/import \{ CATALOG \} from '@jojo\/service\/agent\/catalog'/)
    expect(code).toMatch(/hint=\{`\$\{String\(CATALOG\.length\)\} in total`\}/)
    expect(CATALOG.length).toBeGreaterThan(50)
  })

  it('prints no hand-typed tool count in its text', () => {
    // "82 tools", "ninety-five operations": a number next to the noun it counts.
    const typed = /\b(\d{2,3}|(?:seventy|eighty|ninety)(?:-\w+)?|a hundred[\w -]*?) (?:tools|operations)\b/i
    const prose = code.replace(/\{String\([^)]*\)\}/g, 'N')
    expect(prose.match(typed)?.[0] ?? null).toBeNull()
  })

  it('keeps a typed tool count out of the rail blurb too', () => {
    // The guide rail's blurb for this page said "out of eighty-two" long after
    // the catalog had grown to 95. It names no number now, so it cannot drift.
    const typed = /\bout of (?:\d{2,3}|(?:seventy|eighty|ninety|a hundred)[\w-]*)\b/i
    expect(pagesSource.match(typed)?.[0] ?? null).toBeNull()
    expect(pagesSource).toContain('how it picks the right one out of the whole catalog')
  })
})
