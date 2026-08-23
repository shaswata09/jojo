/**
 * The loop, with a scripted model and a real runtime.
 *
 * The model is a fake because the point is the control flow — a cap that holds,
 * an unmatched id that cannot happen, a refusal that comes back as a sentence.
 * The RUNTIME is real, because "the agent changed the graph" is the one claim a
 * fake would let through untested.
 */
import { describe, expect, it, vi } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import type { ChatMessage, Turn } from '../core/model-server'
import type { GraphSnapshot } from '../core/model'
import type { ToolName } from '../tools/index'
import type { ToolHost } from './execute'
import { CATALOG } from './catalog'
import { runAgent } from './loop'
import type { AgentEvent, LlmTurnFn } from './loop'

const START = Date.parse('2026-08-22T09:00:00.000Z')

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
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
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  return {
    memory: () => repo.getSnapshot() as GraphSnapshot,
    check: (name, input) => runtime.check(name as ToolName, input) as never,
    run: (name, input) => runtime.run(name as ToolName, input as never) as never,
  }
}

/** A model that answers with the given turns, in order, then repeats the last. */
function scripted(turns: Turn[]): LlmTurnFn & { seen: ChatMessage[][] } {
  let i = 0
  const seen: ChatMessage[][] = []
  const fn = (messages: readonly ChatMessage[]) => {
    seen.push([...messages])
    const turn = turns[Math.min(i, turns.length - 1)]
    i += 1
    return Promise.resolve(turn as Turn)
  }
  return Object.assign(fn, { seen })
}

const says = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

const calls = (name: string, args: unknown, id = 'c1', text: string | null = null): Turn => ({
  ok: true,
  text,
  toolCalls: [{ id, name, args, raw: JSON.stringify(args) }],
  finishReason: 'tool_calls',
})

const collect = () => {
  const events: AgentEvent[] = []
  return { events, onEvent: (e: AgentEvent) => events.push(e) }
}

const NEW_APP = {
  org: 'UT Austin',
  role: 'Assistant professor, CS',
  roleTag: 'Assistant Professor',
  stage: 'submitted',
}

describe('the simple shape', () => {
  it('answers without calling anything when nothing needs doing', async () => {
    const { events, onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([says('Nothing to do.')]),
      history: [],
      prompt: 'hello',
      onEvent,
    })
    expect(run.stopped).toBe('answered')
    expect(run.answer).toBe('Nothing to do.')
    expect(events).toEqual([{ type: 'answer', text: 'Nothing to do.' }])
  })

  it('runs a tool and really changes the graph', async () => {
    const h = host()
    const { events, onEvent } = collect()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('Filed it.')]),
      history: [],
      prompt: 'add UT Austin',
      onEvent,
    })
    expect(h.memory().ofType('application')).toHaveLength(1)
    expect(run.answer).toBe('Filed it.')
    // Emitted twice with one id, so a view replaces a row rather than appending.
    const stepEvents = events.filter((e) => e.type === 'step')
    expect(stepEvents).toHaveLength(2)
    expect(stepEvents.map((e) => (e as { step: { status: string } }).step.status)).toEqual([
      'running',
      'done',
    ])
    expect(run.steps[0]).toMatchObject({ name: 'application.create', status: 'done' })
  })

  it('shows the toast sentence the app itself would have shown', async () => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('application_create', NEW_APP), says('done')]),
      history: [],
      prompt: 'x',
      onEvent,
    })
    expect(run.steps[0]?.announcement?.title).toBeTruthy()
    expect(run.steps[0]?.detail).toContain('id: ')
  })
})

describe('the transcript it builds', () => {
  it('puts the assistant turn before the tool result, as servers require', async () => {
    // A `tool` message whose id has no preceding assistant turn is rejected, and
    // the rejection names neither of them.
    const llm = scripted([calls('memory_overview', {}, 'abc'), says('ok')])
    await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent: () => {} })
    const second = llm.seen[1] ?? []
    const assistantAt = second.findIndex((m) => m.role === 'assistant')
    const toolAt = second.findIndex((m) => m.role === 'tool')
    expect(assistantAt).toBeGreaterThanOrEqual(0)
    expect(toolAt).toBeGreaterThan(assistantAt)
    expect(second[toolAt]).toMatchObject({ tool_call_id: 'abc' })
  })

  it('starts with the system prompt and ends ready to be reused as history', async () => {
    const run = await runAgent({
      host: host(),
      llm: scripted([says('hi')]),
      history: [{ role: 'user', content: 'earlier' }],
      prompt: 'now',
      onEvent: () => {},
    })
    expect(run.messages[0]?.role).toBe('system')
    expect(run.messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant'])
  })

  it('replies to every call, including the ones that failed', async () => {
    // A model left waiting on a result it never receives re-issues the same call
    // forever.
    const llm = scripted([calls('application_create', { org: '' }), says('gave up')])
    await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent: () => {} })
    const second = llm.seen[1] ?? []
    expect(second.filter((m) => m.role === 'tool')).toHaveLength(1)
  })
})

