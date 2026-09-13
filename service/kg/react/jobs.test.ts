/**
 * The registry, driven with no tree at all.
 *
 * It is a plain closure for exactly this reason — under D20 no provider can be
 * mounted, and the behaviour that matters is what happens to work when the
 * screen that asked for it goes away. A component cannot be unmounted here, so
 * the test asserts the property that makes unmounting harmless: nothing
 * cancels a job except a person, a torn-down store, or the work itself.
 */

import { describe, expect, it, vi } from 'vitest'
import { createJobs } from './jobs'
import type { Job } from '../core/jobs'
import type { JobOutcome } from './jobs'

const AT = '2026-09-13T09:00:00.000Z'

/** One turn of the microtask queue, for a promise that has already resolved. */
const sleep = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

/** A cancellation in the two-field shape the apps hand over. */
const newSignal = () => {
  const state = { aborted: false }
  return {
    signal: state,
    abort: () => {
      state.aborted = true
    },
  }
}

function harness(limit?: number) {
  let tick = 0
  const settled: Job[] = []
  const jobs = createJobs<{ aborted: boolean }>({
    newSignal,
    now: () => new Date(Date.parse(AT) + tick++ * 1000).toISOString(),
    ...(limit === undefined ? {} : { limit }),
    onSettled: (job) => settled.push(job),
  })
  return { jobs, settled }
}

/** A job whose completion the test decides. */
function deferred() {
  let finish: (outcome: JobOutcome) => void = () => {}
  const promise = new Promise<JobOutcome>((resolve) => {
    finish = resolve
  })
  const seen: { signal?: { aborted: boolean }; onStep?: (s: string) => void } = {}
  return {
    seen,
    finish,
    run: (control: { signal: { aborted: boolean }; onStep: (s: string) => void }) => {
      seen.signal = control.signal
      seen.onStep = control.onStep
      control.onStep('started')
      return promise
    },
  }
}

const spec = (
  id: string,
  run: ReturnType<typeof deferred>['run'],
  over: Record<string, string> = {},
) => ({
  id,
  kind: 'tailor',
  label: `Tailoring ${id}`,
  about: 'application:a',
  run,
  ...over,
})

describe('work outlives whoever asked for it', () => {
  it('keeps running when nothing but the job itself can stop it', async () => {
    /*
     * THE property, stated as the absence of a cancel. The reported defect was
     * a panel aborting its own work from an unmount cleanup; here the only
     * abort is `cancel`, and the run below is never cancelled — so it finishes,
     * and the person who navigated away is told.
     */
    const { jobs, settled } = harness()
    const work = deferred()
    jobs.start(spec('tailor:a:cv', work.run))
    expect(jobs.get('tailor:a:cv')?.state).toBe('running')

    work.finish({ ok: true })
    await vi.waitFor(() => expect(jobs.get('tailor:a:cv')?.state).toBe('done'))
    expect(work.seen.signal?.aborted).toBe(false)
    expect(settled.map((j) => [j.id, j.state])).toEqual([['tailor:a:cv', 'done']])
  })

  it('reports the step while it runs, and drops it when it finishes', async () => {
    const { jobs } = harness()
    const work = deferred()
    jobs.start(spec('a', work.run))
    expect(jobs.get('a')?.step).toBe('started')

    work.finish({ ok: true })
    await vi.waitFor(() => expect(jobs.get('a')?.state).toBe('done'))
    expect(Object.hasOwn(jobs.get('a') ?? {}, 'step')).toBe(false)
  })

  it('carries a failure’s reason to whoever is listening', async () => {
    const { jobs, settled } = harness()
    const work = deferred()
    jobs.start(spec('a', work.run))
    work.finish({ ok: false, reason: 'The model answered with nothing at all.' })

    await vi.waitFor(() => expect(jobs.get('a')?.state).toBe('failed'))
    expect(jobs.get('a')?.error).toMatch(/nothing at all/)
    expect(settled[0]?.error).toMatch(/nothing at all/)
  })

  it('survives a job that throws, rather than running forever', async () => {
    const { jobs } = harness()
    jobs.start(spec('a', () => Promise.reject(new Error('boom')) as never))
    await vi.waitFor(() => expect(jobs.get('a')?.state).toBe('failed'))
    expect(jobs.get('a')?.error).toBe('boom')
  })
})

describe('one at a time', () => {
  it('holds the second until the first is done, then starts it', async () => {
    const { jobs } = harness()
    const first = deferred()
    const second = deferred()
    jobs.start(spec('a', first.run))
    jobs.start(spec('b', second.run))

    expect(jobs.get('a')?.state).toBe('running')
    expect(jobs.get('b')?.state).toBe('queued')
    // And the second was not handed a signal, because it has not begun.
    expect(second.seen.signal).toBeUndefined()

    first.finish({ ok: true })
    await vi.waitFor(() => expect(jobs.get('b')?.state).toBe('running'))
  })

  it('starts the next one when the first is cancelled, not only when it finishes', async () => {
    const { jobs } = harness()
    const first = deferred()
    const second = deferred()
    jobs.start(spec('a', first.run))
    jobs.start(spec('b', second.run))

    jobs.cancel('a')
    expect(jobs.get('a')?.state).toBe('cancelled')
    expect(first.seen.signal?.aborted).toBe(true)
    await vi.waitFor(() => expect(jobs.get('b')?.state).toBe('running'))
  })

  it('runs several when the model is somebody else’s', () => {
    const { jobs } = harness(3)
    jobs.start(spec('a', deferred().run))
    jobs.start(spec('b', deferred().run))
    jobs.start(spec('c', deferred().run))
    expect([jobs.get('a'), jobs.get('b'), jobs.get('c')].map((j) => j?.state)).toEqual([
      'running',
      'running',
      'running',
    ])
  })
})

