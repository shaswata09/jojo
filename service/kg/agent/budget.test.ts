/**
 * The trim that stops a server truncating from the front.
 *
 * Both directions cost something and they are not symmetric. Trimming too
 * eagerly loses context a follow-up needed. Not trimming at all hands the
 * server a request it will cut — and servers cut the FRONT, which is the system
 * prompt: the rules about not inventing ids, about asking when several records
 * match, about what today is. Nothing reports that and the reply looks
 * ordinary.
 */
import { describe, expect, it } from 'vitest'
import { functionSpecs } from './catalog'
import { COMPACT_TARGET, RESERVED_FOR_REPLY, fitHistory, fitsWindow, trimNote } from './budget'
import type { ChatMessage } from '../core/model-server'

const user = (text: string): ChatMessage => ({ role: 'user', content: text })
const assistant = (text: string): ChatMessage => ({ role: 'assistant', content: text })
const calling = (id: string): ChatMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name: 'memory.list', arguments: '{}' } }],
})
const result = (id: string, text: string): ChatMessage => ({
  role: 'tool',
  tool_call_id: id,
  content: text,
})

/** Big enough that a handful of them force a decision. */
const bulk = (n: number) => 'x'.repeat(n)

describe('fitHistory', () => {
  it('leaves a conversation that fits exactly as it is', () => {
    const history = [user('hello'), assistant('hi')]
    const out = fitHistory(history, [{ system: 'rules' }], 10_000)
    expect(out.dropped).toBe(0)
    expect(out.history).toBe(history)
    expect(out.overflows).toBe(false)
  })

  it('drops the OLDEST turns, keeping the recent ones a follow-up refers to', () => {
    /*
     * Sized RELATIVE to the reserve, not against a window that happened to work
     * when the reserve was 1024. Writing `4_000` here encoded the constant
     * without naming it: raising the reserve made the ceiling negative and this
     * test failed for a reason that had nothing to do with what it checks.
     *
     * What it wants is 3,000 tokens of room for history, against two turns of
     * roughly 2,200 each.
     */
    const history = [user(bulk(8000)), assistant(bulk(8000)), user('and the second one?')]
    const out = fitHistory(history, [{ system: 'rules' }], RESERVED_FOR_REPLY + 3_000)
    expect(out.dropped).toBeGreaterThan(0)
    // The last message survives: it is the one the next turn is about.
    expect(out.history.at(-1)).toEqual(user('and the second one?'))
  })

  it('never cuts a tool result away from the call it answers', () => {
    // Cutting between these two leaves `tool_call_id: c1` pointing at nothing,
    // which every provider rejects outright.
    const history = [user(bulk(6000)), calling('c1'), result('c1', bulk(6000)), assistant('done')]
    const out = fitHistory(history, [{ system: 'rules' }], 3_000)
    const orphan = out.history.findIndex(
      (m, i) => m.role === 'tool' && out.history[i - 1]?.role !== 'assistant' && i === 0,
    )
    expect(orphan).toBe(-1)
  })

  it('reserves room for the answer, so a perfect fit is not a full window', () => {
    // A request that filled the window entirely leaves nothing to reply with,
    // which reads as a truncated ANSWER rather than an oversized request.
    const window = 4_000
    const history = [user(bulk((window - 200) * 3))]
    const out = fitHistory(history, [], window)
    expect(out.dropped).toBeGreaterThan(0)
    expect(RESERVED_FOR_REPLY).toBeGreaterThan(0)
  })

  it('says so when the fixed part alone does not fit', () => {
    // 91 tool schemas against an 8k window is this case, and it is not one the
    // caller can fix by dropping conversation — there is none left to drop.
    const out = fitHistory([user('hi')], [{ tools: bulk(40_000) }], 4_000)
    expect(out.overflows).toBe(true)
    expect(out.history).toEqual([])
  })

  it('counts the tool schemas, not just the messages', () => {
    // The schemas were 95% of the request at full catalog — a budget that
    // ignored them would pass every request and prevent nothing.
    const history = [user('hi')]
    const window = RESERVED_FOR_REPLY + 3_000
    const small = fitHistory(history, [{ tools: 'tiny' }], window)
    const large = fitHistory(history, [{ tools: bulk(40_000) }], window)
    expect(small.overflows).toBe(false)
    expect(large.overflows).toBe(true)
  })
})

