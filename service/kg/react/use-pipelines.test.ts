/**
 * The round, and the two ways it used to leave the engine worse than it found it.
 *
 * `usePipelines` cannot be rendered here — nothing in this package renders — so
 * the round is a module-level function and these tests drive it directly. Both
 * cases below are silent failures: neither shows an error, and both look like
 * the feature simply not working.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import type { ToolHost } from '../agent/execute'
import type { AgentRun } from '../agent/loop'
import type { ToolRuntime } from '../tools/runtime'
import type { Pipeline } from '../core/model'
import { abortInFlight, listedByBoard, runPipelineRound } from './use-pipelines'
import type { PipelineLogEntry, RoundDeps } from './use-pipelines'

const host: ToolHost = {
  memory: () => new MutableSnapshot(),
  today: () => '2026-09-14',
  check: (_n, input) => ({ ok: true, value: input }),
  run: () => ({ ok: true, output: null, announcement: { title: 'Done' }, undo: null }),
}

const pipeline: Pipeline = {
  id: 'pipeline:a',
  name: 'Rust jobs in Berlin',
  source: '—',
  schedule: 'daily',
  filter: '—',
  enabled: true,
  kind: 'scout',
}

/** A model round that ended the way `stopped` says, having done nothing. */
const finishing =
  (stopped: AgentRun['stopped']): RoundDeps['agent'] =>
  async () => ({ messages: [], answer: null, steps: [], stopped, offered: null })

function harness(agent: RoundDeps['agent']) {
  const recorded: { name: string; input: unknown }[] = []
  const log: PipelineLogEntry['tone'][] = []
  const busy = { current: false }
  const cancel: RoundDeps['cancel'] = { current: null }
  const running: (string | null)[] = []

  const run = ((name: string, input: unknown) => {
    recorded.push({ name, input })
    return { ok: true, output: undefined, announcement: { title: 'Pipeline ran' } }
  }) as unknown as ToolRuntime['run']

  const deps: RoundDeps = {
    llm: async () => ({ ok: true, text: '', toolCalls: [], finishReason: 'stop' }),
    host,
    runtime: { run } satisfies Pick<ToolRuntime, 'run'>,
    note: (_id, _text, tone) => log.push(tone),
    busy,
    cancel,
    setRunning: (id) => running.push(id),
    setActivity: () => {},
    agent,
  }
  return { deps, recorded, log, busy, cancel, running }
}

describe('the lock a round holds', () => {
  /*
   * `busy` is one lock for the whole engine, so one throw stopped every
   * pipeline: the tick loop returned at its first line forever, Run now did
   * nothing, and the panel kept showing the pipeline that failed as working.
   * Only a reload recovered it.
   */
  it('releases the engine lock when the agent throws', async () => {
    const { deps, busy, cancel, running, log } = harness(() => {
      throw new Error('the graph query had a missing endpoint')
    })

    await runPipelineRound(pipeline, deps)

    expect(busy.current).toBe(false)
    expect(cancel.current).toBeNull()
    expect(running.at(-1)).toBeNull()
    // And the person is told, because the tick loop drops this promise.
    expect(log).toEqual(['error'])
  })

  it('releases it when the record of the round throws', async () => {
    const { deps, busy } = harness(finishing('answered'))
    deps.runtime = {
      run: (() => {
        throw new Error('the store went away mid-commit')
      }) as unknown as ToolRuntime['run'],
    }

    await runPipelineRound(pipeline, deps)

    expect(busy.current).toBe(false)
  })

  it('still lets the next round run after one threw', async () => {
    const { deps, recorded } = harness(() => {
      throw new Error('first round')
    })
    await runPipelineRound(pipeline, deps)

    deps.agent = finishing('answered')
    await runPipelineRound(pipeline, deps)

    expect(recorded.map((r) => r.name)).toEqual(['pipeline.run.record'])
  })

  it('refuses a second round while one is already in flight', async () => {
    const { deps, busy } = harness(finishing('answered'))
    busy.current = true

    await runPipelineRound(pipeline, deps)

    // Left exactly as it was found: the round in flight still owns the lock.
    expect(busy.current).toBe(true)
  })
})

describe('what an aborted round is allowed to write', () => {
  /*
   * Saving model settings rebuilds `llm`, which tears down the tick effect,
   * whose cleanup aborts the round in flight — and Settings saves per
   * keystroke. Recording that as a finished round cost the pipeline both a
   * schedule gap and a place on the idle counter.
   */
  it('records nothing when the round was aborted', async () => {
    const { deps, recorded } = harness(finishing('aborted'))

    await runPipelineRound(pipeline, deps)

    expect(recorded).toEqual([])
  })

  it('still records a round that answered with nothing to raise', async () => {
    const { deps, recorded } = harness(finishing('answered'))

    await runPipelineRound(pipeline, deps)

    expect(recorded).toEqual([
      { name: 'pipeline.run.record', input: { id: 'pipeline:a', raised: 0 } },
    ])
  })

  /** A run that hit its step cap DID run. Only a stop is not a round. */
  it('records a round that ran out of steps', async () => {
    const { deps, recorded } = harness(finishing('cap'))

    await runPipelineRound(pipeline, deps)

    expect(recorded.map((r) => r.name)).toEqual(['pipeline.run.record'])
  })
})

