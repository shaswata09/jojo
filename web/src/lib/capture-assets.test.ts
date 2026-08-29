/**
 * The extension's asset loop, executed rather than described.
 *
 * `inline()` walks a list its own body appends to — a fetched stylesheet's
 * `@import`s and `url()`s are queued as they are discovered — which is what lets
 * one pass cover arbitrary nesting, and also what makes it unbounded: `byHref`
 * collapses repeats of the SAME address and nothing at all stops fresh ones. A
 * page whose sheets import two new sheets apiece had the service worker fetching
 * forever with the badge stuck on '…' and no route to recovery.
 *
 * Run for real, out of the file the browser loads, for the reason
 * `reader-relay.test.ts` gives: a transcription of a guard is not the guard, and
 * a termination argument in prose is worth nothing. `?raw` and `new Function`
 * are that file's precedent — the extension is plain JS with no declarations and
 * cannot be imported.
 *
 * `serialise.js`'s `queueCssUrls` is lifted the same way, at the bottom. It is
 * the other end of the same pipe: what it decides to tokenise is what `inline()`
 * splices, and the escape at that splice is chosen by the KIND the tokeniser
 * gave it. One of those two files alone cannot show the invariant holding.
 */

import { describe, expect, it } from 'vitest'
import backgroundSource from '../../extension/background.js?raw'
import serialiseSource from '../../extension/serialise.js?raw'
import { CAPTURE_MAX_ASSET_BYTES, CAPTURE_SCHEMES } from '@jojo/service/core/capture'

type Asset = { href: string; kind: string }
type Page = { html: string; assets: Asset[]; dropped?: number }
type Inline = (page: Page) => Promise<{ html: string; dropped: number }>
type Fetched = { ok: boolean; status: number; text: () => Promise<string> }

/**
 * `cssSafe` through `byteLength`, which is `inline` and the three helpers it
 * calls. Sliced rather than brace-matched because it is one contiguous run in
 * the file and the pieces are useless apart.
 */
const region = backgroundSource.slice(
  backgroundSource.indexOf('const cssSafe ='),
  backgroundSource.indexOf('async function read()'),
)

/** The real `inline`, given only the names it takes from outside itself. */
function liftInline(fetchImpl: (href: string) => Promise<Fetched>): Inline {
  if (region === '' || !region.includes('async function inline(')) {
    throw new Error('inline() is not where this test expects it in extension/background.js')
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(
    'CAPTURE_MAX_ASSET_BYTES',
    'CAPTURE_SCHEMES',
    'fetch',
    `${region}; return inline`,
  )(CAPTURE_MAX_ASSET_BYTES, CAPTURE_SCHEMES, fetchImpl) as Inline
}

const sheet = (css: string): Fetched => ({
  ok: true,
  status: 200,
  text: () => Promise.resolve(css),
})

describe('a capture whose stylesheets keep naming new stylesheets', () => {
  it('ends, and says how much it left out', async () => {
    let fetches = 0
    /*
     * Every sheet imports two fresh ones, forever. This is the shape the loop
     * had no answer to — not a malicious page in particular, just one where the
     * queue grows faster than the loop drains it.
     *
     * The throw is a tripwire, not part of the fixture: without a cap this test
     * would otherwise hang the run rather than fail it.
     */
    const inline = liftInline((href) => {
      fetches += 1
      if (fetches > 5000) throw new Error('the asset loop never ended')
      return Promise.resolve(sheet(`@import "${href}/a.css"; @import "${href}/b.css";`))
    })

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style>',
      assets: [{ href: 'https://boards.example/s.css', kind: 'css' }],
    })

    // 500 fetched, and the 1001 the last of them had queued are counted as
    // dropped rather than fetched or silently forgotten.
    expect(fetches).toBe(500)
    expect(result.dropped).toBe(501)
    // The invariant this whole function exists for still holds: no token and no
    // live address survives into the archive.
    expect(result.html).not.toMatch(/__JOJO_ASSET_\d+__/)
    expect(result.html).not.toContain('https://boards.example')
  })

  it('still inlines an ordinary sheet, cap or no cap', async () => {
    const inline = liftInline(() => Promise.resolve(sheet('body { color: red }')))

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style>',
      assets: [{ href: 'https://boards.example/s.css', kind: 'css' }],
    })

    expect(result.html).toBe('<style>body { color: red }</style>')
    expect(result.dropped).toBe(0)
  })
})

