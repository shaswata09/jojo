import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Q192 — an error of any kind is reported, with personal data stripped, and only
 * when reporting is allowed and on.
 *
 * `core/crash.test.ts` tests the redaction rules and the two dials as functions.
 * This is the web app's join of them: what `reportError` actually writes, through
 * `recordCrash`, for a thrown value carrying an email address and a model key.
 * A reporter that called the dials correctly but stored `String(thrown)` would
 * pass every core test and leak both.
 */

function fakeWindow() {
  const store = new Map<string, string>()
  return {
    store,
    window: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    },
  }
}

const CRASHES = 'jojo/crashes/v1'
const EMAIL = 'a.person@example.co.uk'
const KEY = 'sk-ant-abcdef1234567890'

async function load(reporting: string) {
  vi.resetModules()
  vi.stubEnv('VITE_CRASH_REPORTING', reporting)
  return {
    log: await import('./crash-log'),
    errors: await import('./report-error'),
  }
}

let fake: ReturnType<typeof fakeWindow>
beforeEach(() => {
  fake = fakeWindow()
  vi.stubGlobal('window', fake.window)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Q192: errors are reported without personal data, and only when on', () => {
  it('keeps a report of any thrown value, with the email and the key stripped', async () => {
    const { log, errors } = await load('true')
    errors.reportError('render', new Error(`could not save ${EMAIL} using ${KEY}`))
    errors.reportError('render', `a bare string naming ${EMAIL}`)
    errors.reportError('render', { odd: 'object', key: KEY })

    const kept = log.readCrashes()
    expect(kept).toHaveLength(3)
    const stored = fake.store.get(CRASHES) ?? ''
    expect(stored).not.toContain(EMAIL)
    expect(stored).not.toContain(KEY)
    expect(stored).toContain('«redacted-email»')
  })

  it('keeps nothing once the person has turned reporting off', async () => {
    const { log, errors } = await load('true')
    log.setCrashEnabled(false)
    errors.reportError('render', new Error('boom'))
    expect(log.recordCrash(new Error('boom'), 'render', false)).toBe(false)
    expect(log.readCrashes()).toEqual([])
  })

  it('keeps nothing in a build without the capability, whatever the setting says', async () => {
    const { log, errors } = await load('')
    log.setCrashEnabled(true)
    errors.reportError('render', new Error('boom'))
    expect(log.CRASH_CAPABILITY).toBe('off')
    expect(log.readCrashes()).toEqual([])
  })
})
