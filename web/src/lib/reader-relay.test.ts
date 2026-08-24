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
    expect(handler.indexOf('isLoopback')).toBeLessThan(handler.indexOf('relayToReader'))
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
      bridgeCallerSource.indexOf('const timer ='),
    )
    expect(chooser).toContain('request.read !== undefined')
    expect(chooser).toContain('request.model !== undefined')
  })
})
