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
import type { GraphSnapshot } from '../core/snapshot'
import type { ToolName } from '../tools/index'
import type { ToolHost } from './execute'
import { CATALOG } from './catalog'
import { RESERVED_FOR_REPLY } from './budget'
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
    /*
     * DIFFERENT arguments each round, so this exercises the ROUND cap and not
     * the repeat guard beside it. They are different limits with different
     * meanings — the cap is "this is taking too many rounds", the repeat guard
     * is "you are asking the same question over and over" — and a test that
     * tripped whichever fired first would stop testing the one it names.
     */
    let round = 0
    const llm = vi.fn(() => {
      round += 1
      return Promise.resolve(calls('memory_list', { type: 'application', limit: round }))
    })
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
    // A plain `Cancellation`, not an `AbortController`: this layer compiles
    // without DOM, and the loop only reads `.aborted`.
    const controller = { aborted: false }
    const h = host()
    const llm: LlmTurnFn = () => {
      controller.aborted = true
      return Promise.resolve(calls('application_create', NEW_APP))
    }
    const run = await runAgent({
      host: h,
      llm,
      history: [],
      prompt: 'x',
      onEvent: () => {},
      signal: controller,
    })
    expect(run.stopped).toBe('aborted')
    expect(h.memory().nodes()).toHaveLength(0)
  })

  /*
   * Stop pressed DURING a turn, not before one — the case the check inside the
   * call loop exists for, and the one nothing here could fail on.
   *
   * The test above sets `aborted` while the model is thinking, so the per-ROUND
   * check catches it and the per-CALL check never runs. Deleting the per-call
   * check therefore changed no result: a mutation run over this file killed 28
   * of 30 mutants and this was one of the two that lived. The guard's own
   * comment records the measurement it was written for — "a model that requested
   * three writes performed all three after the user pressed Stop" — so it is a
   * real guard that simply had no test.
   *
   * Two writes in ONE turn, and the signal is tripped by the first one landing.
   * With the check in place the second never runs; with it removed, both do.
   */
  it('stops between two calls of the same turn, not just between rounds', async () => {
    const h = host()
    const controller = { aborted: false }
    const turn: Turn = {
      ok: true,
      text: null,
      finishReason: 'tool_calls',
      toolCalls: [1, 2].map((n) => ({
        id: `c${String(n)}`,
        name: 'keyword_create',
        args: { name: `k${String(n)}` },
        raw: `{"name":"k${String(n)}"}`,
      })),
    }
    const run = await runAgent({
      host: h,
      llm: scripted([turn, says('done')]),
      history: [],
      prompt: 'add two keywords',
      gate: 'none',
      signal: controller,
      onEvent: (e) => {
        if (e.type === 'step' && e.step.status === 'done') controller.aborted = true
      },
    })
    expect(run.stopped).toBe('aborted')
    expect(run.steps).toHaveLength(1)
    expect(h.memory().nodes().filter((n) => n.type === 'keyword')).toHaveLength(1)
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
      llm: scripted([
        calls('graph_query', {
          kind: 'pattern',
          start: 'application',
          quantifier: 'missing',
          rel: 'AT',
          end: 'organisation',
        }),
        says('none'),
      ]),
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

  it('allows a tool the RETRIEVER did not guess, because that list is a hint', async () => {
    /*
     * The distinction this pair of tests exists to draw.
     *
     * The test above passes `tools` explicitly — a pipeline's boundary — and a
     * call outside it is refused and writes nothing. That must never change.
     *
     * This one narrows by RETRIEVER, which is a token optimisation: a guess at
     * which of eighty-odd tools the question needs, made from the words the
     * person happened to use. Refusing a miss made the same request succeed or
     * fail on phrasing — "add a person" worked and "add Dr Chen as a referee"
     * failed with "No tool is called vault.person.create", about a tool that
     * exists and is not destructive.
     *
     * A miss now reaches the approval gate, which is the real control.
     */
    const h = host()
    const before = h.memory().nodes().length
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('Added.')]),
      history: [],
      // Words that seed a narrow set nowhere near `application.create`.
      prompt: 'what is on my calendar this week',
      retrieve: { carried: null, fromHistory: [] },
      onEvent: () => {},
    })

    expect(run.steps[0]?.status).toBe('done')
    // Greater rather than exact: `application.create` is composite and mints the
    // organisation too, which is not what this test is about.
    expect(h.memory().nodes().length).toBeGreaterThan(before)
  })

  it('still asks before a retriever miss when approvals are on', async () => {
    // The miss is allowed, not waved through: the gate is what decides, exactly
    // as it would have for a tool the retriever did offer.
    const asked: string[] = []
    const h = host()
    const before = h.memory().nodes().length
    const run = await runAgent({
      host: h,
      llm: scripted([calls('application_create', NEW_APP), says('ok')]),
      history: [],
      prompt: 'what is on my calendar this week',
      retrieve: { carried: null, fromHistory: [] },
      gate: 'writes',
      approve: (step) => {
        asked.push(step.name)
        return Promise.resolve(false)
      },
      onEvent: () => {},
    })

    expect(asked).toEqual(['application.create'])
    expect(run.steps[0]?.status).toBe('declined')
    expect(h.memory().nodes().length).toBe(before)
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
  /*
   * A helper that read `llm.seenTools`, which `scripted` does not record and
   * never has, and which nothing called. Dead on both counts — and invisible on
   * both, because `kg/agent` was in no tsconfig's `include`, so this file was
   * never compiled. The tests below assert on what was OFFERED through
   * `run.offered`, which is the loop's own report and the thing worth pinning.
   */

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

describe('a model whose server has no tool template', () => {
  const errorsFrom = async (text: string) => {
    const said: string[] = []
    const run = await runAgent({
      host: host(),
      llm: scripted([says(text)]),
      history: [],
      prompt: 'add an application for Rice',
      onEvent: (e) => {
        if (e.type === 'error') said.push(e.reason)
      },
    })
    return { run, said }
  }

  it('reports a call written as text instead of printing it as the answer', async () => {
    /*
     * Extremely common on small local models: llama.cpp without `--jinja`, or
     * LM Studio with the wrong prompt template, and the model emits
     * `<tool_call>…</tool_call>` in `content`.
     *
     * The chat bubble used to show that raw JSON as jojo's reply, with run
     * status `answered` and no step recorded — indistinguishable from the model
     * politely declining to act, and impossible to debug from the outside.
     */
    const { run, said } = await errorsFrom(
      '<tool_call>{"name": "application_create", "arguments": {"org": "Rice"}}</tool_call>',
    )
    expect(run.stopped).toBe('error')
    expect(said[0]).toContain('application.create')
    expect(said[0]).toMatch(/tool template/)
    expect(said[0]).toMatch(/jinja/)
  })

  it('catches the bare-JSON shape too', async () => {
    // The other family: no envelope, just an object with a name and arguments.
    const { run } = await errorsFrom('{"name": "application_create", "arguments": {"org": "Rice"}}')
    expect(run.stopped).toBe('error')
  })

  it('runs nothing', async () => {
    /*
     * Deliberately not recovered and executed. Recovering a call the transport
     * did not frame means trusting text to be a call the user approved, and the
     * whole approval gate rests on the transport telling the two apart.
     */
    const { run } = await errorsFrom(
      '<tool_call>{"name": "application_create", "arguments": {"org": "Rice"}}</tool_call>',
    )
    expect(run.steps).toEqual([])
  })

  it('leaves an ordinary answer alone', async () => {
    const { run, said } = await errorsFrom('You have three applications at Rice.')
    expect(run.stopped).toBe('answered')
    expect(said).toEqual([])
  })

  it('does not trip on prose that merely mentions a tool', async () => {
    /*
     * A person asking "what would application.create do?" gets an answer that
     * quotes the shape. Requiring an `arguments` key alongside the name is what
     * separates a description from an attempt.
     */
    const { run } = await errorsFrom('The tool is called {"name": "application_create"} internally.')
    expect(run.stopped).toBe('answered')
  })

  it('answers a question ABOUT a tool, payload and all', async () => {
    /*
     * The false positive this guard is one wrong line away from, and it was
     * reproduced end to end.
     *
     * Asking about a tool is what makes the retriever OFFER that tool, so the
     * name check cannot separate the two cases — a complete `name`/`arguments`
     * object quoted inside a sentence looked exactly like a mis-templated
     * call. The person lost their answer and was told to go and fix a `--jinja`
     * flag on a server that was working perfectly.
     */
    const said: string[] = []
    const run = await runAgent({
      host: host(),
      llm: scripted([
        says(
          'Sure. A call to it looks like {"name": "application_create", "arguments": {"org": "Rice"}} and it files a new application.',
        ),
      ]),
      history: [],
      // The prompt matters: `application.create` is offered BECAUSE it was
      // named, which is what makes the answer indistinguishable from a call.
      prompt: 'what would application.create do?',
      retrieve: { carried: null },
      onEvent: (e) => {
        if (e.type === 'error') said.push(e.reason)
      },
    })
    expect(said).toEqual([])
    expect(run.stopped).toBe('answered')
    expect(run.answer).toContain('files a new application')
  })

  it('still catches a bare object in a code fence, which carries no prose', async () => {
    // The fence is how a model with no tool template writes the same object.
    // Stripping it before the whole-answer test is what keeps this a call.
    const { run } = await errorsFrom(
      '```json\n{"name": "application_create", "arguments": {"org": "Rice"}}\n```',
    )
    expect(run.stopped).toBe('error')
  })
})

describe('a reply the model cut off', () => {
  it('says so, instead of showing half a sentence as the answer', async () => {
    /*
     * `finish_reason` was parsed by every reader and consumed by nothing, so a
     * reply that stopped mid-sentence looked exactly like one that finished.
     * On the tool path it is worse than cosmetic: a truncated `arguments`
     * string fails to parse and the model is told "the arguments were not
     * valid JSON", which is the wrong diagnosis and invites the same call again.
     */
    const said: string[] = []
    const run = await runAgent({
      host: host(),
      llm: scripted([
        { ok: true, text: 'Your applications are Rice, UT Aus', toolCalls: [], finishReason: 'length' },
      ]),
      history: [],
      prompt: 'list my applications',
      onEvent: (e) => {
        if (e.type === 'note') said.push(e.text)
      },
    })
    expect(said.join(' ')).toMatch(/cut off|output limit/i)
    // A note, not an error: the partial answer is still worth having.
    expect(run.stopped).toBe('answered')
  })

  it('refuses a reply that is empty and did nothing, rather than showing a blank bubble', async () => {
    /*
     * Measured against Qwen3 14B, which reasons before it speaks: it spends the
     * whole output budget thinking, hits the server's reply limit mid-thought,
     * and returns nothing at all. `file-a-new-document` failed on every
     * condition this way — zero calls, empty text, run status `answered`.
     *
     * A blank chat bubble is the least debuggable failure in the app: nothing
     * on screen says the reply limit is the problem, and the fix is a server
     * setting nobody can guess.
     */
    const errors: string[] = []
    const run = await runAgent({
      host: host(),
      llm: scripted([{ ok: true, text: '', toolCalls: [], finishReason: 'length' }]),
      history: [],
      prompt: 'file my diversity statement',
      onEvent: (e) => {
        if (e.type === 'error') errors.push(e.reason)
      },
    })
    expect(run.stopped).toBe('error')
    // Names the cause AND the class of model, because that is the actionable part.
    expect(errors.join(' ')).toMatch(/reply budget/i)
    expect(errors.join(' ')).toMatch(/Qwen3|thinking/i)
  })

  it('names a different cause when it simply said nothing', async () => {
    // Same blank bubble, different fix — so it must not blame the reply limit.
    const errors: string[] = []
    const run = await runAgent({
      host: host(),
      llm: scripted([{ ok: true, text: '', toolCalls: [], finishReason: 'stop' }]),
      history: [],
      prompt: 'file my diversity statement',
      onEvent: (e) => {
        if (e.type === 'error') errors.push(e.reason)
      },
    })
    expect(run.stopped).toBe('error')
    expect(errors.join(' ')).toMatch(/empty reply/i)
    expect(errors.join(' ')).not.toMatch(/reply budget/i)
  })

  it('does NOT call it an error when the work landed and only the summary is missing', async () => {
    /*
     * The boundary of the rule above, and the reason it is `steps.length === 0`
     * rather than just an empty string. A run whose calls succeeded has changed
     * the store and put its announcements on screen; reporting that as "nothing
     * was changed" would be a lie about records that exist.
     */
    const errors: string[] = []
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('memory_overview', {}), { ok: true, text: '', toolCalls: [], finishReason: 'stop' }]),
      history: [],
      prompt: 'what is in my store',
      tools: ['memory.overview'],
      onEvent: (e) => {
        if (e.type === 'error') errors.push(e.reason)
      },
    })
    expect(errors).toEqual([])
    expect(run.stopped).toBe('answered')
    expect(run.steps.length).toBe(1)
  })

  it('says nothing when the model finished properly', async () => {
    const said: string[] = []
    await runAgent({
      host: host(),
      llm: scripted([says('All done.')]),
      history: [],
      prompt: 'anything',
      onEvent: (e) => {
        if (e.type === 'note') said.push(e.text)
      },
    })
    expect(said.join(' ')).not.toMatch(/output limit/i)
  })
})

