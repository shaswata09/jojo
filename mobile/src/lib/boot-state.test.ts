/**
 * What the phone shows when its store cannot be read — which was, until this
 * file existed, twelve applications that were not the user's.
 *
 * `StoreProvider` fell back to `bootInMemory({ now })` on both of its failing
 * paths, and `bootInMemory` defaults `dataSet` to 'demo'. The seed is counted
 * rather than described below, because the number is the argument: 92 nodes,
 * 12 of them applications with employers, stages and offer details, appearing
 * under one red line reading "Not saving to this device". `repo/boot.ts`'s own
 * `bootStandIn` passes `dataSet: 'empty'` and says at length why; web passes it
 * too. This is the third caller.
 */

import { describe, expect, it } from 'vitest'
import { NODE_TYPES } from '@jojo/service/core/model'
import type { Instant } from '@jojo/service/core/model'
import { bootInMemory } from '@jojo/service/repo/boot'
import type { BootResult, Session } from '@jojo/service/repo/boot'
import { stateFor, stateForThrow } from './boot-state'

const NOW = '2026-08-26T09:00:00.000Z'
const now = () => NOW as Instant

/** Every node the session would put on screen, of any type. */
const nodeCount = (session: Session) => {
  const snapshot = session.repo.getSnapshot()
  return NODE_TYPES.reduce((total, type) => total + snapshot.ofType(type).length, 0)
}

/** A real durable-looking session, to stand in for a store that opened. */
const opened = () => bootInMemory({ now, dataSet: 'empty' })

describe('a store whose rows could not be read', () => {
  const corrupt: BootResult = { outcome: 'corrupt', detail: 'node 4: bad slug', rescued: null }

  it('does not put the demo fixtures on the phone', () => {
    const state = stateFor(corrupt, now)

    // The whole bug, in one number. It was 92.
    expect(nodeCount(state.session)).toBe(0)
  })

  it('does not tell Settings the store is holding demo data', () => {
    // `meta.dataSet` is what Settings reads before offering to replace the
    // user's records with the fixtures — over records that are on disk and
    // merely unreadable.
    expect(stateFor(corrupt, now).session.repo.meta.dataSet).toBe('empty')
  })

  it('says what happened, with the detail', () => {
    expect(stateFor(corrupt, now).why).toBe(
      'the saved records could not be read (node 4: bad slug).',
    )
  })

  it('reports corrupt to the status context, not unavailable', () => {
    // These were the same reading before: every failure arrived as
    // `unavailable/unsupported`, so nothing downstream could tell a locked
    // database from unreadable rows from a device with no storage.
    expect(stateFor(corrupt, now).status).toEqual({
      phase: 'corrupt',
      detail: 'node 4: bad slug',
      rescued: false,
    })
  })

  it('says so when there are rescued rows to offer', () => {
    const rescued: BootResult = {
      outcome: 'corrupt',
      detail: 'meta unreadable',
      rescued: { nodes: [], edges: [], meta: [], ops: [] },
    }

    expect(stateFor(rescued, now).status).toEqual({
      phase: 'corrupt',
      detail: 'meta unreadable',
      rescued: true,
    })
  })
})

describe('a store that would not open', () => {
  const unavailable = (reason: 'blocked' | 'unsupported'): BootResult => ({
    outcome: 'unavailable',
    reason,
    detail: 'AsyncStorage said no',
    session: opened(),
  })

  it('keeps the reason, because blocked means the records are still on disk', () => {
    expect(stateFor(unavailable('blocked'), now).status).toEqual({
      phase: 'unavailable',
      reason: 'blocked',
    })
    expect(stateFor(unavailable('unsupported'), now).status).toEqual({
      phase: 'unavailable',
      reason: 'unsupported',
    })
  })

  it('says a different sentence for each', () => {
    expect(stateFor(unavailable('blocked'), now).why).toBe(
      'storage is locked by something else on this device.',
    )
    expect(stateFor(unavailable('unsupported'), now).why).toBe(
      'this device has no storage this app can use.',
    )
  })

  it('runs on the session boot handed over rather than minting another', () => {
    const result = unavailable('blocked')
    expect(stateFor(result, now).session).toBe(
      (result as Extract<BootResult, { outcome: 'unavailable' }>).session,
    )
  })
})

describe('a boot that threw instead of reporting', () => {
  it('is empty too — the backstop degrades to what a failed open degrades to', () => {
    expect(nodeCount(stateForThrow(now).session)).toBe(0)
  })

  it('is not confused with a device that has no storage', () => {
    // Two very different failures; the sentence is what tells them apart in a
    // bug report.
    expect(stateForThrow(now).why).toBe('the store could not be opened at all.')
    expect(stateForThrow(now).why).not.toBe(
      stateFor(
        { outcome: 'unavailable', reason: 'unsupported', detail: 'x', session: opened() },
        now,
      ).why,
    )
  })
})

describe('a store that opened', () => {
  it('shows no banner and reports ready', () => {
    const session = opened()
    const state = stateFor({ outcome: 'ready', session }, now)

    expect(state.why).toBeNull()
    expect(state.firstRun).toBe(false)
    expect(state.status).toEqual({
      phase: 'ready',
      dataSet: 'empty',
      // The same clock the session was booted from, rather than a second
      // `Date.now()` read beside it.
      hydratedAt: Date.parse(NOW),
    })
  })

  it('raises the demo-or-empty fork on a first run and on nothing else', () => {
    expect(stateFor({ outcome: 'first-run', session: opened() }, now).firstRun).toBe(true)
    expect(stateFor({ outcome: 'ready', session: opened() }, now).firstRun).toBe(false)
    expect(stateFor({ outcome: 'corrupt', detail: 'x', rescued: null }, now).firstRun).toBe(false)
  })
})
