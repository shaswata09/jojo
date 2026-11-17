import { describe, expect, it } from 'vitest'
import { CATALOG } from '@jojo/service/agent/catalog'
import pageSource from './GuideTools.tsx?raw'
import pagesSource from './pages.ts?raw'
import en from '@/i18n/locales/en/guideReference.json'
import guideEn from '@/i18n/locales/en/guide.json'

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
const code = pageSource
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('Q133: the Tools page counts the catalog', () => {
  it('reads the tool total from the catalog it describes', () => {
    expect(code).toMatch(/import \{ CATALOG \} from '@jojo\/service\/agent\/catalog'/)
    expect(code).toMatch(/hint=\{t\('tools\.can\.hint', \{ total: String\(CATALOG\.length\) \}\)\}/)
    expect(en.tools.can.hint).toBe('{{total}} in total')
    expect(CATALOG.length).toBeGreaterThan(50)
  })

  it('prints no hand-typed tool count in its text', () => {
    // "82 tools", "ninety-five operations": a number next to the noun it counts.
    const typed =
      /\b(\d{2,3}|(?:seventy|eighty|ninety)(?:-\w+)?|a hundred[\w -]*?) (?:tools|operations)\b/i
    const prose = code.replace(/\{String\([^)]*\)\}/g, 'N')
    expect(prose.match(typed)?.[0] ?? null).toBeNull()
    // The sentences live in the catalog now; counts reach them as placeholders.
    const catalog = JSON.stringify(en.tools)
    expect(catalog.match(typed)?.[0] ?? null).toBeNull()
    expect(en.tools.picks.p1).toContain('all {{total}} tools')
  })

  it('keeps a typed tool count out of the rail blurb too', () => {
    // The guide rail's blurb for this page said "out of eighty-two" long after
    // the catalog had grown to 95. It names no number now, so it cannot drift.
    // The blurb's words live in the guide catalog; `pages.ts` reads them by key.
    const typed = /\bout of (?:\d{2,3}|(?:seventy|eighty|ninety|a hundred)[\w-]*)\b/i
    expect(pagesSource.match(typed)?.[0] ?? null).toBeNull()
    expect(guideEn.pages.tools.blurb.match(typed)?.[0] ?? null).toBeNull()
    expect(guideEn.pages.tools.blurb).toContain(
      'how it picks the right one out of the whole catalog',
    )
    expect(pagesSource).toContain('guide:pages.${KEY[id]}.blurb')
  })
})