describe('asking twice', () => {
  it('does not start a second copy of a running job', () => {
    const { jobs } = harness()
    const first = deferred()
    const second = deferred()
    jobs.start(spec('a', first.run))
    jobs.start(spec('a', second.run))
    expect(second.seen.signal).toBeUndefined()
    expect(jobs.all()).toHaveLength(1)
  })

  it('runs it again once it has settled — that is what Re-run is', async () => {
    const { jobs } = harness()
    const first = deferred()
    jobs.start(spec('a', first.run))
    first.finish({ ok: true })
    await vi.waitFor(() => expect(jobs.get('a')?.state).toBe('done'))

    const again = deferred()
    jobs.start(spec('a', again.run))
    expect(jobs.get('a')?.state).toBe('running')
    expect(again.seen.signal).toBeDefined()
  })
})

describe('cancelling', () => {
  it('never reports a cancelled job as a failure', async () => {
    // A person stopping something is not an error, and a toast that said so
    // would be the app arguing with them.
    const { jobs, settled } = harness()
    const work = deferred()
    jobs.start(spec('a', work.run))
    jobs.cancel('a')
    // The run resolves afterwards, as an aborted fetch does.
    work.finish({ ok: false, reason: 'aborted' })
    await vi.waitFor(() => expect(jobs.get('a')?.state).toBe('cancelled'))
    expect(jobs.get('a')?.error).toBeUndefined()
    expect(settled.filter((j) => j.state === 'failed')).toEqual([])
  })

  it('settles once, so a job somebody stopped never announces itself as done', async () => {
    /*
     * The race every cancel has: the person presses Cancel, the fetch unwinds a
     * moment later, and the run resolves with whatever it had. Settling is what
     * raises the toast, so a second settle would tell them their tailored CV is
     * ready after they said not to write it.
     */
    const { jobs, settled } = harness()
    const work = deferred()
    jobs.start(spec('a', work.run))
    jobs.cancel('a')
    work.finish({ ok: true })
    await sleep()

    expect(jobs.get('a')?.state).toBe('cancelled')
    expect(settled.filter((j) => j.id === 'a')).toHaveLength(1)
  })

  it('ignores a step reported after the job is over', async () => {
    // A straggler from an aborted run must not put a finished card back to
    // work — the card is gated on the job being live.
    const { jobs } = harness()
    const work = deferred()
    jobs.start(spec('a', work.run))
    work.finish({ ok: true })
    await vi.waitFor(() => expect(jobs.get('a')?.state).toBe('done'))

    work.seen.onStep?.('Writing the tailored version')
    expect(jobs.get('a')?.state).toBe('done')
    expect(Object.hasOwn(jobs.get('a') ?? {}, 'step')).toBe(false)
  })

  it('stops a job that has not started without ever running it', () => {
    const { jobs } = harness()
    const first = deferred()
    const queued = deferred()
    jobs.start(spec('a', first.run))
    jobs.start(spec('b', queued.run))
    jobs.cancel('b')
    expect(jobs.get('b')?.state).toBe('cancelled')
    expect(queued.seen.signal).toBeUndefined()
  })

  it('stops everything when the store is torn down', () => {
    const { jobs } = harness()
    const first = deferred()
    jobs.start(spec('a', first.run))
    jobs.start(spec('b', deferred().run))
    jobs.stopAll()
    expect([jobs.get('a')?.state, jobs.get('b')?.state]).toEqual(['cancelled', 'cancelled'])
    expect(first.seen.signal?.aborted).toBe(true)
  })
})

describe('what a screen sees', () => {
  it('hands back the same array until something moves', () => {
    // `useSyncExternalStore` compares what the getter returns; a fresh array
    // every call is an infinite render loop rather than a slow one.
    const { jobs } = harness()
    jobs.start(spec('a', deferred().run))
    const first = jobs.about('application:a')
    expect(jobs.about('application:a')).toBe(first)
    expect(jobs.live()).toBe(jobs.live())

    jobs.start(spec('b', deferred().run, { about: 'application:a' }))
    expect(jobs.about('application:a')).not.toBe(first)
  })

  it('keeps one record’s jobs out of another’s', () => {
    const { jobs } = harness()
    jobs.start(spec('a', deferred().run))
    jobs.start(spec('b', deferred().run, { about: 'application:b' }))
    expect(jobs.about('application:a').map((j) => j.id)).toEqual(['a'])
    expect(jobs.about('application:b').map((j) => j.id)).toEqual(['b'])
  })

  it('tells listeners once per change', () => {
    const { jobs } = harness()
    const heard = vi.fn()
    const stop = jobs.subscribe(heard)
    jobs.start(spec('a', deferred().run))
    expect(heard.mock.calls.length).toBeGreaterThan(0)
    stop()
    const before = heard.mock.calls.length
    jobs.start(spec('b', deferred().run))
    expect(heard.mock.calls.length).toBe(before)
  })
})
