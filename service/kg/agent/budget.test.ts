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
import {
  COMPACT_TARGET,
  RESERVED_FOR_REPLY,
  SUMMARY_ROOM_SHARE,
  SUMMARY_SHARE,
  fitHistory,
  fitsWindow,
  stubFor,
  trimNote,
} from './budget'
import { MIN_SUMMARY_CHARS } from './compact'
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

/** The loop's own measure of a request, so the tests cannot disagree with it. */
const tokensOf = (parts: readonly unknown[]) =>
  Math.round((JSON.stringify(parts).length / 3.6) * 1.15)

/**
 * The trim's own size, with BOTH of its roundings: `estimateTokens` rounds, and
 * then the margin rounds again. `tokensOf` above folds them into one and can
 * differ by a token — which the exact character counts below cannot afford,
 * because they sit ON the boundary.
 */
const measure = (parts: readonly unknown[]) =>
  Math.round(Math.round(JSON.stringify(parts).length / 3.6) * 1.15)

/**
 * What a token buys in characters, derived from the estimator's divisor the way
 * `budget.ts` derives it — 3.6 rounded to whole tokens per thousand characters,
 * inverted. Writing 3.6 straight would be off by a thousandth and the exact
 * character counts below sit on the boundary.
 */
const charsPerToken = 1000 / Math.round(1000 / 3.6)

/**
 * Every `tool` message answers an assistant call that is still in front of it.
 * This is the shape every provider checks, and the one a bad cut breaks.
 */
const wellFormed = (history: readonly ChatMessage[]): boolean => {
  const answered = new Set<string>()
  for (const m of history) {
    if (m.role === 'assistant') for (const c of m.tool_calls ?? []) answered.add(c.id)
    if (m.role === 'tool' && !answered.has(m.tool_call_id)) return false
  }
  return true
}

/** A serialised `memory.list` of `n` records, the shape `queries.ts` produces. */
const listing = (n: number): string =>
  JSON.stringify({
    total: n,
    shown: n,
    matches: Array.from({ length: n }, (_, i) => ({
      id: `app:${String(i)}`,
      org: `Org ${String(i)}`,
      note: bulk(120),
    })),
  })

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
    /*
     * Cutting between a call and its result leaves `tool_call_id: c1` pointing
     * at nothing, which every provider rejects outright.
     *
     * This used to run at a 3,000 window, which is below the reply reserve —
     * the overflow branch, where the history is emptied and nothing is cut at
     * all. And a first rewrite used big RESULTS, which stage 1 stubs, so the
     * first cut that fitted never fell on a tool message and an unguarded cut
     * passed by luck (found by mutation). The bulk is in the CALLS here — a
     * document being filed, its text in the arguments — with results too
     * short to stub, so that the first cut that fits is exactly the one that
     * would strand `c1`.
     */
    const filing = (id: string): ChatMessage => ({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id,
          type: 'function',
          function: { name: 'document.file', arguments: JSON.stringify({ text: bulk(5000) }) },
        },
      ],
    })
    const history = [
      user('file these'),
      filing('c1'),
      result('c1', 'Filed (id: doc:1)'),
      assistant('Filed the first.'),
      filing('c2'),
      result('c2', 'Filed (id: doc:2)'),
      assistant('Filed the second.'),
    ]
    const out = fitHistory(history, [{ system: 'rules' }], RESERVED_FOR_REPLY + 3_000)
    expect(out.overflows).toBe(false)
    expect(out.stubbed).toBe(0)
    expect(out.dropped).toBeGreaterThan(0)
    expect(wellFormed(out.history)).toBe(true)
    // Not a vacuous pass: the cut landed past `c1`, so its result was the one
    // an unguarded cut would have stranded.
    expect(out.dropped).toBeGreaterThanOrEqual(3)
    expect(out.history.some((m) => m.role === 'tool' && m.tool_call_id === 'c2')).toBe(true)
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
  /**
   * A conversation of `n` exchanges: the person asks in a sentence, and the
   * assistant answers at length.
   *
   * The person's turns used to be 1,200-character walls too, and the two
   * headroom tests below stopped passing when user turns became something the
   * trim keeps verbatim — twenty walls of the person's own words are more than
   * a third of a 16k window on their own. That fixture was making a claim
   * about a conversation nobody has: measured on the endurance transcripts,
   * 34 messages come to 5,920 tokens, with the bulk in tool results and
   * assistant prose. The headroom claim holds for THAT shape, which is what
   * this fixture is now; the wall case has its own tests further down, where
   * what is given up is stated.
   */
  const conversation = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) =>
      i % 2 === 0
        ? user(`ask ${String(i)}: what about the next one?`)
        : assistant(`answer ${String(i)} ${bulk(2400)}`),
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
  const specs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `t${String(i)}`, schema: bulk(600) }))

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
    const out = fitHistory(
      [user(bulk(90_000))],
      [{ tools: bulk(30_000) }],
      RESERVED_FOR_REPLY + 12_000,
    )
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

/**
 * Stage 1: old tool results become one-line stubs before anything is cut.
 *
 * The measured failure this exists for: under the six endurance cases the
 * person's turn-one sentence was summarised alongside forty serialised records
 * at ~20:1 and survived in 1 of 18 cells. A tool result is the one message
 * nobody wrote and everybody can re-derive, so it is the first thing to go —
 * and going first, it is usually the ONLY thing that has to.
 */