describe('a model going in circles', () => {
  const looping = async (maxSteps = 8) => {
    const { events, onEvent } = collect()
    const sent: string[] = []
    const llm = vi.fn((messages: readonly ChatMessage[]) => {
      for (const m of messages) if (m.role === 'tool') sent.push(String(m.content))
      return Promise.resolve(calls('memory_overview', {}))
    })
    const run = await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent, maxSteps })
    return { run, events, llm, sent }
  }

  it('stops a model repeating one call rather than burning every round', async () => {
    /*
     * Nothing watched for repetition. A small model that has misread a refusal
     * re-issues the identical call every round until the cap — eight rounds at
     * an 18k-token prompt is minutes of somebody's GPU spent discovering
     * nothing, and the run then blames the round cap rather than the loop.
     */
    const { run, llm, events } = await looping()
    // `'stuck'` and not `'error'`. The three bad endings want three different
    // reactions, and retrying a run that ended in a circle is the one known not
    // to help — see `AgentRun['stopped']`.
    expect(run.stopped).toBe('stuck')
    expect(llm.mock.calls.length).toBeLessThan(8)
    expect((events.at(-1) as { reason: string }).reason).toMatch(/same arguments/)
    // The REGISTRY name. The wire spelling with underscores appears nowhere a
    // person reads, and this sentence is read by a person.
    expect((events.at(-1) as { reason: string }).reason).toContain('memory.overview')
  })

  /*
   * FIVE, not three, and the number moved deliberately.
   *
   * Gemini CLI's own threshold is five; twice is legitimate in this app's
   * read-write-verify pattern; and `maxSteps` is eight, so stopping at five
   * still leaves three rounds for the model to do something else. The old limit
   * of three was chosen when the only intervention was a stop.
   */
  it('spends five rounds on an identical call, not the whole budget', async () => {
    const { llm } = await looping()
    expect(llm.mock.calls.length).toBe(5)
  })

  it('tells the model it is repeating, before giving up on it', async () => {
    /*
     * The intervention most likely to break the cycle. The model's own
     * transcript already holds the first answer; what it has not been told is
     * that it is going in circles — and an identical result served twice reads
     * to it as confirmation.
     */
    const { sent } = await looping()
    expect(sent.some((t) => /called memory\.overview with exactly these arguments 3 times/.test(t))).toBe(
      true,
    )
  })

  /*
   * THE FAILURE THE OLD COUNTER COULD NOT SEE, and the reason this whole thing
   * was rebuilt rather than retuned.
   *
   * `loop.ts` fingerprinted `${name}\u0000${call.raw}` — the RAW BYTES of the
   * arguments. A sampler at any temperature above zero puts a different amount
   * of whitespace inside the braces each time, and eight different byte strings
   * are eight different calls, so the guard never fired: probed against the real
   * loop, this fixture ran all 8 rounds and ended as `'cap'`.
   */
  it('sees through jittered whitespace, which the raw-bytes fingerprint did not', async () => {
    const { onEvent } = collect()
    let n = 0
    const llm = vi.fn(() => {
      n += 1
      return Promise.resolve({
        ok: true,
        text: null,
        finishReason: 'tool_calls',
        // The same call every round. Only the formatting moves.
        toolCalls: [{ id: `c${String(n)}`, name: 'memory_overview', args: {}, raw: `{${' '.repeat(n)}}` }],
      } as Turn)
    })
    const run = await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent, maxSteps: 8 })
    expect(run.stopped).toBe('stuck')
    expect(llm.mock.calls.length).toBe(5)
  })

  /*
   * THE FINGERPRINT IS TAKEN OVER WHAT RAN, not over what arrived.
   *
   * A model alternating `{"limit":5}` and `{"limit":"5"}` is making ONE call
   * twice, because repair has already made them the same call by the time it
   * runs. Fingerprinting `call.args` instead of `step.args` sees two, which
   * turns a plain repeat into a two-step cycle and costs three more rounds to
   * notice — 8 instead of 5, measured by flipping the line.
   */
  it('counts a call repaired into the same shape as the same call', async () => {
    const { onEvent } = collect()
    let n = 0
    const llm = vi.fn(() => {
      n += 1
      return Promise.resolve(
        calls('memory_list', { type: 'application', limit: n % 2 === 0 ? 5 : '5' }, `c${String(n)}`),
      )
    })
    const run = await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent, maxSteps: 8 })
    expect(run.stopped).toBe('stuck')
    expect(llm.mock.calls.length).toBe(5)
  })

  /*
   * A FAILING call is stopped sooner than a succeeding one, and this test is
   * what proves the loop actually passes `ok`.
   *
   * `StuckObservation.ok` is optional and defaults to the succeeding schedule —
   * the safe direction for an integrator who forgets it, and a silent loss of
   * the whole failing-spiral rule. A call that failed identically twice will
   * fail a third time; the arguments are the problem and the timing is not.
   */
  it('gives up sooner on a call that keeps failing than on one that keeps working', async () => {
    const { onEvent } = collect()
    let n = 0
    const llm = vi.fn(() => {
      n += 1
      return Promise.resolve(
        calls('application_stage_set', { id: 'app:nope', stage: 'interview' }, `c${String(n)}`),
      )
    })
    const run = await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent, maxSteps: 8 })
    expect(run.steps.every((s) => s.status === 'failed')).toBe(true)
    expect(run.stopped).toBe('stuck')
    // Four, against the five an identical SUCCEEDING call gets.
    expect(llm.mock.calls.length).toBe(4)
  })

  it('leaves the same tool alone when the arguments differ', async () => {
    // Calling one tool with different arguments is ordinary work — paging
    // through a list, or looking up three records in turn.
    const { onEvent } = collect()
    let n = 0
    const llm = vi.fn(() => {
      n += 1
      return Promise.resolve(calls('memory_list', { type: 'application', limit: n }))
    })
    const run = await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent, maxSteps: 4 })
    expect(run.stopped).toBe('cap')
    expect(run.steps).toHaveLength(4)
  })
})

