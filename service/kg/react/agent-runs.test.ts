/**
 * The registry that owns a conversation's run instead of a component owning it.
 *
 * Every test here is a thing that was broken before it existed, and the ones
 * that matter most are the ones about IDENTITY: which conversation a run belongs
 * to, and whether answering one can overwrite another. Those were the silent
 * failures — the loud one (a run that stopped) was only ever the visible half.
 */

import { describe, expect, it, vi } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import type { ToolHost } from '../agent/execute'
import type { ChatMessage, Turn } from '../core/model-server'
import type { NodeId } from '../core/model'
import { createAgentRuns } from './agent-runs'
import { RESERVED_FOR_REPLY } from '../agent/budget'
import { RESIDENT } from '../agent/retrieve'
import { CATALOG } from '../agent/catalog'
import type { RunSignal, StartOptions } from './agent-runs'

const answering = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

const host: ToolHost = {
  memory: () => new MutableSnapshot(),
  today: () => '2026-09-14',
  check: (_n, input) => ({ ok: true, value: input }),
  run: () => ({ ok: true, output: null, announcement: { title: 'Done' }, undo: null }),
}

/** A model that answers immediately with the question echoed back. */
const echo = async (messages: readonly ChatMessage[]) => {
  const asked = [...messages].reverse().find((m) => m.role === 'user')
  return answering(`answered:${String(asked?.content ?? '')}`)
}

/** A model that does not answer until told to. */
function heldModel() {
  let release: (turn: Turn) => void = () => {}
  const held = new Promise<Turn>((resolve) => {
    release = resolve
  })
  return { llm: async () => held, answer: (text: string) => release(answering(text)) }
}

const A = 'thread:a' as NodeId
const B = 'thread:b' as NodeId

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

describe('a run that outlives whatever started it', () => {
  it('finishes and reports the thread it was FOR', async () => {
    const runs = createAgentRuns()
    const onSettled = vi.fn()
    runs.start({ threadId: A, prompt: 'hello', history: [], llm: () => echo, host, onSettled })

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled())
    const [threadId, entries] = onSettled.mock.calls[0]!
    expect(threadId).toBe(A)
    expect(entries.map((e: { kind: string }) => e.kind)).toEqual(['you', 'answer'])
  })

  it('keeps the question the moment it is asked, before any answer exists', () => {
    const runs = createAgentRuns()
    const { llm } = heldModel()
    runs.start({ threadId: A, prompt: 'what next', history: [], llm: () => llm, host })

    const run = runs.get(A)
    expect(run?.busy).toBe(true)
    expect(run?.entries).toEqual([{ kind: 'you', id: 'e1', text: 'what next' }])
  })

  /*
   * The literal complaint. Two conversations working at once was impossible
   * before — one hook, one `busy`, one abort object, one transcript — and the
   * thread list disabled every other conversation while anything ran.
   */
  it('runs two conversations at once, without either noticing the other', async () => {
    const runs = createAgentRuns()
    const first = heldModel()
    const second = heldModel()
    const settled: string[] = []
    const onSettled = (threadId: NodeId) => settled.push(threadId)

    runs.start({ threadId: A, prompt: 'about A', history: [], llm: () => first.llm, host, onSettled })
    runs.start({ threadId: B, prompt: 'about B', history: [], llm: () => second.llm, host, onSettled })

    expect([...runs.busyThreads()].sort()).toEqual([A, B])

    second.answer('B is done')
    await vi.waitFor(() => expect(settled).toEqual([B]))
    expect(runs.get(A)?.busy).toBe(true)
    expect(runs.busyThreads()).toEqual([A])

    first.answer('A is done')
    await vi.waitFor(() => expect(settled).toEqual([B, A]))
    expect(runs.busyThreads()).toEqual([])
  })

  /*
   * Each conversation keeps its own transcript. The old code had one `history`
   * ref and one `settled` array per hook, so a second run seeded itself from
   * the first's entries and whichever finished last overwrote the other —
   * `assistant.thread.set` replaces the list wholesale.
   */
  it('never lets one conversation’s answer land in another', async () => {
    const runs = createAgentRuns()
    const saved = new Map<NodeId, string[]>()
    const onSettled = (threadId: NodeId, entries: readonly { kind: string }[]) => {
      saved.set(threadId, entries.map((e) => e.kind))
    }
    runs.start({ threadId: A, prompt: 'A', history: [], llm: () => echo, host, onSettled })
    runs.start({ threadId: B, prompt: 'B', history: [], llm: () => echo, host, onSettled })

    await vi.waitFor(() => expect(saved.size).toBe(2))
    expect(runs.get(A)?.entries.some((e) => e.kind === 'you' && e.text === 'A')).toBe(true)
    expect(runs.get(A)?.entries.some((e) => e.kind === 'you' && e.text === 'B')).toBe(false)
    expect(runs.get(B)?.entries.some((e) => e.kind === 'you' && e.text === 'B')).toBe(true)
  })

  it('refuses a second send into a conversation already working', () => {
    const runs = createAgentRuns()
    const { llm } = heldModel()
    runs.start({ threadId: A, prompt: 'first', history: [], llm: () => llm, host })
    runs.start({ threadId: A, prompt: 'second', history: [], llm: () => llm, host })

    expect(runs.get(A)?.entries.filter((e) => e.kind === 'you')).toHaveLength(1)
  })

  it('ignores an empty prompt rather than starting a run for it', () => {
    const runs = createAgentRuns()
    runs.start({ threadId: A, prompt: '   ', history: [], llm: () => echo, host })
    expect(runs.get(A)).toBeUndefined()
  })
})