describe('stubbing tool results before cutting anything', () => {
  /** `n` exchanges, each a question, a `memory.list` call and its 40 records. */
  const listed = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => [
      user(`turn ${String(i)}: which ones are open?`),
      calling(`c${String(i)}`),
      result(`c${String(i)}`, listing(40)),
      assistant(`Turn ${String(i)}: there are 40, the newest is Org 0.`),
    ]).flat()

  it('fits by stubbing alone, so nothing is cut and no summary is needed', () => {
    const history = listed(12)
    const out = fitHistory(history, [{ system: 'rules' }], 26_600)
    expect(out.overflows).toBe(false)
    expect(out.stubbed).toBeGreaterThan(0)
    expect(out.dropped).toBe(0)
    expect(out.toSummarise).toEqual([])
    expect(out.kept).toEqual([])
    expect(out.history).toHaveLength(history.length)
  })

  it('leaves every user turn and every assistant turn byte-identical', () => {
    const history = listed(12)
    const out = fitHistory(history, [{ system: 'rules' }], 26_600)
    for (const [i, m] of history.entries()) {
      if (m.role !== 'tool') expect(out.history[i]).toBe(m)
    }
  })

  it('keeps the call and answers it with a stub that names the tool and the count', () => {
    const history = listed(12)
    const out = fitHistory(history, [{ system: 'rules' }], 26_600)
    const first = out.history[2]
    expect(first?.role).toBe('tool')
    if (first?.role !== 'tool') return
    expect(first.tool_call_id).toBe('c0')
    expect(first.content).toContain('memory.list')
    expect(first.content).toContain('40 records')
    expect(first.content).toContain('re-read if needed')
    expect(wellFormed(out.history)).toBe(true)
  })

  it('stubs the OLDEST results first and stops as soon as the request fits', () => {
    // The newest results are the ones a follow-up is about. Stubbing from the
    // far end, or stubbing everything regardless, would take them too.
    const history = listed(12)
    const out = fitHistory(history, [{ system: 'rules' }], 26_600)
    const results = out.history.filter((m) => m.role === 'tool')
    const intact = results.filter((m) => m.content === listing(40))
    expect(results).toHaveLength(12)
    expect(out.stubbed).toBeGreaterThan(0)
    expect(out.stubbed).toBeLessThan(12)
    expect(intact.length).toBe(12 - out.stubbed)
    // And the intact ones are the LAST ones.
    expect(results.slice(out.stubbed).every((m) => m.content === listing(40))).toBe(true)
    expect(results.slice(0, out.stubbed).every((m) => m.content !== listing(40))).toBe(true)
  })

  it('lands under the compaction target, so the next turns do not compact again', () => {
    const window = 26_600
    const out = fitHistory(listed(12), [{ system: 'rules' }], window)
    expect(tokensOf(out.history)).toBeLessThanOrEqual(Math.round(window * COMPACT_TARGET))
  })

  it('does not stub a result its stub would not shorten', () => {
    // A write comes back as one sentence with the id in it. A stub of the
    // same length saves nothing and loses the id. The write goes FIRST, so
    // stage 1 reaches it before the listing whose stub is what fits the
    // request — an earlier order let the guard go untested (found by mutation).
    const history = [
      user('file it'),
      calling('w1'),
      result('w1', 'Filed (id: doc:7)'),
      assistant('Filed.'),
      user('list them'),
      calling('r1'),
      result('r1', listing(40)),
      assistant('40 of them.'),
    ]
    const out = fitHistory(history, [{ system: 'rules' }], RESERVED_FOR_REPLY + 2_000)
    expect(out.dropped).toBe(0)
    expect(out.stubbed).toBe(1)
    const short = out.history.find((m) => m.role === 'tool' && m.tool_call_id === 'w1')
    expect(short?.content).toBe('Filed (id: doc:7)')
    expect(
      out.history.find((m) => m.role === 'tool' && m.tool_call_id === 'r1')?.content,
    ).toContain('40 records')
  })

  it('leaves a result exactly as long as its stub alone', () => {
    // The boundary of "would not shorten": equal length saves nothing and
    // would still lose the id (the `>` mutant survived until this).
    const same = 'Filed (id: doc:7)'.padEnd(stubFor('memory.list', 'not json').length, '.')
    const history = [
      user('file it'),
      calling('w1'),
      result('w1', same),
      assistant('Filed.'),
      user('list them'),
      calling('r1'),
      result('r1', listing(40)),
      assistant('40 of them.'),
    ]
    const out = fitHistory(history, [{ system: 'rules' }], RESERVED_FOR_REPLY + 2_000)
    expect(out.stubbed).toBe(1)
    expect(out.history.find((m) => m.role === 'tool' && m.tool_call_id === 'w1')?.content).toBe(
      same,
    )
  })

  it('sends the whole history as `dropped: 0` when the person’s turns alone exceed the target', () => {
    /*
     * The first pass finds no cut — the person's turns are over the target on
     * their own — and the whole stubbed history is within the reserve line.
     * Nothing is evicted, and the boundary must say so: `cut` starting at 1
     * sent the same bytes and reported the first message as
     * evicted-and-carried (found by mutation, and the mutant was the truthful
     * one).
     */
    const window = 16_000
    const fixed = [{ tools: bulk(Math.round((8_000 / 1.15) * 3.6)) }]
    const room = window - RESERVED_FOR_REPLY - tokensOf(fixed)
    const target = Math.max(
      Math.round(window * COMPACT_TARGET) - tokensOf(fixed),
      Math.round(room * COMPACT_TARGET),
    )
    const history = Array.from({ length: 4 }, (_, i) => [
      user(`turn ${String(i)}: ${bulk(1100)}`),
      calling(`c${String(i)}`),
      result(`c${String(i)}`, listing(40)),
      assistant(`Turn ${String(i)}: 40 of them.`),
    ]).flat()
    const out = fitHistory(history, fixed, window)
    expect(out.stubbed).toBe(4)
    // The shape: the person's turns are over the target on their own, and the
    // whole history, stubbed, is under the reserve line.
    expect(tokensOf(history.filter((m) => m.role === 'user'))).toBeGreaterThan(target)
    expect(tokensOf(out.history)).toBeLessThanOrEqual(room - Math.round(window * SUMMARY_SHARE))
    expect(out.dropped).toBe(0)
    expect(out.kept).toEqual([])
    expect(out.toSummarise).toEqual([])
    expect(out.history).toHaveLength(history.length)
  })

  it('leaves a conversation that fits with every result intact', () => {
    // Stubbing is a response to pressure, never a default: a result the window
    // can hold is the better version of the stub.
    const history = listed(1)
    const out = fitHistory(history, [{ system: 'rules' }], 100_000)
    expect(out.stubbed).toBe(0)
    expect(out.history).toBe(history)
  })
})

