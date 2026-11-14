import { afterEach, describe, expect, it, vi } from 'vitest'
import policySource from '../../extension/policy.js?raw'
import routingSource from '../../extension/worker/routing.js?raw'
import targetsSource from '../../extension/worker/targets.js?raw'
// @ts-expect-error — a plain ES module the worker loads from disk, with no types.
import { modelRefusal } from '../../extension/worker/routing.js'
// @ts-expect-error — as above.
import { OWN_PAGE_VERBS, PAGE_VERBS, onMessage } from '../../extension/worker/messages.js'
import { PROVIDERS } from '@jojo/service/core/provider'
import {
  CAPTURE_HREF_ATTR,
  CAPTURE_LAZY_ATTRS,
  CAPTURE_MAX_ASSET_BYTES,
  CAPTURE_MAX_BYTES,
  CAPTURE_SCHEMES,
  CAPTURE_STRIP_ATTRS,
  CAPTURE_STRIP_TAGS,
  CAPTURE_UNCLAMP_ATTR,
  CAPTURE_URL_ATTRS,
} from '@jojo/service/core/capture'

/**
 * The extension's copy of the capture policy has not drifted.
 *
 * `web/extension/policy.js` is a hand transcription of constants that live in
 * `service/kg/core/capture.ts`, and it exists because the extension is loaded
 * from disk by the browser rather than built by Vite — it cannot import from the
 * package, and putting a build step in front of it would put a compile between
 * editing the extension and reloading it.
 *
 * A transcription with no check is the `buildMonth` drift waiting to happen:
 * somebody adds a tag to the strip list, the package's tests stay green, and
 * every capture taken from then on keeps an element the viewer was promised
 * would never reach it. Silent, and only visible in a saved page nobody reads
 * again for a year.
 *
 * Read as SOURCE TEXT rather than imported, deliberately. Importing the module
 * would need `allowJs` and a tsconfig that reaches outside `src`, and it would
 * check that the file parses rather than that it says the same thing. This
 * compares the literals, which is the claim being made.
 */

