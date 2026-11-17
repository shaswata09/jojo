/**
 * Two owner requests about a scout suggestion's card, which exist only as JSX
 * and class names (D20: no mounting), so they are read out of the source.
 *
 * Q287 — each suggestion shows its link as a link that opens in a new tab, a
 *        one- or two-line summary of the posting, and an "Open posting" button
 *        on the right. What the card is fed (`postingPreview`: summary, title,
 *        an address that opens) is tested in `core/proposal.test.ts`.
 * Q305 — a long posting address pushed every card past the Suggestions panel.
 *        The fix (9656c5d) was the list's column: `grid-cols-1` is
 *        `minmax(0, 1fr)`, so the column is the panel's width and the link is
 *        what gives way. A bare `grid` sizes its one column to the widest thing
 *        a card cannot wrap.
 */
import { describe, expect, it } from 'vitest'
import source from './ProposalQueue.tsx?raw'
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
    expect(code).toMatch(
      /<ul className="grid grid-cols-1 gap-2\.5">\s*\{\[\.\.\.pending, \.\.\.answered\]/,
    )
  })

  it('lets each card shrink below its content, and long words wrap', () => {
    expect(code).toContain("? 'min-w-0 rounded-lg border border-hairline bg-well/40 px-3.5 py-3'")
    expect(code).toContain(": 'min-w-0 rounded-lg border border-hairline bg-panel px-3.5 py-3'")
    expect(code).toMatch(/'min-w-0 text-sm wrap-anywhere'/)
  })
})