describe('stubFor', () => {
  it('reads the count off the list envelope, truncated or not', () => {
    // `queries.ts` puts `total` and `shown` FIRST so they survive the cut at
    // 6,000 characters. A truncated result will not parse; its head will.
    const cut = `${listing(80).slice(0, 6000)}\n\n[Truncated at 6000 characters.]`
    expect(stubFor('memory.list', cut)).toContain('80 records')
    expect(stubFor('memory.list', listing(3))).toContain('3 records')
    // `total`, not `shown`: a model asked for `limit: 50` of 80 should hear 80,
    // which is the number the envelope exists to deliver.
    const limited = listing(50).replace('"total":50', '"total":80')
    expect(stubFor('memory.list', limited)).toContain('80 records')
  })

  it('counts a bare array and reads one record as one', () => {
    expect(stubFor('memory.search', '[{"id":"a"},{"id":"b"}]')).toContain('2 records')
    expect(stubFor('memory.search', '[{"id":"a"}]')).toContain('1 record ')
  })

  it('names the tool without a count when the result is not a list', () => {
    const text = stubFor('memory.get', '{"id":"app:1","org":"Rice"}')
    expect(text).toContain('memory.get result')
    expect(text).not.toMatch(/\d+ record/)
    expect(stubFor('document.read', 'plain prose, not JSON')).toContain('document.read')
  })
})

/**
 * Stage 2: the cut. The person's turns are carried forward verbatim; only the
 * assistant's are offered for summarising.
 */
describe('cutting, with the person’s turns kept', () => {
  /** The bulk is the assistant's prose: nothing here can be stubbed. */
  const prose = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => [
      user(`turn ${String(i)}: the fact is ${String(i)}`),
      assistant(`answer ${String(i)} ${bulk(3000)}`),
    ]).flat()

  it('keeps every user turn from the cut prefix, verbatim and in order, ahead of the tail', () => {
    const history = prose(16)
    const out = fitHistory(history, [{ system: 'rules' }], 16_000)
    expect(out.dropped).toBeGreaterThan(0)
    expect(out.kept.length).toBeGreaterThan(0)
    // Verbatim: the same objects, not copies or paraphrases.
    const prefixUsers = history.slice(0, out.dropped).filter((m) => m.role === 'user')
    expect(out.kept).toEqual(prefixUsers)
    out.kept.forEach((m, i) => expect(m).toBe(prefixUsers[i]))
    // And they are the head of what is sent, followed by the untouched tail.
    expect(out.history.slice(0, out.kept.length)).toEqual(out.kept)
    expect(out.history.slice(out.kept.length)).toEqual(history.slice(out.dropped))
    expect(out.lost).toBeNull()
  })

  it('offers the summariser the assistant’s messages and nothing else', () => {
    const history = prose(16)
    const out = fitHistory(history, [{ system: 'rules' }], 16_000)
    expect(out.toSummarise.length).toBeGreaterThan(0)
    expect(out.toSummarise.every((m) => m.role === 'assistant')).toBe(true)
    expect(out.toSummarise).toEqual(
      history.slice(0, out.dropped).filter((m) => m.role === 'assistant'),
    )
    // `dropped` is the boundary, and it counts the kept user turns: the two
    // together are the whole prefix.
    expect(out.kept.length + out.toSummarise.length).toBe(out.dropped)
  })

  it('offers no tool result to the summariser, stubbed or not', () => {
    const history = Array.from({ length: 8 }, (_, i) => [
      user(`turn ${String(i)}`),
      calling(`c${String(i)}`),
      result(`c${String(i)}`, listing(40)),
      assistant(`answer ${String(i)} ${bulk(3000)}`),
    ]).flat()
    const out = fitHistory(history, [{ system: 'rules' }], 16_000)
    expect(out.dropped).toBeGreaterThan(0)
    expect(out.toSummarise.some((m) => m.role === 'tool')).toBe(false)
    expect(out.toSummarise.some((m) => m.role === 'user')).toBe(false)
    expect(wellFormed(out.history)).toBe(true)
  })

  it('cuts only after every stub has been tried', () => {
    // The order is the whole design: a cut loses the assistant's words for
    // good, a stub loses nothing. So no result may still be intact when a cut
    // is made — except one too short to be worth stubbing.
    const history = Array.from({ length: 8 }, (_, i) => [
      user(`turn ${String(i)}`),
      calling(`c${String(i)}`),
      result(`c${String(i)}`, listing(40)),
      assistant(`answer ${String(i)} ${bulk(3000)}`),
    ]).flat()
    const out = fitHistory(history, [{ system: 'rules' }], 16_000)
    expect(out.dropped).toBeGreaterThan(0)
    expect(out.stubbed).toBe(8)
    expect(out.history.some((m) => m.role === 'tool' && m.content === listing(40))).toBe(false)
  })

  it('can cut everything the assistant said and still send what the person said', () => {
    // The last exchange alone is bigger than the room. The old trim had no
    // answer but "drop everything"; now the answer is the person's own words.
    const history = [user('my dog is called Bruno'), assistant(bulk(60_000))]
    const out = fitHistory(history, [{ system: 'rules' }], 16_000)
    expect(out.overflows).toBe(false)
    expect(out.lost).toBeNull()
    expect(out.history).toEqual([history[0]])
    expect(out.toSummarise).toEqual([history[1]])
  })

  it('a stubbed-only fit and a cut are told apart by the fields, not by guessing', () => {
    const stubbedOnly = fitHistory(
      Array.from({ length: 12 }, (_, i) => [
        user(`turn ${String(i)}`),
        calling(`c${String(i)}`),
        result(`c${String(i)}`, listing(40)),
        assistant('ok'),
      ]).flat(),
      [{ system: 'rules' }],
      26_600,
    )
    const cut = fitHistory(prose(16), [{ system: 'rules' }], 16_000)
    expect(
      stubbedOnly.dropped === 0 && stubbedOnly.stubbed > 0 && stubbedOnly.toSummarise.length === 0,
    ).toBe(true)
    expect(cut.dropped > 0 && cut.toSummarise.length > 0).toBe(true)
  })
})