describe('a stylesheet larger than the per-asset cap', () => {
  it('is dropped rather than inlined whole', async () => {
    // The blob branch has checked this since it was written; the css branch
    // reached its `continue` without ever meeting the check, so the one asset
    // kept as TEXT was the one with no ceiling.
    const huge = `/*${'a'.repeat(CAPTURE_MAX_ASSET_BYTES)}*/`
    const inline = liftInline(() => Promise.resolve(sheet(huge)))

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style>',
      assets: [{ href: 'https://boards.example/huge.css', kind: 'css' }],
    })

    expect(result.html).toBe('<style></style>')
    expect(result.dropped).toBe(1)
  })

  it('keeps one that is only just inside it', async () => {
    const big = 'a'.repeat(CAPTURE_MAX_ASSET_BYTES)
    const inline = liftInline(() => Promise.resolve(sheet(big)))

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style>',
      assets: [{ href: 'https://boards.example/big.css', kind: 'css' }],
    })

    expect(result.dropped).toBe(0)
    expect(result.html.length).toBe('<style></style>'.length + CAPTURE_MAX_ASSET_BYTES)
  })
})

/**
 * The same address twice, and the escape that was decided by iteration order.
 *
 * `serialise.js` mints a token per OCCURRENCE and de-duplicates nothing: two
 * identical `<link rel=stylesheet>` tags, or a `<link>` plus an `@import` of the
 * same sheet, are two tokens for one address. `inline()`'s `byHref` shortcut
 * gave the second token its value without ever recording it in `cssKeys`, so the
 * splice escaped the FIRST occurrence and wrote the second one raw.
 *
 * Executed before the fix: the stored capture carried
 * `</style><img alt="a > b" src=https://evil.example/beacon.png>` as a LIVE tag
 * — a beacon fired at the site the posting came from, every time the archive was
 * opened — and `remoteRefCount` returned 0 for the file.
 */
describe('a stylesheet reached through the de-duplication shortcut', () => {
  const hostile = '}</style><img alt="a > b" src=https://evil.example/beacon.png>'

  it('is escaped on every occurrence, not just the one that was fetched', async () => {
    let fetches = 0
    const inline = liftInline(() => {
      fetches += 1
      return Promise.resolve(sheet(hostile))
    })

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style><style>__JOJO_ASSET_1__</style>',
      assets: [
        { href: 'https://cdn.test/s.css', kind: 'css' },
        { href: 'https://cdn.test/s.css', kind: 'css' },
      ],
    })

    // Still one request — the de-duplication that motivated the shortcut (4.1 MB
    // of duplicate webfonts in a 9.3 MB Lever capture) is intact.
    expect(fetches).toBe(1)
    // And neither copy can leave the <style> it was spliced into. The address
    // is still in the file as inert CSS text — what matters is that no `<` of
    // the sheet's own survived to open a tag around it.
    const escaped = '}\\3c /style>\\3c img alt="a > b" src=https://evil.example/beacon.png>'
    expect(result.html).toBe(`<style>${escaped}</style><style>${escaped}</style>`)
  })

  it('does not hand a stylesheet’s TEXT to a token that wanted a data URI', async () => {
    // The kinds are not interchangeable: `css` resolves to text spliced as
    // markup-adjacent content, `css-asset` to a data URI spliced inside a
    // `url()`. Keyed by address alone, whichever kind was fetched first decided
    // the value for both.
    const inline = liftInline((href) =>
      Promise.resolve(
        href.endsWith('s.css')
          ? { ...sheet('body{}'), blob: () => Promise.resolve({ size: 4 }) }
          : sheet('body{}'),
      ),
    )

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style><style>.a{background:url("__JOJO_ASSET_1__")}</style>',
      assets: [
        { href: 'https://cdn.test/s.css', kind: 'css' },
        { href: 'https://cdn.test/s.css', kind: 'css-asset' },
      ],
    })

    // The second token is a blob the stub cannot read, so it empties rather than
    // inheriting the first token's stylesheet text.
    expect(result.html).toContain('<style>body{}</style>')
    expect(result.html).not.toContain('url("body{}")')
  })
})

