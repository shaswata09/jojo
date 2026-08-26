/**
 * Running a workflow that a small model is driving.
 *
 * The behaviours here are the ones that separate this from a `for` loop with a
 * try/catch, and every one of them is about a specific way a 7B model fails:
 * one malformed reply out of six (retry), a step that improves the answer
 * rather than producing it (optional), and routing that has to be decided by
 * the code rather than by the model (conditional edges, budget).
 */

import { describe, expect, it } from 'vitest'
import { checkFlow, describeTrace, FLOW_BUDGET, runFlow } from './flow'
import type { Flow, FlowNode, StepOutcome } from './flow'

type S = { readonly seen: readonly string[] }

const node = (name: string, over: Partial<FlowNode<S>> = {}): FlowNode<S> => ({
  name,
  label: `doing ${name}`,
  run: async (state) => ({ ok: true, state: { seen: [...state.seen, name] } }),
  ...over,
})

const flow = (...nodes: FlowNode<S>[]): Flow<S> => ({ name: 'test', nodes })
const start: S = { seen: [] }

describe('running in a line', () => {
  it('runs every step in order', async () => {
    const out = await runFlow(flow(node('a'), node('b'), node('c')), start)
    expect(out.ok).toBe(true)
    expect(out.state.seen).toEqual(['a', 'b', 'c'])
  })

  it('carries each step’s state into the next', async () => {
    const out = await runFlow(
      flow(node('a'), node('b', { run: async (s) => ({ ok: true, state: { seen: [...s.seen, `b(${String(s.seen.length)})`] } }) })),
      start,
    )
    expect(out.state.seen).toEqual(['a', 'b(1)'])
  })

  it('stops at the first fatal failure and says which step', async () => {
    /*
     * "Reading your CV failed" is not something anybody can act on. Naming the
     * step is the difference between a bug report and a shrug, and it is what a
     * single try/catch around the whole run throws away.
     */
    const out = await runFlow(
      flow(node('a'), node('b', { run: async () => ({ ok: false, reason: 'no reader configured' }) }), node('c')),
      start,
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('doing b')
    expect(out.reason).toContain('no reader configured')
    // The work already done survives. Partial work is still work.
    expect(out.state.seen).toEqual(['a'])
  })
})

describe('retrying', () => {
  it('tries again when the step says it is worth it', async () => {
    /*
     * The commonest small-model failure by a wide margin: one malformed reply
     * out of six. Abandoning the run for it is why hand-rolled orchestration
     * feels unreliable on a 7B and fine on a frontier model.
     */
    let tries = 0
    const flaky: FlowNode<S> = node('flaky', {
      attempts: 3,
      run: async (s): Promise<StepOutcome<S>> => {
        tries += 1
        return tries < 3
          ? { ok: false, reason: 'the model did not return JSON', retry: true }
          : { ok: true, state: { seen: [...s.seen, 'flaky'] } }
      },
    })
    const out = await runFlow(flow(flaky), start)
    expect(out.ok).toBe(true)
    expect(tries).toBe(3)
  })

  it('runs a step exactly once when it succeeds first time', async () => {
    /*
     * `attempts` is a ceiling, not a count. Without the break on success a node
     * declaring three attempts runs three times whenever it works — three round
     * trips, three sets of writes, for one job — and every test that only
     * checks the OUTCOME still passes.
     */
    let tries = 0
    const out = await runFlow(
      flow(node('x', {
        attempts: 3,
        run: async (s) => {
          tries += 1
          return { ok: true, state: s }
        },
      })),
      start,
    )
    expect(out.ok).toBe(true)
    expect(tries).toBe(1)
    expect(out.trace).toHaveLength(1)
  })

  it('does not retry a failure the step called fatal', async () => {
    /*
     * "Nothing is configured" does not become true on a second attempt, and
     * three round trips to discover that is three times the wait for the same
     * answer. The node's own judgement about its failure wins over its
     * attempt count.
     */
    let tries = 0
    const out = await runFlow(
      flow(node('x', {
        attempts: 5,
        run: async () => {
          tries += 1
          return { ok: false, reason: 'no model configured' }
        },
      })),
      start,
    )
    expect(out.ok).toBe(false)
    expect(tries).toBe(1)
  })

  it('gives up after the last attempt', async () => {
    let tries = 0
    await runFlow(
      flow(node('x', {
        attempts: 2,
        run: async () => {
          tries += 1
          return { ok: false, reason: 'again', retry: true }
        },
      })),
      start,
    )
    expect(tries).toBe(2)
  })

  it('treats a thrown error as worth retrying', async () => {
    // A throw out of a model call is the transient case. Left uncaught it also
    // puts every caller back to wrapping the whole flow in one try/catch, which
    // is the thing this replaces.
    let tries = 0
    const out = await runFlow(
      flow(node('x', {
        attempts: 2,
        run: async (s) => {
          tries += 1
          if (tries === 1) throw new Error('socket hang up')
          return { ok: true, state: s }
        },
      })),
      start,
    )
    expect(out.ok).toBe(true)
    expect(out.trace[0]?.reason).toContain('socket hang up')
  })
})

describe('steps that may be skipped', () => {
  it('carries on past an optional step that gave up', async () => {
    /*
     * For the step that improves a result rather than producing it. Somebody
     * who uploaded a CV should get their thirty facts whether or not the graph
     * also learned how two of them connect.
     */
    const out = await runFlow(
      flow(
        node('read'),
        node('relate', { optional: true, run: async () => ({ ok: false, reason: 'model timed out' }) }),
        node('save'),
      ),
      start,
    )
    expect(out.ok).toBe(true)
    expect(out.state.seen).toEqual(['read', 'save'])
    expect(out.trace.some((t) => t.skipped === true)).toBe(true)
  })

  it('records why it was skipped rather than hiding it', async () => {
    const out = await runFlow(
      flow(node('relate', { optional: true, run: async () => ({ ok: false, reason: 'model timed out' }) })),
      start,
    )
    expect(describeTrace(out.trace).join(' ')).toContain('model timed out')
  })
})

describe('routing that is not a line', () => {
  it('follows a conditional edge decided by state', async () => {
    /*
     * By STATE, never by asking the model where to go next. A model choosing
     * its own next step is the failure this whole file exists to avoid — and
     * it is the one that gets worse the smaller the model is.
     */
    const out = await runFlow(
      flow(
        node('a', { to: (s) => (s.seen.includes('a') ? 'c' : 'b') }),
        node('b'),
        node('c'),
      ),
      start,
    )
    expect(out.state.seen).toEqual(['a', 'c'])
  })

  it('ends early when an edge points nowhere', async () => {
    const out = await runFlow(flow(node('a', { to: () => null }), node('b')), start)
    expect(out.ok).toBe(true)
    expect(out.state.seen).toEqual(['a'])
  })

  it('loops back, and stops before it spins forever', async () => {
    /*
     * A conditional edge can point backwards — that is what non-linear means,
     * and it is also what makes an infinite loop possible. Stopping with a
     * readable trace beats spinning against somebody's GPU.
     */
    const out = await runFlow(flow(node('a', { to: () => 'a' })), start)
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('loops')
    expect(out.trace.length).toBeLessThanOrEqual(FLOW_BUDGET + 1)
  })

  it('refuses an edge to a step that does not exist', async () => {
    const out = await runFlow(flow(node('a', { to: () => 'nowhere' })), start)
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('nowhere')
  })

  it('routes around a step that could not run', async () => {
    // The branch exists precisely so an optional failure has somewhere to go.
    const out = await runFlow(
      flow(
        node('try', {
          optional: true,
          run: async () => ({ ok: false, reason: 'no' }),
          to: (s) => (s.seen.includes('try') ? 'after' : 'fallback'),
        }),
        node('fallback'),
        node('after'),
      ),
      start,
    )
    expect(out.state.seen).toEqual(['fallback', 'after'])
  })
})

describe('being stopped', () => {
  it('stops between steps when the signal is aborted', async () => {
    /*
     * A plain object, not an `AbortController`. This layer compiles without
     * DOM, so naming one here is a type error — and the flow only ever reads
     * `.aborted`, which is the whole of `Cancellation`. A real `AbortSignal`
     * passes the same way, structurally, which is what the apps hand it.
     */
    const stop = { aborted: false }
    const out = await runFlow(
      flow(node('a', { run: async (s) => { stop.aborted = true; return { ok: true, state: { seen: [...s.seen, 'a'] } } } }), node('b')),
      start,
      { signal: stop },
    )
    expect(out.ok).toBe(false)
    expect(out.state.seen).toEqual(['a'])
  })
})

describe('what the caller can watch', () => {
  it('announces each step with a label a person can read', async () => {
    const seen: string[] = []
    await runFlow(flow(node('a'), node('b')), start, { onStep: (label) => seen.push(label) })
    expect(seen).toEqual(['doing a', 'doing b'])
  })

  it('offers a checkpoint after every step that succeeded', async () => {
    /*
     * A callback rather than a store: what "durable" means differs per platform
     * and this layer is forbidden from knowing. A caller that persists here can
     * start the next run from the middle.
     */
    const saved: string[] = []
    await runFlow(flow(node('a'), node('b')), start, { onCheckpoint: (n) => saved.push(n) })
    expect(saved).toEqual(['a', 'b'])
  })

  it('does not checkpoint a step that failed', async () => {
    // Checkpointing a failure would make the resumed run start after a step
    // that never happened.
    const saved: string[] = []
    await runFlow(
      flow(node('a', { optional: true, run: async () => ({ ok: false, reason: 'no' }) })),
      start,
      { onCheckpoint: (n) => saved.push(n) },
    )
    expect(saved).toEqual([])
  })
})

describe('checking a flow before running it', () => {
  it('catches two steps with one name', () => {
    // A duplicate name makes `to` ambiguous and the trace unreadable.
    expect(checkFlow(flow(node('a'), node('a')))).toContain('two steps are called “a”')
  })

  it('catches a step with nothing to show', () => {
    expect(checkFlow(flow(node('a', { label: '  ' })))).toHaveLength(1)
  })

  it('catches a step set to run fewer than once', () => {
    expect(checkFlow(flow(node('a', { attempts: 0 })))).toHaveLength(1)
  })

  it('passes a well-formed flow', () => {
    expect(checkFlow(flow(node('a'), node('b')))).toEqual([])
  })
})