describe('an approval that outlives the screen that asked', () => {
  /** A model that asks to delete something, once. */
  function deleting() {
    let asked = false
    const llm = async (): Promise<Turn> => {
      if (asked) return answering('done')
      asked = true
      return {
        ok: true,
        text: null,
        toolCalls: [
          { id: 'c1', name: 'application_delete', args: { id: 'app:1' }, raw: '{}' },
        ],
        finishReason: 'tool_calls',
      }
    }
    return llm
  }

  /*
   * The deadlock. The approval used to resolve from a button rendered inside
   * the transcript, so closing the page left `runAgent` parked on a promise
   * nobody could reach — forever, un-abortable, and the exchange was never
   * saved.
   */
  it('parks on the run, where anything can answer it', async () => {
    const runs = createAgentRuns()
    const onSettled = vi.fn()
    runs.start({ threadId: A, prompt: 'delete it', history: [], llm: () => deleting(), host, onSettled })

    await vi.waitFor(() => expect(runs.get(A)?.pending).not.toBeNull())
    expect(runs.waiting().map((r) => r.threadId)).toEqual([A])
    expect(runs.get(A)?.pending?.step.name).toBe('application.delete')

    runs.decide(A, true)
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled())
    expect(runs.get(A)?.pending).toBeNull()
  })

  it('lets a parked run be stopped, rather than stranding it', async () => {
    const runs = createAgentRuns()
    const onSettled = vi.fn()
    runs.start({ threadId: A, prompt: 'delete it', history: [], llm: () => deleting(), host, onSettled })
    await vi.waitFor(() => expect(runs.get(A)?.pending).not.toBeNull())

    runs.stop(A)
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled())
    expect(runs.get(A)?.busy).toBe(false)
    expect(runs.get(A)?.pending).toBeNull()
  })

  it('does nothing when asked to decide something that is not waiting', () => {
    const runs = createAgentRuns()
    expect(() => runs.decide(A, true)).not.toThrow()
  })
})

describe('what a screen subscribes to', () => {
  it('tells listeners when anything changes', async () => {
    const runs = createAgentRuns()
    const seen = vi.fn()
    const off = runs.subscribe(seen)
    runs.start({ threadId: A, prompt: 'hello', history: [], llm: () => echo, host })
    await settle()
    expect(seen).toHaveBeenCalled()
    off()
  })

  /*
   * `useSyncExternalStore` compares by reference, so a getter that mints a
   * fresh array on every call re-renders forever. `queue.ts` and
   * `kg-context.ts` both make this promise about their getters.
   */
  it('returns the same list between changes, so React can compare it', async () => {
    const runs = createAgentRuns()
    const { llm } = heldModel()
    runs.start({ threadId: A, prompt: 'hello', history: [], llm: () => llm, host })
    const once = runs.busyThreads()
    expect(runs.busyThreads()).toBe(once)
    await settle()
    expect(runs.busyThreads()).toBe(once)
  })

  it('stops unsubscribed listeners being called', async () => {
    const runs = createAgentRuns()
    const seen = vi.fn()
    runs.subscribe(seen)()
    runs.start({ threadId: A, prompt: 'hello', history: [], llm: () => echo, host })
    await settle()
    expect(seen).not.toHaveBeenCalled()
  })

  it('forgets a conversation on request, stopping it first', async () => {
    const runs = createAgentRuns()
    const { llm } = heldModel()
    runs.start({ threadId: A, prompt: 'hello', history: [], llm: () => llm, host })
    runs.forget(A)
    expect(runs.get(A)).toBeUndefined()
    expect(runs.busyThreads()).toEqual([])
  })

  it('stops everything when the store underneath is going away', async () => {
    const runs = createAgentRuns()
    const onSettled = vi.fn()
    runs.start({ threadId: A, prompt: 'a', history: [], llm: () => heldModel().llm, host, onSettled })
    runs.start({ threadId: B, prompt: 'b', history: [], llm: () => heldModel().llm, host, onSettled })
    runs.stopAll()
    // The flag is set; the loop notices between rounds. What matters here is
    // that neither is left parked on a person who has gone.
    expect(runs.waiting()).toEqual([])
  })
})

