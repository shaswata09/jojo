/**
 * The two readings of a stored conversation.
 *
 * Pure functions only — no renderer, per D20. What they are worth testing FOR is
 * the pairing: a server rejects a `tool` message whose `tool_call_id` has no
 * preceding assistant turn asking for it, and rejects it without naming either,
 * so a thread that continues wrongly fails as an opaque 400 several turns later.
 */
import { describe, expect, it } from 'vitest'
import type { ThreadEntry } from '../core/model'
import { toAgentEntries, toThreadEntries, toTranscript } from './use-threads'
import type { AgentEntry } from './use-agent'

const step = (over: Partial<Extract<ThreadEntry, { kind: 'step' }>> = {}) =>
  ({
    kind: 'step',
    tool: 'memory.list',
    title: 'List records',
    effect: 'read',
    args: { type: 'application' },
    status: 'done',
    detail: '[]',
    ...over,
  }) as ThreadEntry

describe('the transcript a model continues from', () => {
  it('puts the assistant turn before the tool result, as servers require', () => {
    const out = toTranscript([{ kind: 'you', text: 'what is here' }, step()])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
    const assistant = out[1] as unknown as {
      tool_calls: { id: string; function: { name: string } }[]
    }
    const tool = out[2] as unknown as { tool_call_id: string }
    expect(tool.tool_call_id).toBe(assistant.tool_calls[0]?.id)
  })

  it('sends the wire spelling of a tool name, not the registry one', () => {
    // OpenAI function names forbid a dot, and a server rejects the whole request
    // rather than the one tool.
    const out = toTranscript([step({ tool: 'graph.query' })])
    const assistant = out[0] as unknown as { tool_calls: { function: { name: string } }[] }
    expect(assistant.tool_calls[0]?.function.name).toBe('graph_query')
  })

  it('collapses consecutive steps into one assistant turn, as they arrived', () => {
    const out = toTranscript([step(), step({ tool: 'memory.get' }), { kind: 'answer', text: 'ok' }])
    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'assistant'])
    const assistant = out[0] as unknown as { tool_calls: unknown[] }
    expect(assistant.tool_calls).toHaveLength(2)
  })

  it('mints ids from position, so re-deriving a thread twice agrees with itself', () => {
    const thread: ThreadEntry[] = [{ kind: 'you', text: 'x' }, step()]
    expect(JSON.stringify(toTranscript(thread))).toBe(JSON.stringify(toTranscript(thread)))
  })

  it('tells the model its own failure as an observation, not as something it said', () => {
    // An assistant turn reading "Nothing answered" is a sentence it will
    // helpfully repeat.
    const out = toTranscript([{ kind: 'error', text: 'Nothing answered.' }])
    expect(out[0]?.role).toBe('user')
    expect((out[0] as { content: string }).content).toContain('previous attempt failed')
  })

  it('never emits a tool turn with no call in front of it', () => {
    // The invariant, over every arrangement the store can hold.
    const messy: ThreadEntry[] = [
      step(),
      { kind: 'answer', text: 'a' },
      step({ status: 'failed', detail: 'Error: no' }),
      step(),
      { kind: 'you', text: 'again' },
      { kind: 'error', text: 'boom' },
      step(),
    ]
    const out = toTranscript(messy)
    const open = new Set<string>()
    for (const m of out) {
      if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls) {
        for (const c of m.tool_calls) open.add(c.id)
      }
      if (m.role === 'tool') {
        expect(open.has(m.tool_call_id)).toBe(true)
        open.delete(m.tool_call_id)
      }
    }
    expect(open.size).toBe(0)
  })
})

describe('the round trip a screen makes', () => {
  it('survives storing and re-reading every turn shape', () => {
    const stored: ThreadEntry[] = [
      { kind: 'you', text: 'hello' },
      { kind: 'note', text: 'looking' },
      step(),
      { kind: 'answer', text: 'done' },
      { kind: 'error', text: 'oops' },
    ]
    expect(toThreadEntries(toAgentEntries(stored))).toEqual(stored)
  })

  it('never stores a step still running', () => {
    // An exchange is saved once it has settled, and a step frozen mid-flight
    // would read as a hang forever.
    const live: AgentEntry[] = [
      {
        kind: 'step',
        id: 's1',
        step: {
          id: 's1',
          name: 'memory.list',
          title: 'List',
          effect: 'read',
          destructive: false,
          args: {},
          status: 'running',
        },
      },
    ]
    const out = toThreadEntries(live)
    expect((out[0] as { status: string }).status).toBe('failed')
  })

  it('drops the undo closure, which cannot survive a reload', () => {
    const back = toAgentEntries([step()])
    expect((back[0] as { step: { undo?: unknown } }).step.undo).toBeUndefined()
  })
})