describe('compacting to a target, not to the line', () => {
  /** A conversation of `n` sizeable exchanges. */
  const conversation = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) =>
      i % 2 === 0 ? user(`ask ${String(i)} ${bulk(1200)}`) : assistant(`answer ${String(i)} ${bulk(1200)}`),
    )

  it('lands near a third of the window, not just under the ceiling', () => {
    // Trimming the minimum that fits is what thrashes: the next turn overflows
    // again. Measured before this, six of ten turns trimmed.
    const window = 16_000
    const out = fitHistory(conversation(40), [{ system: 'rules' }], window)
    expect(out.dropped).toBeGreaterThan(0)

    const kept = Math.round((JSON.stringify(out.history).length / 3.6) * 1.15)
    expect(kept).toBeLessThanOrEqual(Math.round(window * COMPACT_TARGET))
  })

  it('leaves room for many more turns before compacting again', () => {
    const window = 16_000
    const fixed = [{ system: 'rules' }]
    const first = fitHistory(conversation(40), fixed, window)
    expect(first.dropped).toBeGreaterThan(0)

    // Add several ordinary turns on top of what compaction left. None of them
    // should trigger another compaction — that headroom IS the point.
    let history = [...first.history]
    for (let i = 0; i < 4; i += 1) {
      history = [...history, user(`follow-up ${String(i)} ${bulk(300)}`)]
      expect(fitHistory(history, fixed, window).dropped).toBe(0)
    }
  })

  it('does not compact a conversation that already fits', () => {
    // The target is where compaction LANDS, never a size it enforces. A short
    // chat is left byte-identical, which is also what keeps the prefix cached.
    const history = conversation(2)
    const out = fitHistory(history, [{ system: 'rules' }], 100_000)
    expect(out.dropped).toBe(0)
    expect(out.history).toBe(history)
  })

  it('keeps history when the tool list is bigger than a third of the window', () => {
    /*
     * The first version aimed at `window/3 - base`, which reads correctly and
     * collapses: schemas can exceed a third of the window on their own, the
     * target goes negative, and every compaction dropped the ENTIRE
     * conversation — the opposite of keeping the important part.
     *
     * Measured at 16k with ~9.6k of schemas: 12 of 12 dropped.
     */
    const fixed = [{ tools: bulk(30_000) }]
    const history = Array.from({ length: 12 }, (_, i) => user(`turn ${String(i)} ${bulk(2500)}`))
    const out = fitHistory(history, fixed, RESERVED_FOR_REPLY + 12_000)
    expect(out.overflows).toBe(false)
    expect(out.dropped).toBeGreaterThan(0)
    // Something survives. That is the whole claim.
    expect(out.history.length).toBeGreaterThan(0)
  })

  it('tells the truth about overflow: dropped, but not summarisable', () => {
    /*
     * Two different questions, and conflating them broke it twice in a row.
     *
     * Overflow means the fixed part alone exceeds the window. History IS
     * dropped — losing the conversation is less bad than losing the system
     * prompt to a server that truncates from the front — so the person has to
     * be told, and `dropped` is what tells them. But nothing is being
     * SUMMARISED, because the request cannot be sent; recording it as
     * "summarised through here" would replace a conversation with a summary of
     * a request that never happened.
     *
     * First version reported `history.length` and the thread was corrupted.
     * Second reported 0 and the conversation vanished with nothing said.
     */
    const history = Array.from({ length: 12 }, (_, i) => user(`turn ${String(i)}`))
    const out = fitHistory(history, [{ tools: bulk(80_000) }], 8_000)
    expect(out.overflows).toBe(true)
    expect(out.dropped).toBe(12)
    expect(out.summarisable).toBe(false)
  })

  it('marks an ordinary trim as summarisable', () => {
    const history = Array.from({ length: 30 }, (_, i) => user(`turn ${String(i)} ${bulk(2500)}`))
    const out = fitHistory(history, [{ system: 'rules' }], 16_000)
    expect(out.dropped).toBeGreaterThan(0)
    expect(out.summarisable).toBe(true)
  })

  it('still respects the ceiling when a third is not reachable', () => {
    // A big fixed part can exceed a third of a small window on its own. The
    // target must not then ask for negative history, and the ceiling is still
    // the constraint that matters.
    const out = fitHistory(conversation(10), [{ tools: bulk(12_000) }], 8_000)
    expect(out.overflows === true || out.history.length < 10).toBe(true)
  })
})

