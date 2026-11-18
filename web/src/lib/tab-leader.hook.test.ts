/**
 * `useTabLeader`, run (review 3, coverage-4).
 *
 * The hook holds the half of the election `waitToLead` cannot: the one-task
 * deferral that keeps React's development double-mount from leaving an orphan
 * in the queue, the `pagehide` withdrawal, the `pageshow` re-ask, and letting
 * go on unmount. None of it ran in a test before; the call site was matched by
 * a regex. This runner mounts nothing (D20), so a few lines stand in for
 * React's `useState` and `useEffect`, and the window and Web Locks are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * One component's worth of React: state slots by call order, and effects that
 * re-run (cleanup first) when a dependency changed — run after the render, as
 * React runs them after commit.
 */
const slots: unknown[] = []
let cursor = 0
type Effect = { deps: readonly unknown[]; cleanup?: () => void }
const effects: Effect[] = []
let effectCursor = 0
let pending: (() => void)[] = []

vi.mock('react', () => ({
  useState: <T>(initial: T) => {
    const at = cursor++
    if (slots.length <= at) slots.push(initial)
    const set = (next: T | ((prev: T) => T)) => {
      slots[at] = typeof next === 'function' ? (next as (prev: T) => T)(slots[at] as T) : next
    }
    return [slots[at] as T, set] as const
  },
  useEffect: (run: () => (() => void) | void, deps: readonly unknown[]) => {
    const at = effectCursor++
    const before = effects[at]
    if (before !== undefined && deps.every((dep, i) => dep === before.deps[i])) return
    pending.push(() => {
      before?.cleanup?.()
      effects[at] = { deps, cleanup: run() ?? undefined }
    })
  },
}))

const { useTabLeader } = await import('@/lib/tab-leader')

function Tab(): boolean {
  cursor = 0
  effectCursor = 0
  pending = []
  const leader = useTabLeader('jojo-scout')
  for (const run of pending) run()
  return leader
}

function unmount(): void {
  for (const effect of effects) effect.cleanup?.()
}

/** Every request made of the lock, and whether its wait was called off. */
const requests: AbortSignal[] = []
const page = new EventTarget()

beforeEach(() => {
  vi.useFakeTimers()
  slots.length = 0
  effects.length = 0
  requests.length = 0
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    addEventListener: page.addEventListener.bind(page),
    removeEventListener: page.removeEventListener.bind(page),
  })
  vi.stubGlobal('navigator', {
    locks: {
      // Free: granted at once, and held until the request's signal aborts.
      request: async (
        _name: string,
        options: { signal: AbortSignal },
        callback: () => Promise<void>,
      ) => {
        requests.push(options.signal)
        return callback()
      },
    },
  })
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const shown = (persisted: boolean) =>
  Object.assign(new Event('pageshow'), { persisted }) as unknown as Event

describe('useTabLeader (coverage-4)', () => {
  it('asks for the lock a task after mounting, not in the same one', async () => {
    expect(Tab()).toBe(false)
    expect(requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(1)
    expect(Tab()).toBe(true)
  })

  it('makes no request at all for a mount that is cleaned up in the same task', async () => {
    // React's development double-mount: mount, clean up, mount again.
    Tab()
    unmount()
    effects.length = 0
    Tab()
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(1)
  })

  it('withdraws from the line on pagehide, synchronously', async () => {
    Tab()
    await vi.advanceTimersByTimeAsync(0)
    expect(requests[0]?.aborted).toBe(false)
    page.dispatchEvent(new Event('pagehide'))
    expect(requests[0]?.aborted).toBe(true)
  })

  it('asks again when the page comes back from the back/forward cache, and only then', async () => {
    Tab()
    await vi.advanceTimersByTimeAsync(0)
    page.dispatchEvent(new Event('pagehide'))
    page.dispatchEvent(shown(false))
    Tab()
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(1)
    page.dispatchEvent(shown(true))
    Tab()
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.aborted).toBe(false)
  })

  it('lets go and stops leading when unmounted', async () => {
    Tab()
    await vi.advanceTimersByTimeAsync(0)
    expect(Tab()).toBe(true)
    unmount()
    expect(requests[0]?.aborted).toBe(true)
    expect(slots[0]).toBe(false)
    // And stops listening: a later pageshow asks for nothing.
    effects.length = 0
    page.dispatchEvent(shown(true))
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(1)
  })
})
