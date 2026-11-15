/**
 * Owner requests about the two pipelines, held on the round itself.
 *
 * Q126 — Pipeline 1 (the twin) keeps the graph up to date. Every action is an
 *        approval card; in auto mode it runs them and logs each one. Driven
 *        through `runPipelineRound`, the module-level round `usePipelines`
 *        calls, because nothing in this package renders (D20).
 * Q127 — Pipeline 2 (the scout) only ever fills the review queue: even a scout
 *        stored with `auto: true` has its save turned into a card, never run.
 * Q128 — a pipeline that has run out of work offers to switch itself off: the
 *        modal is raised for an enabled pipeline with two idle rounds and an
 *        empty queue, and never while a round is running. `shutdownCandidate`
 *        is the hook's own derivation, lifted out unchanged.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import type { ToolHost } from '../agent/execute'
import type { AgentStep } from '../agent/types'
import type { ToolRuntime } from '../tools/runtime'
import type { Pipeline } from '../core/model'
import { runPipelineRound, shutdownCandidate } from './use-pipelines'
import type { PipelineLogEntry, RoundDeps } from './use-pipelines'

const twin: Pipeline = {
  id: 'pipeline:t',
  name: 'Me',
  source: '—',
  schedule: 'daily',
  filter: '—',
  enabled: true,
  kind: 'twin',
}

/** A done write step, the shape the loop reports after a tool call lands. */
const wrote: AgentStep = {
  id: 'step-1',
  name: 'application.note.set',
  title: 'Set a note',
  effect: 'update',
  destructive: false,
  args: { id: 'application-1', note: 'Ask about the start date.' },
  status: 'done',
  announcement: { title: 'Note saved', description: 'Rice — Assistant professor' },
}

/**
 * A round whose model makes one write through the host it was handed, then
 * reports the step. What reaches the REAL host is the thing being asserted.
 */
function round(step: AgentStep = wrote) {
  const reachedHost: string[] = []
  const log: { text: string; tone: PipelineLogEntry['tone'] }[] = []
  const host: ToolHost = {
    memory: () => new MutableSnapshot(),
    today: () => '2026-09-14',
    check: (_n, input) => ({ ok: true, value: input }),
    run: (name) => {
      reachedHost.push(name)
      return { ok: true, output: null, announcement: { title: 'Done' }, undo: null }
    },
  }
  const deps: RoundDeps = {
    llm: async () => ({ ok: true, text: '', toolCalls: [], finishReason: 'stop' }),
    host,
    runtime: {
      run: (() => ({ ok: true, output: undefined })) as unknown as ToolRuntime['run'],
    },
    note: (_id, text, tone) => log.push({ text, tone }),
    busy: { current: false },
    cancel: { current: null },
    setRunning: () => {},
    setActivity: () => {},
    agent: async (options) => {
      options.host.run(step.name as never, step.args)
      options.onEvent?.({ type: 'step', step })
      return { messages: [], answer: null, steps: [step], stopped: 'answered', offered: null }
    },
  }
  return { deps, reachedHost, log }
}

describe('Q126 the twin pipeline: approval cards, or auto with a log', () => {
  it('turns a write into an approval card when the twin is not auto, and logs it as suggested', async () => {
    const { deps, reachedHost, log } = round()
    await runPipelineRound({ ...twin, auto: false }, deps)

    // The note never reached the store; a proposal did.
    expect(reachedHost).toEqual(['pipeline.proposal.raise'])
    expect(log).toEqual([{ text: 'Note saved — Rice — Assistant professor', tone: 'suggested' }])
  })

  it('runs the write itself in auto mode, and logs it as applied', async () => {
    const auto = { ...twin, auto: true }
    const { deps, reachedHost, log } = round()
    await runPipelineRound(auto, deps)

    expect(reachedHost).toEqual(['application.note.set'])
    expect(log).toEqual([{ text: 'Note saved — Rice — Assistant professor', tone: 'applied' }])
  })
})

describe('Q127 the scout pipeline only adds to the review queue', () => {
  it('queues a found posting for approval even when the scout is stored as auto', async () => {
    const scout: Pipeline = { ...twin, id: 'pipeline:s', kind: 'scout', auto: true }
    const saved: AgentStep = {
      ...wrote,
      name: 'scout.posting.save',
      title: 'Save a posting',
      args: { url: 'https://jobs.rice.edu/postings/29411', title: 'Assistant Professor' },
    }
    const { deps, reachedHost } = round(saved)
    await runPipelineRound(scout, deps)

    expect(reachedHost).toEqual(['pipeline.proposal.raise'])
  })
})

describe('Q128 when the modal offers to switch a pipeline off', () => {
  const idle: Pipeline = { ...twin, id: 'pipeline:idle', idleRounds: 2 }

  it('offers it for an enabled pipeline with nothing left to do', () => {
    expect(shutdownCandidate([idle], [], null)).toBe(idle)
  })

  it('does not offer it while that pipeline still has suggestions waiting', () => {
    expect(
      shutdownCandidate([idle], [{ pipelineId: idle.id as never, status: 'pending' }], null),
    ).toBeNull()
    // Another pipeline's queue is not this one's.
    expect(
      shutdownCandidate([idle], [{ pipelineId: 'pipeline:other' as never, status: 'pending' }], null),
    ).toBe(idle)
  })

  it('does not offer it while a round is running, nor for one already off', () => {
    expect(shutdownCandidate([idle], [], 'pipeline:idle')).toBeNull()
    expect(shutdownCandidate([{ ...idle, enabled: false }], [], null)).toBeNull()
  })

  it('does not offer it after one empty round, only two', () => {
    expect(shutdownCandidate([{ ...idle, idleRounds: 1 }], [], null)).toBeNull()
  })
})