/**
 * The wall case: the person's own turns are too big for the target.
 *
 * What is given up is HEADROOM, not words. A conversation whose user turns
 * exceed a third of the window lands wherever those turns fit under the
 * ceiling and compacts again next turn; that costs a summariser call per turn
 * while it lasts, and the alternative — paraphrasing what the person wrote —
 * is the measured failure this whole design replaced. Only when even the
 * words alone do not fit under the ceiling does stage 3 drop the oldest of
 * them, and it says so.
 */
describe('when the person’s turns alone exceed the target', () => {
  const walls = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => [
      user(`wall ${String(i)} ${bulk(1200)}`),
      assistant(`answer ${String(i)}`),
    ]).flat()

  it('keeps them all when they fit under the ceiling, giving up headroom instead', () => {
    const window = 16_000
    const history = walls(20)
    const out = fitHistory(history, [{ system: 'rules' }], window)
    const users = history.filter((m) => m.role === 'user')
    expect(tokensOf(users)).toBeGreaterThan(Math.round(window * COMPACT_TARGET))
    expect(out.lost).toBeNull()
    expect(out.history.filter((m) => m.role === 'user')).toEqual(users)
    expect(tokensOf(out.history)).toBeLessThanOrEqual(window - RESERVED_FOR_REPLY)
  })

  it('drops the oldest of them only when even they alone do not fit, and says how many', () => {
    const window = 16_000
    const history = walls(40)
    const out = fitHistory(history, [{ system: 'rules' }], window)
    expect(out.overflows).toBe(false)
    expect(out.lost).not.toBeNull()
    expect(out.lost?.reason).toContain('did not fit even with every reply and result removed')
    const users = history.filter((m) => m.role === 'user')
    // The survivors are the NEWEST, verbatim, and they are all that is sent.
    expect(out.history).toEqual(users.slice(out.lost?.count))
    expect(out.kept).toEqual(out.history)
    expect(out.lost?.count).toBeGreaterThan(0)
    expect(out.lost?.count).toBeLessThan(users.length)
    // As few as will fit: one more would not.
    expect(tokensOf(users.slice((out.lost?.count ?? 0) - 1))).toBeGreaterThan(
      window - RESERVED_FOR_REPLY,
    )
    expect(tokensOf(out.history)).toBeLessThanOrEqual(window - RESERVED_FOR_REPLY)
  })
})

/**
 * The summary budget is a share of the window, bounded by what is left.
 *
 * It replaced a fixed 1,200 characters, which was the other half of the
 * measured failure: the same paragraph at 8k and at 128k.
 */
describe('the summary budget', () => {
  it('is a tenth of the window when the request leaves that much room', () => {
    const window = 32_000
    const out = fitHistory([user('hi')], [{ system: 'rules' }], window)
    // In characters, through the estimator and the margin: a tenth of the
    // window in tokens, given back as the characters that measure to it.
    const expected = Math.floor(((window * SUMMARY_SHARE) / 1.15) * 3.6)
    expect(Math.abs(out.summaryChars - expected)).toBeLessThan(40)
    expect(tokensOf([bulk(out.summaryChars)])).toBeLessThanOrEqual(
      Math.round(window * SUMMARY_SHARE),
    )
  })

  it('never exceeds what the fitted request leaves under the ceiling', () => {
    // The endurance shape: 21.7k of tools at 26.6k leaves ~800 tokens of room,
    // and a tenth of the window would be 2.6k — a summary that size would
    // re-overflow the request the trim just fixed.
    const fixed = [{ tools: bulk(Math.round((21_000 / 1.15) * 3.6)) }]
    const window = 26_600
    const out = fitHistory([user('hi')], fixed, window)
    expect(out.overflows).toBe(false)
    const room = window - RESERVED_FOR_REPLY - tokensOf(fixed)
    expect(tokensOf([bulk(out.summaryChars)])).toBeLessThanOrEqual(room - tokensOf(out.history))
    expect(out.summaryChars).toBeLessThan(Math.floor(((window * SUMMARY_SHARE) / 1.15) * 3.6))
  })

  it('is zero on overflow, where nothing is summarised', () => {
    expect(fitHistory([user('hi')], [{ tools: bulk(40_000) }], 4_000).summaryChars).toBe(0)
  })

  it('fits beside the compaction target and the reply reserve at the smallest window anybody runs', () => {
    // A third, a tenth and the reserve must add up to less than the window,
    // or a compaction would set up the next overflow itself.
    const smallest = 8_192
    expect(
      Math.round(smallest * COMPACT_TARGET) +
        Math.round(smallest * SUMMARY_SHARE) +
        RESERVED_FOR_REPLY,
    ).toBeLessThan(smallest)
  })
})

