import { describe, expect, it, vi } from 'vitest'
import { CAPTURE_MAX_ASSETS } from '@jojo/service/core/capture'

/**
 * The phone's half of the inliner, executed.
 *
 * `capture-script.ts` walks the page inside the WebView and hands back
 * addresses; `inlineCapture` fetches them, splices the results into the markup
 * and puts the document past `readCapture`. It shares its SHAPE with
 * `web/extension/background.js` and, for a long time, shared only the shape:
 * three of the defences the extension grew after a leak were never carried
 * across, and every one of them was reachable here.
 *
 * `environment: 'node'` — nothing below needs a DOM. `react-native-blob-util` is
 * mocked because it is imported for the file-writing half of this module, which
 * these tests do not reach; `fetch` is stubbed because that is the network the
 * whole feature exists to keep a stored capture off.
 */

vi.mock('react-native-blob-util', () => ({
  default: { fs: { dirs: { DocumentDir: '/documents' } } },
}))

const { inlineCapture } = await import('./capture')

const NOW = '2026-01-01T00:00:00.000Z'

/** A response carrying stylesheet text, which is the only asset kind kept raw. */
const sheet = (css: string) =>
  ({ ok: true, status: 200, text: () => Promise.resolve(css) }) as unknown as Response

/** A response the blob path cannot read, so the asset drops rather than inlines. */
const opaque = () =>
  ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve({ size: 4 }),
  }) as unknown as Response

async function capture(html: string, assets: { href: string; kind: string }[]) {
  return await inlineCapture(
    { type: 'jojo:capture', url: 'https://acme.test/jobs/1', title: 'A job', html, assets },
    NOW,
  )
}

/**
 * The splice, and what a remote server can put through it.
 *
 * A `<link rel=stylesheet>` becomes a `<style>` holding a token, and the token's
 * value is whatever the CDN returned. A sheet ending
 * `}</style><img src=…>` closes the block and writes a live tag into the stored
 * capture. The extension has escaped this since it was found; the phone, running
 * the identical splice on the identical bytes, never got the escape.
 *
 * Reproduced before the fix: `ok: true`, with
 * `<img alt="a > b" src=https://evil.example/beacon.png>` in the stored file and
 * `remoteRefCount` reporting it clean — the `>` in the first attribute blinded
 * the sweep and the scan together.
 */
describe('a stylesheet that tries to close the <style> it is spliced into', () => {
  it('cannot, on any occurrence of the address', async () => {
    let fetches = 0
    vi.stubGlobal('fetch', () => {
      fetches += 1
      return Promise.resolve(sheet('}</style><img alt="a > b" src=https://evil.example/b.png>'))
    })

    const out = await capture('<style>__JOJO_ASSET_0__</style><style>__JOJO_ASSET_1__</style>', [
      { href: 'https://cdn.test/s.css', kind: 'css' },
      { href: 'https://cdn.test/s.css', kind: 'css' },
    ])

    expect(out.ok).toBe(true)
    if (!out.ok) return
    // The escape is `\3c ` — the CSS hex escape for `<`, trailing space and all,
    // which the CSS parser consumes and the HTML tokeniser never reads as a tag.
    const escaped = '}\\3c /style>\\3c img alt="a > b" src=https://evil.example/b.png>'
    expect(out.capture.html).toBe(`<style>${escaped}</style><style>${escaped}</style>`)
    // One request: the de-duplication the escape had to be threaded through is
    // still doing its job. It was the SHORTCUT that skipped the escape.
    expect(fetches).toBe(1)
  })

  it('does not hand a stylesheet’s text to a token that asked for a data URI', async () => {
    // `css` resolves to text spliced as markup-adjacent content and `css-asset`
    // to a data URI spliced inside a `url()`. Cached by address alone, whichever
    // kind was fetched first decided the value for both.
    vi.stubGlobal('fetch', (href: string) =>
      Promise.resolve(href.endsWith('s.css') ? sheet('body{}') : opaque()),
    )

    const out = await capture(
      '<style>__JOJO_ASSET_0__</style><style>.a{background:url("__JOJO_ASSET_1__")}</style>',
      [
        { href: 'https://cdn.test/s.css', kind: 'css' },
        { href: 'https://cdn.test/s.css', kind: 'css-asset' },
      ],
    )

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.capture.html).toContain('<style>body{}</style>')
    expect(out.capture.html).not.toContain('url("body{}")')
  })
})

