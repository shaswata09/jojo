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
 */

import { describe, expect, it } from 'vitest'
import backgroundSource from '../../extension/background.js?raw'
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