/**
 * The share is RESERVED by the cut, not hoped for.
 *
 * `summaryChars` is what the fitted tail leaves under the ceiling. When the
 * person's turns alone exceed the target, the cut is decided by `room`, and a
 * pass that took the FIRST cut under it left anything from nothing to one
 * exchange. Measured on long-vault-convention against Qwen3 14B at 26,100:
 * summaryChars 90 and 172 — a summariser call spent on a note cut
 * mid-heading. The middle pass aims for `room - share` first, so the share is
 * taken from exchanges that were going anyway.
 */
describe('reserving the summary share', () => {
  const window = 16_000
  const fixed = [{ system: 'rules' }]
  const room = window - RESERVED_FOR_REPLY - tokensOf(fixed)
  const share = Math.round(window * SUMMARY_SHARE)
  /**
   * Fourteen exchanges whose user turns alone exceed the target, sized so the
   * first cut under `room` lands ONE token short of it (found by sweeping the
   * sizes against the previous trim: summaryChars 0).
   */
  const history = Array.from({ length: 14 }, (_, i) => [
    user(`turn ${String(i)}: ${bulk(1500)}`),
    assistant(`answer ${String(i)} ${bulk(3100)}`),
  ]).flat()
  const users = history.filter((m) => m.role === 'user')

  it('is the shape where the target pass cannot land, so the cut is decided by room', () => {
    expect(tokensOf(users)).toBeGreaterThan(Math.round(window * COMPACT_TARGET))
    // And the share IS affordable: the person's turns plus one exchange fit
    // under `room - share`, so a cut exists that leaves it.
    expect(tokensOf([...users, ...history.slice(-2)])).toBeLessThanOrEqual(room - share)
  })

  it('leaves the whole share, taken from what was evicted and nothing else', () => {
    const out = fitHistory(history, fixed, window)
    expect(out.overflows).toBe(false)
    expect(out.lost).toBeNull()
    // The whole share, in characters through the estimator and the margin.
    const expected = Math.floor((share / 1.15) * 3.6)
    expect(Math.abs(out.summaryChars - expected)).toBeLessThan(40)
    expect(tokensOf([bulk(out.summaryChars)])).toBeLessThanOrEqual(share)
    // Every user turn still goes, verbatim: the reserve is never the person's words.
    expect(out.history.filter((m) => m.role === 'user')).toEqual(users)
    // And the tail is not emptied to make room: something of the assistant's went too.
    expect(out.history.some((m) => m.role === 'assistant')).toBe(true)
  })

  const line = window - RESERVED_FOR_REPLY - measure(fixed) - share

  /**
   * A history whose tightest affording cut lands EXACTLY on `room - share`
   * (`offset` 0) or one token past it (`offset` 1). The last answer, which is
   * in every candidate, is padded until the candidate just under the mark
   * measures to it — a token is ~3.1 characters, so the deficit says roughly
   * how much and a short scan finds the exact hit. The line is what
   * "reserved" means: a cut landing on it is taken, one past it is not, and
   * both `± 1` mutants of the pass survived until this pinned it.
   */
  const landing = (offset: number): { readonly history: ChatMessage[]; readonly cut: number } => {
    const want = line + offset
    const build = (pad: number): ChatMessage[] =>
      Array.from({ length: 14 }, (_, i) => [
        user(`turn ${String(i)}: ${bulk(1500)}`),
        assistant(`answer ${String(i)} ${bulk(i === 13 ? 3100 + pad : 3100)}`),
      ]).flat()
    const sizeAt = (h: readonly ChatMessage[], cut: number) =>
      measure([...h.slice(0, cut).filter((m) => m.role === 'user'), ...h.slice(cut)])
    const bare = build(0)
    let cut = 2
    while (cut < bare.length && sizeAt(bare, cut) > want) cut += 2
    const deficit = want - sizeAt(bare, cut)
    const from = Math.max(0, Math.floor((deficit / 1.15) * 3.6) - 12)
    for (let pad = from; pad < from + 48; pad += 1) {
      const h = build(pad)
      if (sizeAt(h, cut) === want) return { history: h, cut }
    }
    throw new Error('no padding lands on the boundary')
  }

  it('takes a cut that lands exactly on the reserve line', () => {
    const { history: exact, cut } = landing(0)
    const out = fitHistory(exact, fixed, window)
    expect(measure(out.history)).toBe(line)
    expect(out.dropped).toBe(cut)
  })

  it('refuses a cut one token past the reserve line and takes the next', () => {
    const { history: over, cut } = landing(1)
    const out = fitHistory(over, fixed, window)
    expect(measure(out.history)).toBeLessThanOrEqual(line)
    expect(out.dropped).toBe(cut + 2)
  })

  it('evicts the FEWEST exchanges that afford the share, not one more', () => {
    // Putting back the exchange nearest the boundary would eat into the share.
    // This is what tells "reserve the share" apart from "cut harder".
    const out = fitHistory(history, fixed, window)
    const back = out.dropped - 1
    expect(history[back]?.role).toBe('assistant')
    const candidate = [
      ...history.slice(0, back).filter((m) => m.role === 'user'),
      ...history.slice(back),
    ]
    expect(room - tokensOf(candidate)).toBeLessThan(share)
    expect(tokensOf(out.history)).toBeLessThanOrEqual(room - share)
  })
})