/**
 * The loop that the page being captured could grow forever.
 *
 * A fetched stylesheet's `@import`s are queued onto the list this loop is
 * walking, and the per-address cache only collapses repeats — so a page whose
 * sheets import two FRESH ones apiece has no end. Measured here before the cap:
 * 6001 requests from one asset, and it stopped only because the harness had
 * started failing them. On a phone that is the Save button on 'Keeping…'
 * forever, over the user's own data.
 */
describe('a capture whose stylesheets keep naming new stylesheets', () => {
  it('ends, and says how much it left out', async () => {
    let fetches = 0
    vi.stubGlobal('fetch', (href: string) => {
      fetches += 1
      // A tripwire, not part of the fixture: without a cap this would hang the
      // run rather than fail it.
      if (fetches > CAPTURE_MAX_ASSETS * 4) throw new Error('the asset loop never ended')
      return Promise.resolve(sheet(`@import "${href}/a.css"; @import "${href}/b.css";`))
    })

    const out = await capture('<style>__JOJO_ASSET_0__</style>', [
      { href: 'https://cdn.test/s.css', kind: 'css' },
    ])

    expect(fetches).toBe(CAPTURE_MAX_ASSETS)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // Counted rather than silently truncated, and the tokens past the cap are
    // emptied by the sweep exactly as a failed fetch's are.
    expect(out.capture.dropped).toBe(CAPTURE_MAX_ASSETS + 1)
    expect(out.capture.html).not.toMatch(/__JOJO_ASSET_\d+__/)
    expect(out.capture.html).not.toContain('cdn.test')
  })

  it('still inlines an ordinary sheet, cap or no cap', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(sheet('body { color: red }')))
    const out = await capture('<style>__JOJO_ASSET_0__</style>', [
      { href: 'https://cdn.test/s.css', kind: 'css' },
    ])

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.capture.html).toBe('<style>body { color: red }</style>')
    expect(out.capture.dropped).toBe(0)
  })
})

/**
 * `image-set()` in a stylesheet the phone fetched.
 *
 * Its URL can be a bare STRING — no `url(`, no `@import`, no attribute name — so
 * both rewrites in the css branch walked past it and every pattern in
 * `remoteRefCount` was blind to it. The address reached the stored capture and
 * the scan called the file clean.
 */
describe('a fetched stylesheet that uses image-set', () => {
  it('tokenises the bare strings so they can be inlined', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', (href: string) => {
      fetched.push(href)
      return Promise.resolve(
        href.endsWith('s.css')
          ? sheet('.a{background-image:image-set("https://cdn.test/x.png" 1x, "//cdn.test/y.png" 2x)}')
          : opaque(),
      )
    })

    const out = await capture('<style>__JOJO_ASSET_0__</style>', [
      { href: 'https://cdn.test/s.css', kind: 'css' },
    ])

    expect(fetched).toContain('https://cdn.test/x.png')
    expect(fetched).toContain('https://cdn.test/y.png')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.capture.html).not.toContain('cdn.test/x.png')
    expect(out.capture.html).not.toContain('cdn.test/y.png')
  })

  it('leaves a type() option alone, which is a MIME type and not an address', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', (href: string) => {
      fetched.push(href)
      return Promise.resolve(sheet('.a{background:image-set(url("data:,") type("image/avif"))}'))
    })

    const out = await capture('<style>__JOJO_ASSET_0__</style>', [
      { href: 'https://cdn.test/s.css', kind: 'css' },
    ])

    expect(fetched).toEqual(['https://cdn.test/s.css'])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.capture.html).toContain('type("image/avif")')
  })
})

/**
 * The sweep, and the `>` that used to end its anchor early.
 *
 * `>` is legal and unescaped inside an attribute value — the HTML serialiser
 * escapes `&`, nbsp and `"` there and leaves `>` alone — so `<[^>]*?` stopped at
 * the first one and never reached the attributes after it. `remoteRefCount`
 * carried the same spelling, so the sweep and the scan were blind together.
 */
describe('the final sweep', () => {
  it('empties a remote src that hides behind a `>` in an earlier attribute', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no asset should be fetched')))
    const out = await capture('<img alt="a > b" src=https://evil.example/beacon.png>', [])

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.capture.html).toBe('<img alt="a > b" src="">')
    expect(out.capture.dropped).toBe(1)
  })

  it('still leaves a posting that quotes markup in its own prose alone', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no asset should be fetched')))
    const prose = '<p>To embed it write &lt;img src="https://example.com/x.png"&gt;</p>'
    const out = await capture(prose, [])

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.capture.html).toBe(prose)
    expect(out.capture.dropped).toBe(0)
  })
})
