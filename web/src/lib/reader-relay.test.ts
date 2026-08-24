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

/** The real `isLoopback`, lifted out of the file the browser loads. */
const isLoopback: (url: string) => boolean = (() => {
  const at = backgroundSource.indexOf('function isLoopback(')
  if (at === -1) throw new Error('isLoopback is not in extension/background.js any more')
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
  if (end === -1) throw new Error('could not find the end of isLoopback')
  const source = backgroundSource.slice(at, end)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`${source}; return isLoopback`)() as (url: string) => boolean
})()

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
