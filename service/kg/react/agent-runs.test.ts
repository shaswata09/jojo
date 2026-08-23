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
import type { RunSignal } from './agent-runs'

const answering = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

const host: ToolHost = {
  memory: () => new MutableSnapshot(),
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
