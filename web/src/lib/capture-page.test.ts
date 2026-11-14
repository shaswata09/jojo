/**
 * The extension's capture-by-address, executed out of the file the browser loads.
 *
 * "From link" asks the worker to open a posting nobody is looking at, render it
 * and hand the page back. Three promises in that sentence are worth a test,
 * because each fails silently: the tab it opened is closed whatever happens (a
 * background feature that leaves tabs behind reads as malware), a sign-in wall
 * is refused rather than filed as the posting, and the page is NOT queued —
 * the app files it, so a queued copy would be filed a second time the next
 * time the inbox drained.
 *
 * Run rather than re-described, for the reason `reader-relay.test.ts` gives: a
 * transcription of a guard is not the guard. The worker's own modules are
 * imported; `chrome` is a fake, and the two seams a test cannot wait on — the
 * tab's load and settle (`worker/tabs.js`) and the asset loop with its nonce
 * (`worker/inline.js`) — are mocked, so everything else under test is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error — a plain ES module the worker loads from disk, with no types.
import { CAPTURE_PAGE_INLINE_BY_MS, capturePage } from '../../extension/worker/capture.js'
// @ts-expect-error — as above.
import { isLocalTarget, looksLikeSignIn } from '../../extension/worker/targets.js'
// @ts-expect-error — as above.
import { scanBoard } from '../../extension/worker/scan-board.js'
// @ts-expect-error — as above.
import { onCaptureUrl, onScanBoard } from '../../extension/worker/page-verbs.js'
// @ts-expect-error — as above.
import { PAGE_VERBS } from '../../extension/worker/messages.js'
// @ts-expect-error — as above.
import { expandListing } from '../../extension/harvest.js'
import captureSource from '../../extension/worker/capture.js?raw'
import pageVerbsSource from '../../extension/worker/page-verbs.js?raw'
import bridgeCallerSource from './capture-bridge.ts?raw'

/** What the mocked seams answer, set per worker. */
const seams = vi.hoisted(() => ({
  loads: true,
  inline: (async () => ({ html: '', dropped: 0 })) as (...args: unknown[]) => Promise<unknown>,
}))

vi.mock('../../extension/worker/tabs.js', () => ({
  SETTLE_MS: 0,
  sleep: async () => undefined,
  waitForLoad: async () => seams.loads,
}))

