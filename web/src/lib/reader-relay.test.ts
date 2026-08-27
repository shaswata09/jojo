/**
 * The extension's loopback guard, executed against the shipped source.
 *
 * WHY THIS IS A SECURITY TEST AND NOT A UNIT TEST. `jojo:read-document` relays a
 * request the PAGE composed, using the EXTENSION's `host_permissions` — which
 * are `http://*` and `https://*`. Without a check on the address, any script
 * that got onto jojo's origin could hand the worker any URL on the web and read
 * the response back: an open proxy wearing jojo's permissions, and a far worse
 * bug than the one the relay exists to fix.
 *
 * So the rule is asserted by running the real function out of `background.js`
 * rather than by re-describing it here. `capture-policy.test.ts` set the
 * precedent of reading extension source with `?raw`; this goes one further and
 * executes it, because a transcription of a guard is not the guard.
 */

import { describe, expect, it } from 'vitest'
import backgroundSource from '../../extension/background.js?raw'

import bridgeCallerSource from './capture-bridge.ts?raw'
import policySource from '../../extension/policy.js?raw'
import bridgeSource from '../../extension/bridge.js?raw'

/*
 * Read as source, not imported. The extension is plain JS with no declarations —
 * which is exactly why `capture-policy.test.ts` reads it this way — and parsing
 * the literal checks what the browser will load rather than what TypeScript can
 * be talked into believing about it.
 */
const MODEL_HOSTS: string[] = (() => {
  const match = /export const MODEL_HOSTS = \[([\s\S]*?)\]/.exec(policySource)
  if (match === null) throw new Error('MODEL_HOSTS is not exported from extension/policy.js')
  return [...match[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!)
})()

/** The real function, lifted out of the file the browser loads. */
function lift(name: string): (url: string) => boolean {
  const at = backgroundSource.indexOf(`function ${name}(`)
  if (at === -1) throw new Error(`${name} is not in extension/background.js any more`)
  // To the end of the function, found by matching braces from its first one.
  let depth = 0
  let end = -1
  for (let i = backgroundSource.indexOf('{', at); i < backgroundSource.length; i += 1) {
    const c = backgroundSource[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end === -1) throw new Error(`could not find the end of ${name}`)
  const source = backgroundSource.slice(at, end)
  // `MODEL_HOSTS` is a module import in the real file, so it is supplied here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function('MODEL_HOSTS', `${source}; return ${name}`)(MODEL_HOSTS) as (
    url: string,
  ) => boolean
}

const isLoopback = lift('isLoopback')

/**
 * Where the timeout decision ends, located by what the file actually says.
 *
 * This was `indexOf('const timer =')`, and the source says `let timer =`. The
 * miss returns -1, `slice(start, -1)` then takes everything up to the last
 * character, and every assertion below passed on text from anywhere in the
 * file — including assertions about lines that had been deleted.
 *
 * Asserted non-negative here so the same slip fails loudly instead of widening
 * the window again.
 */
/** A source slice with its comments removed, so an assertion cannot match prose. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

function endOfTimeoutBlock(source: string): number {
  const from = source.indexOf('const timeout =')
  expect(from).toBeGreaterThan(0)
  // The declaration that CONSUMES the timeout, which is the line after the
  // decision. Searched from `const timeout =` because `setTimeout` also appears
  // earlier, in the re-arm inside the CHUNK branch.
  const at = source.indexOf('timer = window.setTimeout', from)
  expect(at).toBeGreaterThan(from)
  return at
}

describe('what the extension will relay to', () => {
  it('allows the addresses a reader on this machine actually listens on', () => {
    expect(isLoopback('http://127.0.0.1:3001/mcp/')).toBe(true)
    expect(isLoopback('http://localhost:3001/mcp/')).toBe(true)
    expect(isLoopback('http://[::1]:3001/mcp/')).toBe(true)
    // Any port, because the reader's is a flag the user chose.
    expect(isLoopback('http://127.0.0.1:9999/mcp/')).toBe(true)
  })

  it('refuses anything that is not this machine', () => {
    expect(isLoopback('http://example.com/mcp')).toBe(false)
    expect(isLoopback('https://example.com/mcp')).toBe(false)
    // A private address is still somebody else's machine.
    expect(isLoopback('http://192.168.1.10:3001/mcp')).toBe(false)
    expect(isLoopback('http://10.0.0.5:3001/mcp')).toBe(false)
  })

  it('is not fooled by an address that merely starts with a loopback host', () => {
    /*
     * The reason this is parsed rather than pattern-matched. Every one of these
     * passes a `startsWith('http://127.0.0.1')` test and every one of them is a
     * request to somebody else's server — userinfo before an `@` is a host that
     * is not the host.
     */
    expect(isLoopback('http://127.0.0.1@evil.example.com/')).toBe(false)
    expect(isLoopback('http://localhost@evil.example.com/mcp')).toBe(false)
    expect(isLoopback('http://127.0.0.1.evil.example.com/mcp')).toBe(false)
    expect(isLoopback('http://evil.example.com/?x=http://127.0.0.1')).toBe(false)
    expect(isLoopback('http://evil.example.com#http://127.0.0.1')).toBe(false)
  })

  it('refuses https, because a loopback reader has no certificate', () => {
    // Allowing it would imply there is an https story for a local server.
    expect(isLoopback('https://127.0.0.1:3001/mcp/')).toBe(false)
    expect(isLoopback('https://localhost:3001/mcp/')).toBe(false)
  })

  it('refuses schemes that are not http at all', () => {
    expect(isLoopback('file:///etc/passwd')).toBe(false)
    expect(isLoopback('chrome-extension://abc/background.js')).toBe(false)
    expect(isLoopback('javascript:alert(1)')).toBe(false)
    expect(isLoopback('data:text/plain,hi')).toBe(false)
  })

  it('refuses junk rather than throwing on it', () => {
    // The worker calls this on a value that crossed postMessage, so it has to
    // survive anything without taking the service worker down with it.
    for (const junk of ['', 'not a url', '://', '127.0.0.1:3001', '//127.0.0.1/mcp']) {
      expect(() => isLoopback(junk), junk).not.toThrow()
      expect(isLoopback(junk), junk).toBe(false)
    }
  })
})

