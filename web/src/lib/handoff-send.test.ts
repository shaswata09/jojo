/**
 * That a step which THROWS ends the transfer visibly, rather than silently.
 *
 * `ConnectPanel` calls `void send.start(code, token)`. Nothing is watching that
 * promise, so a rejection out of it is not a worse message than a returned
 * failure — it is no message: the stage never leaves 'packing', the Send button
 * keeps spinning, the code field stays disabled, and the page has to be
 * reloaded to get back to a working transfer. `useBackup().download` was fixed
 * for the same reason and its comment says so; this is the other caller of the
 * same `build()`.
 *
 * D20 rules out mounting the hook, so this tests two separate things: that the
 * guard behaves, and — the part that was missing — that `start` is actually
 * WIRED to it. Testing the guard alone asserts that JavaScript's try/catch
 * works: `guardedTransfer` holds none of the transfer logic, so every one of
 * those assertions passed while `start` ran outside it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNEXPECTED_ADVICE, guardedTransfer } from '@/lib/handoff-send'
// `?raw`, the same way `reader-relay.test.ts` reads the extension: the wiring is
// the claim, and the wiring is only visible in the source.
import sendSource from './handoff-send.ts?raw'

// Hoisted, because `vi.mock` is lifted above the imports.
const { reported } = vi.hoisted(() => ({ reported: vi.fn() }))
vi.mock('@/lib/report-error', () => ({ reportError: reported }))

afterEach(() => {
  reported.mockReset()
})

describe('a transfer step that throws', () => {
  it('answers with advice instead of rejecting', async () => {
    /*
     * The real shape of this: `build()` hits the quota wall, or a stored
     * document will not read. Before the guard this rejection left the hook
     * mid-flight with 'packing' on screen and no way back.
     */
    const advice = await guardedTransfer(() =>
      Promise.reject(new DOMException('quota', 'QuotaExceededError')),
    )
    expect(advice).toBe(UNEXPECTED_ADVICE)
  })

  it('is reported to the transfer site, since the sentence cannot name it', async () => {
    // The screen gets one fixed sentence on purpose; the console and the local
    // crash log get the thrown value, which is the only place the cause exists.
    const thrown = new TypeError('nope')
    await guardedTransfer(() => Promise.reject(thrown))
    expect(reported).toHaveBeenCalledWith('transfer', thrown)
  })

  it('says nothing when the run finishes', async () => {
    // The companion assertion: a guard that reported failure on every run would
    // put a warning under a transfer that actually landed.
    expect(await guardedTransfer(async () => {})).toBeNull()
    expect(reported).not.toHaveBeenCalled()
  })

  it('leaves a run that failed in its own words alone', async () => {
    /*
     * The flow answers its OWN failures — a mistyped code, an unreachable
     * phone — by setting the problem and returning normally. Those must not
     * pick up the generic sentence on top of the specific one.
     */
    let said: string | null = null
    const advice = await guardedTransfer(async () => {
      said = 'That code is the wrong length.'
    })
    expect(advice).toBeNull()
    expect(said).toBe('That code is the wrong length.')
  })
})

/**
 * The wiring, which is the whole of the fix.
 *
 * `guardedTransfer` is four lines of try/catch and holds no transfer logic —
 * exercising it says nothing about whether `start` uses it. This asserts what
 * the defect was actually about: that `start`'s body runs INSIDE the guard, so
 * a rejection from any step becomes a stage and a sentence rather than an
 * unhandled rejection out of `void send.start(...)`.
 */
describe('start runs inside the guard', () => {
  /** Comments stripped, so an assertion cannot pass on prose describing the fix. */
  const code = sendSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  it('awaits guardedTransfer before doing any of the work', () => {
    const start = code.slice(code.indexOf('const start = useCallback('))
    expect(start).toContain('await guardedTransfer(')

    // The steps that can throw are after the guard opens, not before it.
    const opensAt = start.indexOf('guardedTransfer(')
    for (const step of ['decodeAddress(', 'build(']) {
      const at = start.indexOf(step)
      expect(at).toBeGreaterThan(opensAt)
    }
  })

  it('turns the guard’s advice into something on screen', () => {
    const start = code.slice(code.indexOf('const start = useCallback('))
    // The advice has to reach state, or the guard catches into a void.
    expect(start).toContain('setProblem(')
  })
})