describe('what it refuses to hide', () => {
  it('reports a tool refusing as a sentence, and changes nothing', async () => {
    const h = host()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', { org: '', role: 'x' }), says('could not')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.detail).toContain('Error:')
    expect(h.memory().nodes()).toHaveLength(0)
  })

  it('quotes malformed arguments back rather than repairing them', async () => {
    // A repair would be a silent edit to what the user is about to be told
    // happened.
    const bad: Turn = {
      ok: true,
      text: null,
      toolCalls: [{ id: 'c1', name: 'application_create', args: null, raw: '{"org": ' }],
      finishReason: 'tool_calls',
    }
    const run = await runAgent({
      host: host(),
      llm: scripted([bad, says('sorry')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.detail).toContain('not valid JSON')
    expect(run.steps[0]?.detail).toContain('{"org": ')
  })

  it('names a tool that does not exist instead of crashing', async () => {
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('application_summon', {}), says('no such thing')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.detail).toContain('application_summon')
  })

  it('passes a model failure straight through', async () => {
    const { events, onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([{ ok: false, kind: 'unreachable', reason: 'Nothing answered.' }]),
      history: [],
      prompt: 'x',
      onEvent,
    })
    expect(run.stopped).toBe('error')
    expect(events).toContainEqual({ type: 'error', reason: 'Nothing answered.' })
  })
})

describe('the stops', () => {
  it('holds the cap and says so, rather than looping forever', async () => {
    const { events, onEvent } = collect()
    const llm = vi.fn(() => Promise.resolve(calls('memory_overview', {})))
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'x',
      onEvent,
      maxSteps: 3,
    })
    expect(run.stopped).toBe('cap')
    expect(llm).toHaveBeenCalledTimes(3)
    expect(run.steps).toHaveLength(3)
    // A run that ends without explaining itself is indistinguishable from a crash.
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect((events.at(-1) as { reason: string }).reason).toContain('3 rounds')
  })

  it('stops when aborted, without running the next call', async () => {
    const controller = new AbortController()
    const h = host()
    const llm: LlmTurnFn = () => {
      controller.abort()
      return Promise.resolve(calls('application_create', NEW_APP))
    }
    const run = await runAgent({
      host: h,
      llm,
      history: [],
      prompt: 'x',
      onEvent: () => {},
      signal: controller.signal,
    })
    expect(run.stopped).toBe('aborted')
    expect(h.memory().nodes()).toHaveLength(0)
  })
})

describe('the approval gate', () => {
  const setup = async (approve: (s: { name: string }) => boolean) => {
    const h = host()
    const made = h.run('application.create' as ToolName, NEW_APP)
    const id = (made as { ok: true; output: string }).output
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_delete', { id }), says('done')]),
      history: [],
      prompt: 'delete it',
      onEvent: () => {},
      approve,
    })
    return { h, run }
  }

  it('asks before a destructive call, and does nothing when declined', async () => {
    const { h, run } = await setup(() => false)
    expect(run.steps[0]).toMatchObject({ destructive: true, status: 'declined' })
    expect(h.memory().ofType('application')).toHaveLength(1)
    expect(run.steps[0]?.detail).toContain('declined')
  })

  it('runs it when allowed', async () => {
    const { h, run } = await setup(() => true)
    expect(run.steps[0]?.status).toBe('done')
    expect(h.memory().ofType('application')).toHaveLength(0)
  })

  it('never asks about a read or an ordinary write', async () => {
    const approve = vi.fn(() => true)
    await runAgent({
      host: host(),
      llm: scripted([calls('application_create', NEW_APP), says('done')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
      approve,
    })
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('the tool list a run is offered', () => {
  it('is the whole catalog by default', async () => {
    let offered = 0
    await runAgent({
      host: host(),
      llm: (_messages, tools) => {
        offered = tools.length
        return Promise.resolve(says('ok'))
      },
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(offered).toBe(CATALOG.length)
  })

  it('is only what was named, so a focused screen stays focused', async () => {
    // The Graph card needs two tools. Handing it sixty-seven is a bigger prompt
    // and sixty-five chances to do something the card cannot render.
    let names: string[] = []
    await runAgent({
      host: host(),
      llm: (_messages, tools) => {
        names = (tools as { function: { name: string } }[]).map((t) => t.function.name)
        return Promise.resolve(says('ok'))
      },
      history: [],
      prompt: 'x',
      onEvent: () => {},
      tools: ['graph.query', 'memory.search'],
    })
    expect(names.sort()).toEqual(['graph_query', 'memory_search'])
  })

  it('ignores a name that no longer exists rather than losing the run', async () => {
    let count = -1
    await runAgent({
      host: host(),
      llm: (_messages, tools) => {
        count = tools.length
        return Promise.resolve(says('ok'))
      },
      history: [],
      prompt: 'x',
      onEvent: () => {},
      tools: ['graph.query', 'application.summon'],
    })
    expect(count).toBe(1)
  })
})

describe('what a step carries back', () => {
  it('keeps the tool’s own return value, not only the prose', async () => {
    // The Graph page draws a subgraph from it, which it cannot do from a string
    // it would have to parse back.
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('graph_query', { kind: 'pattern', start: 'application', quantifier: 'missing', rel: 'AT', end: 'organisation' }), says('none')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    const out = run.steps[0]?.output as { summary: string; rows: unknown[] }
    expect(out.summary).toContain('applications')
    expect(Array.isArray(out.rows)).toBe(true)
  })
})

describe('undo', () => {
  it('hands back a way to take every write back', async () => {
    const h = host()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('done')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(h.memory().ofType('application')).toHaveLength(1)
    run.steps[0]?.undo?.()
    expect(h.memory().ofType('application')).toHaveLength(0)
  })
})