/**
 * `image-set()` in a stylesheet the inliner fetched.
 *
 * Its URL can be a BARE STRING — no `url(`, no `@import`, no attribute name —
 * so both rewrites in the css branch walked past it and all of `remoteRefCount`
 * was blind to it. Executed before the fix: the address reached the stored
 * capture untouched and the scan called the file clean.
 */
describe('a fetched stylesheet that uses image-set', () => {
  it('tokenises the bare strings so they can be inlined', async () => {
    const fetched: string[] = []
    const inline = liftInline((href) => {
      fetched.push(href)
      return Promise.resolve(
        href.endsWith('s.css')
          ? sheet(
              '.a{background-image:image-set("https://cdn.test/x.png" 1x, "//cdn.test/x2.png" 2x)}',
            )
          : { ...sheet(''), blob: () => Promise.resolve({ size: 4 }) },
      )
    })

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style>',
      assets: [{ href: 'https://cdn.test/s.css', kind: 'css' }],
    })

    expect(fetched).toContain('https://cdn.test/x.png')
    expect(fetched).toContain('https://cdn.test/x2.png')
    expect(result.html).not.toContain('cdn.test/x.png')
    expect(result.html).not.toContain('cdn.test/x2.png')
  })

  it('leaves a type() option alone, which is a MIME type and not an address', async () => {
    const fetched: string[] = []
    const inline = liftInline((href) => {
      fetched.push(href)
      return Promise.resolve(sheet('.a{background:image-set(url("data:,") type("image/avif"))}'))
    })

    const result = await inline({
      html: '<style>__JOJO_ASSET_0__</style>',
      assets: [{ href: 'https://cdn.test/s.css', kind: 'css' }],
    })

    // One fetch: the stylesheet itself. Tokenising `"image/avif"` would have
    // resolved it against the sheet's URL and fetched a page that never existed.
    expect(fetched).toEqual(['https://cdn.test/s.css'])
    expect(result.html).toContain('type("image/avif")')
  })
})

/**
 * The sweep, and the `>` that used to end its anchor early.
 *
 * `>` is legal and unescaped inside an attribute value, so `<[^>]*?` stopped at
 * the first one and never reached the attributes after it. The scan in
 * `service/kg/core/capture.ts` carried the same spelling, so the two were blind
 * together — which is how a live address reached a stored capture with every
 * check reporting it clean.
 */
describe('the final sweep', () => {
  it('empties a remote src that hides behind a `>` in an earlier attribute', async () => {
    const inline = liftInline(() => Promise.resolve(sheet('')))
    const result = await inline({
      html: '<img alt="a > b" src=https://evil.example/beacon.png>',
      assets: [],
    })

    expect(result.html).toBe('<img alt="a > b" src="">')
    expect(result.dropped).toBe(1)
  })

  it('still leaves a posting that quotes markup in its own prose alone', async () => {
    const inline = liftInline(() => Promise.resolve(sheet('')))
    const prose = '<p>To embed it write &lt;img src="https://example.com/x.png"&gt;</p>'
    const result = await inline({ html: prose, assets: [] })

    expect(result.html).toBe(prose)
    expect(result.dropped).toBe(0)
  })
})

/**
 * The tokeniser, and the one place it must not mint a `css` token.
 *
 * `inline()` escapes a `css` token's value with `cssSafe`, which escapes `<`
 * ALONE — correct exactly while such a token sits inside a `<style>` element,
 * and useless anywhere else. `queueCssUrls` runs on inline `style` ATTRIBUTES
 * too, and an `@import` found there used to become a `css` token like any other,
 * so the fetched sheet was spliced into a quoted attribute value.
 *
 * Executed before the fix, with a sheet answering
 * `a{content:"x"}" onload="alert(1)" background="https://…`: the stored capture
 * read `<div style="a{content:"x"}" onload="alert(1)" background="…">` — the
 * attribute closed, an event handler written into the archive, and an address
 * the sweep only caught because it happened to carry no `>`.
 *
 * An `@import` in a style attribute is not a stylesheet at all — the CSS parser
 * honours `@import` only at the top of a style SHEET — so dropping it loses
 * nothing that a browser would have loaded, and it keeps `cssSafe`'s assumption
 * TRUE rather than widening the escape to mangle `"` in every real stylesheet.
 */
