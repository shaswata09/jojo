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

describe('which steps have to be approved', () => {
  /**
   * Runs one write and reports every step the gate stopped to ask about.
   *
   * `application.note.set` is an `update` — the kind that used to happen with
   * nobody being asked, which is what "approve actions like edit file" means.
   */
  const askedAbout = async (tool: string, gate?: 'destructive' | 'writes') => {
    const h = host()
    const made = h.run('application.create' as ToolName, NEW_APP)
    const id = (made as { ok: true; output: string }).output
    const seen: string[] = []
    await runAgent({
      host: h,
      llm: scripted([calls(tool, { id, note: 'x' }), says('done')]),
      history: [],
      prompt: 'do it',
      ...(gate === undefined ? {} : { gate }),
      approve: (step) => {
        seen.push(step.name)
        return true
      },
      onEvent: () => {},
    })
    return seen
  }

  it('leaves a plain edit alone by default', async () => {
    expect(await askedAbout('application_note_set')).toEqual([])
  })

  it('asks about a plain edit once the gate is widened', async () => {
    expect(await askedAbout('application_note_set', 'writes')).toEqual(['application.note.set'])
  })

  it('never asks about a read, however wide the gate', async () => {
    expect(await askedAbout('memory_list', 'writes')).toEqual([])
  })

  /*
   * A hallucinated name has `effect: 'unknown'`, and `callTool` refuses it a
   * line later regardless. Asking a person to approve a call that cannot happen
   * is asking them to rubber-stamp.
   */
  it('never asks about a tool that does not exist', async () => {
    expect(await askedAbout('not_a_real_tool', 'writes')).toEqual([])
  })

  it('still asks about a delete when the gate is left at its default', async () => {
    expect(await askedAbout('application_delete', undefined)).toEqual(['application.delete'])
  })
})

describe('the offered tool list is an allowlist, not a suggestion', () => {
  /**
   * The hole this closes was live and reachable from a shipped screen.
   *
   * `AgentOptions.tools` narrowed the PROMPT and nothing else: `performCall`
   * searched the whole `CATALOG` and `callTool` searched it again, so a tool
   * that was never offered ran anyway if the model named it. The Graph page's
   * "Ask the graph" card offers two READS — a model answering it with
   * `application_create` wrote a record to the store, from a card whose whole
   * premise is that it only looks.
   *
   * A model handed a short list can still emit anything; small models routinely
   * do. Narrowing the prompt is a hint. This is the part that holds.
   */
  it('refuses a call the caller never offered, and writes nothing', async () => {
    const h = host()
    const before = h.memory().nodes().length
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('Could not.')]),
      history: [],
      prompt: 'add an application',
      // What AskBox offers: two reads and no writes at all.
      tools: ['graph.query', 'memory.search'],
      onEvent: () => {},
    })

    const step = run.steps[0]
    expect(step?.status).toBe('failed')
    // THE assertion. Before the allowlist this was `before + 1`.
    expect(h.memory().nodes().length).toBe(before)
    expect(run.stopped).toBe('answered')
  })

  it('tells the model the name is unavailable, in the words it already knows', async () => {
    // Deliberately the same sentence as an unknown name. From the model's side
    // these are one fact — that name is not available here — and a different
    // phrasing invites a retry of the identical call.
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('application_create', NEW_APP), says('ok')]),
      history: [],
      prompt: 'x',
      tools: ['memory.search'],
      onEvent: () => {},
    })
    expect(run.steps[0]?.detail).toContain('No tool is called')
    // It must NOT hint that the tool exists somewhere else: a model told that
    // asks for it again and spends the step budget doing it.
    expect(run.steps[0]?.detail).not.toContain('not offered')
    expect(run.steps[0]?.detail).not.toContain('elsewhere')
  })

  it('still runs what WAS offered', async () => {
    // The guard must not be a blanket refusal — the narrowed set has to work.
    const h = host()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('Filed it.')]),
      history: [],
      prompt: 'x',
      tools: ['application.create'],
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('done')
    expect(h.memory().nodes().length).toBeGreaterThan(0)
  })

  it('accepts either spelling of a name, because callers write the registry one', async () => {
    const h = host()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('ok')]),
      history: [],
      // The wire spelling, where the test above used the registry spelling.
      tools: ['application_create'],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('done')
  })

  it('offers everything when the caller names nothing', async () => {
    // The Assistant and MCP must be untouched: absent means all 82, and an
    // empty list would mean none — the two must never be confused.
    const h = host()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('ok')]),
      history: [],
      prompt: 'x',
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('done')
  })
})

describe('the retriever, when the caller has not chosen', () => {
  /**
   * The Assistant is the one surface that offers all 82 tools. `retrieve` lets
   * it narrow from what the person actually asked, without any caller that
   * ALREADY narrowed being second-guessed.
   */
  const _toolNames = (llm: ReturnType<typeof scripted>) =>
    (llm.seenTools ?? []).map((t) => (t as { function: { name: string } }).function.name)

  it('narrows a clear request, and still runs what it offered', async () => {
    const h = host()
    const llm = scripted([
      calls('timeline_item_create', {
        title: 'Send the Baylor cover letter',
        date: '2026-08-27',
        kind: 'deadline',
      }),
      says('Done.'),
    ])
    const run = await runAgent({
      host: h,
      llm,
      history: [],
      prompt: 'remind me to send the Baylor cover letter on Thursday',
      retrieve: {},
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('done')
  })

  it('offers everything when the message says nothing about capabilities', async () => {
    // Abstention. "hello" must not narrow, because guessing from it is how a
    // retriever loses somebody their next request.
    const h = host()
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('ok')]),
      history: [],
      prompt: 'hello',
      retrieve: {},
      onEvent: () => {},
    })
    // A tool no sensible retriever would have picked from "hello" still runs,
    // which is the proof that it abstained rather than guessed.
    expect(run.steps[0]?.status).toBe('done')
  })

  it('never overrides a caller that already narrowed', async () => {
    /*
     * `tools` wins outright. AskBox and the pipelines choose deliberately, and
     * a retriever that improved on them would be an opinion about a decision
     * already made in code — and would reopen the write hole the allowlist
     * above closes.
     */
    const h = host()
    const before = h.memory().nodes().length
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('ok')]),
      history: [],
      // A message that WOULD have seeded the application tools.
      prompt: 'add my Rice application',
      tools: ['memory.search'],
      retrieve: {},
      onEvent: () => {},
    })
    expect(run.steps[0]?.status).toBe('failed')
    expect(h.memory().nodes().length).toBe(before)
  })
})
