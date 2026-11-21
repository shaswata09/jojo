/**
 * Two owner requests about a scout suggestion's card, which exist only as JSX
 * and class names (D20: no mounting), so they are read out of the source.
 *
 * Q287 — each suggestion shows its link as a link that opens in a new tab, a
 *        one- or two-line summary of the posting, and an "Open posting" button
 *        on the right. What the card is fed (`postingPreview`: summary, title,
 *        an address that opens) is tested in `core/proposal.test.ts`.
 * Q343 — a search box, filters, and the closed suggestions in a box of their
 *        own below the active ones (see the last block).
 * Q305 — a long posting address pushed every card past the Suggestions panel.
 *        The fix (9656c5d) was the list's column: `grid-cols-1` is
 *        `minmax(0, 1fr)`, so the column is the panel's width and the link is
 *        what gives way. A bare `grid` sizes its one column to the widest thing
 *        a card cannot wrap.
 */
import { describe, expect, it } from 'vitest'
import source from './ProposalQueue.tsx?raw'
import filters from './ProposalFilters.tsx?raw'
import en from '@/i18n/locales/en/scout.json'

/** Comments removed, so prose about a class or a prop does not count as one. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q287 a scout suggestion shows a summary, its link, and an open button', () => {
  it('clamps the posting summary to two lines', () => {
    expect(code).toMatch(/className="line-clamp-2[^"]*"\s*>\s*\{posting\.summary\}/)
  })

  it('makes the address itself a link that opens in a new tab', () => {
    expect(code).toMatch(
      /<a\s+href=\{posting\.href\}\s+target="_blank"\s+rel="noopener noreferrer"\s+title=\{posting\.href\}[\s\S]{0,200}?\{posting\.label\}\s*<\/a>/,
    )
  })

  it('puts an Open posting button, also a new tab, in the right-hand column', () => {
    const right = code.indexOf('<div className="ms-auto flex shrink-0')
    expect(right).toBeGreaterThan(-1)
    const button = code.slice(right, right + 700)
    expect(button).toMatch(/<a\s+href=\{posting\.href\}\s+target="_blank"/)
    expect(button).toMatch(/<ExternalLink [^>]*\/>\s*\{t\('proposals\.openPosting'\)\}\s*<\/a>/)
    expect(en.proposals.openPosting).toBe('Open posting')
  })
})

describe('Q305 suggestion cards stay inside the Suggestions panel', () => {
  it('lays the cards out in a one-column grid the panel’s width, not an auto-sized one', () => {
    // Both lists since Q343: the active cards, and the Closed box's.
    expect(code).toMatch(/<ul className="grid grid-cols-1 gap-2\.5">\{shownActive\.map\(cardFor\)\}<\/ul>/)
    expect(code).toMatch(/<ul className="grid grid-cols-1 gap-2\.5">\{shownClosed\.map\(cardFor\)\}<\/ul>/)
    expect(code).not.toMatch(/<ul className="grid(?! grid-cols-1)/)
  })

  it('lets each card shrink below its content, and long words wrap', () => {
    expect(code).toContain("? 'min-w-0 rounded-lg border border-hairline bg-well/40 px-3.5 py-3'")
    expect(code).toContain(": 'min-w-0 rounded-lg border border-hairline bg-panel px-3.5 py-3'")
    expect(code).toMatch(/'min-w-0 text-sm wrap-anywhere'/)
  })
})

/*
 * Q343 — the owner asked for a search bar, filters by tags, keywords and other
 * categories, and finished suggestions moved out of the main list into a
 * dedicated scrollable box at the bottom. What counts as active, what the
 * search matches and what each filter does are `core/proposal-filter.ts` and
 * tested there; this pins that the panel is wired to them.
 */
const filterCode = filters.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q343 the suggestions can be searched and filtered, and closed ones sit apart', () => {
  it('lists only the active suggestions in the main list, by the shared rule', () => {
    expect(code).toMatch(/const \{ active, closed \} = splitProposals\(proposals,/)
    expect(code).toMatch(/const shownActive = active\.filter\(passes\)/)
    expect(code).not.toMatch(/\[\.\.\.pending, \.\.\.answered\]/)
  })

  it('puts the closed ones in their own scrolling box below the main list', () => {
    const main = code.indexOf('{shownActive.map(cardFor)}')
    const box = code.indexOf('{shownClosed.map(cardFor)}')
    expect(main).toBeGreaterThan(-1)
    expect(box).toBeGreaterThan(main)
    const around = code.slice(code.lastIndexOf('<div', box), box)
    expect(around).toMatch(/max-h-\[22rem\] overflow-y-auto/)
    expect(around).toMatch(/tabIndex=\{0\}/)
    expect(en.proposals.closed.title).toBe('Closed')
  })

  it('has a search box and a filter for every category, over both lists', () => {
    expect(code).toMatch(/<ProposalFilters filter=\{filter\} facets=\{facets\} onChange=\{setFilter\} \/>/)
    expect(code).toMatch(/const shownClosed = closed\.filter\(passes\)/)
    expect(filterCode).toMatch(/<Input\s+id=\{searchId\}\s+type="search"/)
    for (const key of ['pipelines', 'types', 'roleTags', 'keywords', 'employers'])
      expect(filterCode).toContain(`key: '${key}'`)
    expect(Object.keys(en.proposals.filter)).toEqual(
      expect.arrayContaining(['pipeline', 'type', 'roleTag', 'keyword', 'employer']),
    )
  })

  it('does not offer Approve all over a filtered list', () => {
    expect(code).toMatch(/pending\.length > 1 && pendingFrom && !filtering/)
  })
})