/**
 * A round that throws must still reach the crash log.
 *
 * Catching it inside the hook fixed a real problem — a rejected round left the
 * schedule wedged — and silently took away the only durable record of it. The
 * throw used to escape into the dropped promise at `void runRoundRef.current`
 * and reach the app's `unhandledrejection` listener, which writes to the crash
 * ring the Diagnostics panel reads and to the one analytics event this app
 * sends. `note()` replaced all of that with an in-memory list capped at two
 * hundred entries and gone on reload.
 */
describe('a round that throws', () => {
  it('is reported as well as noted', async () => {
    const boom = new Error('the model went away')
    const { deps, log } = harness(() => {
      throw boom
    })
    const reported: unknown[] = []

    await runPipelineRound(pipeline, { ...deps, onError: (thrown) => reported.push(thrown) })

    // Both: the log is what an unattended pipeline leaves behind, and the port
    // is what survives a reload.
    expect(log).toContain('error')
    expect(reported).toEqual([boom])
  })
})

describe('what a round is told, and when it may start', () => {
  const twin: Pipeline = { ...pipeline, id: 'pipeline:t', name: 'Me', kind: 'twin', auto: true }

  /*
   * An auto twin is handed the real host, so its writes land — and it was
   * told, in the prompt every pipeline shares, that nothing takes effect and
   * every call is a card. A model that believes that writes more freely.
   */
  it('tells an auto twin that its writes land and can be undone', async () => {
    let prompt = ''
    const { deps } = harness(async (options) => {
      prompt = options.prompt
      return { messages: [], answer: null, steps: [], stopped: 'answered', offered: null }
    })
    await runPipelineRound(twin, deps)
    expect(prompt).toContain('takes effect immediately')
    expect(prompt).toContain('undo')
    expect(prompt).not.toContain('Nothing you call takes effect immediately')

    await runPipelineRound({ ...twin, auto: false }, deps)
    expect(prompt).toContain('Nothing you call takes effect immediately')
  })

  /*
   * Switching a pipeline off set a flag the loop reads between steps; the
   * request in flight ran on, and the engine-wide lock with it.
   */
  it('cancels the round’s own request when the round is stopped', async () => {
    const cancelled: string[] = []
    const { deps, cancel } = harness(async (options) => {
      await options.llm([], [])
      return { messages: [], answer: null, steps: [], stopped: 'aborted', offered: null }
    })
    deps.llmFor = (signal) => () =>
      new Promise((resolve) => {
        signal.onAbort?.(() => {
          cancelled.push('request')
          resolve({ ok: false, error: 'aborted' } as never)
        })
      })
    const round = runPipelineRound(pipeline, deps)
    await Promise.resolve()
    abortInFlight(cancel)
    await round
    expect(cancelled).toEqual(['request'])
  })

  /*
   * The blob index loads after the scheduler's first tick, so the first twin
   * round of a session was told there was no CV.
   */
  it('does not start a twin round before the documents are known', async () => {
    let ran = false
    const { deps, busy } = harness(async () => {
      ran = true
      return { messages: [], answer: null, steps: [], stopped: 'answered', offered: null }
    })
    deps.documentsReady = false
    await runPipelineRound(twin, deps)
    expect(ran).toBe(false)
    expect(busy.current).toBe(false)

    // A scout does not read documents and is not held up by them.
    await runPipelineRound(pipeline, deps)
    expect(ran).toBe(true)
  })
})

describe('what a board read listed', () => {
  /*
   * The background reader opens a suggestion's page in the person's own,
   * signed-in browser, so it may only open what a board actually listed — not
   * any address the model wrote into a suggestion (R6).
   */
  const step = (name: string, status: 'done' | 'failed', output: unknown) => ({
    id: 's1',
    name,
    title: name,
    effect: 'read' as const,
    destructive: false,
    args: { url: 'https://cra.org/ads/' },
    status,
    output,
  })

  it('remembers the postings a finished board.search returned, per pipeline', async () => {
    const { deps } = harness(async (options) => {
      options.onEvent?.({
        type: 'step',
        step: step('board.search', 'done', {
          postings: [{ url: 'https://cra.org/ads/4411', title: 'Lecturer' }],
        }),
      } as never)
      // A second board read in the same round adds to the first.
      options.onEvent?.({
        type: 'step',
        step: step('board.search', 'done', {
          postings: [{ url: 'https://cra.org/ads/5522', title: 'Professor' }],
        }),
      } as never)
      options.onEvent?.({
        type: 'step',
        step: step('board.search', 'failed', {
          postings: [{ url: 'https://cra.org/ads/9999', title: 'Not read' }],
        }),
      } as never)
      options.onEvent?.({
        type: 'step',
        step: step('scout.posting.save', 'done', {
          postings: [{ url: 'https://mail.example/inbox', title: 'x' }],
        }),
      } as never)
      return { messages: [], answer: null, steps: [], stopped: 'answered', offered: null }
    })
    await runPipelineRound({ ...pipeline, id: 'pipeline:listed' }, deps)
    expect(listedByBoard('pipeline:listed', 'https://cra.org/ads/4411')).toBe(true)
    expect(listedByBoard('pipeline:listed', 'https://cra.org/ads/5522')).toBe(true)
    expect(listedByBoard('pipeline:other', 'https://cra.org/ads/4411')).toBe(false)
    expect(listedByBoard('pipeline:listed', 'https://cra.org/ads/9999')).toBe(false)
    expect(listedByBoard('pipeline:listed', 'https://mail.example/inbox')).toBe(false)
  })
})