describe('the relay is wired into the extension it ships with', () => {
  it('handles the read verb in the worker', () => {
    expect(backgroundSource).toContain("'jojo:read-document'")
    // And checks the address before fetching, not after.
    const handler = backgroundSource.slice(backgroundSource.indexOf("'jojo:read-document'"))
    // The address is checked BEFORE anything is fetched, not after.
    expect(handler.indexOf('isLoopback')).toBeLessThan(handler.indexOf('await relay('))
  })
})

describe('what the extension will relay a MODEL request to', () => {
  const isKnownModelHost: (url: string) => boolean = lift('isKnownModelHost')

  it('allows the providers in its own list', () => {
    expect(isKnownModelHost('https://integrate.api.nvidia.com/v1/chat/completions')).toBe(true)
    expect(isKnownModelHost('https://api.openai.com/v1/chat/completions')).toBe(true)
    expect(isKnownModelHost('https://api.anthropic.com/v1/messages')).toBe(true)
  })

  it('is an exact host match, not a suffix test', () => {
    /*
     * How allowlists usually fail. `endsWith('openai.com')` also accepts
     * `evil-openai.com`, and `includes` is worse again.
     */
    expect(isKnownModelHost('https://evil-openai.com/v1/chat/completions')).toBe(false)
    expect(isKnownModelHost('https://api.openai.com.evil.example/v1')).toBe(false)
    expect(isKnownModelHost('https://openai.com/v1')).toBe(false)
  })

  it('refuses anything not on the list, and plain http', () => {
    expect(isKnownModelHost('https://example.com/v1/chat/completions')).toBe(false)
    // http to a provider would be a downgrade nobody asked for.
    expect(isKnownModelHost('http://api.openai.com/v1/chat/completions')).toBe(false)
    expect(isKnownModelHost('https://127.0.0.1:3001/v1')).toBe(false)
  })

  it('refuses junk without throwing', () => {
    for (const junk of ['', 'not a url', '://', 'api.openai.com']) {
      expect(() => isKnownModelHost(junk), junk).not.toThrow()
      expect(isKnownModelHost(junk), junk).toBe(false)
    }
  })
})

