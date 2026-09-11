import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain ES module loaded from disk by the browser, with no
// types of its own. Imported directly rather than `?raw`, because what is under
// test is its behaviour, not its text. See `web/extension/shrink.js`.
import { shrinkToFit } from '../../extension/shrink.js'

type Shrunk = { html: string | null; dropped: number; freedBytes: number }
const shrink = shrinkToFit as (html: string, max: number) => Shrunk

/** A base64 data URI of exactly `n` payload characters, distinct per `tag`. */
const uri = (tag: string, n: number, mime = 'image/png') =>
  `data:${mime};base64,${tag}${'A'.repeat(Math.max(0, n - tag.length))}`

const bytes = (s: string) => new TextEncoder().encode(s).length

describe('a page already under the cap', () => {
  it('is returned untouched', () => {
    const html = `<p>posting</p><img src="${uri('x', 100)}">`
    expect(shrink(html, 10_000)).toEqual({ html, dropped: 0, freedBytes: 0 })
  })
})

describe('a page over the cap', () => {
  it('leaves out the most expensive asset first, and only as much as it needs', () => {
    const big = uri('big', 5000)
    const small = uri('small', 500)
    const html = `<p>Senior ML Engineer</p><img src="${big}"><img src="${small}">`
    // Cap sits between "both" and "just the small one".
    const r = shrink(html, bytes(html) - 1000)

    expect(r.html).not.toBeNull()
    expect(r.dropped).toBe(1)
    expect(r.html).not.toContain(big)
    expect(r.html).toContain(small)
    expect(bytes(r.html!)).toBeLessThanOrEqual(bytes(html) - 1000)
  })

  it('counts an asset by size times occurrences, because inline() splices every copy', () => {
    /*
     * The case that motivated the ordering. `inline()` fetches an address once
     * but writes its value at every reference, and on gitlab.com/jobs the same
     * 0.31 MB SVG appeared several times. A 1 KB icon used ten times costs 10 KB
     * — more than a single 6 KB photo — so it must go first.
     */
    const icon = uri('icon', 1000, 'image/svg+xml')
    const photo = uri('photo', 6000)
    const iconUses = Array.from({ length: 10 }, () => `.i{background:url("${icon}")}`).join('')
    const html = `<style>${iconUses}</style><img src="${photo}"><p>body text</p>`
    const r = shrink(html, bytes(html) - 8000)

    expect(r.dropped).toBe(1)
    expect(r.html).not.toContain(icon)
    expect(r.html).toContain(photo)
  })

  it('never introduces a live address — a removed asset becomes an empty value', () => {
    const html = `<style>.h{background:url("${uri('a', 4000)}")}</style><img src="${uri('b', 4000)}">`
    const r = shrink(html, 200)
    expect(r.html).toContain('url("")')
    expect(r.html).toContain('src=""')
    expect(r.html).not.toMatch(/https?:/)
  })

  it('leaves the text of the posting byte-for-byte alone', () => {
    const text = '<h1>Staff Engineer — Ümlaut & “quotes” 🚀</h1><p>Requirements: PyTorch, 5+ years.</p>'
    const html = `${text}<img src="${uri('p', 9000)}">`
    const r = shrink(html, bytes(text) + 200)
    expect(r.html!.startsWith(text)).toBe(true)
  })

  it('does not touch a data URI that is only mentioned in text', () => {
    // Only the two positions inline() writes are assets: inside url(...) and as
    // an attribute value. A URI quoted in a code sample is content.
    const mentioned = uri('text', 3000)
    const html = `<pre>${mentioned}</pre><img src="${uri('real', 3000)}">`
    const r = shrink(html, bytes(html) - 2000)
    expect(r.html).toContain(`<pre>${mentioned}</pre>`)
  })
})

describe('a page that cannot fit at all', () => {
  it('returns null rather than a broken half-page', () => {
    // Text alone is over the cap: removing every asset cannot help, and the
    // caller needs to know so it can say so instead of storing a gutted page.
    const html = `<p>${'x'.repeat(5000)}</p><img src="${uri('a', 100)}">`
    const r = shrink(html, 1000)
    expect(r.html).toBeNull()
    expect(r.dropped).toBe(1)
  })
})

describe('the gitlab.com/jobs shape, measured', () => {
  it('saves a page that is over by a sliver instead of discarding it', () => {
    // 8.04 MB against 8 MB, with a 0.46 MB font as the largest asset: one
    // removal is enough, and the posting text survives.
    const MB = 1024 * 1024
    const font = uri('font', Math.round(0.46 * MB), 'application/octet-stream')
    const filler = 'y'.repeat(Math.round(7.6 * MB))
    const html = `<style>@font-face{src:url("${font}")}</style><main>${filler}</main><h1>Jobs at GitLab</h1>`
    expect(bytes(html)).toBeGreaterThan(8 * MB)

    const r = shrink(html, 8 * MB)
    expect(r.html).not.toBeNull()
    expect(r.dropped).toBe(1)
    expect(r.html).toContain('<h1>Jobs at GitLab</h1>')
    expect(bytes(r.html!)).toBeLessThanOrEqual(8 * MB)
  })
})