/** Pulls `export const NAME = [ … ]` out of the source as a real array. */
function arrayLiteral(name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(policySource)
  if (match === null) throw new Error(`${name} is not exported from extension/policy.js`)
  return [...match[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!)
}

/** Pulls a scalar `export const NAME = <value>` line. */
function scalarLiteral(name: string): string {
  const match = new RegExp(`export const ${name} = (.+)`).exec(policySource)
  if (match === null) throw new Error(`${name} is not exported from extension/policy.js`)
  return match[1]!.trim().replace(/^'|'$/g, '')
}

describe('the extension carries the same capture policy as the package', () => {
  it.each([
    ['CAPTURE_STRIP_TAGS', CAPTURE_STRIP_TAGS],
    ['CAPTURE_STRIP_ATTRS', CAPTURE_STRIP_ATTRS],
    ['CAPTURE_URL_ATTRS', CAPTURE_URL_ATTRS],
    ['CAPTURE_SCHEMES', CAPTURE_SCHEMES],
    ['CAPTURE_LAZY_ATTRS', CAPTURE_LAZY_ATTRS],
  ])('%s matches, in the same order', (name, expected) => {
    // Order as well as membership: the strip loop walks the list, and `link`
    // running before `meta` is what lets the stylesheet branch replace a node
    // the meta branch would otherwise have already removed.
    expect(arrayLiteral(name)).toEqual([...expected])
  })

  it('names the same attribute for a rewritten anchor', () => {
    // The one both serialisers write and `remoteRefCount` is built around. A
    // mismatch here means every captured link reads as a leak and every capture
    // is refused — loud, but only at the moment somebody tries to save a page.
    expect(scalarLiteral('CAPTURE_HREF_ATTR')).toBe(CAPTURE_HREF_ATTR)
  })

  it('names the same attribute for an un-clamped element', () => {
    // Both halves have to agree or the rule the serialiser appends selects
    // nothing, and every captured posting silently keeps its "See more" clamp.
    expect(scalarLiteral('CAPTURE_UNCLAMP_ATTR')).toBe(CAPTURE_UNCLAMP_ATTR)
  })

  it('caps at the same size', () => {
    // Evaluated rather than string-compared, so `8 * 1024 * 1024` and
    // `8388608` are allowed to be spelled differently and still agree.
    const evaluate = (expr: string) => Number(new Function(`return ${expr}`)())
    expect(evaluate(scalarLiteral('CAPTURE_MAX_BYTES'))).toBe(CAPTURE_MAX_BYTES)
    expect(evaluate(scalarLiteral('CAPTURE_MAX_ASSET_BYTES'))).toBe(CAPTURE_MAX_ASSET_BYTES)
  })

  it('is reading a real file and real constants', () => {
    // Guards the guard. If the glob resolved to nothing or the regex stopped
    // matching, every assertion above would pass by comparing nothing.
    expect(policySource).toContain('CAPTURE_STRIP_TAGS')
    expect(CAPTURE_STRIP_TAGS.length).toBeGreaterThan(5)
    expect(() => arrayLiteral('CAPTURE_NOT_A_REAL_LIST')).toThrow()
  })
})


describe("the extension's model-host list matches the provider table", () => {
  /*
   * The same bargain as every other list in `policy.js`: the extension cannot
   * import from `@jojo/service`, so the hosts are transcribed — and the
   * transcription is checked, so the rule still has one owner.
   *
   * It matters more than the capture lists because this one is a security
   * boundary. The worker relays a page-composed request under its own
   * `https://*` permission, and the list is what stops that being an open proxy.
   * A host that drifts OUT silently breaks a provider; one that drifts IN
   * silently widens what the extension can be asked to fetch.
   */
  it('names exactly the cloud providers jojo knows about', () => {
    const transcribed = arrayLiteral('MODEL_HOSTS')
    const fromTable = PROVIDERS.filter((p) => p.cloud).map((p) => new URL(p.endpoint).hostname)
    expect([...transcribed].sort()).toEqual([...new Set(fromTable)].sort())
  })

  it('lists no local provider, which loopback allows instead', () => {
    const transcribed = arrayLiteral('MODEL_HOSTS')
    expect(transcribed).not.toContain('localhost')
    expect(transcribed).not.toContain('127.0.0.1')
  })
})

/**
 * The relay's address rule, read out of the extension source.
 *
 * The page and the extension have to agree about which addresses are relayable.
 * They did not: the page's error text said "install the jojo extension, which
 * relays that one hop for you" while `background.js` allowed loopback and five
 * hosted providers, so somebody with a model server on their own network
 * installed an extension that then refused the address it was installed for.
 *
 * Read from source, because what is asserted is which checks the guard is
 * written with; the next block runs it.
 */
describe('which model addresses the extension will relay', () => {
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  it('relays private-network addresses as well as loopback and known providers', () => {
    const source = strip(routingSource)
    const guard = source.slice(source.indexOf('async function modelRefusal'))
    expect(guard).toContain('isPrivateNetwork(url)')
    expect(guard).toContain('isLoopback(url)')
    expect(guard).toContain('isKnownModelHost(url)')
  })

  it('accepts only ranges that are unroutable on the public internet', () => {
    const source = strip(targetsSource)
    const fn = source.slice(source.indexOf('function isPrivateNetwork'))
    // RFC 1918, RFC 3927 link-local, and mDNS. A public http address relayed
    // would make this a way for any page to launder a request through the
    // user's browser.
    for (const marker of ['=== 10', '=== 172', '=== 192', '=== 169', ".local'"]) {
      expect(fn).toContain(marker)
    }
    expect(fn).toContain("protocol !== 'http:'")
  })
})

/**
 * "Models on my network" is a switch, and it starts OFF.
 *
 * The comment above `isPrivateNetwork` said the popup's routing switches turned
 * the LAN relay off "by host like any other" — but those switches are keyed by
 * the hosted providers' names, so `10.0.0.5` had no switch and could never be
 * refused. Executed, not read: the real `modelRefusal` is imported from the
 * module the browser loads and run against a stored routing.
 */
describe('relaying to a model on the person’s own network', () => {
  const MODEL_HOSTS = arrayLiteral('MODEL_HOSTS')
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  /** The real `modelRefusal`, reading `saved` as the routing the popup stored. */
  const refusalWith = (saved: unknown) => (url: string) => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ 'jojo.routing': saved }) } } })
    return (modelRefusal as (url: string) => Promise<string | null>)(url)
  }

  it('is refused until the person turns it on, and the refusal names the switch', async () => {
    for (const saved of [undefined, {}, { network: false }]) {
      const reason = await refusalWith(saved)('http://10.0.0.5:8000/v1/chat/completions')
      expect(reason).toContain('Models on my network')
    }
  })

  it('is relayed once they have', async () => {
    await expect(refusalWith({ network: true })('http://10.0.0.5:8000/v1/chat/completions')).resolves.toBeNull()
  })

  it('leaves loopback and the named providers exactly as they were', async () => {
    const refusal = refusalWith(undefined)
    await expect(refusal('http://127.0.0.1:11434/v1/chat/completions')).resolves.toBeNull()
    await expect(refusal(`https://${MODEL_HOSTS[0]!}/v1/chat/completions`)).resolves.toBeNull()
    await expect(refusal('http://evil.example/v1')).resolves.toContain('not a model provider')
  })

  /*
   * Round 2: the relay took ANY loopback port and path, so a page could send a
   * "model" request at jojo's reader (3001), its bridge (3002) or any local dev
   * server and read the answer — undoing the pinning those two verbs have.
   */
  it('keeps the usual local model ports working out of the box', async () => {
    const refusal = refusalWith(undefined)
    for (const at of ['http://localhost:11434/api/chat', 'http://127.0.0.1:1234/v1/models', 'http://localhost:8000/v1/chat/completions', 'http://127.0.0.1:8080/v1/chat/completions']) {
      await expect(refusal(at), at).resolves.toBeNull()
    }
  })

  it('never relays a model request to jojo’s own reader or bridge, switch or no switch', async () => {
    for (const saved of [undefined, { network: true }]) {
      const refusal = refusalWith(saved)
      for (const at of ['http://127.0.0.1:3001/mcp', 'http://localhost:3002/link', 'http://[::1]:3001/mcp']) {
        await expect(refusal(at), at).resolves.toMatch(/reader or bridge/)
      }
    }
    // A reader the person moved to another port is refused there too.
    await expect(
      refusalWith({ reader: { endpoint: 'http://127.0.0.1:3555/mcp' } })('http://127.0.0.1:3555/mcp'),
    ).resolves.toMatch(/reader or bridge/)
  })

  it('puts any other loopback port behind the network switch', async () => {
    await expect(refusalWith(undefined)('http://127.0.0.1:5432/')).resolves.toContain('Models on my network')
    await expect(refusalWith(undefined)('http://localhost/admin')).resolves.toContain('Models on my network')
    await expect(refusalWith({ network: true })('http://127.0.0.1:8103/v1/chat/completions')).resolves.toBeNull()
  })

  it('cannot be switched on by a page, only by the popup', async () => {
    // One of the popup's own verbs, and not one a page can send.
    expect(OWN_PAGE_VERBS.has('jojo:set-routing')).toBe(true)
    expect(PAGE_VERBS.has('jojo:set-routing')).toBe(false)
    // And run: from a web page it is not answered and nothing is written; from
    // the popup it is.
    const writes: unknown[] = []
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext', getURL: (path: string) => `chrome-extension://ext/${path}` },
      storage: {
        local: {
          get: async () => ({}),
          set: async (values: unknown) => {
            writes.push(values)
          },
        },
      },
    })
    type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => boolean
    const listener = onMessage as Listener
    const message = { type: 'jojo:set-routing', network: true }
    const answers: unknown[] = []
    expect(listener(message, { id: 'ext', url: 'https://jojo.test/' }, (v) => answers.push(v))).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(writes).toEqual([])
    expect(answers).toEqual([])
    const answered = await new Promise((resolve) => {
      expect(listener(message, { id: 'ext', url: 'chrome-extension://ext/popup.html' }, resolve)).toBe(true)
    })
    expect(answered).toMatchObject({ routing: { network: true } })
    expect(writes).toEqual([{ 'jojo.routing': expect.objectContaining({ network: true }) }])
  })
})
