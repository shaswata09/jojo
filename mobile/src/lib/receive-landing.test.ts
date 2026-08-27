/**
 * One transfer, one offer to replace the phone — however long the poll runs.
 *
 * The session these tests hand over is the shape a finished convoy really has:
 * `complete` latches true and `payload()` keeps returning the same bytes, which
 * is what made the panel's flag load-bearing. The panel cleared that flag when
 * the confirmation sheet closed, so the tick 250 ms later re-offered the same
 * backup — Cancel could not cancel, and because `ConfirmSheet` calls `onClose()`
 * before `onConfirm()`, agreeing re-offered it too, on top of an `applyPlan`
 * that had not finished.
 *
 * So every test below ticks well past the point of completion and counts. A
 * landing that offered twice would be indistinguishable from the fixed one on a
 * single tick.
 *
 * `react-native-blob-util` is stubbed for the reason it is in
 * `restore-documents.test.ts`: `planReceived` reaches it through the restore
 * path, this suite runs on node, and nothing here touches a file.
 */

import { describe, expect, it, vi } from 'vitest'
import { createLanding } from './receive-landing'
import type { LandingSource } from './receive-landing'
import type { RestorePlan } from '@jojo/service/core/backup'

vi.mock('react-native-blob-util', () => ({
  default: { fs: { dirs: { DocumentDir: '/data/user/0/dev.jojo/files' } } },
}))

/** A backup this build reads: the format, the version, an empty graph. */
const BACKUP = JSON.stringify({
  format: 'jojo.backup',
  version: 1,
  exportedAt: '2026-08-24T10:00:00.000Z',
  graph: { nodes: [{ id: 'n1' }], edges: [] },
  documents: [],
})

/**
 * ASCII to bytes without `TextEncoder`. Not a purity ritual — the payload a
 * transfer carries is UTF-8 and every character above is one byte, so this is
 * the encoding, and it keeps the test off a global Hermes does not have either.
 */
const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

/**
 * A convoy that finishes after `until` ticks and then stays finished, which is
 * exactly what `core/convoy.ts` does: `done` is never cleared.
 */
function session(payload: Uint8Array | null, until = 1): LandingSource & { stops: number } {
  let ticks = 0
  const state = {
    stops: 0,
    progress: () => {
      ticks += 1
      return { bytes: ticks * 100, complete: ticks >= until }
    },
    payload: () => payload,
    stop: () => {
      state.stops += 1
    },
  }
  return state
}

function watch() {
  const plans: RestorePlan[] = []
  const failures: string[] = []
  const seen: number[] = []
  return {
    plans,
    failures,
    seen,
    report: {
      onBytes: (n: number) => seen.push(n),
      onPlan: (plan: RestorePlan) => plans.push(plan),
      onFailure: (message: string) => failures.push(message),
    },
  }
}

describe('createLanding — while the transfer is still arriving', () => {
  it('reports bytes on every tick and offers nothing', () => {
    const w = watch()
    const tick = createLanding(session(bytes(BACKUP), 5), w.report)

    tick()
    tick()
    tick()

    expect(w.seen).toEqual([100, 200, 300])
    expect(w.plans).toEqual([])
    expect(w.failures).toEqual([])
  })
})

describe('createLanding — once the last chunk has authenticated', () => {
  it('offers the plan and closes the socket', () => {
    const w = watch()
    const convoy = session(bytes(BACKUP), 1)
    const tick = createLanding(convoy, w.report)

    tick()

    expect(w.plans).toHaveLength(1)
    expect(w.plans[0]?.nodes).toHaveLength(1)
    expect(convoy.stops).toBe(1)
  })

  it('never offers a second time, however long the poll keeps running', () => {
    const w = watch()
    const convoy = session(bytes(BACKUP), 1)
    const tick = createLanding(convoy, w.report)

    // Twenty ticks is five seconds of the real 250 ms poll — a person reading
    // the sheet before deciding. `complete` is still true on every one of them.
    for (let i = 0; i < 20; i += 1) tick()

    expect(w.plans).toHaveLength(1)
    // And the socket is closed once, not twenty times.
    expect(convoy.stops).toBe(1)
  })

  it('stays closed after the person declines, because declining cannot reach the latch', () => {
    const w = watch()
    const tick = createLanding(session(bytes(BACKUP), 1), w.report)

    tick()
    // What the panel does on Cancel — and on Confirm, since `ConfirmSheet` runs
    // `onClose()` first. Whatever it clears, it is not this.
    for (let i = 0; i < 20; i += 1) tick()

    expect(w.plans).toHaveLength(1)
  })

  it('reports authenticated bytes that are not a backup, once', () => {
    const w = watch()
    const tick = createLanding(session(bytes('{"format":"something else"}'), 1), w.report)

    tick()
    tick()
    tick()

    expect(w.plans).toEqual([])
    expect(w.failures).toHaveLength(1)
    expect(w.failures[0]).toContain('not written by jojo')
  })
})

describe('createLanding — a new pairing is a new latch', () => {
  it('offers again for the next session, so declining does not wedge the screen', () => {
    const w = watch()
    createLanding(session(bytes(BACKUP), 1), w.report)()
    // The person said no, scanned the code again, and a second session began.
    createLanding(session(bytes(BACKUP), 1), w.report)()

    expect(w.plans).toHaveLength(2)
  })
})