describe('trimNote', () => {
  it('says what was lost and that the records are not', () => {
    const note = trimNote(4)
    expect(note).toContain('4 messages')
    expect(note).toContain('records are untouched')
  })

  it('reads correctly for one', () => {
    expect(trimNote(1)).toContain('1 message was')
  })
})

/**
 * Whether the tool list leaves room for a conversation, which is what decides
 * if the LLM chooser is worth its risk this turn.
 *
 * The chooser narrows better than the lexicon and picks worse: measured, it
 * under-picks WRITES, and an assistant given only read tools does not say it
 * cannot act — it says it did. So it earns its place only when the safe path
 * genuinely cannot work, and this is that test.
 */
describe('fitsWindow', () => {
  const specs = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `t${String(i)}`, schema: bulk(600) }))

  it('is measured against the compaction target, not the whole window', () => {
    // "Fits at all" is the wrong bar: a request where the schemas take
    // everything but the reply reserve leaves the person one turn and no
    // history.
    const tools = specs(20)
    const size = Math.round((JSON.stringify(tools).length / 3.6) * 1.15)
    expect(fitsWindow(tools, Math.round(size / COMPACT_TARGET) + 500)).toBe(true)
    expect(fitsWindow(tools, size + 500)).toBe(false)
  })

  it('says no when there is nothing to measure', () => {
    // `undefined` means the caller did not narrow at all — the whole catalog.
    expect(fitsWindow(undefined, 128_000)).toBe(false)
  })

  it('lets a small list through a small window', () => {
    expect(fitsWindow(specs(2), 32_000)).toBe(true)
  })
})

/**
 * The documented decision boundary, measured against the REAL catalog.
 *
 * `docs/AUDIT-2026-08-25.md` prints these as a table and a reader acts on them:
 * they are the reason the chooser is off on every shipped default. A table in
 * prose rots silently — the catalog grows a tool, the boundary moves, and the
 * sentence "on a shipped default the chooser never runs" quietly stops being
 * true. So the numbers live here too, where adding tools fails a test instead.
 */
describe('what fits what, on the catalog as it actually is', () => {
  it('cannot offer the whole catalog below a cloud-sized window', () => {
    const all = functionSpecs()
    expect(all.length).toBeGreaterThan(80)
    expect(fitsWindow(all, 32_000)).toBe(false)
    expect(fitsWindow(all, 128_000)).toBe(true)
  })

  it('fits a retriever-sized selection in the window every local provider declares', () => {
    // `defaultContext` is 32,768 for both local providers, and a typical
    // narrowed selection is ~24 tools. That pair is what keeps the chooser off.
    const some = functionSpecs().slice(0, 24)
    expect(fitsWindow(some, 32_000)).toBe(true)
    expect(fitsWindow(some, 16_000)).toBe(false)
  })
})