describe('the page actually sends the relayed shapes across the wire', () => {
  /*
   * The bug this exists for, and it made the whole relay dead on arrival.
   *
   * `bridge.js` picks its verb from the SHAPE of the message it receives — there
   * is no type name on the wire, deliberately, so a page cannot name a verb the
   * worker was not expecting. `ask()` composed that message from an explicit
   * field list, and the list was written before `read` and `model` existed. So
   * both were dropped at the boundary, the bridge saw a bare object, chose
   * `peek`, and every relayed call came back as a capture count.
   *
   * Asserted on the source because there is nothing to mount: the fields have to
   * be in the literal that is posted.
   */
  it('includes read and model in the posted message', () => {
    const posted = bridgeCallerSource.slice(
      bridgeCallerSource.indexOf('window.postMessage('),
      bridgeCallerSource.indexOf('window.location.origin', bridgeCallerSource.indexOf('window.postMessage(')),
    )
    expect(posted).toContain('read: request.read')
    expect(posted).toContain('model: request.model')
  })

  it('gives a relayed request longer than the 400ms probe budget', () => {
    // A model answer and a PDF conversion both take seconds. The probe budget
    // would have abandoned every one and blamed the extension.
    const chooser = bridgeCallerSource.slice(
      bridgeCallerSource.indexOf('const timeout ='),
      endOfTimeoutBlock(bridgeCallerSource),
    )
    expect(chooser).toContain('request.read !== undefined')
    expect(chooser).toContain('request.model !== undefined')
  })
})