/**
 * The model is told what today is.
 *
 * `host.today()` reached the tools and never the model, so every relative date
 * a person speaks was resolved against whatever the weights believe the date
 * is. Measured on the multi-turn benchmark: asked to be reminded "on the 20th"
 * in a world dated 2026-09-14, Gemma 3 31B filed it under **2025-05-20** — the
 * reminder was created correctly, rescheduled correctly, and landed sixteen
 * months in the past.
 *
 * Pinned on the message the model actually receives rather than on the
 * constant, because the bug was that the constant was complete and nothing
 * appended to it.
 */
describe('the date', () => {
  it('reaches the model in the system message', async () => {
    const seen: ChatMessage[][] = []
    await runAgent({
      host: host(),
      llm: async (messages) => {
        seen.push([...messages])
        return { ok: true, text: 'Done.', toolCalls: [], finishReason: 'stop' }
      },
      history: [],
      prompt: 'remind me on the 20th',
      onEvent: () => {},
    })
    const system = seen[0]?.[0]
    expect(system?.role).toBe('system')
    // The host's date, not a real one — `core` has no clock (D26) and this test
    // would otherwise pass on the day it was written and never again.
    expect(system?.content).toContain(host().today())
  })

  it('keeps the rest of the prompt intact around it', async () => {
    const seen: ChatMessage[][] = []
    await runAgent({
      host: host(),
      llm: async (messages) => {
        seen.push([...messages])
        return { ok: true, text: 'Done.', toolCalls: [], finishReason: 'stop' }
      },
      history: [],
      prompt: 'hello',
      onEvent: () => {},
    })
    // Appended, not replacing: a date that arrived by overwriting the operating
    // rules would pass the test above and lose everything else.
    expect(seen[0]?.[0]?.content).toContain('You act by calling tools')
    expect(seen[0]?.[0]?.content).toContain('Ids are never invented')
  })
})

/**
 * The harness pieces that only exist once they are wired: the chooser, the
 * summariser, and the one message neither of them may touch.
 */
