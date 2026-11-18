/**
 * The pairing hook, run with real core pairing (review 3, coverage-8).
 *
 * Only `armRefresh` was tested; the hook itself sat at 4.5% coverage. What it
 * holds is security-relevant: the offer is single-use, so a second device
 * cannot pair against a session already in use, and a response is checked
 * against the offer whose path it arrived on, so the phone that scanned the
 * code just before it was replaced is not refused. This runner mounts nothing
 * (D20); a few lines stand in for React's hooks, and the phone's half of each
 * pairing is `acceptPairing`, as the phone runs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAIRING_TTL_MS, acceptPairing } from '@jojo/service/core/pairing'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'

/*
 * One component's worth of React: state, refs and memos in slots by call
 * order, and effects that re-run (cleanup first) when a dependency changed,
 * after the render — as React runs them after commit.
 */
const slots: unknown[] = []
let cursor = 0
type Effect = { deps: readonly unknown[]; cleanup?: () => void }
const effects: Effect[] = []
let effectCursor = 0
let pending: (() => void)[] = []
const same = (a: readonly unknown[], b: readonly unknown[]) => a.every((dep, i) => dep === b[i])

vi.mock('react', () => {
  const slot = <T>(make: () => T): { at: number; value: T } => {
    const at = cursor++
    if (slots.length <= at) slots.push(make())
    return { at, value: slots[at] as T }
  }
  const memo = <T>(make: () => T, deps: readonly unknown[]): T => {
    const { at, value } = slot(() => ({ deps, value: make() }))
    const held = value as { deps: readonly unknown[]; value: T }
    if (same(deps, held.deps)) return held.value
    slots[at] = { deps, value: make() }
    return (slots[at] as { value: T }).value
  }
  return {
    useState: <T>(initial: T | (() => T)) => {
      const { at, value } = slot(() =>
        typeof initial === 'function' ? (initial as () => T)() : initial,
      )
      const set = (next: T | ((prev: T) => T)) => {
        slots[at] = typeof next === 'function' ? (next as (prev: T) => T)(slots[at] as T) : next
      }
      return [value, set] as const
    },
    useRef: <T>(initial: T) => slot(() => ({ current: initial })).value,
    useMemo: memo,
    useCallback: <T>(fn: T, deps: readonly unknown[]) => memo(() => fn, deps),
    useEffect: (run: () => (() => void) | void, deps: readonly unknown[]) => {
      const at = effectCursor++
      const before = effects[at]
      if (before !== undefined && same(deps, before.deps)) return
      pending.push(() => {
        before?.cleanup?.()
        effects[at] = { deps, cleanup: run() ?? undefined }
      })
    },
  }
})

const { offerFor, usePairingSession } = await import('@/lib/pairing-session')

type Session = ReturnType<typeof usePairingSession>

function Screen(active = true): Session {
  cursor = 0
  effectCursor = 0
  pending = []
  const session = usePairingSession(active, 'push')
  for (const run of pending) run()
  return session
}

/** Lets the mint's awaits land, then renders what they set. */
async function settle(active = true): Promise<Session> {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0)
  return Screen(active)
}

const phone = createSecrets()

/** What a phone that read `offer` off the screen answers. */
async function answer(offer: Uint8Array | null): Promise<Uint8Array> {
  expect(offer).not.toBeNull()
  const accepted = await acceptPairing(phone, offer as Uint8Array)
  if (!accepted.ok) throw new Error(accepted.error)
  return accepted.value.response
}

beforeEach(() => {
  vi.useFakeTimers()
  slots.length = 0
  effects.length = 0
})

afterEach(() => {
  for (const effect of effects) effect.cleanup?.()
  vi.useRealTimers()
})

describe('which offer a response is checked against (coverage-8)', () => {
  const live = { state: 'live', token: 'T2' }
  const previous = { state: 'previous', token: 'T1' }

  it('takes the replaced offer only for a response on its path', () => {
    expect(offerFor('T1', live, previous)).toBe('previous')
  })

  it('takes the live offer for its own path, no path, or an unknown one', () => {
    expect(offerFor('T2', live, previous)).toBe('live')
    expect(offerFor(undefined, live, previous)).toBe('live')
    expect(offerFor('T9', live, previous)).toBe('live')
  })

  it('takes the live offer when nothing was replaced, or when both carry the token', () => {
    expect(offerFor('T1', live, null)).toBe('live')
    expect(offerFor('T2', live, { state: 'previous', token: 'T2' })).toBe('live')
  })
})

describe('usePairingSession (coverage-8)', () => {
  it('pairs the device that read the screen, and spends the offer doing it', async () => {
    Screen()
    const shown = await settle()
    expect(shown.phase).toBe('offering')
    expect(shown.token).not.toBeNull()

    const keys = await shown.complete(await answer(shown.offer), shown.token ?? undefined)
    expect(keys).not.toBeNull()
    const after = Screen()
    expect(after.phase).toBe('paired')
    expect(after.keys).toBe(keys)
    expect(after.offer).toBeNull()

    // A second device answering the same code is refused: the offer is spent.
    const second = await after.complete(await answer(shown.offer), shown.token ?? undefined)
    expect(second).toBeNull()
    expect(Screen().keys).toBe(keys)
  })

  it('answers the phone that scanned the code just before it was replaced', async () => {
    Screen()
    const first = await settle()
    const scanned = first.offer
    const oldToken = first.token
    // The re-mint, twenty seconds before the first code expires.
    await vi.advanceTimersByTimeAsync(PAIRING_TTL_MS - 20_000)
    Screen()
    const replaced = await settle()
    expect(replaced.token).not.toBe(oldToken)
    expect(replaced.tokens).toEqual([replaced.token, oldToken])

    const keys = await replaced.complete(await answer(scanned), oldToken ?? undefined)
    expect(keys).not.toBeNull()
    expect(Screen().phase).toBe('paired')
  })

  it('puts a new code up for a response to an expired one', async () => {
    Screen()
    const shown = await settle()
    const response = await answer(shown.offer)
    vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1)
    expect(await shown.complete(response, shown.token ?? undefined)).toBeNull()
    // The refresh takes effect on the next render, and the new code a moment later.
    Screen()
    const after = await settle()
    expect(after.refused).toBe('pairing/expired')
    expect(after.keys).toBeNull()
    expect(after.phase).toBe('offering')
    expect(after.token).not.toBe(shown.token)
  })

  it('takes the keys and the offer with it when the screen is left', async () => {
    Screen()
    const shown = await settle()
    expect(await shown.complete(await answer(shown.offer), shown.token ?? undefined)).not.toBeNull()
    Screen(false)
    const left = Screen(false)
    expect(left).toMatchObject({ offer: null, token: null, keys: null, phase: 'starting' })
    // And nothing it held can pair any more.
    expect(await left.complete(await answer(shown.offer), shown.token ?? undefined)).toBeNull()
  })
})