/**
 * The shape this commit was written for, at the window the case declares.
 *
 * The fixed part is ~21,695 tokens by this estimator (92 specs and the system
 * prompt) against a 26,100 window: the room for history is 309 tokens and a
 * TENTH OF THE WINDOW is 2,610 — eight times it. `room - share` was then
 * negative, the reserving pass could not fire, the last pass settled for `room`
 * and filled it, and the summary was left the crumb the fit happened not to
 * use. Measured on 2026-09-06 by driving the real loop through the case and
 * replaying `fitHistory` at each turn (`dropped`, `summaryChars`):
 *
 *     turn 5   room 329   dropped  9   112
 *     turn 6   room 331   dropped 13    53
 *     turn 7   room 328   dropped 17    18
 *     turn 8   room 309   dropped 25   275
 *
 * All four are under `MIN_SUMMARY_CHARS`, so `compact` refused every one of
 * them — and the loop, which carries a second copy of that floor, skipped the
 * call entirely, so the id ledger it builds without a model was not placed
 * either. Bounding the share by a third of the ROOM as well as a tenth of the
 * window (`SUMMARY_ROOM_SHARE`) makes the reserving pass reachable again: 103
 * tokens here, 322 characters, over the floor on all four turns.
 *
 * What it costs is one message. In the fixture below — the case's own turns at
 * its own window, room 310 — the person's seven turns are 200 of those tokens
 * and the closing answer is 75 more, so the unreserved cut sent 275 and left 35
 * (109 characters); reserving the 103 evicts that one answer, sends the 200 and
 * leaves the whole share. Which is the trade this file has to keep
 * checking in both directions: a verbatim exchange is worth more than the same
 * tokens of a summary of it, so the reserve may never take a SECOND one.
 */
describe('the long-vault-convention shape at 26,100', () => {
  const window = 26_100
  const base = 21_693
  const fixed = [{ tools: bulk(Math.round((base / 1.15) * 3.6) - 14) }]
  const room = window - RESERVED_FOR_REPLY - measure(fixed)
  const share = Math.round(window * SUMMARY_SHARE)
  const says = [
    'House rule for this chat: every URL you store in the vault for me carries the note ‘found by assistant’, so I can tell yours from mine later.',
    'What documents do I have in the vault?',
    'Open my teaching statement — what course do I say I want to build?',
    'And the research statement — what is the second of the three threads?',
    'Which referees are on my current CV?',
    'What snippets do I have saved?',
    'And which link is in the vault right now?',
  ]
  const answers = [
    'Understood — every URL I store carries the note "found by assistant".',
    'Four documents: CV-2026, Research-statement, Teaching-statement and Old-CV-2024.',
    'A project-based operating systems course.',
    'Cache coherence under partition.',
    'Prof. Marta Oyelaran and Dr Idris Whitfield.',
    'One snippet: Follow-up after interview.',
    // Qwen answers at length; two hundred characters is the measured shape.
    `One link: Rice CS faculty openings. ${bulk(165)}`,
  ]
  /** The listing, three reads (the CV truncated at 6,000), two more listings. */
  const results = [
    listing(4),
    bulk(3200),
    bulk(3600),
    `${bulk(6000)}\n\n[Truncated at 6000 characters.]`,
    listing(1),
    listing(1),
  ]
  const history: ChatMessage[] = [user(says[0] ?? ''), assistant(answers[0] ?? '')]
  for (let t = 1; t < 7; t += 1) {
    history.push(
      user(says[t] ?? ''),
      calling(`c${String(t)}`),
      result(`c${String(t)}`, results[t - 1] ?? ''),
      assistant(answers[t] ?? ''),
    )
  }
  const users = history.filter((m) => m.role === 'user')

  it('is the shape where no cut can afford a tenth of the window, or reach the target', () => {
    expect(Math.abs(measure(fixed) - base)).toBeLessThan(4)
    expect(room).toBeLessThan(share)
    // Eight times the room, which is what makes the old middle pass unreachable.
    expect(share / room).toBeGreaterThan(8)
    // And the target pass cannot land either — the person's turns exceed it on
    // their own — so what decides the cut is the reserve line and then `room`.
    expect(measure(users)).toBeGreaterThan(Math.round(room * COMPACT_TARGET))
  })

  /**
   * The reproduction, from the two lines that changed and nothing else.
   *
   * With the share at a tenth of the window the middle pass is negative here,
   * so the trim was `[target (unreachable), _, room]` — the tightest cut under
   * `room`, and whatever it left over. `unreserved` is exactly that pass, run
   * over the same stubbed history the real trim builds (cross-checked below
   * against `out.stubbed`), so the before-number is measured rather than
   * remembered.
   */
  const stubbedHistory = history.map((m) =>
    m.role === 'tool' && stubFor('memory.list', m.content).length < m.content.length
      ? result(m.tool_call_id, stubFor('memory.list', m.content))
      : m,
  )
  const unreserved = (): { readonly dropped: number; readonly summaryChars: number } => {
    for (let cut = 0; cut <= stubbedHistory.length; cut += 1) {
      if (cut < stubbedHistory.length && stubbedHistory[cut]?.role === 'tool') continue
      const candidate = [
        ...stubbedHistory.slice(0, cut).filter((m) => m.role === 'user'),
        ...stubbedHistory.slice(cut),
      ]
      if (measure(candidate) <= room) {
        const left = Math.min(share, room - measure(candidate))
        return {
          dropped: cut,
          summaryChars: Math.max(0, Math.floor((left / 1.15) * charsPerToken)),
        }
      }
    }
    throw new Error('the unreserved pass fitted nothing')
  }

  it('had a budget under compact’s floor, and has one over it', () => {
    const before = unreserved()
    // The old numbers, exactly: a cut that filled the room (275 of 310) and
    // left the summary the 35 tokens nobody else wanted.
    expect(before.dropped).toBe(25)
    expect(before.summaryChars).toBe(109)
    expect(before.summaryChars).toBeLessThan(MIN_SUMMARY_CHARS)

    const out = fitHistory(history, fixed, window)
    // A third of the room — 103 tokens — reserved and handed back in characters.
    expect(out.summaryChars).toBe(322)
    expect(out.summaryChars).toBeGreaterThanOrEqual(MIN_SUMMARY_CHARS)
    expect(out.summaryChars).toBe(
      Math.floor((Math.round(room * SUMMARY_ROOM_SHARE) / 1.15) * charsPerToken),
    )
    // And it is still the honest remainder: it never exceeds what the tail left.
    expect(measure([bulk(out.summaryChars)])).toBeLessThanOrEqual(room - measure(out.history))
  })

  it('pays for it with ONE message of history, and never with the person’s words', () => {
    const out = fitHistory(history, fixed, window)
    expect(out.dropped).toBe(unreserved().dropped + 1)
    // The message it costs is the assistant's closing answer, and the whole
    // history is 26 messages: what is sent is the seven turns the person wrote.
    expect(out.dropped).toBe(history.length)
    expect(out.history).toEqual(users)
    expect(out.lost).toBeNull()
    expect(out.overflows).toBe(false)
    expect(wellFormed(out.history)).toBe(true)
    // The last exchange's result was stubbed like every other: nothing is
    // protected, and the numbers in the header are why.
    expect(out.stubbed).toBe(6)
    // The stubbed history the reproduction above works from replaced the same
    // messages the trim did — otherwise the before-number measures another run.
    expect(stubbedHistory.filter((m, i) => m !== history[i])).toHaveLength(out.stubbed)
  })
})

