/**
 * The extension's board scan, against a fake `chrome`: what it refuses before
 * a tab is opened, and what it does when the page is a bot check.
 *
 * Every case here ends before the scan's settle wait, so none of them sleeps.
 * The rules themselves are pinned in `service/kg/core/robots.test.ts` and the
 * transcription in `extension-crawl-rules.test.ts`; this is the wiring — that
 * the worker actually asks them, in the right order, before the right step.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

type Store = Record<string, unknown>

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function boot(
  options: { robots?: string | null; signals?: unknown; store?: Store; landAt?: string } = {},
) {
  const store: Store = { ...options.store }
  const opened: string[] = []
  const fetched: string[] = []
  const chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (values: Store) => {
          Object.assign(store, structuredClone(values))
        },
      },
    },
    tabs: {
      create: async ({ url }: { url: string }) => {
        opened.push(url)
        return { id: 7 }
      },
      get: async () => ({ status: 'complete', url: options.landAt ?? opened.at(-1) }),
      remove: async () => undefined,
      onUpdated: { addListener: () => undefined, removeListener: () => undefined },
    },
    scripting: {
      executeScript: async ({ func }: { func: { name: string } }) => {
        // A capture's serialiser is where these tests stop: past every check.
        if (func.name === 'serialise') throw new Error('serialised')
        return func.name === 'pageSignals' ? [{ result: options.signals ?? null }] : [{ result: [] }]
      },
    },
  }
  vi.stubGlobal('chrome', chrome)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      if (options.robots === null) throw new Error('unreachable')
      return { ok: options.robots !== undefined, status: options.robots === undefined ? 404 : 200, text: async () => options.robots ?? '' }
    }),
  )
  vi.resetModules()
  // @ts-expect-error — a plain ES module the worker loads from disk, with no types.
  const mod = await import('../../extension/worker/scan-board.js')
  // @ts-expect-error — as above.
  const capture = await import('../../extension/worker/capture.js')
  // @ts-expect-error — as above.
  const verbs = await import('../../extension/worker/page-verbs.js')
  return {
    scanBoard: mod.scanBoard as (url: string) => Promise<{ ok: boolean; reason?: string }>,
    capturePage: capture.capturePage as (
      url: string,
      options?: { unattended?: boolean },
    ) => Promise<{ ok: boolean; reason?: string }>,
    onCaptureUrl: verbs.onCaptureUrl as (
      message: Record<string, unknown>,
      reply: (out: { ok: boolean; reason?: string }) => void,
    ) => Promise<void>,
    mod,
    store,
    opened,
    fetched,
  }
}

/** Runs a read that waits out the worker's settle, on a fake clock. */
async function past<T>(read: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(30000)
  return read
}

describe('what a board scan refuses before opening a tab', () => {
  it('a site whose terms forbid automated reading, without even asking its robots.txt', async () => {
    const { scanBoard, opened, fetched } = await boot()
    const out = await scanBoard('https://www.linkedin.com/jobs/search/?keywords=ml')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('does not allow automated reading')
    expect(opened).toEqual([])
    expect(fetched).toEqual([])
  })

  it('an address the site’s robots.txt disallows', async () => {
    const { scanBoard, opened, fetched } = await boot({
      robots: 'User-agent: *\nDisallow: /search/\nDisallow: /search?*\nDisallow: /jobtype/*\n',
    })
    const out = await scanBoard('https://careercenter.cra.org/search?keywords=faculty')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('robots.txt')
    expect(opened).toEqual([])
    // Without the person's cookies, and from the site's root.
    expect(fetched).toEqual(['https://careercenter.cra.org/robots.txt'])
  })

  it('a host whose pages for today are spent', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const { scanBoard, mod, opened } = await boot({
      store: { 'jojo.boardPace': { 'a.test': { last: 0, day, pages: 100 } } },
    })
    expect(mod.PACE_BOOK).toBe('jojo.boardPace')
    const out = await scanBoard('https://a.test/jobs')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('100 pages of a.test today')
    expect(opened).toEqual([])
  })

  it('a host that asks for a longer gap than one scan can wait', async () => {
    const { scanBoard, opened } = await boot({
      robots: 'User-agent: *\nCrawl-delay: 60\n',
      store: { 'jojo.boardPace': { 'a.test': { last: Date.now(), day: new Date().toISOString().slice(0, 10), pages: 1 } } },
    })
    const out = await scanBoard('https://a.test/jobs?page=2')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('wait 60 seconds between pages')
    expect(opened).toEqual([])
  })
})

