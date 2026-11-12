/**
 * The extension's message handlers, run as the browser runs them.
 *
 * The whole of `background.js` is evaluated against a fake `chrome`, with its
 * imports handed in by name, and messages are sent to the listener it
 * registers. The other worker tests lift one function at a time; these are the
 * promises that only exist at the level of the HANDLER — that every verb
 * answers even when something inside it throws, that the crash-reporting verb
 * the bridge forwards is actually answered, and that two writes to the queue
 * cannot erase each other.
 */
import { describe, expect, it } from 'vitest'
import backgroundSource from '../../extension/background.js?raw'
// @ts-expect-error — a plain ES module the worker loads from disk, with no types
// of its own; handed to the evaluated worker untyped, as the browser hands it.
import * as policy from '../../extension/policy.js'

type Listener = (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean
type Store = Record<string, unknown>

/** The worker, booted against an in-memory `chrome`. */
function boot(options: { failGet?: boolean; slowSet?: number; failWrite?: string } = {}) {
  const store: Store = {}
  const listeners: Listener[] = []
  const chrome = {
    runtime: {
      id: 'ext',
      getURL: (path: string) => `chrome-extension://ext/${path}`,
      getManifest: () => ({ version: '1', content_scripts: [] }),
      onInstalled: { addListener: () => undefined },
      onConnect: { addListener: () => undefined },
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          if (options.failGet === true) throw new Error('storage is unavailable')
          const out: Store = {}
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in store) out[key] = structuredClone(store[key])
          }
          return out
        },
        set: async (values: Store) => {
          if (options.slowSet !== undefined) await new Promise((r) => setTimeout(r, options.slowSet))
          if (options.failWrite !== undefined && options.failWrite in values) throw new Error('quota exceeded')
          Object.assign(store, structuredClone(values))
        },
      },
    },
    action: {
      setBadgeText: async ({ tabId }: { tabId?: number }) => {
        // A closed tab: what Chrome does, and what used to escape every handler.
        if (tabId === 404) throw new Error('No tab with id: 404.')
      },
      setTitle: async () => undefined,
    },
    tabs: { query: async () => [], get: async () => ({}), remove: async () => undefined },
    scripting: { executeScript: async () => [{ result: null }] },
  }
  const body = backgroundSource.replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
  const names = Object.keys(policy)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('chrome', 'expandListing', 'harvest', 'serialise', 'shrinkToFit', ...names, body)(
    chrome,
    () => undefined,
    () => undefined,
    () => undefined,
    (html: string) => ({ html, dropped: 0 }),
    ...names.map((n) => (policy as Record<string, unknown>)[n]),
  )
  if (listeners.length !== 1) throw new Error('background.js registered no message listener')
  const send = (message: unknown, own = false) =>
    new Promise<unknown>((resolve) => {
      const sender = own ? { id: 'ext', url: 'chrome-extension://ext/popup.html' } : { id: 'ext', url: 'https://jojo.test/' }
      const async = listeners[0]!(message, sender, resolve)
      if (!async) resolve('no answer')
    })
  return { send, store }
}

describe('every verb answers', () => {
  it('with a reason when something inside it throws, rather than leaving the caller waiting', async () => {
    const { send } = boot({ failGet: true })
    for (const type of ['jojo:peek-captures', 'jojo:take-captures', 'jojo:ack-captures', 'jojo:read-document']) {
      await expect(send({ type, ids: [] }), type).resolves.toMatchObject({
        ok: false,
        reason: 'storage is unavailable',
      })
    }
  })

  it('answers a capture of a tab that has since closed, instead of rejecting on its badge', async () => {
    const { send } = boot()
    // The serialiser stub returns nothing, so this fails — and says so, with
    // the badge on the closed tab swallowed rather than thrown.
    await expect(send({ type: 'jojo:capture-tab', tabId: 404 }, true)).resolves.toMatchObject({
      ok: false,
      reason: 'Nothing came back from that page.',
    })
  })
})

describe('the crash-reporting verb', () => {
  it('is answered, with the choice and what has been kept', async () => {
    const { send } = boot()
    await expect(send({ type: 'jojo:crash-reporting', on: true, clear: false })).resolves.toEqual({
      on: true,
      crashes: [],
    })
  })

  it('keeps a handler failure once it is switched on — the verb and the message, nothing else', async () => {
    const { send } = boot({ failWrite: 'jojo.captures' })
    await send({ type: 'jojo:crash-reporting', on: true })
    await expect(send({ type: 'jojo:delete-capture', id: 'x' }, true)).resolves.toMatchObject({
      ok: false,
      reason: 'quota exceeded',
    })
    await new Promise((r) => setTimeout(r, 0))
    const kept = (await send({ type: 'jojo:crash-reporting', on: true })) as { crashes: Record<string, unknown>[] }
    expect(kept.crashes).toEqual([
      { at: expect.any(String), verb: 'jojo:delete-capture', message: 'quota exceeded' },
    ])
    const cleared = (await send({ type: 'jojo:crash-reporting', on: true, clear: true })) as { crashes: unknown[] }
    expect(cleared.crashes).toEqual([])
  })

  it('records nothing for a failure while it is off', async () => {
    const { send } = boot({ failWrite: 'jojo.captures' })
    await send({ type: 'jojo:delete-capture', id: 'x' }, true)
    await new Promise((r) => setTimeout(r, 0))
    await expect(send({ type: 'jojo:crash-reporting', on: true })).resolves.toEqual({ on: true, crashes: [] })
  })

  it('records nothing while it is off, which is the default', async () => {
    const { send } = boot({ failGet: false })
    await expect(send({ type: 'jojo:crash-reporting' })).resolves.toEqual({ on: false, crashes: [] })
  })
})

describe('the capture queue', () => {
  it('loses nothing when an acknowledgement and a delete land together', async () => {
    const { send, store } = boot({ slowSet: 5 })
    store['jojo.captures'] = [
      { id: 'a', url: 'https://x.test/a', html: '' },
      { id: 'b', url: 'https://x.test/b', html: '' },
      { id: 'c', url: 'https://x.test/c', html: '' },
    ]
    // Unchained, each read the same three, removed its own one, and the second
    // write put back the one the first had removed.
    await Promise.all([
      send({ type: 'jojo:ack-captures', ids: ['a'] }),
      send({ type: 'jojo:delete-capture', id: 'b' }, true),
    ])
    expect((store['jojo.captures'] as { id: string }[]).map((c) => c.id)).toEqual(['c'])
  })
})