describe('the long-conversation harness', () => {
  const seeing = () => {
    const seen: ChatMessage[][] = []
    const llm: LlmTurnFn = async (messages) => {
      seen.push([...messages])
      return { ok: true, text: 'Done.', toolCalls: [], finishReason: 'stop' }
    }
    return { seen, llm }
  }

  /** Enough conversation that a small window cannot hold it. */
  const long = (): ChatMessage[] =>
    Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0
        ? ({ role: 'user', content: `question ${String(i)} ${'x'.repeat(2000)}` } as ChatMessage)
        : ({ role: 'assistant', content: `answer ${String(i)} ${'y'.repeat(2000)}` } as ChatMessage),
    )

  it('never drops the system message, however small the window', async () => {
    // THE invariant. Servers truncate from the front, which is where the rules
    // about not inventing ids and about today's date live; the whole point of
    // trimming here rather than there is that this message survives.
    const { seen, llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: long(),
      prompt: 'and now?',
      onEvent: () => {},
      window: 2_000,
    })
    const first = seen[0]?.[0]
    expect(first?.role).toBe('system')
    expect(first?.content).toContain('Ids are never invented')
  })

  it('keeps the current question, which is what the turn is about', async () => {
    const { seen, llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: long(),
      prompt: 'and now?',
      onEvent: () => {},
      window: 2_000,
    })
    expect(seen[0]?.at(-1)?.content).toBe('and now?')
  })

  it('puts a summary where the dropped exchanges were', async () => {
    const { seen, llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: long(),
      prompt: 'and now?',
      onEvent: () => {},
      // Room for history EXPRESSED relative to the reply reserve, so raising
      // the reserve cannot silently turn this into the overflow case — which
      // is exactly what a bare `2_000` did.
      window: RESERVED_FOR_REPLY + 2_000,
      // A small tool list on purpose. With the whole catalog offered, the
      // SCHEMAS alone exceed a window this size — that is the overflow case,
      // where nothing is dropped because no amount of history would help, and
      // it is not the case this test is about.
      tools: ['memory.overview'],
      summariser: {
        ask: async () => ({
          ok: true,
          text: 'They asked about Rice and it was moved to interview.',
          toolCalls: [],
          finishReason: 'stop',
        }),
      },
    })
    const summary = seen[0]?.[1]
    expect(summary?.role).toBe('system')
    expect(summary?.content).toContain('summarised, not verbatim')
    expect(summary?.content).toContain('Rice')
  })

  it('does not summarise, or record, a request that could not be sent', async () => {
    /*
     * Overflow: the tool schemas alone exceed the window. History is dropped
     * because losing the conversation beats losing the system prompt to a
     * server that truncates from the front — but nothing is SUMMARISED, and
     * nothing is written to the thread.
     *
     * Getting this wrong replaces a real conversation with a summary of a
     * request that never happened, permanently, on the person's own record.
     */
    let asked = 0
    const { llm } = seeing()
    const run = await runAgent({
      host: host(),
      llm,
      history: long(),
      prompt: 'and now?',
      onEvent: () => {},
      window: 1_000,
      summariser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: 'a summary', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(asked).toBe(0)
    expect(run.compacted).toBeUndefined()
  })

  it('still trims when the summariser is down', async () => {
    // Compaction improves a long chat; it is never what makes one possible.
    const { seen, llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: long(),
      prompt: 'and now?',
      onEvent: () => {},
      window: 2_000,
      summariser: { ask: () => Promise.reject(new Error('down')) },
    })
    expect(seen[0]?.[0]?.role).toBe('system')
    expect(seen[0]?.length).toBeLessThan(long().length)
  })

  it('offers what the chooser picked, closed over and stripped', async () => {
    const { llm } = seeing()
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'do something',
      onEvent: () => {},
      retrieve: { carried: null },
      chooser: {
        ask: async () => ({
          ok: true,
          // `memory.clear` is in the pick on purpose: the chooser is a model and
          // may reach for anything. The pipeline must strip it anyway.
          text: '{"tools":["application.create","memory.clear"]}',
          toolCalls: [],
          finishReason: 'stop',
        }),
      },
    })
    expect(run.offered).not.toBeNull()
    expect(run.offered).toContain('application.create')
    expect(run.offered).not.toContain('memory.clear')
  })

  it('does not consult the chooser when the lexicon already fits', async () => {
    /*
     * The chooser narrows better and picks worse — measured, it under-picks
     * writes, and the lexicon alone scores 30/30 on the multi-turn suite. So it
     * is not a default; it is what happens when the safe path cannot work.
     *
     * On a large window it must not run at all: no risk, and no round trip.
     */
    let asked = 0
    const { llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add an application to Rice',
      onEvent: () => {},
      window: 128_000,
      retrieve: { carried: null },
      chooser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: '{"tools":["memory.list"]}', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(asked).toBe(0)
  })

  it('consults it when the lexicon’s list cannot fit', async () => {
    let asked = 0
    const { llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add an application to Rice',
      onEvent: () => {},
      // A small window: the lexicon's thirty-odd schemas do not fit, and a
      // riskier narrowing is the only thing that makes the turn possible.
      window: 8_000,
      retrieve: { carried: null },
      chooser: {
        ask: async () => {
          asked += 1
          return {
            ok: true,
            text: '{"tools":["application.create","memory.search"]}',
            toolCalls: [],
            finishReason: 'stop',
          }
        },
      },
    })
    expect(asked).toBe(1)
  })

  it('does not consult it without a window, because it cannot know', async () => {
    // No declared window means no way to tell whether narrowing is needed, and
    // the safe path is the one that scores 30/30.
    let asked = 0
    const { llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add an application to Rice',
      onEvent: () => {},
      retrieve: { carried: null },
      chooser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: '{"tools":["memory.list"]}', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(asked).toBe(0)
  })

  it('does not consult it when the retriever abstained, however small the window', async () => {
    /*
     * The bug this is written against, and it was mine.
     *
     * Abstention makes the lexicon's list the ENTIRE safe catalog, which fits
     * no window anyone runs — so a gate that only asks "does it fit" fires the
     * chooser exactly on abstention and nowhere else. Backwards: abstention is
     * where `offeredFor` REPLACES with the chooser's picks rather than unioning
     * them, so a chooser that returns only reads leaves the model no way to act.
     *
     * Measured on a live model: "I am withdrawing from Baylor" abstained, and
     * the reply claimed the application had been closed having called nothing.
     *
     * THAT SENTENCE NO LONGER ABSTAINS, and the fixture moved rather than the
     * rule. `retrieve.ts` learned "withdrawing" as an outcome word, so it now
     * selects seven application tools — which is the narrowing doing its job and
     * leaves this test, whose whole subject is abstention, measuring nothing.
     * Re-measured with `select` directly: "I heard back from Baylor this
     * morning" recognises no tool word and returns null, which is the path this
     * is about. If it ever stops abstaining, move the fixture again; do not
     * relax the assertion.
     */
    let asked = 0
    const { llm } = seeing()
    await runAgent({
      host: host(),
      llm,
      history: [],
      // Nothing here is a tool word — this is the abstention path.
      prompt: 'I heard back from Baylor this morning',
      onEvent: () => {},
      window: 8_000,
      retrieve: { carried: null },
      chooser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: '{"tools":["memory.search"]}', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(asked).toBe(0)
  })

  it('does not consult it when the retriever abstained on a FOLLOW-UP either', async () => {
    /*
     * The same bug as the test above, surviving the fix for it.
     *
     * The gate asked `offeredFor(...) !== null`, which is not "did the lexicon
     * recognise this": that returns null only when nothing was recognised AND
     * nothing was carried. A conversation carries a set from turn two onwards,
     * so the abstention guard was live for the first message of a chat and
     * dead for every message after it — and "yes, do that" is the shape of
     * follow-up the lexicon can never read.
     *
     * What that costs is the same thing, on the turn where it is most
     * expensive: `offeredFor` REPLACES with the chooser's picks when the
     * lexicon abstained, so the tool the person had just said yes to was gone
     * from the list at the moment they said it.
     */
    const { llm } = seeing()
    const first = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add a reminder for the Rice interview',
      onEvent: () => {},
      window: 128_000,
      retrieve: { carried: null },
    })
    expect(first.offered).toContain('timeline.item.reschedule')

    let asked = 0
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      // Recognises nothing: no tool word, and the referent is in the last turn.
      prompt: 'yes, do that',
      onEvent: () => {},
      // Small enough that the carried set does not fit, which is the only
      // condition the old gate then had left to check.
      window: 8_000,
      retrieve: { carried: first.offered },
      chooser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: '{"tools":["memory.search"]}', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(asked).toBe(0)
    expect(run.offered).toContain('timeline.item.reschedule')
  })

  it('spends no chooser round trip once Stop has been pressed', async () => {
    /*
     * The chooser and the summariser run BEFORE the round loop, and the first
     * abort check used to be inside it. Neither is handed the signal, so
     * neither can be cancelled in flight either: pressing Stop bought two full
     * untimed round trips on somebody's own GPU, with the composer already
     * disabled and the UI already saying it had stopped.
     */
    let asked = 0
    const { llm } = seeing()
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add an application to Rice',
      onEvent: () => {},
      window: 8_000,
      signal: { aborted: true },
      retrieve: { carried: null },
      chooser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: '{"tools":["application.create"]}', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(run.stopped).toBe('aborted')
    expect(asked).toBe(0)
  })

  it('spends no summariser round trip once Stop has been pressed', async () => {
    // The second of the two, and the more wasteful: it summarises a
    // conversation for a request that is never going to be sent.
    let asked = 0
    const { llm } = seeing()
    const run = await runAgent({
      host: host(),
      llm,
      history: long(),
      prompt: 'and now?',
      onEvent: () => {},
      window: RESERVED_FOR_REPLY + 2_000,
      tools: ['memory.overview'],
      signal: { aborted: true },
      summariser: {
        ask: async () => {
          asked += 1
          return { ok: true, text: 'a summary', toolCalls: [], finishReason: 'stop' }
        },
      },
    })
    expect(run.stopped).toBe('aborted')
    expect(asked).toBe(0)
  })

  describe('what each approval mode lets through', () => {
    /*
     * The three modes are a promise about what happens WITHOUT being asked, so
     * each is tested against the same destructive and non-destructive step
     * rather than against itself.
     *
     * `semi` is the one worth pinning hardest: it stops for `delete` and
     * `admin` effects and lets a `move` through, which is why closing an
     * application does not prompt. That is the setting's meaning, not a bug —
     * and a test is the only thing that keeps it from drifting into "stops for
     * anything scary", which is not something the code can know.
     */
    const asked: string[] = []
    const runWith = async (gate: 'writes' | 'destructive' | 'none' | undefined, tool: string) => {
      asked.length = 0
      await runAgent({
        host: host(),
        llm: scripted([calls(tool, tool === 'memory_clear' ? { confirm: true } : {}), says('done')]),
        history: [],
        prompt: 'do it',
        tools: [tool.replace(/_/g, '.')],
        ...(gate === undefined ? {} : { gate }),
        approve: async (step) => {
          asked.push(step.name)
          return true
        },
        onEvent: () => {},
      })
      return asked.length
    }

    it('manual asks before an ordinary edit', async () => {
      expect(await runWith('writes', 'application_update')).toBe(1)
    })

    it('semi does NOT ask before an ordinary edit', async () => {
      expect(await runWith('destructive', 'application_update')).toBe(0)
    })

    it('semi DOES ask before a deletion', async () => {
      expect(await runWith('destructive', 'timeline_item_delete')).toBe(1)
    })

    it('auto asks before nothing, deletions included', async () => {
      // The mode the person chose explicitly. Nothing is confirmed — which is
      // what its copy says, and the copy is the only warning there is.
      expect(await runWith('none', 'timeline_item_delete')).toBe(0)
      expect(await runWith('none', 'application_update')).toBe(0)
    })

    it('defaults to stopping for deletions when no mode is given', async () => {
      // Pipelines and the graph ask-box pass no gate. The default must not be
      // `none`, or a caller that forgets becomes the unsafe one.
      expect(await runWith(undefined, 'timeline_item_delete')).toBe(1)
    })
  })

  describe('the two tools that cannot be undone', () => {
    /*
     * `memory.reset` and `memory.clear` empty the store with `undoable: false`.
     * `offeredFor` strips them unless the person lexically asked, and that strip
     * used to be ADVISORY: the executor enforced the offered set only when a
     * caller passed an explicit `tools` list, which the Assistant does not.
     *
     * That was defensible while the approval gate was the backstop — "with
     * approvals on the person is asked, and with them off a delete still stops".
     * Adding `auto` (`gate: 'none'`) removed the backstop and made the hole
     * reachable. Proven with a probe before this test existed: prompt "what
     * applications do I have at Rice", no mention of wiping, whole store gone.
     */
    const wiper = () => {
      let n = 0
      return async (): Promise<Turn> =>
        n++ === 0
          ? calls('memory_clear', { confirm: true })
          : { ok: true, text: 'done', toolCalls: [], finishReason: 'stop' }
    }

    it('will not run one the retriever never offered, even with approvals off', async () => {
      const ran: string[] = []
      const h = host()
      await runAgent({
        host: { ...h, run: (name) => { ran.push(name); return h.run(name, {}) } },
        llm: wiper(),
        history: [],
        prompt: 'what applications do I have at Rice',
        retrieve: { carried: null },
        gate: 'none',
        onEvent: () => {},
      })
      expect(ran).toEqual([])
    })

    it('still runs one the person actually asked for', async () => {
      // The strip is about IMPLICIT reach, not a ban. "Wipe everything" is a
      // request, `asksToWipe` recognises it, and the tool is offered — so a
      // refusal here would break the feature rather than protect anyone.
      const ran: string[] = []
      const h = host()
      await runAgent({
        host: { ...h, run: (name) => { ran.push(name); return h.run(name, {}) } },
        llm: wiper(),
        history: [],
        prompt: 'wipe everything and start over from scratch',
        retrieve: { carried: null },
        gate: 'none',
        onEvent: () => {},
      })
      expect(ran).toEqual(['memory.clear'])
    })
  })

  it('falls back to the lexicon when the chooser is down', async () => {
    const { llm } = seeing()
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add an application to Rice',
      onEvent: () => {},
      retrieve: { carried: null },
      chooser: { ask: () => Promise.reject(new Error('ECONNREFUSED')) },
    })
    // The lexicon is offline and cannot fail, so this is still a narrowed set
    // rather than everything — a chooser being down costs latency, not reach.
    expect(run.offered).not.toBeNull()
    expect(run.offered?.length).toBeLessThan(60)
  })
})

