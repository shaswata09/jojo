/**
 * What the global error chain hands on, when the throw was not an Error.
 *
 * Crashlytics' own global handler is in that chain — its module's constructor
 * installs it — and for a non-Error it logs `Unknown Error: ${error}` to the
 * vendor, verbatim, outside `core/crash.ts`'s redaction. A thrown record, or a
 * string built from one, would ride along with the next report. So nothing
 * jojo installs may pass a raw non-Error to the handler before or after it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    multiGet: (keys: string[]) => Promise.resolve(keys.map((k) => [k, null])),
  },
}))

const { asError } = await import('./crash')
const { installLastResortHandlers } = await import('./last-resort')

describe('asError', () => {
  it('passes a real Error through untouched', () => {
    const error = new TypeError('a typed error')
    expect(asError(error)).toBe(error)
  })

  it('keeps only the TYPE of anything else', () => {
    const record = { employer: 'Fujitsu', notes: 'second interview' }
    for (const [thrown, kind] of [
      [record, 'object'],
      ['a note about Fujitsu', 'string'],
      [['Fujitsu'], 'array'],
      [42, 'number'],
      [undefined, 'undefined'],
    ] as const) {
      const out = asError(thrown)
      expect(out).toBeInstanceOf(Error)
      expect(out.message).toBe(`non-Error thrown: ${kind}`)
      expect(out.message).not.toContain('Fujitsu')
    }
  })

  it('cannot throw, even on a revoked proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(() => asError(proxy)).not.toThrow()
    expect(asError(proxy).message).toBe('non-Error thrown: object')
  })
})

describe('installLastResortHandlers', () => {
  const globals = globalThis as typeof globalThis & { ErrorUtils?: unknown }
  afterEach(() => {
    delete globals.ErrorUtils
    vi.restoreAllMocks()
  })

  it('hands the previous handler an Error, never the raw value', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const previous = vi.fn()
    let installed: ((error: unknown, isFatal?: boolean) => void) | undefined
    globals.ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
        installed = handler
      },
    }
    installLastResortHandlers()
    installed?.({ employer: 'Fujitsu' }, true)

    expect(previous).toHaveBeenCalledTimes(1)
    const [handed, fatal] = previous.mock.calls[0] as [unknown, boolean]
    expect(handed).toBeInstanceOf(Error)
    expect((handed as Error).message).toBe('non-Error thrown: object')
    // Fatal still reaches React Native's handler, which is what ends the process.
    expect(fatal).toBe(true)
  })
})
