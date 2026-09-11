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
 * transcription of a guard is not the guard. `?raw` and `new Function` are its
 * precedent; `chrome` and the helpers the function calls are injected, and
 * `hostOf`, `byteLength` and `looksLikeSignIn` are lifted out of the same file
 * so the ones under test are the real ones.
 */
import { describe, expect, it } from 'vitest'
import backgroundSource from '../../extension/background.js?raw'
// @ts-expect-error — a plain ES module the worker loads from disk, with no types
// of its own; `capture-shrink.test.ts` imports it the same way. It is handed to
// the lifted worker untyped, which is how the worker itself receives it.
import { shrinkToFit } from '../../extension/shrink.js'

/** A declaration out of `background.js`, to the end of its body. */
function lift(name: string): string {
  const at = backgroundSource.search(new RegExp(`(?:async )?function ${name}\\(`))
  if (at === -1) throw new Error(`${name} is not in extension/background.js any more`)
  let depth = 0
  for (let i = backgroundSource.indexOf('{', at); i < backgroundSource.length; i += 1) {
    const c = backgroundSource[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return backgroundSource.slice(at, i + 1)
    }
  }
  throw new Error(`could not find the end of ${name}`)
}

const SIGN_IN = /^const SIGN_IN = .*$/m.exec(backgroundSource)?.[0]
if (SIGN_IN === undefined) throw new Error('SIGN_IN is not in extension/background.js any more')

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

// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const build = new Function(
  'chrome',
  'waitForLoad',
  'sleep',
  'SETTLE_MS',
  'serialise',
  'POLICY',
  'inline',
  'CAPTURE_MAX_BYTES',
  'shrinkToFit',
  [SIGN_IN, lift('hostOf'), lift('byteLength'), lift('looksLikeSignIn'), lift('capturePage')].join(
    '\n',
  ) + '\nreturn { capturePage, looksLikeSignIn }',
) as (...deps: unknown[]) => {
  capturePage: (url: string) => Promise<Result>
  looksLikeSignIn: (requested: string, landed: string) => boolean
}

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
}: { landed?: string; loads?: boolean; throws?: string; inlined?: string } = {}) {
  const created: { url: string; active: boolean }[] = []
  const removed: number[] = []
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
        return [{ result: served }]
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
  const { capturePage, looksLikeSignIn } = build(
    chrome,
    async () => loads,
    async () => undefined,
    0,
    () => undefined,
    {},
    async (page: { dropped: number }) => ({ html: inlined, dropped: page.dropped + 2 }),
    8 * 1024 * 1024,
    shrinkToFit,
  )
  return { capturePage, looksLikeSignIn, created, removed, stored: () => stored }
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
      expect(lift(name), `${name} no longer calls shrinkToFit`).toContain(
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
  const { looksLikeSignIn } = worker()

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