/**
 * The step cap used to be a wall.
 *
 * The loop ran to `maxSteps` and stopped with "Stopped after N rounds without
 * finishing" and no answer, having never told the model it was running out. A
 * model that knows it has one round left reports what it found; one that does
 * not calls another tool and is cut off mid-thought.
 */
describe('the step budget', () => {
  /*
   * A DIFFERENT call each round, which the fixture has to do deliberately: the
   * stuck detector stops five identical calls, so a model that asked the same
   * thing every time would be halted by it and never reach the cap this test is
   * about.
   */
  const listing = (round: number): Turn => ({
    ok: true,
    text: null,
    toolCalls: [
      {
        id: `c${String(round)}`,
        name: 'memory.list',
        args: { type: 'application', limit: round + 1 },
        raw: `{"type":"application","limit":${String(round + 1)}}`,
      },
    ],
    finishReason: 'tool_calls',
  })

  const transcriptOf = async (maxSteps: number) => {
    const seen: ChatMessage[][] = []
    let round = 0
    await runAgent({
      host: host(),
      llm: async (messages) => {
        seen.push([...messages])
        return listing(round++)
      },
      history: [],
      prompt: 'what have I got?',
      onEvent: () => {},
      maxSteps,
    })
    return seen
  }

  it('says nothing about a budget while there is plenty', async () => {
    // A countdown on every round is noise, and noise in a small model's context
    // is not free. Six rounds, and the first result is silent about it.
    const seen = await transcriptOf(6)
    const first = seen[1]?.filter((m) => m.role === 'tool') ?? []
    expect(first.length).toBeGreaterThan(0)
    expect(first[0]?.content).not.toContain('step')
  })

  it('warns as the rounds run out', async () => {
    const seen = await transcriptOf(6)
    const last = seen.at(-1)?.filter((m) => m.role === 'tool') ?? []
    const text = last.map((m) => m.content ?? '').join(' ')
    expect(text).toContain('step left')
  })

  it('rides on a result the model is already reading', async () => {
    // Not a system message injected mid-conversation, which some providers
    // handle badly, and not a separate turn, which costs a round trip. The
    // tool's own answer is still there, with the note after it.
    const seen = await transcriptOf(2)
    const results = seen.at(-1)?.filter((m) => m.role === 'tool') ?? []
    const withBudget = results.find((m) => (m.content ?? '').includes('step'))
    expect(withBudget).toBeDefined()
    expect(withBudget?.content).toContain('total')
  })
})