/**
 * The same window, with the person talking more: the case where the share still
 * cannot be reserved, and `summaryChars` is the honest remainder again.
 *
 * The reserve line is `room - room/3`, two thirds of the room. Below it the
 * fitted tail can be nothing but the person's own turns — those are in every
 * candidate — so a conversation whose user turns alone exceed two thirds of the
 * room has no cut that affords the share, whatever the share is. The last pass
 * then takes what FITS and the summary gets what is left over, which is the
 * only honest answer: widening it would mean evicting a sentence the person
 * wrote to make room for a paraphrase of it, and the trim never does that.
 *
 * This is also the pass that keeps `lost` empty here. Without it the fit falls
 * through to stage 3 and starts dropping the person's earliest turns for a
 * budget it cannot spend.
 */
describe('when the person’s own turns take more than two thirds of the room', () => {
  const window = 26_100
  const fixed = [{ tools: bulk(Math.round((21_693 / 1.15) * 3.6) - 14) }]
  const room = window - RESERVED_FOR_REPLY - measure(fixed)
  const share = Math.min(Math.round(window * SUMMARY_SHARE), Math.round(room * SUMMARY_ROOM_SHARE))
  /** Seven questions of the length people actually type, and long answers. */
  const history = Array.from({ length: 7 }, (_, i) => [
    user(
      `turn ${String(i)}: which of the applications I opened this month is still waiting on me?`,
    ),
    assistant(`Turn ${String(i)}: ${bulk(400)}`),
  ]).flat()
  const users = history.filter((m) => m.role === 'user')

  it('is the shape where no cut can reserve the share', () => {
    expect(measure(users)).toBeGreaterThan(room - share)
    expect(measure(users)).toBeLessThanOrEqual(room)
  })

  it('sends every user turn and reports what they left, not the share', () => {
    const out = fitHistory(history, fixed, window)
    expect(out.overflows).toBe(false)
    expect(out.lost).toBeNull()
    expect(out.history).toEqual(users)
    // The remainder, exactly — and it is below the share, which is the whole
    // difference between "reserved" and "whatever was left".
    expect(out.summaryChars).toBe(Math.floor(((room - measure(users)) / 1.15) * charsPerToken))
    expect(out.summaryChars).toBeLessThan(Math.floor((share / 1.15) * charsPerToken))
    expect(out.summaryChars).toBeLessThan(MIN_SUMMARY_CHARS)
  })
})