describe("the extension's CSS tokeniser", () => {
  /** `queueCssUrls`, given only the three names it takes from `serialise()`. */
  function liftQueueCssUrls() {
    const region = serialiseSource.slice(
      serialiseSource.indexOf('  function queueCssUrls('),
      serialiseSource.indexOf('  // ---- 0.'),
    )
    if (region === '' || !region.includes('function queueCssUrls(')) {
      throw new Error('queueCssUrls() is not where this test expects it in extension/serialise.js')
    }
    const assets: { href: string; kind: string }[] = []
    const absolute = (value: unknown) => {
      try {
        const url = new URL(String(value).trim(), 'https://board.test/jobs/1')
        return CAPTURE_SCHEMES.includes(url.protocol as (typeof CAPTURE_SCHEMES)[number])
          ? url.href
          : null
      } catch {
        return null
      }
    }
    const token = (href: string, kind: string) => {
      assets.push({ href, kind })
      return `__JOJO_ASSET_${String(assets.length - 1)}__`
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const run = new Function(
      'absolute',
      'token',
      `let dropped = 0; ${region}; return queueCssUrls`,
    )(absolute, token) as (css: string, inAttribute: boolean) => string
    return { run, assets }
  }

  it('drops an @import found in a style attribute rather than tokenising it', () => {
    const { run, assets } = liftQueueCssUrls()
    expect(run('@import "https://evil.test/s.css";', true)).toBe('')
    // Nothing queued means nothing fetched and nothing spliced: the value that
    // would have landed inside `style="…"` never exists.
    expect(assets).toEqual([])
  })

  it('still tokenises the same @import inside a <style> element', () => {
    const { run, assets } = liftQueueCssUrls()
    expect(run('@import "https://cdn.test/s.css";', false)).toBe('__JOJO_ASSET_0__')
    expect(assets).toEqual([{ href: 'https://cdn.test/s.css', kind: 'css' }])
  })

  it('tokenises an image-set bare string, which matches no url() pattern', () => {
    const { run, assets } = liftQueueCssUrls()
    const out = run('.a{background-image:image-set("https://cdn.test/x.png" 1x)}', false)
    // Rewritten to a `url()` so the inliner treats it as any other CSS asset.
    expect(out).toBe('.a{background-image:image-set(url("__JOJO_ASSET_0__") 1x)}')
    expect(assets).toEqual([{ href: 'https://cdn.test/x.png', kind: 'css-asset' }])
  })

  it('tokenises the vendor-prefixed and single-quoted spellings too', () => {
    const { run, assets } = liftQueueCssUrls()
    const out = run(".a{background:-webkit-image-set('https://cdn.test/x.png' 1x)}", false)
    expect(out).toBe('.a{background:-webkit-image-set(url("__JOJO_ASSET_0__") 1x)}')
    expect(assets).toHaveLength(1)
  })

  it('leaves an image-set option that is a MIME type rather than an address', () => {
    const { run, assets } = liftQueueCssUrls()
    const out = run('.a{background:image-set("https://cdn.test/x.avif" type("image/avif"))}', false)
    expect(out).toBe('.a{background:image-set(url("__JOJO_ASSET_0__") type("image/avif"))}')
    // One asset, and it is the image. `image/avif` resolved against the page URL
    // would have been a fetch of a path that never existed.
    expect(assets).toEqual([{ href: 'https://cdn.test/x.avif', kind: 'css-asset' }])
  })

  it('leaves an already-inlined image-set alone', () => {
    const { run, assets } = liftQueueCssUrls()
    const css = '.a{background:image-set("data:image/png;base64,AAAA" 1x)}'
    expect(run(css, false)).toBe(css)
    expect(assets).toEqual([])
  })
})
