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
import { runPipelineRound } from './use-pipelines'
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