/**
 * The other five endurance shapes, whose rooms are 420-1,232 tokens.
 *
 * A third of those is 140-410 tokens against a window-tenth of 2,620-2,700, so
 * every one of them now RESERVES LESS than it did. That is not a loss, and the
 * reason is structural rather than lucky: the reserve line is `room - room/3`,
 * two thirds of the room, and the target the first pass aims at is `room/3`
 * when the window figure collapses — so wherever the target pass can land, it
 * lands first and the reserve is never consulted. Measured against the real
 * loop on 2026-09-06, all five keep the same `dropped` and the same messages
 * they had before; what changes is the CAP on the summary, from ~2,600
 * characters to ~1,257, and a shorter cap costs nothing while the summary is
 * the paraphrase and the history it stops displacing is verbatim.
 */
describe('the wider endurance rooms', () => {
  const window = 27_000
  const base = 21_700
  const fixed = [{ tools: bulk(Math.round((base / 1.15) * 3.6) - 14) }]
  const room = window - RESERVED_FOR_REPLY - measure(fixed)
  const target = Math.max(
    Math.round(window * COMPACT_TARGET) - measure(fixed),
    Math.round(room * COMPACT_TARGET),
  )
  /** Seven exchanges around big results — the endurance shape, at a wider room. */
  const history = [
    user('House rule: my referees are Prof. Marta Oyelaran and Dr Idris Whitfield.'),
    assistant('Noted.'),
    ...Array.from({ length: 6 }, (_, i) => [
      user(`turn ${String(i + 2)}: what is open now?`),
      calling(`c${String(i)}`),
      result(`c${String(i)}`, listing(20)),
      assistant(`Turn ${String(i + 2)}: twenty of them, newest first.`),
    ]).flat(),
  ]

  it('is decided by the target pass, which this change did not touch', () => {
    const out = fitHistory(history, fixed, window)
    // The fit lands under the target, so the reserve line — which is looser —
    // was never reached: the same cut the old arithmetic made.
    expect(measure(out.history)).toBeLessThanOrEqual(target)
    expect(out.dropped).toBeGreaterThan(0)
    expect(out.lost).toBeNull()
    expect(out.history.filter((m) => m.role === 'user')).toEqual(
      history.filter((m) => m.role === 'user'),
    )
  })

  it('reserves a third of the room instead of a tenth of the window, and clears the floor', () => {
    const out = fitHistory(history, fixed, window)
    const third = Math.round(room * SUMMARY_ROOM_SHARE)
    expect(third).toBeLessThan(Math.round(window * SUMMARY_SHARE))
    expect(out.summaryChars).toBe(Math.floor((third / 1.15) * charsPerToken))
    // A seventh of what the window's tenth would have asked for — 1,257
    // characters against 8,445, a cap the 1,205 tokens of room could never have
    // left anyway — and still nearly four times `compact`'s floor.
    expect(out.summaryChars).toBe(1_257)
    expect(out.summaryChars).toBeLessThan(
      Math.floor(((window * SUMMARY_SHARE) / 1.15) * charsPerToken) / 5,
    )
    expect(out.summaryChars).toBeGreaterThan(3 * MIN_SUMMARY_CHARS)
  })

  it('leaves the reserve line looser than the target at every room, so it can only act where the target cannot', () => {
    /*
     * `room - room/3` against `room/3`: two thirds against one. This is the
     * invariant behind "the five wider cases keep their history" — a reserve
     * that were TIGHTER than the target would re-cut every fit the target pass
     * already made, which is how a summary reserve turns into a second trim.
     */
    for (const r of [420, 620, 811, 1009, 1204, 1232, 8_000, 40_000]) {
      const reserveLine = r - Math.round(r * SUMMARY_ROOM_SHARE)
      expect(reserveLine).toBeGreaterThanOrEqual(Math.round(r * COMPACT_TARGET))
    }
  })
})

/**
 * The proof the design is for: a history of the shape that failed 17 times in
 * 18, fitted, with the turn-one fact intact and no summariser involved.
 */
describe('the turn-one fact, twenty thousand tokens later', () => {
  it('is sent verbatim, and no summary was needed to keep it', () => {
    const fact = user('My dog is called Bruno, and the Rice application is the one at Houston.')
    const exchanges = Array.from({ length: 10 }, (_, i) => [
      user(`turn ${String(i + 1)}: what is open now?`),
      calling(`c${String(i)}`),
      result(`c${String(i)}`, listing(40)),
      assistant(`Turn ${String(i + 1)}: 40 open, newest first.`),
    ]).flat()
    const history = [fact, ...exchanges]
    // ~20k tokens by the loop's own measure, the size of the endurance cases.
    const size = tokensOf(history)
    expect(size).toBeGreaterThan(20_000)
    expect(size).toBeLessThan(24_000)

    // The endurance window: 26,600, with a small fixed part so the trim is
    // deciding about history and not about tool schemas.
    const out = fitHistory(
      history,
      [{ system: 'rules' }, { question: 'What is my dog called?' }],
      26_600,
    )
    expect(out.overflows).toBe(false)
    // Verbatim: the same object, in the same place.
    expect(out.history[0]).toBe(fact)
    expect(out.history[0]?.content).toBe(fact.content)
    // No summary was needed: nothing was cut, nothing is offered to the
    // summariser, nothing is lost — the records were stubbed and can be re-read.
    expect(out.dropped).toBe(0)
    expect(out.toSummarise).toEqual([])
    expect(out.lost).toBeNull()
    expect(out.stubbed).toBeGreaterThan(0)
    expect(wellFormed(out.history)).toBe(true)
    expect(tokensOf(out.history)).toBeLessThanOrEqual(Math.round(26_600 * COMPACT_TARGET))
  })
})
