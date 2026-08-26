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
import {
  entriesForMessages,
  nextContextThrough,
  toAgentEntries,
  toThreadEntries,
  toTranscript,
} from './use-threads'
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

/**
 * The translation between what a thread stores and what a loop compacts.
 *
 * The loop counts MESSAGES and a thread stores ENTRIES, and a run of steps
 * collapses into one assistant turn plus a result each — so the two counts
 * diverge exactly where a conversation did work. Getting this wrong marks
 * entries as summarised that the summary never saw, and those exchanges then
 * vanish from the next turn with nothing standing in for them.
 */
describe('entriesForMessages', () => {
  const you = (text: string): ThreadEntry => ({ kind: 'you', text })
  const answer = (text: string): ThreadEntry => ({ kind: 'answer', text })
  const step = (_n: number): ThreadEntry => ({
    kind: 'step',
    tool: 'memory.list',
    title: 'List records',
    effect: 'read',
    args: {},
    status: 'done',
  })

  it('is one-to-one where the entries are plain turns', () => {
    const entries = [you('a'), answer('b'), you('c')]
    expect(entriesForMessages(entries, 3)).toBe(3)
    expect(entriesForMessages(entries, 2)).toBe(2)
  })

  it('never overshoots the messages the summary actually saw', () => {
    // THE property. Rounding up would mark an exchange summarised that the
    // summariser never read, and it would then be dropped with nothing in its
    // place.
    const entries = [you('a'), step(1), step(2), answer('b'), you('c')]
    for (let m = 0; m <= 8; m += 1) {
      const at = entriesForMessages(entries, m)
      expect(toTranscript(entries.slice(0, at)).length).toBeLessThanOrEqual(m)
    }
  })

  it('handles a run of steps, which is where the two counts diverge', () => {
    // Two steps become one assistant turn plus two results — three messages
    // from two entries, so a naive one-to-one would be wrong by one.
    const entries = [you('a'), step(1), step(2)]
    expect(toTranscript(entries).length).toBeGreaterThan(entries.length)
    expect(entriesForMessages(entries, toTranscript(entries).length)).toBe(entries.length)
  })

  it('answers zero and the whole list at the ends', () => {
    const entries = [you('a'), answer('b')]
    expect(entriesForMessages(entries, 0)).toBe(0)
    expect(entriesForMessages(entries, -5)).toBe(0)
    expect(entriesForMessages(entries, 1000)).toBe(entries.length)
    expect(entriesForMessages([], 5)).toBe(0)
  })
})

/**
 * Where a second compaction's summary reaches.
 *
 * The loop counts messages, and the messages it counted came from
 * `entries.slice(contextThrough)` — not from the whole thread. Measuring
 * against the full list moved the boundary BACKWARDS on every compaction after
 * the first, un-covering entries the summary had already replaced so they were
 * sent again beside a summary that contained them.
 */
describe('nextContextThrough', () => {
  const you = (text: string): ThreadEntry => ({ kind: 'you', text })
  const answer = (text: string): ThreadEntry => ({ kind: 'answer', text })
  const entries = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? you(`q${String(i)}`) : answer(`a${String(i)}`)))

  it('moves forward from where the last summary reached', () => {
    // Six already covered, four more messages summarised -> ten, not four.
    expect(nextContextThrough(entries, 6, 4)).toBe(10)
  })

  it('never moves backwards', () => {
    for (const from of [0, 3, 6, 12, 19]) {
      for (const messages of [0, 1, 5, 100]) {
        expect(nextContextThrough(entries, from, messages)).toBeGreaterThanOrEqual(from)
      }
    }
  })

  it('is the plain count when nothing was covered before', () => {
    expect(nextContextThrough(entries, 0, 4)).toBe(entriesForMessages(entries, 4))
  })

  it('stays inside the list whatever it is handed', () => {
    expect(nextContextThrough(entries, 99, 5)).toBe(entries.length)
    expect(nextContextThrough(entries, -3, 0)).toBe(0)
    expect(nextContextThrough([], 0, 5)).toBe(0)
  })
})
