/**
 * Owner request Q102: the chat shows what the agent does as it happens, in order.
 *
 * The thread draws whatever events the loop emits, in the order it emits them —
 * a step row for each tool call (running, then settled), the model's thinking
 * as it streams, and the reply's text fragment by fragment. So the order is a
 * property of `runAgent`'s event stream, and that is what is asserted here: a
 * real runtime, a scripted model that streams through the loop's own callbacks.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import type { Turn } from '../core/model-server'
import type { GraphSnapshot } from '../core/snapshot'
import type { ToolName } from '../tools/index'
import type { ToolHost } from './execute'
import { runAgent } from './loop'
import type { AgentEvent, LlmTurnFn } from './loop'

const START = Date.parse('2026-08-22T09:00:00.000Z')

const nullDriver = () => ({
  open: async () => ({
    ok: true as const,
    value: { version: 1, from: 0, migrated: [], crossTab: false },
  }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function host(): ToolHost {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
      handoverAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  return {
    memory: () => repo.getSnapshot() as GraphSnapshot,
    today: () => '2026-10-12',
    check: (name, input) => runtime.check(name as ToolName, input) as never,
    run: (name, input) => runtime.run(name as ToolName, input as never) as never,
  }
}

const NEW_APP = {
  org: 'UT Austin',
  role: 'Assistant professor, CS',
  roleTag: 'Assistant Professor',
  stage: 'submitted',
}

/** Two rounds: think, then call a tool; think again, then stream the reply. */
function streaming(): LlmTurnFn {
  let round = 0
  return async (_messages, _tools, onDelta, onReasoning) => {
    round += 1
    if (round === 1) {
      onReasoning?.('I should file it. ')
      const turn: Turn = {
        ok: true,
        text: null,
        toolCalls: [{ id: 'c1', name: 'application_create', args: NEW_APP, raw: JSON.stringify(NEW_APP) }],
        finishReason: 'tool_calls',
      }
      return turn
    }
    onReasoning?.('Now say so.')
    onDelta?.('Filed ')
    onDelta?.('UT Austin.')
    return { ok: true, text: 'Filed UT Austin.', toolCalls: [], finishReason: 'stop' }
  }
}

/** A compact trace of the events a thread draws from. */
const trace = (events: readonly AgentEvent[]) =>
  events
    .filter((e) => ['thinking', 'step', 'delta', 'answer'].includes(e.type))
    .map((e) => {
      if (e.type === 'step') return `step:${e.step.name}:${e.step.status}`
      if (e.type === 'thinking' || e.type === 'delta' || e.type === 'answer') return `${e.type}:${e.text}`
      return e.type
    })

describe('what the thread is told, and when', () => {
  it('streams thinking, the tool call and the reply text in the order they happened', async () => {
    const events: AgentEvent[] = []
    await runAgent({
      host: host(),
      llm: streaming(),
      history: [],
      prompt: 'add UT Austin',
      onEvent: (e) => events.push(e),
    })
    expect(trace(events)).toEqual([
      'thinking:I should file it. ',
      'step:application.create:running',
      'step:application.create:done',
      'thinking:Now say so.',
      'delta:Filed ',
      'delta:UT Austin.',
      'answer:Filed UT Austin.',
    ])
  })
})

/**
 * Owner request Q308: application notes can be added, edited and deleted from chat.
 *
 * Driven through `runAgent` with no `tools` list, which is how the Assistant
 * calls it, so the assertion covers both halves: the note tool is in what a
 * chat is offered, and calling it really changes the record.
 */
describe('an application note, from chat', () => {
  const noteOf = (h: ToolHost, id: string) =>
    (h.memory().node(id as never, 'application')?.props as { note?: string } | undefined)?.note

  const say = (h: ToolHost, appId: string, note: string, prompt: string) => {
    let round = 0
    const args = { id: appId, note }
    const llm: LlmTurnFn = async () => {
      round += 1
      return round === 1
        ? {
            ok: true,
            text: null,
            toolCalls: [{ id: 'n1', name: 'application_note_set', args, raw: JSON.stringify(args) }],
            finishReason: 'tool_calls',
          }
        : { ok: true, text: 'Done.', toolCalls: [], finishReason: 'stop' }
    }
    return runAgent({ host: h, llm, history: [], prompt, onEvent: () => {} })
  }

  it('adds, edits and deletes the note through the agent', async () => {
    const h = host()
    const created = h.run('application.create', NEW_APP) as { ok: boolean; output?: string }
    const appId = created.output as string

    await say(h, appId, 'Ask about lab space', 'note: ask about lab space')
    expect(noteOf(h, appId)).toBe('Ask about lab space')

    await say(h, appId, 'Ask about lab space and startup', 'add startup to the note')
    expect(noteOf(h, appId)).toBe('Ask about lab space and startup')

    await say(h, appId, '', 'delete the note')
    expect(noteOf(h, appId) ?? '').toBe('')
  })
})