/**
 * THE WIRING, not the modules.
 *
 * `repair.ts`, `stuck.ts` and `verify-gate.ts` each have their own suite proving
 * they are right in isolation. This block exists because that is not the same
 * claim: three individually-correct guards can compose wrongly, and the joined
 * path is the one place that shows it. Two of the failures below were real —
 * a repair that ran before the approval gate saw it would have had a person
 * approve one call and the loop run another, and leaving the old `REPEAT_LIMIT`
 * block beside the new detector would have stopped at three before the nudge at
 * three could ever be sent.
 */

/** A turn whose `arguments` string is not JSON — what the transport hands over. */
const malformed = (name: string, raw: string, id = 'c1'): Turn => ({
  ok: true,
  text: null,
  toolCalls: [{ id, name, args: null, raw }],
  finishReason: 'tool_calls',
})

describe('malformed arguments are repaired, and then face every existing check', () => {
  /*
   * The format channel is not the capability channel, and jojo was scoring one
   * as the other. Aider publishes them separately for exactly this reason — QwQ
   * complied with the edit format 91.0% of the time and scored 42.1%;
   * Qwen2.5-Coder-32B complied 94.7% and scored 71.4%.
   *
   * Probed against the real loop before this existed: `memory_list` sent as
   * `{"type":"application","limit":"5"} </tool_call>` came back "the arguments
   * were not valid JSON", and the same call with `limit: '5'` came back
   * "limit: Needs to be a number". Neither is a mistake about the job; both cost
   * one of eight rounds.
   */
  it('runs a call whose arguments had prose stuck to the end of them', async () => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([
        malformed('memory_list', '{"type":"application","limit":"5"} </tool_call>'),
        says('none yet'),
      ]),
      history: [],
      prompt: 'what have I got',
      onEvent,
    })
    expect(run.steps[0]?.status).toBe('done')
    expect(run.steps[0]?.repairs).toContain('trimmed-garbage')
    expect(run.steps[0]?.repairs).toContain('coerced-number')
  })

  it('runs a call whose number arrived as a string', async () => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('memory_list', { type: 'application', limit: '5' }), says('none')]),
      history: [],
      prompt: 'what have I got',
      onEvent,
    })
    expect(run.steps[0]?.status).toBe('done')
    expect(run.steps[0]?.repairs).toEqual(['coerced-number'])
  })

  /*
   * Nothing is repaired quietly. The loop header's original objection to
   * repairing at all — that it "makes the trace a worse record of what happened
   * than the thing it is a trace of" — is answered by this note and only by it.
   */
  it('says on screen what it had to fix', async () => {
    const { events, onEvent } = collect()
    await runAgent({
      host: host(),
      llm: scripted([calls('memory_list', { type: 'application', limit: '5' }), says('none')]),
      history: [],
      prompt: 'x',
      onEvent,
    })
    const note = events.find((e) => e.type === 'note' && e.text.startsWith('Fixed the arguments'))
    expect(note).toBeDefined()
    // `app: true`, so it is never replayed to the model next turn as its own
    // prior speech. Telling a model its arguments were reformatted teaches it
    // nothing it can act on and costs tokens on every later request.
    expect(note).toMatchObject({ app: true })
  })

  it('leaves a step that needed nothing without a repair record', async () => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('memory_list', { type: 'application' }), says('none')]),
      history: [],
      prompt: 'x',
      onEvent,
    })
    expect(run.steps[0]?.status).toBe('done')
    expect(run.steps[0]?.repairs).toBeUndefined()
  })

  /*
   * THE ORDERING THAT MATTERS MOST. A repair that happened after `base` was
   * built would show the person one set of arguments, take their approval for
   * it, and run another — which is the exact shape of the thing the approval
   * gate exists to prevent.
   */
  it('shows the approver the repaired arguments, not the broken ones', async () => {
    const h = host()
    const made = h.run('application.create' as ToolName, NEW_APP)
    const id = (made as { ok: true; output: string }).output
    const seen: unknown[] = []
    await runAgent({
      host: h,
      llm: scripted([malformed('application_delete', `{"id":"${id}"} </tool_call>`), says('gone')]),
      history: [],
      prompt: 'delete it',
      onEvent: () => {},
      approve: (step) => {
        seen.push(step.args)
        return true
      },
    })
    expect(seen).toEqual([{ id }])
  })

  it('still asks, and still obeys a refusal, when the arguments needed repairing', async () => {
    const h = host()
    const made = h.run('application.create' as ToolName, NEW_APP)
    const id = (made as { ok: true; output: string }).output
    const approve = vi.fn(() => false)
    const run = await runAgent({
      host: h,
      llm: scripted([malformed('application_delete', `{"id":"${id}"} </tool_call>`), says('ok')]),
      history: [],
      prompt: 'delete it',
      onEvent: () => {},
      approve,
    })
    expect(approve).toHaveBeenCalledTimes(1)
    expect(run.steps[0]?.status).toBe('declined')
    // The record is the claim that matters. A repair that bypassed the gate
    // would have deleted it with the person having said no.
    expect(h.memory().ofType('application')).toHaveLength(1)
  })

  /*
   * `NEVER_IMPLICIT` is decided on the NAME, above the repair, and repair cannot
   * touch a name. `memory.clear` is one of the two operations in this app that
   * cannot be undone; `offeredFor` strips it from every request that did not ask
   * to wipe, and the loop makes that strip real rather than advisory.
   */
  it('refuses an un-offered memory.clear before repair can get near it', async () => {
    const h = host()
    const { onEvent } = collect()
    const run = await runAgent({
      host: h,
      llm: scripted([malformed('memory_clear', '{} </tool_call>'), says('ok')]),
      history: [],
      prompt: 'what applications do I have at Rice',
      onEvent,
      // The retriever's own narrowing, which is what strips the two
      // un-undoable tools. `gate: 'none'` so nothing else could stop it.
      retrieve: { carried: null, fromHistory: [] },
      gate: 'none',
    })
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.detail).toContain('No tool is called')
    expect(h.memory().ofType('application')).toHaveLength(0)
  })

  /*
   * A REPLY CUT OFF AT THE OUTPUT LIMIT IS NOT REPAIRED, and the sentence it
   * gets instead is the measured one.
   *
   * Reported from a CV import: `profile.background.add` with thirty facts in one
   * array, cut off partway through the second title. Recovering the first
   * fifteen and running them is not a formatting fix — it is a silent partial
   * write the person is then told succeeded — and "send the same call again with
   * FEWER items" is the only remedy that works, because the model cannot see its
   * own output limit.
   */
  const cutOff = async (raw: string) => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([
        {
          ok: true,
          text: null,
          finishReason: 'length',
          toolCalls: [{ id: 'c1', name: 'memory_search', args: null, raw }],
        },
        says('sorry'),
      ]),
      history: [],
      prompt: 'x',
      onEvent,
    })
    return run
  }

  it('does not repair a reply that stopped at the model output limit', async () => {
    const run = await cutOff('{"query":"ric')
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.detail).toContain('FEWER items')
  })

  /*
   * THE ONE THAT KILLS THE MUTANT, and it took a probe to find a shape where the
   * exclusion is load-bearing at all.
   *
   * `repairArgs` refuses an unterminated document on its own, so most cut-off
   * replies would be refused with or without the guard. This shape is not one of
   * them: a complete object followed by the start of a second call is
   * `trimmed-garbage` as far as the repair layer can tell, and it would recover
   * `{"query":"rice"}` and run it — measured with a probe against the real
   * module. That is a silent half-completion. The model asked for two things,
   * one would happen, and it would be told it succeeded, so it would never send
   * the second.
   *
   * The cost of the guard is one round on the shape where recovery would have
   * been right. The cost of not having it is a write the person is told about
   * and a write they are not, from the same reply.
   */
  it('does not recover the first of two calls from a reply that was cut off', async () => {
    const run = await cutOff(
      '{"query":"rice"} </tool_call><tool_call>{"name":"memory_search","argum',
    )
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.repairs).toBeUndefined()
    expect(run.steps[0]?.detail).toContain('FEWER items')
  })

  /*
   * A repair it cannot make changes nothing at all: the original arguments carry
   * on to the checks that were already there, and `runtime.check` gives the
   * accurate message. `repairArgs`'s own `reason` is deliberately never shown to
   * the model — this file keeps ownership of every sentence a model reads.
   */
  it('falls through to the tool own message when it cannot fix the arguments', async () => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: scripted([calls('application_stage_set', { stage: 'interview' }), says('ok')]),
      history: [],
      prompt: 'move it',
      onEvent,
    })
    expect(run.steps[0]?.status).toBe('failed')
    expect(run.steps[0]?.detail).toMatch(/id/i)
    expect(run.steps[0]?.repairs).toBeUndefined()
  })
})