describe('stopping a run', () => {
  /*
   * Stop used to mean "finish this round first". The loop reads a plain
   * `{aborted}` flag between rounds, so on a slow model the UI said stopped
   * while the HTTP request stayed open to its sixty-second timeout. The flag
   * carries a subscription now, and the app hangs its AbortController on it.
   */
  it('tells the app to cancel its request, not just the loop', async () => {
    const runs = createAgentRuns()
    const cancelled = vi.fn()
    const held = heldModel()

    runs.start({
      threadId: A,
      prompt: 'hello',
      history: [],
      host,
      llm: (signal) => {
        signal.onAbort(cancelled)
        return held.llm
      },
    })

    expect(cancelled).not.toHaveBeenCalled()
    runs.stop(A)
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('fires immediately for a subscriber that arrives after the stop', () => {
    const runs = createAgentRuns()
    const late = vi.fn()
    // Collected rather than assigned to a `let`: TypeScript narrows a variable
    // initialised to `null` and cannot see the assignment inside the callback.
    const handed: RunSignal[] = []
    runs.start({
      threadId: A,
      prompt: 'hello',
      history: [],
      host,
      llm: (signal) => {
        handed.push(signal)
        return heldModel().llm
      },
    })
    runs.stop(A)
    handed[0]?.onAbort(late)
    expect(late).toHaveBeenCalledTimes(1)
  })
})

describe('carrying the tool set between turns', () => {
  it('starts the next turn from what the last one was offered', async () => {
    /*
     * The retriever's carry is grow-only and was never exercised: `carried` was
     * hard-wired to `null`, so turn one sent a narrowed set and turn two — "yes,
     * do that", which matches no seed and makes the retriever abstain — sent the
     * entire catalog. A conversation whose prompt prefix changes size between
     * turns cannot be prefix-cached, and on a small model the second message is
     * where the window runs out.
     */
    const runs = createAgentRuns()
    const seen: number[] = []
    const llm = () => async (_m: readonly ChatMessage[], tools: readonly unknown[]) => {
      seen.push(tools.length)
      return answering('done')
    }

    runs.start({ threadId: A, prompt: 'add a reminder for Thursday', history: [], llm, host })
    await vi.waitFor(() => expect(runs.get(A)?.busy).toBe(false))
    const narrowed = runs.get(A)?.offered
    expect(narrowed, 'the opener should have narrowed').not.toBeNull()

    runs.start({ threadId: A, prompt: 'yes, do that', history: [], llm, host })
    await vi.waitFor(() => expect(seen.length).toBe(2))

    /*
     * The follow-up must not be offered MORE than the opener. The carry is
     * grow-only, so equal or a little larger is correct; jumping to the whole
     * catalog is the defect.
     */
    expect(seen[1]).toBeLessThanOrEqual((seen[0] ?? 0) + RESIDENT.length)
    expect(seen[1]).toBeLessThan(CATALOG.length)
  })

  it('keeps two conversations’ tool sets apart', async () => {
    // Carried per thread. Two conversations about different things must not
    // inherit each other's tools.
    const runs = createAgentRuns()
    const llm = () => async () => answering('done')

    runs.start({ threadId: A, prompt: 'delete the Rice application', history: [], llm, host })
    await vi.waitFor(() => expect(runs.get(A)?.busy).toBe(false))
    runs.start({ threadId: B, prompt: 'what is on this week', history: [], llm, host })
    await vi.waitFor(() => expect(runs.get(B)?.busy).toBe(false))

    expect(runs.get(A)?.offered).not.toEqual(runs.get(B)?.offered)
  })
})

/**
 * The seam between a compaction and the conversation that has to remember it.
 *
 * The loop can summarise perfectly and the thread can store perfectly, and a
 * long chat still forgets everything if nothing carries one to the other. That
 * "nothing" is four lines in `start`, it has no visible symptom when it is
 * missing — the turn answers normally — and every other test in this file
 * passed without it. So it is tested here rather than trusted.
 */
describe('what a compaction has to tell the thread', () => {
  /** Long enough that the fixed part plus history cannot fit the window. */
  const longHistory = (turns: number): ChatMessage[] =>
    Array.from({ length: turns }, (_, i) => [
      { role: 'user' as const, content: `question ${String(i)} ${'x'.repeat(400)}` },
      { role: 'assistant' as const, content: `answer ${String(i)} ${'y'.repeat(400)}` },
    ]).flat()

  it('reports the summary, the thread it belongs to, and how far it reaches', async () => {
    const runs = createAgentRuns()
    const onCompacted = vi.fn()

    runs.start({
      threadId: A,
      prompt: 'and what about the last one',
      history: longHistory(20),
      llm: () => echo,
      host,
      tools: ['memory.overview'],
      // Relative to the reserve, not a bare number: `4_000` silently became an
      // OVERFLOW (nothing compacts, because no amount of history would help)
      // the moment the reply reserve was raised to what a reasoning model needs.
      window: RESERVED_FOR_REPLY + 4_000,
      summariser: { ask: async () => answering('You asked about twenty applications at Rice.') },
      onCompacted,
    })

    await vi.waitFor(() => expect(onCompacted).toHaveBeenCalled())
    const [threadId, context, through] = onCompacted.mock.calls[0]!
    expect(threadId).toBe(A)
    expect(context).toContain('twenty applications at Rice')
    // The count is what stops the NEXT turn summarising the same exchanges
    // again, so a zero here would be a compaction that repeats forever.
    expect(through).toBeGreaterThan(0)
  })

  it('says nothing when the conversation fit', async () => {
    const runs = createAgentRuns()
    const onCompacted = vi.fn()
    const onSettled = vi.fn()

    runs.start({
      threadId: A,
      prompt: 'hello',
      history: [],
      llm: () => echo,
      host,
      tools: ['memory.overview'],
      window: 128_000,
      summariser: { ask: async () => answering('should never be asked') },
      onCompacted,
      onSettled,
    })

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled())
    expect(onCompacted).not.toHaveBeenCalled()
  })
})

/**
 * Two turns of one conversation, each calling a tool.
 *
 * `runAgent`'s step counter restarts at 0 every run, and `record` upserts by
 * entry id — so turn two's first step arrived as the same id as turn one's and
 * overwrote it IN PLACE. Turn one's tool row was destroyed, turn two's was
 * filed under turn one's question, and the result was persisted through
 * `assistant.thread.set`, which is `undoable: false`.
 *
 * The counter-example matters as much: a step is recorded twice, `running` then
 * `done`, and the shared id is what makes those one row. A fix that mints a
 * fresh id per event splits every tool call in two. Both are asserted here.
 */
describe('step rows across turns', () => {
  const callThenSay = (answer: string) => {
    let n = 0
    return async (): Promise<Turn> =>
      n++ === 0
        ? {
            ok: true,
            text: null,
            toolCalls: [{ id: 'c1', name: 'memory_overview', args: {}, raw: '{}' }],
            finishReason: 'tool_calls',
          }
        : answering(answer)
  }

  it('gives each turn its own step row, and each step exactly one', async () => {
    const runs = createAgentRuns()
    const settled = vi.fn()
    const turn = (prompt: string, history: readonly ChatMessage[], answer: string) => {
      runs.start({
        threadId: A,
        prompt,
        history,
        llm: () => callThenSay(answer),
        host,
        tools: ['memory.overview'],
        entries: runs.get(A)?.entries ?? [],
        onSettled: settled,
      })
    }

    turn('first', [], 'one')
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1))
    turn('second', settled.mock.calls[0]![2] as ChatMessage[], 'two')
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(2))

    const kinds = (runs.get(A)?.entries ?? []).map((e) => e.kind)
    expect(kinds).toEqual(['you', 'step', 'answer', 'you', 'step', 'answer'])
    // Distinct ids, or one of them overwrote the other.
    const ids = (runs.get(A)?.entries ?? []).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/*
 * A run that has been FORGOTTEN is not a run that is over.
 *
 * `forget` sets the abort flag and drops the run's state, but the promise is
 * still unwinding — an aborted request has to come back before `runAgent`
 * returns. Everything that happens after the await is keyed by thread id, so
 * whatever occupies that key when the abandoned run finally settles is what it
 * writes to. Both AskBoxes reach this in two clicks: "Ask something else" is
 * live mid-run, and so is the composer behind it.
 */
describe('a run abandoned while a new one takes its place', () => {
  it('does not clear the busy flag of the run that replaced it', async () => {
    const runs = createAgentRuns()
    const abandoned = heldModel()
    const replacement = heldModel()

    runs.start({ threadId: A, prompt: 'first', history: [], llm: () => abandoned.llm, host })
    runs.forget(A)
    runs.start({ threadId: A, prompt: 'second', history: [], llm: () => replacement.llm, host })

    abandoned.answer('the answer nobody is waiting for')
    await settle()

    expect(runs.get(A)?.busy).toBe(true)
    expect(runs.busyThreads()).toEqual([A])
  })

  it('leaves the replacement stoppable', async () => {
    const runs = createAgentRuns()
    const abandoned = heldModel()
    const cancelled = vi.fn()

    runs.start({ threadId: A, prompt: 'first', history: [], llm: () => abandoned.llm, host })
    runs.forget(A)
    runs.start({
      threadId: A,
      prompt: 'second',
      history: [],
      host,
      llm: (signal) => {
        signal.onAbort(cancelled)
        return heldModel().llm
      },
    })

    abandoned.answer('the answer nobody is waiting for')
    await settle()

    // `inner` is where the replacement's cancellation lives. The abandoned
    // run's `finally` deleted it by thread id, so Stop did nothing at all.
    runs.stop(A)
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('never saves the replacement’s transcript under the abandoned run’s turn', async () => {
    const runs = createAgentRuns()
    const abandoned = heldModel()
    const onSettled = vi.fn()

    const start = (prompt: string, llm: StartOptions['llm']) => {
      runs.start({ threadId: A, prompt, history: [], llm, host, onSettled })
    }

    start('first', () => abandoned.llm)
    runs.forget(A)
    start('second', () => heldModel().llm)

    abandoned.answer('the answer nobody is waiting for')
    await settle()

    // `assistant.thread.set` REPLACES the stored entries and is `undoable:
    // false`, so a save carrying the live run's half-finished list is a
    // conversation destroyed on disk.
    expect(onSettled).not.toHaveBeenCalled()
    expect(runs.get(A)?.entries).toEqual([{ kind: 'you', id: 'e1', text: 'second' }])
  })

  it('does not put the abandoned run’s failure on the new conversation', async () => {
    const runs = createAgentRuns()
    let fail: (reason: Error) => void = () => {}
    const throwing = new Promise<Turn>((_resolve, reject) => {
      fail = reject
    })

    runs.start({ threadId: A, prompt: 'first', history: [], llm: () => () => throwing, host })
    runs.forget(A)
    runs.start({ threadId: A, prompt: 'second', history: [], llm: () => heldModel().llm, host })

    fail(new Error('the reader was never started'))
    await settle()

    expect(runs.get(A)?.entries.some((e) => e.kind === 'error')).toBe(false)
  })

  it('does not hand the abandoned run’s tool set to the new one', async () => {
    const runs = createAgentRuns()
    const abandoned = heldModel()

    runs.start({
      threadId: A,
      prompt: 'first',
      history: [],
      llm: () => abandoned.llm,
      host,
      tools: ['memory.overview'],
    })
    runs.forget(A)
    runs.start({ threadId: A, prompt: 'second', history: [], llm: () => heldModel().llm, host })

    abandoned.answer('the answer nobody is waiting for')
    await settle()

    // `offered` is what the NEXT turn carries. Inheriting a dead run's is a
    // conversation narrowed to tools it never used.
    expect(runs.get(A)?.offered).toBeNull()
  })
})
