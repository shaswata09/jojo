/**
 * Redaction, which is the half of crash reporting that can betray somebody.
 *
 * The rest of this feature is plumbing. This file is the part that matters: a
 * crash report is assembled from a message and a stack written by code that was
 * already failing, and both routinely contain the URL that failed, the object
 * that was being sent, and — one template literal away at any time — the user's
 * API key. jojo's promise is that records stay on the device; a reporter that
 * shipped a key to a vendor would break it on the one code path a user opted
 * into precisely because they trusted it.
 *
 * So the cases below are adversarial rather than illustrative. Each is a real
 * shape one of these strings takes in this codebase.
 */

import { describe, expect, it } from 'vitest'
import { CRASH_KEPT, keepCrash, redact, toCrashReport } from './crash'
import { CRASH_DEFAULTS, crashCapability, crashReportingOn } from './crash-config'

describe('redaction', () => {
  it('removes a vendor key by its own prefix, wherever it appears', () => {
    /*
     * The prefixes `provider.ts` actually mints. A prefix rule is what catches
     * one that arrived somewhere no rule anticipated — inside a URL, inside a
     * serialised settings object, halfway through a sentence.
     */
    for (const key of [
      'sk-ant-abcdef1234567890',
      'sk-proj-abcdef1234567890',
      'nvapi-eR5bh7XImSg49kwA2GfHGG',
      'gsk_abcdefghij1234567890',
      'sk-or-v1-abcdefghij123456',
    ]) {
      const out = redact(`request failed with ${key} attached`)
      expect(out, key).not.toContain(key)
      expect(out, key).toContain('«redacted-key»')
    }
  })

  it('removes an auth header however it is spelled', () => {
    expect(redact('Authorization: Bearer sk-ant-abcdef1234567890')).not.toMatch(/sk-ant/)
    expect(redact('x-api-key: nvapi-abcdefghijkl')).not.toMatch(/nvapi-abcdefghijkl/)
    expect(redact('api-key=gsk_abcdefghijklmno')).not.toMatch(/gsk_abcdefghijklmno/)
    // Still readable as a header, so the reader knows what was there.
    expect(redact('Authorization: Bearer abc123def456ghi')).toContain('«redacted»')

    /*
     * The case this rule EXISTS for, and the one the first version of this test
     * missed: a header carrying a token with no vendor prefix and no `Bearer`.
     * Every other example here is also caught by the prefix rule or the bearer
     * rule, so deleting the header rule changed nothing and the suite passed —
     * found by mutation testing, not by reading.
     */
    const bare = 'x-api-key: 9f83bc21ae44d0175c6e'
    expect(redact(bare)).not.toContain('9f83bc21ae44d0175c6e')
    expect(redact('Authorization: Token 9f83bc21ae44d0175c6e')).not.toContain(
      '9f83bc21ae44d0175c6e',
    )
  })

  it('removes a bearer token with no recognisable prefix', () => {
    const out = redact('failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(out).toContain('Bearer «redacted»')
  })

  it('keeps a URL’s origin and path but drops its query and fragment', () => {
    /*
     * A failed request names its URL and the query string is where tokens, ids
     * and what the user typed live. The origin and path are the useful half of a
     * bug report; the rest is their business.
     */
    const out = redact('GET https://api.example.com/v1/models?key=secret123&user=me failed')
    expect(out).toContain('https://api.example.com/v1/models')
    expect(out).not.toContain('secret123')
    expect(out).not.toContain('user=me')
  })

  it('removes the account name from a filesystem path', () => {
    // A stack from a phone or a desktop carries it, and it is a real name the
    // user never chose to hand over.
    expect(redact('at /Users/shaswatamitra/Desktop/jojo/web/src/main.tsx:12')).toContain(
      '/Users/«user»',
    )
    expect(redact('at /Users/shaswatamitra/Desktop/x')).not.toContain('shaswatamitra')
    expect(redact('at /home/someone/app/index.js')).not.toContain('someone')
    expect(redact('at C:\\Users\\Someone\\app\\index.js')).not.toContain('Someone')
  })

  it('removes an email address', () => {
    // The profile holds one, and a validation error quotes the value it rejected.
    expect(redact('invalid contact: a.person@example.co.uk')).not.toContain('a.person@example')
    expect(redact('invalid contact: a.person@example.co.uk')).toContain('«redacted-email»')
  })

  it('leaves an ordinary message alone', () => {
    // A redactor that mangles innocent text is one somebody turns off.
    const plain = 'Cannot read properties of undefined (reading “entries”)'
    expect(redact(plain)).toBe(plain)
    expect(redact('The server answered 429.')).toBe('The server answered 429.')
  })

  it('redacts a key even when it is buried in a serialised object', () => {
    // The realistic leak: something throws with the settings attached.
    const thrown = JSON.stringify({ endpoint: 'https://x/v1', apiKey: 'nvapi-abcdefghijklmno' })
    expect(redact(thrown)).not.toContain('nvapi-abcdefghijklmno')
  })
})

describe('turning a throw into a report', () => {
  const at = '2026-08-24T10:00:00.000Z'

  it('reads an Error, and redacts both halves', () => {
    const error = new Error('failed calling https://api.example.com/v1?key=sk-ant-abcdefghij12')
    error.stack = 'Error: boom\n    at /Users/shaswatamitra/app/x.ts:1:1'
    const report = toCrashReport(error, 'assistant', at, 'c1')
    expect(report.message).not.toContain('sk-ant')
    expect(report.stack).not.toContain('shaswatamitra')
    expect(report.where).toBe('assistant')
    expect(report.at).toBe(at)
  })

  it('survives everything a catch can actually hand it', () => {
    /*
     * `catch` and `window.onerror` do not promise an Error. A reporter that
     * assumed one would throw inside the handler for a throw, which is the worst
     * possible place to have a bug — so this takes `unknown` and every one of
     * these has to come back with a usable report.
     */
    for (const thrown of [
      'a bare string',
      42,
      null,
      undefined,
      { message: 'an object' },
      [1, 2, 3],
      new TypeError('a typed error'),
    ]) {
      expect(() => toCrashReport(thrown, 'boot', at, 'c'), String(thrown)).not.toThrow()
      const report = toCrashReport(thrown, 'boot', at, 'c')
      expect(report.message.length, String(thrown)).toBeGreaterThan(0)
    }
  })

  it('does not throw on a value whose own toString throws', () => {
    const hostile = {
      get message() {
        throw new Error('nope')
      },
      toJSON() {
        throw new Error('nope')
      },
    }
    expect(() => toCrashReport(hostile, 'boot', at, 'c')).not.toThrow()
    expect(toCrashReport(hostile, 'boot', at, 'c').message.length).toBeGreaterThan(0)
  })

  it('caps a runaway stack rather than keeping a core dump', () => {
    const error = new Error('boom')
    error.stack = `Error: boom\n${'    at somewhere (/a/b/c.ts:1:1)\n'.repeat(5000)}`
    const report = toCrashReport(error, 'vault', at, 'c')
    expect((report.stack ?? '').length).toBeLessThanOrEqual(4000)
  })

  it('omits the stack rather than inventing one', () => {
    const report = toCrashReport('just a string', 'boot', at, 'c')
    expect(report.stack).toBeUndefined()
  })
})

describe('how many are kept', () => {
  const report = (id: string) => ({ id, at: '2026-08-24T10:00:00.000Z', where: 'x', message: id })

  it('keeps the newest first', () => {
    const list = keepCrash(keepCrash([], report('a')), report('b'))
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('is a ring, so a crash loop cannot fill the disk', () => {
    let list: ReturnType<typeof report>[] = []
    for (let i = 0; i < CRASH_KEPT + 40; i += 1) list = keepCrash(list, report(`c${String(i)}`))
    expect(list).toHaveLength(CRASH_KEPT)
    // The newest survive; the oldest fall off the end.
    expect(list[0]?.id).toBe(`c${String(CRASH_KEPT + 39)}`)
  })
})

describe('the two dials', () => {
  /*
   * A build can only ever take away. The reason both exist is that "what this
   * copy of jojo is capable of" and "what this person has agreed to" are
   * different questions, and somebody packaging jojo for a privacy-sensitive
   * audience needs to answer the first for everyone.
   */
  it('is off unless BOTH the build allows it and the user turned it on', () => {
    expect(crashReportingOn('allowed', { enabled: true })).toBe(true)
    expect(crashReportingOn('allowed', { enabled: false })).toBe(false)
    // The veto: a build with it compiled out cannot be talked round by settings.
    expect(crashReportingOn('off', { enabled: true })).toBe(false)
    expect(crashReportingOn('off', { enabled: false })).toBe(false)
  })

  it('ships on where the build allows it, and the build is still the veto', () => {
    // Changed deliberately — see the header of `crash-config.ts`. The default
    // is on so that the crashes reported are a sample of everybody rather than
    // of the people who go looking through Settings.
    expect(CRASH_DEFAULTS.enabled).toBe(true)
    expect(crashReportingOn('allowed', CRASH_DEFAULTS)).toBe(true)
    /*
     * And this is the line that keeps the default honest: a build that did not
     * ask for the capability reports nothing, whatever the default says. That
     * is what a packager who needs opt-in ships, and it is why flipping the
     * default above cannot turn reporting on anywhere it was previously off.
     */
    expect(crashReportingOn('off', CRASH_DEFAULTS)).toBe(false)
  })

  it('reads only an explicit yes out of a build flag', () => {
    for (const yes of ['true', 'TRUE', '1', 'on', 'yes', ' true ', true]) {
      expect(crashCapability(yes), String(yes)).toBe('allowed')
    }
    /*
     * Everything else is off, including the shapes a misconfiguration takes.
     * The failure that matters is reporting when nobody asked, so anything
     * unrecognised fails closed.
     */
    for (const no of ['false', '0', 'off', 'no', '', '  ', 'maybe', 'TRUEISH', undefined, null, false]) {
      expect(crashCapability(no), String(no)).toBe('off')
    }
  })
})
