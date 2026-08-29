/**
 * What `boot()` said, turned into what the provider shows — out of
 * `lib/store.tsx`, where two of its four answers were being collapsed into one.
 *
 * ## The stand-in was the demo fixtures
 *
 * Both failing arms of `StoreProvider` called `bootInMemory({ now })`, and
 * `bootInMemory` defaults `dataSet` to `'demo'`. Measured on the real function:
 * that is 92 seeded nodes — 12 applications with employers, stages, offer
 * details and interview dates — put on screen under one line of red text reading
 * "Not saving to this device". Nothing anywhere said they were not the user's.
 * `service/kg/repo/boot.ts` names this exact outcome as the worst available
 * here and its own `bootStandIn` passes `dataSet: 'empty'`; so does
 * `web/src/lib/store.tsx`. The phone was the one caller that did not.
 *
 * Empty is the honest reading and the safe one. A corrupt store means the rows
 * are there and could not be read; an empty list under "the saved records could
 * not be read" says exactly that, while twelve fabricated jobs say the opposite
 * of it and are indistinguishable from a restore having silently happened.
 *
 * ## And the four outcomes were three
 *
 * `StorePhase` has arms for corrupt, for blocked and for unsupported, and the
 * provider mapped every failure to `{ phase: 'unavailable', reason:
 * 'unsupported' }` — so a database another app has locked, a device with no
 * storage at all, and rows that failed validation all reported the same thing to
 * anything reading the status context. The banner's sentence already
 * distinguished them; the machine-readable half did not, and that is the half a
 * recovery panel would have to switch on.
 *
 * Here rather than in `store.tsx` because none of it needs React and all of it
 * needs running: the corrupt branch is reached by a store this test suite can
 * construct and a phone almost never will.
 */

import type { Instant } from '@jojo/service/core/model'
import { bootInMemory } from '@jojo/service/repo/boot'
import type { BootResult, Session } from '@jojo/service/repo/boot'
import type { StorePhase } from '@jojo/service/react/status-context'

export type StoreState = {
  session: Session
  /**
   * Null when the store opened. Otherwise the second half of the banner's
   * sentence — "Not saving to this device — …" — which is the only thing that
   * tells someone their evening's typing will not survive the app closing.
   */
  why: string | null
  /** What the status context is told. One arm per outcome, not one for all of them. */
  status: StorePhase
  /** The launch where the store was empty and the demo-or-empty fork is free. */
  firstRun: boolean
}

/**
 * The session a failed open falls back to: in memory, and EMPTY.
 *
 * `dataSet: 'empty'` is the whole point of this function existing — see the
 * header. It is the same choice `bootStandIn` makes inside the package, made
 * again here because that one is private to `repo/boot.ts`.
 */
const standIn = (now: () => Instant): Session => bootInMemory({ now, dataSet: 'empty' })

/**
 * `hydratedAt` from the SAME clock the session was booted from.
 *
 * `Date.now()` was read separately in the provider, so the timestamp the status
 * context reports and the timestamps in the graph came from two different
 * readings — which is invisible until something compares them.
 */
const hydratedAt = (now: () => Instant) => Date.parse(now())

export function stateFor(result: BootResult, now: () => Instant): StoreState {
  // 'corrupt' is the only outcome without a session: the rows on disk failed
  // validation and `boot` will not hand back a graph built from them. The other
  // three all carry one, working, and differ only in what has to be said.
  if (result.outcome === 'corrupt') {
    return {
      session: standIn(now),
      why: `the saved records could not be read (${result.detail}).`,
      // `rescued` is what the recovery panel offers to download before anything
      // else, so whether there is anything to offer is part of the reading.
      status: { phase: 'corrupt', detail: result.detail, rescued: result.rescued !== null },
      firstRun: false,
    }
  }

  if (result.outcome === 'unavailable') {
    return {
      session: result.session,
      why:
        result.reason === 'blocked'
          ? 'storage is locked by something else on this device.'
          : 'this device has no storage this app can use.',
      // Carried through rather than flattened: 'blocked' means there IS a
      // database on disk with the user's records in it, which is a different
      // thing to say and a different thing to do about it.
      status: { phase: 'unavailable', reason: result.reason },
      firstRun: false,
    }
  }

  return {
    session: result.session,
    why: null,
    status: {
      phase: 'ready',
      dataSet: result.session.repo.meta.dataSet,
      hydratedAt: hydratedAt(now),
    },
    // Asked once, on the launch where the store was empty. `boot` writes the
    // meta row that stops it being asked again.
    firstRun: result.outcome === 'first-run',
  }
}

/**
 * The backstop for a `boot()` that throws instead of returning.
 *
 * It is not supposed to be reachable — `boot` reports rather than throws — and
 * it degrades to exactly what an unavailable store degrades to, including the
 * empty stand-in. Kept separate from `stateFor` so the sentence can say what
 * actually happened: "could not be opened at all" is a different fact from
 * "this device has no storage", and a user reporting one should not be reading
 * the other back to us. The thrown error itself is the caller's to log; it is
 * not put in front of the user, because a stack trace in a banner is not a
 * sentence anybody can act on.
 */
export function stateForThrow(now: () => Instant): StoreState {
  return {
    session: standIn(now),
    why: 'the store could not be opened at all.',
    status: { phase: 'unavailable', reason: 'unsupported' },
    firstRun: false,
  }
}
