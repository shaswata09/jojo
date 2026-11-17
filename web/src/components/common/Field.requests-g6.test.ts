import { describe, expect, it } from 'vitest'
import field from '@/components/common/Field.tsx?raw'

/**
 * Q154 — a web-address field shows a go-to icon at its right that opens the
 * link in a new tab.
 *
 * What may be opened is `openHref`'s decision and `vault/links/url.test.ts`
 * pins it. This pins the other half: that a URL field actually draws the
 * button, at its right edge, opening a new tab. Source read (D20).
 */
const code = field
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** The `OpenLink` component's anchor. */
const anchor = /function OpenLink[\s\S]*?<a\b([\s\S]*?)>\s*<ExternalLink\b/.exec(code)?.[1] ?? ''

describe('the go-to button on a URL field (Q154)', () => {
  it('appears for a field of type url holding an address openHref accepts', () => {
    expect(code).toMatch(
      /const href = props\.type === 'url' \? openHref\(String\(props\.value \?\? ''\)\) : undefined/,
    )
    expect(code).toMatch(/\{href \? <OpenLink href=\{href\} label=\{label\} \/> : null\}/)
  })

  it('is a link that opens a new tab', () => {
    expect(anchor).toMatch(/href=\{href\}/)
    expect(anchor).toMatch(/target="_blank"/)
    expect(anchor).toMatch(/rel="noopener noreferrer"/)
  })

  it('sits at the right of the field, which leaves room for it', () => {
    expect(anchor).toMatch(/className="absolute end-1 top-1\/2 /)
    expect(code).toMatch(/button && 'pe-8 /)
  })
})