describe('a relayed GET carries no body', () => {
  /*
   * The bug this pins, reported from a real connection test:
   *
   *   Failed to execute 'fetch' on 'WorkerGlobalScope':
   *   Request with GET/HEAD method cannot have body.
   *
   * The bridge rebuilt an absent body as `''`, and an empty string is still a
   * body. The model list is a GET, so every connection test through the relay
   * died on it — and the message blamed the server for not running.
   */
  it('the bridge omits an absent body rather than sending an empty string', () => {
    const rebuild = bridgeSource.slice(
      bridgeSource.indexOf('const read ='),
      bridgeSource.indexOf('chrome.runtime.sendMessage'),
    )
    expect(rebuild).not.toContain("body: typeof relayed.body === 'string' ? relayed.body : ''")
    expect(rebuild).toMatch(/\.\.\.\(typeof relayed\.body === 'string' && relayed\.body !== ''/)
  })

  it('and the worker refuses to attach one to a GET or HEAD at all', () => {
    // Belt and braces: the bridge is one caller, and the worker is the thing
    // that actually calls `fetch`.
    const fn = backgroundSource.slice(
      backgroundSource.indexOf('async function relay('),
      backgroundSource.indexOf('/* --------------------------------- scanning'),
    )
    expect(fn).toContain("method !== 'GET' && method !== 'HEAD'")
    expect(fn).toContain('sendsBody')
  })

  it('names what it was calling, rather than saying "reader" for everything', () => {
    expect(backgroundSource).toContain("relay(request, 'reader')")
    expect(backgroundSource).toContain("relay(request, 'model provider')")
  })
})

describe('installing the extension reaches tabs that are already open', () => {
  /*
   * "MarkItDown does not show connected until you refresh." Nothing was broken:
   * a manifest content script runs on navigation and not retroactively, so the
   * tab somebody installed FROM — jojo's own Settings page, every time, because
   * that is where the installer is — had no bridge and no way to get one.
   */
  it('injects on install, using the manifest’s own patterns', () => {
    expect(backgroundSource).toContain('chrome.runtime.onInstalled.addListener')
    expect(backgroundSource).toContain('injectIntoOpenTabs')
    // Read from the manifest rather than repeated, so the port list has one owner.
    expect(backgroundSource).toContain('chrome.runtime.getManifest().content_scripts')
  })
})

/**
 * The region of the worker that owns the hop: the budget, the model allowlist
 * and `relay` itself. Lifted whole rather than function by function, because
 * `relay` reads `READ_TIMEOUT_MS` and a test that supplied its own would be
 * asserting against a number the browser never uses.
 */
const relayRegion = backgroundSource.slice(
  backgroundSource.indexOf('const READ_TIMEOUT_MS'),
  backgroundSource.indexOf('/* --------------------------------- scanning'),
)

type Relayed = { ok: boolean; status: number; text: string; reason?: string }
type Relay = (
  request: { url: string; method?: string; headers?: Record<string, string>; body?: string },
  what: string,
) => Promise<Relayed>

/** The real `relay`, with only `fetch` replaced. */
function liftRelay(fetchImpl: () => Promise<unknown>): Relay {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function('MODEL_HOSTS', 'fetch', `${relayRegion}; return relay`)(
    MODEL_HOSTS,
    fetchImpl,
  ) as Relay
}

/** The number the worker actually ships, read out of the file the browser loads. */
const numberIn = (source: string, name: string): number => {
  const match = new RegExp(`const ${name} = (\\d+)`).exec(source)
  if (match === null) throw new Error(`${name} is not a plain number any more`)
  return Number(match[1])
}

const READ_TIMEOUT_MS = numberIn(backgroundSource, 'READ_TIMEOUT_MS')

describe('a relay whose far end is not there', () => {
  const request = { url: 'http://127.0.0.1:3001/mcp', method: 'POST', headers: {}, body: '{}' }

  /*
   * THE BUG THIS PINS, and it made every diagnostic in `relay` dead code.
   *
   * The catch block called `recordExtensionCrash`, which is defined nowhere in
   * the repo. So the commonest failure the relay has — a reader that was never
   * started — threw `ReferenceError` before the `return`, `sendResponse` was
   * never called, and the page got Chrome's "message port closed before a
   * response was received" instead of a sentence naming the address.
   *
   * Executed rather than read: the call sat in the file for a release without
   * anything noticing, precisely because nothing ever ran this path.
   */
  it('answers with a reason rather than throwing out of its own catch', async () => {
    const relay = liftRelay(() => Promise.reject(new TypeError('Failed to fetch')))

    const answer = await relay(request, 'reader')

    expect(answer.ok).toBe(false)
    expect(answer.status).toBe(0)
    expect(answer.reason).toContain('Could not reach the reader at http://127.0.0.1:3001/mcp')
  })

  it('names the model provider when that is what was being called', async () => {
    const relay = liftRelay(() => Promise.reject(new TypeError('Failed to fetch')))

    const answer = await relay({ ...request, url: 'https://api.openai.com/v1' }, 'model provider')

    expect(answer.reason).toContain('Could not reach the model provider')
    expect(answer.reason).not.toContain('reader')
  })

  it('says how long it waited when the wait is what ran out', async () => {
    const relay = liftRelay(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    )

    const answer = await relay(request, 'reader')

    // The seconds come from the constant, so this stays true if the budget moves.
    expect(answer.reason).toBe(
      `The reader did not answer within ${String(READ_TIMEOUT_MS / 1000)} seconds.`,
    )
  })
})

describe('the two ends of one relayed request agree on how long it gets', () => {
  /*
   * They did not, and the disagreement was invisible from either side: the
   * worker gave a read 120 seconds while the page gave the same read the scan's
   * 40 and nothing re-armed it, because reads do not stream. A 55-second PDF
   * conversion therefore succeeded in the worker and was reported to the user as
   * "the extension did not answer", with the answer posted into a channel the
   * page had already closed.
   *
   * Two files, two constants, no import between them — the extension is loaded
   * from disk and cannot see the app's modules — which is the same situation
   * `policy.js` is in, and gets the same answer: transcribe, and let a test own
   * the claim that the transcription still holds.
   */
  const PAGE = numberIn(bridgeCallerSource, 'RELAY_TIMEOUT_MS')

  it('has the page willing to wait longer than the worker will work', () => {
    expect(PAGE).toBeGreaterThan(READ_TIMEOUT_MS)
  })

  it('does not leave the page waiting on a worker that has already given up', () => {
    // The margin is for one postMessage hop, not for a second thought. Wide and
    // the user waits out a minute of nothing after the worker stopped; narrow
    // and the page wins the race and writes the vaguer sentence.
    expect(PAGE - READ_TIMEOUT_MS).toBeLessThanOrEqual(10000)
  })

  it('spends that budget on the two verbs the worker actually relays', () => {
    /*
     * COMMENTS STRIPPED, because this reads the decision and the decision is
     * code. Matching the raw slice let `RELAY_TIMEOUT_MS` pass on the words
     * "see `RELAY_TIMEOUT_MS`" in a comment two lines above it: mutating the
     * actual `answered ? RELAY_TIMEOUT_MS : SCAN_TIMEOUT_MS` away left this
     * test green.
     */
    const chooser = withoutComments(
      bridgeCallerSource.slice(
        bridgeCallerSource.indexOf('const timeout ='),
        endOfTimeoutBlock(bridgeCallerSource),
      ),
    )
    expect(chooser).toContain('RELAY_TIMEOUT_MS')
    expect(chooser).toContain('request.read !== undefined')
    expect(chooser).toContain('request.model !== undefined')
    // A scan is a different job with a different far end, and keeps its own.
    expect(chooser).toContain('SCAN_TIMEOUT_MS')
  })
})