/**
 * The trim must never choose "drop everything" over "keep what fits".
 *
 * The loop ran to `cut <= history.length`, so the EMPTY tail was a candidate —
 * and an empty tail satisfies any target trivially. A conversation whose last
 * exchange was slightly too big for the target therefore lost the whole thing
 * while `overflows: false` reported that all was well: the same silent loss the
 * overflow branch was split apart to prevent, reached by another road.
 *
 * Raising `RESERVED_FOR_REPLY` to the measured value is what made it reachable.
 * It was always the behaviour.
 */
describe('what survives when the target is smaller than one exchange', () => {
  it('keeps the last exchange rather than emptying the conversation', () => {
    // A tool list taking most of the ceiling, so the target lands below the
    // size of a single turn — the shape a reasoning model's reserve creates.
    const fixed = [{ tools: bulk(30_000) }]
    const history = Array.from({ length: 12 }, (_, i) => user(`turn ${String(i)} ${bulk(2500)}`))
    const out = fitHistory(history, fixed, RESERVED_FOR_REPLY + 12_000)

    expect(out.overflows).toBe(false)
    expect(out.dropped).toBeGreaterThan(0)
    // The claim: something survives, and it is the END of the conversation.
    expect(out.history.length).toBeGreaterThan(0)
    expect(out.history.at(-1)).toEqual(history.at(-1))
  })

  it('still reports overflow when even one exchange cannot fit', () => {
    // The honest end of the scale: not "keep something regardless", but "keep
    // what genuinely fits". Here nothing does.
    const out = fitHistory([user(bulk(90_000))], [{ tools: bulk(30_000) }], RESERVED_FOR_REPLY + 12_000)
    expect(out.history).toEqual([])
  })
})

/**
 * The reserve is a claim about models, so it is pinned as one.
 *
 * Not `toBe(4096)` — that is a change-detector that says nothing and has to be
 * edited every time the number is re-measured. The claim is that the reserve
 * clears what a model needs before it has said anything, and the measurement
 * behind it is in `budget.ts`: Gemma 3 31B 39 tokens, GPT-OSS 120B 398, and
 * Qwen3 14B 2,358, on four ordinary requests with the whole catalog offered.
 *
 * Lowering it below that measurement is the specific regression this catches —
 * it was 1024 once, which is less than half of what a reasoning model needs,
 * and the failure it produced was an empty reply rather than a short one.
 */
describe('the reply reserve', () => {
  /** The worst `completion_tokens` measured across the three benchmark models. */
  const MEASURED_WORST = 2358

  it('clears what a model that reasons before it speaks actually needs', () => {
    expect(RESERVED_FOR_REPLY).toBeGreaterThan(MEASURED_WORST)
  })

  it('does not swallow the window it is reserved from', () => {
    // The other end: a reserve big enough to leave no room for history would
    // trade a truncated reply for a conversation with no memory.
    expect(RESERVED_FOR_REPLY).toBeLessThan(32_768 * COMPACT_TARGET)
  })
})

/**
 * `fitsWindow` and `fitHistory` must agree about how big a thing is.
 *
 * They measure the same bytes for different decisions — one gates the LLM
 * chooser, the other trims history — and `fitsWindow` carried its own copy of
 * the 1.15 margin. Two copies of a constant are two things that can stop
 * agreeing, and the failure would be silent: the chooser deciding a list fits
 * while the trim decides it does not.
 */
it('measures a list the same way the trim does', () => {
  const tools = Array.from({ length: 12 }, (_, i) => ({ name: `t${String(i)}`, schema: bulk(500) }))
  // The exact boundary: a window whose compaction target is precisely the
  // measured size. One token less must not fit.
  const size = Math.round((JSON.stringify(tools).length / 3.6) * 1.15)
  expect(fitsWindow(tools, Math.ceil(size / COMPACT_TARGET))).toBe(true)
  expect(fitsWindow(tools, Math.floor((size - 1) / COMPACT_TARGET))).toBe(false)
})