describe('the pre-exit verification gate', () => {
  const CLAIM = "I've moved your Rice application to interview."

  /*
   * The gate is handed the conversation that came BEFORE this turn, and nothing
   * proved it: replacing `history: priorText` with `history: []` at the call
   * site left every test in this file green (the second of two survivors in a
   * 30-mutant run over the wiring).
   *
   * It is load-bearing for one rule. `named-unread-record` asks whether a
   * capitalised name in the answer came from anywhere real, and a name the
   * PERSON introduced two turns ago is real — it is just not in this turn's
   * prompt. Without the prior text the gate reads it as invented and spends a
   * round telling a model to look up something it was told.
   *
   * A single round is asserted, because that is the whole observable: with the
   * history the answer is accepted immediately; without it the gate argues once
   * and the model has to answer twice.
   */
  it('is given the conversation before this turn, so an earlier name is not \u201cinvented\u201d', async () => {
    const llm = scripted([says('Your Rice University application is at the interview stage.')])
    const { events, onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm,
      history: [{ role: 'user', content: 'I applied to Rice University last month.' }],
      prompt: 'what stage is it at',
      gate: 'none',
      onEvent,
    })
    expect(run.stopped).toBe('answered')
    // One round: the gate did not argue.
    expect(llm.seen).toHaveLength(1)
    expect(events.filter((e) => e.type === 'note' && e.app === true)).toHaveLength(0)
  })

  /**
   * A model that answers with the same claim every round, and never calls
   * anything. `n` counts the rounds it was asked for.
   */
  const claiming = async (maxSteps = 4) => {
    const { events, onEvent } = collect()
    const sent: ChatMessage[][] = []
    const llm = vi.fn((messages: readonly ChatMessage[]) => {
      sent.push([...messages])
      return Promise.resolve(says(CLAIM))
    })
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'move my Rice application to interview',
      onEvent,
      maxSteps,
    })
    const nudges = events.filter(
      (e) => e.type === 'note' && e.text.startsWith('The assistant said it had changed'),
    )
    return { run, events, llm, nudges, sent }
  }

  /*
   * `bench-score.ts` carries the number in its own comment: "an agent that calls
   * nothing and always answers scored 16/36 clean and 45/69 turns". That is 44%
   * of the suite for no work, and `answerMust` catches it at SCORING time —
   * which helps whoever reads the benchmark and does nothing for the person
   * whose application did not move.
   */
  it('sends an announcement with no write back to the model', async () => {
    const { llm, nudges, sent } = await claiming()
    expect(llm).toHaveBeenCalledTimes(2)
    expect(nudges).toHaveLength(1)
    // Second person, for the model — and it is the model that gets it, in the
    // transcript, not the person.
    expect(
      (sent[1] ?? []).some(
        (m) => m.role === 'user' && String(m.content).startsWith('Stop: you said you changed'),
      ),
    ).toBe(true)
  })

  /*
   * ONE. `MAX_VERIFY_NUDGES_PER_TURN` is not a tuning knob: a model that cannot
   * satisfy the gate is not made able to by being asked twice, and two nudges
   * would double the worst case of every turn the gate misjudges.
   *
   * The counter lives in the loop because the bound is per USER TURN and the
   * gate is called once per model turn — a gate counting for itself would reset
   * every round and never bind.
   */
  it('argues exactly once, however often the model repeats itself', async () => {
    const { run, llm, nudges } = await claiming(8)
    expect(nudges).toHaveLength(1)
    expect(llm).toHaveBeenCalledTimes(2)
    expect(run.stopped).toBe('answered')
    expect(run.answer).toBe(CLAIM)
  })

  /*
   * NOT ON THE LAST ROUND. A nudge spends a round, so nudging on the final one
   * falls out of the loop and reports `'cap'` with `answer: null` — a perfectly
   * good reply thrown away and replaced with "stopped after N rounds". The gate
   * is worth a round only when there is a round to spend.
   */
  it('accepts the answer rather than destroying it when no round is left', async () => {
    const { run, llm, nudges } = await claiming(1)
    expect(run.stopped).toBe('answered')
    expect(run.answer).toBe(CLAIM)
    expect(llm).toHaveBeenCalledTimes(1)
    expect(nudges).toHaveLength(0)
  })

  /*
   * A REPLY THAT HAS COME APART, which is the one thing the stuck detector can
   * say about an answer that the verification gate cannot.
   *
   * Gemini CLI's content scan, and the packing test is the half that makes it
   * usable: a 50-character chunk appearing ten times is not enough on its own —
   * a long answer legitimately repeats a heading — it is a chant only when the
   * occurrences are packed. A model in this state has lost the thread rather
   * than finished, so this is an error naming the cause and not an answer.
   *
   * IT IS THE ONLY VERDICT THE ANSWER PATH HONOURS TODAY, and the arithmetic
   * says so rather than the code: the other stop that can fire there is `echo`
   * at three identical answers, and at most TWO call-free answers can happen in
   * a run, because the verification gate argues once and then accepts. The
   * branch covers both because it is one branch; only this half is reachable,
   * and if `MAX_VERIFY_NUDGES_PER_TURN` ever rises the other half starts
   * working without anything here changing.
   */
  it('stops a reply that is chanting at itself rather than printing it', async () => {
    const { events, onEvent } = collect()
    const chant = 'I will look that up for you right away, one moment. '.repeat(14)
    const run = await runAgent({
      host: host(),
      llm: scripted([says(chant)]),
      history: [],
      prompt: 'what have I got',
      onEvent,
      maxSteps: 4,
    })
    expect(run.stopped).toBe('stuck')
    expect(run.answer).toBeNull()
    expect((events.at(-1) as { reason: string }).reason).toMatch(/repeating the same phrase/)
    // Never shown as the answer. That is what this replaces: a chat bubble
    // holding 700 characters of the same sentence, with the run reported as
    // having answered.
    expect(events.some((e) => e.type === 'answer')).toBe(false)
  })

  /*
   * The three `ambiguity` conversations score ASKING as the correct move —
   * "Move my Rice application to interview" matches two records, and picking one
   * is the failure. A gate that nudged a question would push the model toward
   * the exact guess those cases exist to catch.
   */
  it('leaves a clarifying question alone', async () => {
    const { onEvent } = collect()
    const llm = vi.fn(() =>
      Promise.resolve(says('There are two Rice applications — the postdoc and the lectureship. Which did you mean?')),
    )
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'move my Rice application to interview',
      onEvent,
      maxSteps: 4,
    })
    expect(run.stopped).toBe('answered')
    expect(llm).toHaveBeenCalledTimes(1)
  })

  it('leaves an ordinary answer that did the work alone', async () => {
    const { onEvent } = collect()
    const llm = vi.fn(
      (() => {
        let i = 0
        return () => Promise.resolve(i++ === 0 ? calls('application_create', NEW_APP) : says(CLAIM))
      })(),
    )
    const run = await runAgent({
      host: host(),
      llm,
      history: [],
      prompt: 'add UT Austin',
      onEvent,
      maxSteps: 4,
    })
    expect(run.stopped).toBe('answered')
    expect(llm).toHaveBeenCalledTimes(2)
  })

  /*
   * The nudge is a round the model can use. A model that takes it and does the
   * work must be answered normally — otherwise the gate would be a way of losing
   * turns rather than saving them.
   */
  it('answers normally once the nudge has been taken', async () => {
    const h = host()
    const { onEvent } = collect()
    let i = 0
    const llm = vi.fn(() => {
      i += 1
      return Promise.resolve(i === 2 ? calls('application_create', NEW_APP) : says(CLAIM))
    })
    const run = await runAgent({
      host: h,
      llm,
      history: [],
      prompt: 'add UT Austin to my applications',
      onEvent,
      maxSteps: 6,
    })
    expect(run.stopped).toBe('answered')
    expect(h.memory().ofType('application')).toHaveLength(1)
  })
})