vi.mock('../../extension/worker/inline.js', () => ({
  captureNonce: () => 'feedfacefeedfacefeedface',
  inline: (...args: unknown[]) => seams.inline(...args),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A function declaration out of a module's source, to the end of its body. */
function lift(source: string, name: string): string {
  const at = source.search(new RegExp(`(?:async )?function ${name}\\(`))
  if (at === -1) throw new Error(`${name} is not in that module any more`)
  let depth = 0
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    const c = source[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  throw new Error(`could not find the end of ${name}`)
}

/** The cap `policy.js` sets, which the harness hands the worker. */
const CAP = 8 * 1024 * 1024

type Page = {
  url: string
  title: string
  html: string
  capturedAt: string
  dropped: number
  shadowRoots: number
}
type Result = { ok: true; capture: Page } | { ok: false; reason: string }

/** A `const NAME = <number>` out of a source file, as the number. */
function numberIn(source: string, name: string): number {
  const match = new RegExp(`const ${name} = ([\\d_]+)`).exec(source)
  if (match === null) throw new Error(`${name} is not a numeric constant any more`)
  return Number(match[1]!.replace(/_/g, ''))
}

const INLINE_BY = CAPTURE_PAGE_INLINE_BY_MS as number

const served = {
  url: 'https://job-boards.greenhouse.io/acme/jobs/4',
  title: 'Research Engineer — Acme',
  html: '<html><body><h1>Research Engineer</h1></body></html>',
  capturedAt: '2026-09-11T10:00:00.000Z',
  dropped: 0,
  shadowRoots: 1,
  assets: [],
}

/** A worker around one tab, recording what it was asked to do. */
function worker({
  landed = served.url,
  loads = true,
  throws,
  inlined = served.html,
  readAt = served.url,
}: { landed?: string; loads?: boolean; throws?: string; inlined?: string; readAt?: string } = {}) {
  const created: { url: string; active: boolean }[] = []
  const removed: number[] = []
  /** What `inline` was handed, and whether the tab was already gone when it ran. */
  const inlinedWith: { nonce: unknown; deadline: unknown; tabOpen: boolean }[] = []
  let stored = 0
  const chrome = {
    tabs: {
      create: async (options: { url: string; active: boolean }) => {
        created.push(options)
        return { id: 7 }
      },
      get: async () => ({ id: 7, url: landed, status: 'complete' }),
      remove: async (id: number) => {
        removed.push(id)
      },
    },
    scripting: {
      executeScript: async () => {
        if (throws !== undefined) throw new Error(throws)
        return [{ result: { ...served, url: readAt } }]
      },
    },
    storage: {
      local: {
        set: async () => {
          stored += 1
        },
        get: async () => ({}),
      },
    },
    action: { setBadgeText: async () => undefined, setTitle: async () => undefined },
  }
  seams.loads = loads
  seams.inline = async (...args: unknown[]) => {
    const [page, nonce, deadline] = args as [{ dropped: number }, unknown, unknown]
    inlinedWith.push({ nonce, deadline, tabOpen: !removed.includes(7) })
    return { html: inlined, dropped: page.dropped + 2 }
  }
  /** The real `capturePage`, run against this worker's `chrome`. */
  const run = (url: string): Promise<Result> => {
    vi.stubGlobal('chrome', chrome)
    return (capturePage as (url: string) => Promise<Result>)(url)
  }
  return { capturePage: run, created, removed, inlinedWith, stored: () => stored }
}

describe('capturing a posting by its address', () => {
  it('opens it in the background and hands the whole page back', async () => {
    const w = worker()
    const out = await w.capturePage(served.url)
    expect(out).toEqual({
      ok: true,
      capture: {
        url: served.url,
        title: served.title,
        html: served.html,
        capturedAt: served.capturedAt,
        // The inliner's count, not the serialiser's: what was actually lost.
        dropped: 2,
        shadowRoots: 1,
      },
    })
    expect(w.created).toEqual([{ url: served.url, active: false }])
  })

  it('does not queue it: the app files it, and a queued copy would be filed twice', async () => {
    const w = worker()
    await w.capturePage(served.url)
    expect(w.stored()).toBe(0)
  })

  it('closes the tab it opened, whether the capture worked or not', async () => {
    for (const options of [
      {},
      { throws: 'Cannot access contents of the page' },
      { loads: false },
    ]) {
      const w = worker(options)
      await w.capturePage(served.url)
      expect(w.removed).toEqual([7])
    }
  })

  it('says why when the page throws, and when it never finishes loading', async () => {
    await expect(worker({ throws: 'Frame was removed' }).capturePage(served.url)).resolves.toEqual({
      ok: false,
      reason: 'Frame was removed',
    })
    await expect(worker({ loads: false }).capturePage(served.url)).resolves.toEqual({
      ok: false,
      reason: 'That page took too long to load.',
    })
  })

  it('refuses a sign-in wall rather than saving it as the posting', async () => {
    const w = worker({ landed: 'https://www.linkedin.com/authwall?trk=job' })
    const out = await w.capturePage('https://www.linkedin.com/jobs/view/4012/')
    expect(out).toMatchObject({ ok: false })
    expect(out.ok === false && out.reason).toContain('to sign in')
  })

  it('follows a careers page to the board that hosts its listing', async () => {
    const w = worker({ landed: 'https://job-boards.greenhouse.io/acme/jobs/4' })
    await expect(w.capturePage('https://careers.acme.com/jobs/4')).resolves.toMatchObject({
      ok: true,
    })
  })

  it('keeps a page over the cap by leaving out its heaviest fonts — the HigherEdJobs case', async () => {
    /*
     * Measured 2026-09-11 on a HigherEdJobs posting: 56 KB of HTML and about
     * 9,700 characters of text, inlined to ~8.8 MB because its stylesheets pull
     * in 32 Font Awesome files — both the .ttf and the .woff2 of every face, 7.4
     * MB as base64. "+ From link" refused it outright ("That page is too big to
     * keep.") while the Capture button, which already shrank, would have kept it.
     */
    const font = (n: number) => `data:font/ttf;base64,${'A'.repeat(1_700_000)}${String(n)}`
    const faces = [1, 2, 3, 4, 5].map(
      (n) => `@font-face{font-family:f${String(n)};src:url("${font(n)}")}`,
    )
    const heavy = `<html><head><style>${faces.join('')}</style></head><body><h1>Assistant Professor</h1></body></html>`
    expect(heavy.length).toBeGreaterThan(CAP)
    const out = await worker({ inlined: heavy }).capturePage(served.url)
    if (!out.ok) throw new Error(`refused: ${out.reason}`)
    expect(out.capture.html.length).toBeLessThanOrEqual(CAP)
    // The posting is untouched; a left-out font is an empty value, as a failed fetch is.
    expect(out.capture.html).toContain('<h1>Assistant Professor</h1>')
    expect(out.capture.html).toContain('url("")')
    // The inliner's two, plus the one font left out — reported, never hidden.
    expect(out.capture.dropped).toBe(3)
  })

  it('refuses only a page that cannot fit with every embedded asset gone, in the Capture button’s words', async () => {
    const text = `<html><body>${'x'.repeat(CAP + 1)}</body></html>`
    await expect(worker({ inlined: text }).capturePage(served.url)).resolves.toEqual({
      ok: false,
      reason:
        'That page is too big to keep, even with its images and fonts left out — the limit is 8 MB.',
    })
  })

  it('shares the one shrinker with the Capture button, so the two cannot drift apart again', () => {
    // They did once: capture() learned to shrink and capturePage() kept the old
    // all-or-nothing refusal, so the same page was kept by one button and
    // refused by the other.
    for (const name of ['capture', 'capturePage']) {
      expect(lift(captureSource, name), `${name} no longer calls shrinkToFit`).toContain(
        'shrinkToFit(html, CAPTURE_MAX_BYTES)',
      )
    }
  })

  it('keeps a page of exactly the cap — the boundary `readCapture` uses too', async () => {
    // The worker and the app's gate must draw the line in the same place: a
    // page the worker kept and the app then refused would be read, paid for,
    // and thrown away at the last step.
    const full = 'x'.repeat(8 * 1024 * 1024)
    await expect(worker({ inlined: full }).capturePage(served.url)).resolves.toMatchObject({
      ok: true,
    })
    const { readCapture, CAPTURE_MAX_BYTES } = await import('@jojo/service/core/capture')
    expect(full.length).toBe(CAPTURE_MAX_BYTES)
    expect(
      typeof readCapture({ url: served.url, title: '', html: full, capturedAt: served.capturedAt }),
    ).toBe('object')
  })
})

describe('what counts as a sign-in wall', () => {
  it('is a page it was SENT to, never the address asked for', () => {
    // A posting whose own path says "login" is still the posting.
    expect(
      looksLikeSignIn(
        'https://acme.test/jobs/login-engineer',
        'https://acme.test/jobs/login-engineer',
      ),
    ).toBe(false)
  })

  it('knows the walls the boards people paste actually put up', () => {
    const asked = 'https://www.linkedin.com/jobs/view/4012/'
    for (const wall of [
      'https://www.linkedin.com/authwall?trk=job',
      'https://www.linkedin.com/login?session_redirect=x',
      'https://accounts.google.com/v3/signin/identifier',
      'https://acme.wd5.myworkdayjobs.com/en-US/careers/login',
      'https://sso.acme.com/saml',
      'https://www.linkedin.com/checkpoint/challenge',
    ]) {
      expect(looksLikeSignIn(asked, wall), wall).toBe(true)
    }
  })

  it('lets an ordinary redirect through, including one to a word that merely contains "auth"', () => {
    const asked = 'https://careers.acme.com/jobs/4'
    for (const fine of [
      'https://job-boards.greenhouse.io/acme/jobs/4',
      'https://jobs.lever.co/acme/5f1c2e2a-1111-4222-8333-944455556666',
      'https://careers.acme.com/jobs/authentication-engineer',
      'https://careers.acme.com/en/jobs/4',
    ]) {
      expect(looksLikeSignIn(asked, fine), fine).toBe(false)
    }
  })
})

describe('the tab and the clock', () => {
  it('closes the tab before inlining, not after it', async () => {
    // Inlining can take a minute; the tab sat open in the person's window,
    // signed in and running the site's scripts, for all of it.
    const w = worker()
    await w.capturePage(served.url)
    expect(w.inlinedWith).toHaveLength(1)
    expect(w.inlinedWith[0]!.tabOpen).toBe(false)
    // Once: the `finally` does not close it a second time.
    expect(w.removed).toEqual([7])
  })

  it('hands the serialiser’s nonce and a deadline to the inliner', async () => {
    const w = worker()
    const before = Date.now()
    await w.capturePage(served.url)
    const { nonce, deadline } = w.inlinedWith[0]!
    expect(nonce).toBe('feedfacefeedfacefeedface')
    expect(deadline).toBeGreaterThanOrEqual(before + INLINE_BY)
    expect(deadline).toBeLessThanOrEqual(Date.now() + INLINE_BY)
  })

  it('stops inlining well inside the page’s own budget', () => {
    /*
     * The race has to go the worker's way: a capture finished after the page
     * gave up is posted into a closed channel and nothing is kept — measured on
     * AcademicCareers. After the deadline come only `shrinkToFit` and one
     * message back, so fifteen seconds of margin is generous rather than tight.
     */
    expect(INLINE_BY + 15000).toBeLessThanOrEqual(numberIn(bridgeCallerSource, 'CAPTURE_TIMEOUT_MS'))
  })
})

describe('where "From link" and the scan will not go', () => {
  it('refuses this machine and the person’s own network, in every spelling URL normalises', () => {
    for (const url of [
      'http://localhost:3000/',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://10.0.0.5/admin',
      'http://0xa.0.0.5/',
      'http://172.16.0.1/',
      'https://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:10.0.0.1]/',
      'http://nas.local/',
      'http://router.lan/',
      'not a url',
      // Round 2: a trailing dot, carrier-grade NAT / Tailscale, single-label
      // intranet names, and the numeric spellings URL folds.
      'http://localhost./',
      'http://LOCALHOST.:8080/',
      'http://app.localhost./',
      'http://nas.local./',
      'http://100.64.0.1/',
      'http://100.127.255.254/',
      'http://router/',
      'http://router./',
      'http://intranet:8080/jobs',
      'http://0x7f.1/',
      'http://0177.0.0.1/',
      'http://017700000001/',
      'http://127.0.0.1./',
    ]) {
      expect(isLocalTarget(url), url).toBe(true)
    }
  })

  it('lets every public board through', () => {
    for (const url of [
      'https://www.linkedin.com/jobs/view/4012/',
      'https://job-boards.greenhouse.io/acme/jobs/4',
      'https://172.15.0.1/',
      'https://192.169.0.1/',
      'https://100.63.255.255/',
      'https://100.128.0.1/',
      'https://www.linkedin.com./jobs/view/4012/',
      'https://academiccareers.com/job/183456/x/',
    ]) {
      expect(isLocalTarget(url), url).toBe(false)
    }
  })

  it('refuses a public address that redirects onto the network', async () => {
    const w = worker({ landed: 'http://192.168.1.1/' })
    const out = await w.capturePage(served.url)
    expect(out).toMatchObject({ ok: false })
    expect(w.inlinedWith).toHaveLength(0)
  })

  it('refuses a page that moved onto the network after the tab was checked', async () => {
    const w = worker({ readAt: 'http://192.168.1.1/admin' })
    const out = await w.capturePage(served.url)
    expect(out).toMatchObject({ ok: false })
    expect(w.inlinedWith).toHaveLength(0)
  })

  it('is checked by both verbs before a tab opens', () => {
    for (const [verb, handler, name] of [
      ['jojo:scan-board', onScanBoard, 'onScanBoard'],
      ['jojo:capture-url', onCaptureUrl, 'onCaptureUrl'],
    ] as const) {
      // The verb is answered by this handler, and the handler checks first.
      expect(PAGE_VERBS.get(verb), verb).toBe(handler)
      const body = lift(pageVerbsSource, name)
      expect(body.indexOf('isLocalTarget(url)'), verb).toBeGreaterThan(-1)
      expect(body.indexOf('isLocalTarget(url)'), verb).toBeLessThan(body.search(/await (scanBoard|capturePage)\(/))
    }
  })
})

/**
 * "Load more" can navigate. A link dressed as a button, or a button inside a
 * form, moves the tab — and the harvest read whatever page it reached, with
 * every check already behind it. The worker now asks where the tab is AFTER
 * pressing, and the presser skips anything that would submit a form.
 */
describe('a scan whose "Load more" navigates the tab', () => {
  function scanner(urls: string[]) {
    let gets = 0
    const ran: string[] = []
    const chrome = {
      tabs: {
        create: async () => ({ id: 9 }),
        get: async () => ({ id: 9, url: urls[Math.min(gets++, urls.length - 1)], status: 'complete' }),
        remove: async () => undefined,
      },
      scripting: {
        executeScript: async ({ func }: { func: unknown }) => {
          ran.push(func === expandListing ? 'expand' : 'harvest')
          return [{ result: [] }]
        },
      },
    }
    seams.loads = true
    /** The real `scanBoard`, run against this scanner's `chrome`. */
    const scan = (url: string) => {
      vi.stubGlobal('chrome', chrome)
      return (scanBoard as (url: string) => Promise<{ ok: boolean; reason?: string; landed?: string }>)(url)
    }
    return { scan, ran }
  }

  const board = 'https://careercenter.cra.org/jobs/'

  it('refuses when pressing landed on a sign-in page, and harvests nothing', async () => {
    const { scan, ran } = scanner([board, 'https://careercenter.cra.org/login?next=/jobs'])
    const out = await scan(board)
    expect(out.ok).toBe(false)
    expect(ran).toEqual(['expand'])
  })

  it('refuses when pressing left the site', async () => {
    const { scan, ran } = scanner([board, 'https://elsewhere.example/'])
    expect((await scan(board)).ok).toBe(false)
    expect(ran).toEqual(['expand'])
  })

  it('refuses when the board navigated onto the network while it was being read', async () => {
    const { scan, ran } = scanner([board, board, 'http://192.168.1.1/'])
    expect((await scan(board)).ok).toBe(false)
    expect(ran).toEqual(['expand', 'harvest'])
  })

  it('reads the board, and says where, when pressing stayed put', async () => {
    const { scan, ran } = scanner([board, board])
    await expect(scan(board)).resolves.toMatchObject({ ok: true, landed: board })
    expect(ran).toEqual(['expand', 'harvest'])
  })
})

describe('the "Load more" presser', () => {
  it('skips a submit button and anything inside a form', async () => {
    const harvestSource = (await import('../../extension/harvest.js?raw')).default
    const finder = harvestSource.slice(harvestSource.indexOf('const findMore'), harvestSource.indexOf('const links ='))
    expect(finder).toMatch(/type'\) \|\| ''\)\.toLowerCase\(\) === 'submit'/)
    expect(finder).toContain("el.closest('form')")
  })
})