describe('a board that answers with a bot check', () => {
  it('is closed at once and reported, before the tab can settle past it', async () => {
    const { scanBoard, opened, store } = await boot({
      signals: { title: 'Just a moment...', html: '<div id="challenge-form"></div>', links: 0 },
    })
    const out = await scanBoard('https://a.test/jobs')
    expect(out).toEqual({ ok: false, reason: 'This board is asking for a human check; open it yourself.' })
    expect(opened).toEqual(['https://a.test/jobs'])
    // The page load still counts against the host's pace and budget.
    expect((store['jojo.boardPace'] as Record<string, { pages: number }>)['a.test']?.pages).toBe(1)
  })

  it('a missing or unreachable robots.txt is no reason to refuse', async () => {
    const { scanBoard, opened } = await boot({
      robots: null,
      signals: { title: 'Just a moment...' },
    })
    await scanBoard('https://b.test/jobs')
    expect(opened).toEqual(['https://b.test/jobs'])
  })
})

/*
 * The scout's background reader opens each posting a board listed, in a tab,
 * with nobody watching. Until this it went through "From link"'s capture with
 * none of a scan's manners: no robots.txt, no pace, no daily budget, no stop
 * at a bot check, and a listed link that redirected onto LinkedIn was read.
 */
describe('a posting the background reader opens', () => {
  it('is never opened on a site whose terms forbid automated reading', async () => {
    const { capturePage, opened, fetched } = await boot()
    const out = await capturePage('https://uk.indeed.com/viewjob?jk=1', { unattended: true })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('indeed.com does not allow automated reading')
    expect(opened).toEqual([])
    expect(fetched).toEqual([])
  })

  it('asks robots.txt, and keeps the one daily book a scan keeps', async () => {
    const disallowed = await boot({ robots: 'User-agent: *\nDisallow: /ads/\n' })
    const refused = await disallowed.capturePage('https://cra.test/ads/4411', { unattended: true })
    expect(refused.reason).toContain('robots.txt')
    expect(disallowed.opened).toEqual([])

    const day = new Date().toISOString().slice(0, 10)
    const spent = await boot({ store: { 'jojo.boardPace': { 'a.test': { last: 0, day, pages: 100 } } } })
    const out = await spent.capturePage('https://a.test/jobs/1', { unattended: true })
    expect(out.reason).toContain('100 pages of a.test today')
    expect(spent.opened).toEqual([])
  })

  it('stops at a bot check before the settle, and the load still counts', async () => {
    const { capturePage, opened, store } = await boot({
      signals: { title: 'Just a moment...', html: '<div id="challenge-form"></div>', links: 0 },
    })
    const out = await capturePage('https://a.test/jobs/1', { unattended: true })
    expect(out).toEqual({ ok: false, reason: 'This board is asking for a human check; open it yourself.' })
    expect(opened).toEqual(['https://a.test/jobs/1'])
    expect((store['jojo.boardPace'] as Record<string, { pages: number }>)['a.test']?.pages).toBe(1)
  })

  it('refuses a listed link that redirected onto a forbidden site, before reading it', async () => {
    vi.useFakeTimers()
    const { capturePage, opened } = await boot({ landAt: 'https://www.linkedin.com/jobs/view/42' })
    const out = await past(capturePage('https://a.test/apply/42', { unattended: true }))
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('linkedin.com does not allow automated reading')
    expect(opened).toEqual(['https://a.test/apply/42'])
  })

  it('is told apart from "From link" only by a literal true', async () => {
    vi.useFakeTimers()
    const { onCaptureUrl, opened, fetched } = await boot()
    const answers: { ok: boolean; reason?: string }[] = []
    await onCaptureUrl({ url: 'https://www.linkedin.com/jobs/view/42', unattended: true }, (a) => answers.push(a))
    expect(answers[0]?.reason).toContain('does not allow automated reading')
    expect(opened).toEqual([])

    // A person's own "From link" is a person reading a page: no robots.txt,
    // no pace, and not refused for the site. It runs on to the serialiser.
    await past(onCaptureUrl({ url: 'https://www.linkedin.com/jobs/view/42', unattended: 'yes' }, (a) => answers.push(a)))
    expect(opened).toEqual(['https://www.linkedin.com/jobs/view/42'])
    expect(fetched).toEqual([])
    expect(answers[1]).toEqual({ ok: false, reason: 'serialised' })
  })
})