describe('the three bad endings are told apart', () => {
  /*
   * `'error'` is the transport, `'cap'` is the round budget, `'stuck'` is the
   * model going in circles. They were two — `'stuck'` was reported as `'error'`
   * — which told every caller the least useful of the three: retrying is
   * reasonable for a transport failure, a bigger `maxSteps` may finish a capped
   * run, and repeating the same request unchanged is known not to help a stuck
   * one.
   */
  const endingFor = async (llm: LlmTurnFn) => {
    const { onEvent } = collect()
    const run = await runAgent({ host: host(), llm, history: [], prompt: 'x', onEvent, maxSteps: 8 })
    return run.stopped
  }

  it('separates a round-cap stop from a stuck stop', async () => {
    let n = 0
    const capped = await endingFor(() => {
      n += 1
      return Promise.resolve(calls('memory_list', { type: 'application', limit: n }, `c${String(n)}`))
    })
    const circling = await endingFor(() => Promise.resolve(calls('memory_overview', {})))
    expect(capped).toBe('cap')
    expect(circling).toBe('stuck')
  })

  it('separates a transport failure from both', async () => {
    expect(await endingFor(() => Promise.resolve({ ok: false, kind: 'unreachable', reason: 'no' }))).toBe(
      'error',
    )
  })

  /*
   * THE INVARIANT THAT SURVIVES THE NEW EXIT. Every call gets a reply, on the
   * way out as well as in the middle.
   *
   * `messages` is returned to the caller and stored as the thread's transcript.
   * An assistant turn asking for a tool with no matching `tool` message is
   * rejected outright by OpenAI-compatible servers on the NEXT request, naming
   * neither — so a stuck stop that returned before pushing the result would have
   * poisoned the conversation that followed it.
   */
  it('leaves a transcript every server will accept, even when it stops mid-turn', async () => {
    const { onEvent } = collect()
    const run = await runAgent({
      host: host(),
      llm: () => Promise.resolve(calls('memory_overview', {})),
      history: [],
      prompt: 'x',
      onEvent,
      maxSteps: 8,
    })
    expect(run.stopped).toBe('stuck')
    const asked = run.messages.flatMap((m) =>
      m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.id) : [],
    )
    const answered = run.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)
    expect(asked.length).toBeGreaterThan(0)
    expect(answered).toEqual(asked)
  })
})
