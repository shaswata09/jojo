/**
 * The queue's rules, over plain values.
 *
 * Every one of these is a way background work has already gone wrong in this
 * app or would have: the same job started twice by a remount, a second model
 * call launched while the first is still going, a list that grows for as long
 * as the app is open, and — the one this whole thing exists for — a job
 * surviving the screen that asked for it. The last is not assertable here,
 * because it is about where the state LIVES; what is assertable is that
 * nothing in the rules below is keyed to a component.
 */

import { describe, expect, it } from 'vitest'
import {
  about,
  enqueue,
  forget,
  isLive,
  isOver,
  live,
  LIMIT,
  mark,
  nextToStart,
  prune,
  REMEMBERED,
} from './jobs'
import type { Job } from './jobs'

const AT = '2026-09-13T09:00:00.000Z'

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  kind: 'tailor',
  label: `Tailoring ${id}`,
  about: 'application:a',
  state: 'queued',
  queuedAt: AT,
  ...over,
})

describe('asking twice', () => {
  it('keeps the job already queued', () => {
    // A panel that remounts — StrictMode does this on every dev mount — must
    // not put a second minute of model time on the queue.
    const once = enqueue([], job('tailor:a:cv'))
    const twice = enqueue(once, job('tailor:a:cv', { label: 'different' }))
    expect(twice).toHaveLength(1)
    expect(twice[0]?.label).toBe('Tailoring tailor:a:cv')
  })

  it('keeps the job already running, however long it has been going', () => {
    const running = mark(enqueue([], job('x')), 'x', { state: 'running', startedAt: AT })
    expect(enqueue(running, job('x'))).toHaveLength(1)
    expect(enqueue(running, job('x'))[0]?.state).toBe('running')
  })

  it('replaces a settled one, because asking again is a new piece of work', () => {
    // Re-run, and Try again after a failure. Both mean "do it once more".
    for (const state of ['done', 'failed', 'cancelled'] as const) {
      const settled = mark(enqueue([], job('x')), 'x', { state })
      const again = enqueue(settled, job('x', { label: 'again' }))
      expect(again).toHaveLength(1)
      expect(again[0]?.state).toBe('queued')
      expect(again[0]?.label).toBe('again')
    }
  })
})

describe('what runs next', () => {
  it('runs one at a time by default', () => {
    // The box answering is one small server; see the header.
    expect(LIMIT).toBe(1)
    const two = enqueue(enqueue([], job('a')), job('b'))
    expect(nextToStart(two)?.id).toBe('a')
    const started = mark(two, 'a', { state: 'running' })
    expect(nextToStart(started)).toBeUndefined()
  })

  it('starts the next the moment a slot frees, in the order they were asked', () => {
    const three = enqueue(enqueue(enqueue([], job('a')), job('b')), job('c'))
    const done = mark(mark(three, 'a', { state: 'running' }), 'a', { state: 'done' })
    expect(nextToStart(done)?.id).toBe('b')
  })

  it('lets a hosted model run several', () => {
    const three = enqueue(enqueue(enqueue([], job('a')), job('b')), job('c'))
    const one = mark(three, 'a', { state: 'running' })
    expect(nextToStart(one, 3)?.id).toBe('b')
    const two = mark(one, 'b', { state: 'running' })
    expect(nextToStart(two, 3)?.id).toBe('c')
    expect(nextToStart(mark(two, 'c', { state: 'running' }), 3)).toBeUndefined()
  })

  it('never starts anything settled', () => {
    const settled = mark(enqueue([], job('a')), 'a', { state: 'failed' })
    expect(nextToStart(settled)).toBeUndefined()
  })
})

describe('over and live', () => {
  it('counts the three settled states as over, and the two others as live', () => {
    expect(isOver(job('a', { state: 'done' }))).toBe(true)
    expect(isOver(job('a', { state: 'failed' }))).toBe(true)
    expect(isOver(job('a', { state: 'cancelled' }))).toBe(true)
    expect(isLive(job('a', { state: 'queued' }))).toBe(true)
    expect(isLive(job('a', { state: 'running' }))).toBe(true)
  })

  it('lists the live ones oldest first', () => {
    const jobs = mark(enqueue(enqueue(enqueue([], job('a')), job('b')), job('c')), 'b', {
      state: 'done',
    })
    expect(live(jobs).map((j) => j.id)).toEqual(['a', 'c'])
  })
})

describe('whose job it is', () => {
  it('finds one record’s jobs and leaves another record’s alone', () => {
    const jobs = enqueue(enqueue([], job('a')), job('b', { about: 'application:b' }))
    expect(about(jobs, 'application:a').map((j) => j.id)).toEqual(['a'])
    expect(about(jobs, 'application:b').map((j) => j.id)).toEqual(['b'])
    expect(about(jobs, 'application:none')).toEqual([])
  })
})

describe('clearing a key', () => {
  it('drops it rather than storing undefined', () => {
    // `{ step: undefined }` is not assignable under exactOptionalPropertyTypes,
    // and a stored `undefined` survives as a present key that an `in` check
    // reads as set (D21). A finished job must not still say what it was doing.
    const running = mark(enqueue([], job('a')), 'a', { state: 'running', step: 'Writing' })
    const done = mark(running, 'a', { state: 'done' }, ['step'])
    expect(Object.hasOwn(done[0] ?? {}, 'step')).toBe(false)
  })
})

describe('forgetting', () => {
  it('forgets a settled job', () => {
    const jobs = mark(enqueue([], job('a')), 'a', { state: 'done' })
    expect(forget(jobs, 'a')).toEqual([])
  })

  it('refuses to forget one that is still going', () => {
    // Forgetting a running job would leave a promise writing into a queue that
    // no longer knows about it — the orphan this whole file exists to prevent.
    const running = mark(enqueue([], job('a')), 'a', { state: 'running' })
    expect(forget(running, 'a')).toHaveLength(1)
  })
})

describe('not growing forever', () => {
  it('drops the oldest settled past the bound', () => {
    let jobs: readonly Job[] = []
    for (let i = 0; i < REMEMBERED + 5; i += 1) {
      jobs = mark(enqueue(jobs, job(`j${String(i)}`)), `j${String(i)}`, { state: 'done' })
    }
    expect(jobs).toHaveLength(REMEMBERED)
    expect(jobs[0]?.id).toBe('j5')
  })

  it('never drops a live job, however many there are', () => {
    let jobs: readonly Job[] = []
    for (let i = 0; i < REMEMBERED + 5; i += 1) jobs = enqueue(jobs, job(`q${String(i)}`))
    expect(jobs).toHaveLength(REMEMBERED + 5)
    expect(prune(jobs, 2)).toHaveLength(REMEMBERED + 5)
  })

  it('prunes on the way in, so nobody has to remember to call it', () => {
    let jobs: readonly Job[] = []
    for (let i = 0; i < REMEMBERED + 3; i += 1) {
      jobs = mark(enqueue(jobs, job(`j${String(i)}`)), `j${String(i)}`, { state: 'failed' })
    }
    expect(jobs.length).toBeLessThanOrEqual(REMEMBERED)
  })
})
