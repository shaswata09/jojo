/**
 * The summary that replaces the part of a chat that no longer fits.
 *
 * Its dangerous direction is invention. A trim that loses turn three leaves the
 * assistant ignorant, which is recoverable — it asks again. A summary that says
 * "the person agreed to close the Baylor application" when they did not leaves
 * it CONFIDENT, and it acts. So the shape of the output is pinned here: whose
 * voice it is in, that it is labelled, and that it cannot grow without bound.
 *
 * And the shape of the INPUT, which is where the measured failures were. Round
 * one: the summariser lost the person's turn-one fact in 17 of 18 endurance
 * cells, because that sentence went in beside 6,000-character tool results at
 * a 150-word cap. Round two, after the results were withheld: the refusal
 * guard measured a reply against the summariser's now-tiny input and threw
 * away 12/34 GPT-OSS summaries; the summaries that survived said "app:
 * unknown" because nothing they were shown held an id; and a budget of 90 or
 * 172 characters spent a call on a note cut mid-heading. What the summariser
 * is shown, what is measured when it answers, what the harness writes without
 * it, and when it is not called at all are each a test below.
 */
import { describe, expect, it } from 'vitest'
import {
  LEDGER_HEADING,
  MIN_SUMMARY_CHARS,
  SUMMARY_SLOTS,
  asMessage,
  compact,
  compactionMessages,
  ledgerIn,
  ledgerLine,
  recordsIn,
  replacedBy,
  summarisable,
} from './compact'
import type { Summarisable } from './compact'
import type { ChatMessage, Turn } from '../core/model-server'

const user = (text: string): ChatMessage => ({ role: 'user', content: text })
const said = (text: string): Summarisable => ({ role: 'assistant', content: text })
const calling = (...calls: readonly (readonly [name: string, args?: string])[]): Summarisable => ({
  role: 'assistant',
  content: null,
  tool_calls: calls.map(([name, args], i) => ({
    id: `c${String(i)}`,
    type: 'function',
    function: { name, arguments: args ?? '{}' },
  })),
})
const result = (text: string): ChatMessage => ({ role: 'tool', tool_call_id: 'c0', content: text })

const answering = (text: string) => async (): Promise<Turn> => ({
  ok: true,
  text,
  toolCalls: [],
  finishReason: 'stop',
})

/** A summariser that records what it was asked, and answers with `text`. */
const scripted = (text: string) => {
  const seen: ChatMessage[][] = []
  const ask = async (messages: readonly ChatMessage[]): Promise<Turn> => {
    seen.push([...messages])
    return { ok: true, text, toolCalls: [], finishReason: 'stop' }
  }
  return { seen, ask }
}

/** The input the summariser is shown for `dropped`, as one string. */
const inputFor = (dropped: readonly ChatMessage[]): string =>
  compactionMessages(summarisable(dropped))[1]?.content ?? ''

/** A well-formed reply: every slot, in order. Long enough to be worth keeping. */
const filled = [
  `${SUMMARY_SLOTS[0]}: they meant the Rice application, the one at Houston.`,
  `${SUMMARY_SLOTS[1]}: Rice University application — app:0192a.`,
  `${SUMMARY_SLOTS[2]}: do not touch the Baylor one.`,
  `${SUMMARY_SLOTS[3]}: none.`,
].join('\n')

/** The ledger line exactly as the contract spells it. */
const ledger = (...entries: readonly string[]): string =>
  `${LEDGER_HEADING} (ids exact): ${entries.join('; ')}`

/**
 * The line as round two wrote it, which stored contexts still carry. Its
 * heading alone is 59 characters — the reason it was shortened (see the
 * budget-328 test below).
 */
const ledgerRoundTwo = (...entries: readonly string[]): string =>
  `${LEDGER_HEADING} (in tool results no longer shown; ids exact): ${entries.join('; ')}`

/**
 * A write's result as `execute.ts` `renderOutcome` gives it back: the toast's
 * `title — description`, then ` (id: …)` when the tool returned a string id.
 */
const wrote = (said: string, id: string): ChatMessage => result(`${said} (id: ${id})`)

/** A record as `queries.ts` `render` emits one: id, type, label, then props. */
const record = (id: string, label: string, props: Record<string, unknown> = {}) => ({
  id,
  type: 'application',
  label,
  ...props,
})

/** A `memory.list` page as `Matches<T>`: counts first, then the records. */
const page = (...records: readonly Record<string, unknown>[]): string =>
  JSON.stringify({ total: records.length, shown: records.length, matches: records })

/**
 * The measured shape: a short exchange whose one list result is ~6,000
 * characters. The prose the summariser sees is a few hundred; the result it
 * stands in for is twenty times that.
 */
const bulky = (): ChatMessage[] => [
  user('I meant the Rice one, at Houston — move it to interview and leave Baylor alone'),
  calling(['memory.list', '{"type":"application"}']),
  result(
    page(
      record('app:0192a', 'Rice University', { role: 'Research Fellow', notes: 'n'.repeat(2_900) }),
      record('app:0192b', 'Baylor', { role: 'Lecturer', notes: 'n'.repeat(2_900) }),
    ),
  ),
  calling(['application.stage.set', '{"id":"app:0192a","stage":"Interview"}']),
  result('Rice University — Interview'),
  said(
    'Moved the Rice University application (app:0192a) to Interview and left Baylor alone, as you asked.',
  ),
]

/** The same exchange with a result nothing can walk: no ledger comes of it. */
const plain = (): ChatMessage[] => [
  user('I meant the Rice one, at Houston — move it to interview and leave Baylor alone'),
  calling(['application.stage.set', '{"id":"app:0192a","stage":"Interview"}']),
  result('Rice University — Interview'),
  said(
    'Moved the Rice University application (app:0192a) to Interview and left Baylor alone, as you asked.',
  ),
]

describe('summarisable — the marking', () => {
  it('keeps only the assistant’s own turns', () => {
    // The person's words are kept verbatim by the budget layer and must never
    // be paraphrased; tool results are the bulk that drowned everything else.
    const kept = summarisable(bulky())
    expect(kept.every((m) => m.role === 'assistant')).toBe(true)
    expect(kept).toHaveLength(3)
  })
})

describe('compactionMessages — what the summariser is shown', () => {
  it('never shows the summariser the person’s words', () => {
    // THE measured failure. The turn-one sentence went into the summariser
    // beside forty serialised records and came out compressed ~20:1. It is
    // kept verbatim in the conversation instead, so here it must be absent.
    const input = inputFor(bulky())
    expect(input).not.toContain('at Houston')
    expect(input).not.toContain('leave Baylor alone')
  })

  it('shows each call as name(arguments) and withholds what it returned', () => {
    // The arguments carry exactly the ids and values the assistant acted on,
    // in fifty characters; the result is ~6,000 and re-readable. Round one
    // showed names only and the summaries said "app: unknown".
    const input = inputFor(bulky())
    expect(input).toContain('memory.list({"type":"application"})')
    expect(input).toContain('application.stage.set({"id":"app:0192a","stage":"Interview"})')
    expect(input).toContain('results not shown')
    expect(input).not.toContain('"label":"Baylor"')
    expect(input).not.toContain('nnnn')
    expect(input).not.toContain('Rice University — Interview')
  })

  it('cuts the arguments of one call at 160 characters', () => {
    // A `note` or a pasted posting can be thousands of characters; the id is
    // at the front of every call this app makes, so a fragment keeps it.
    const args = `{"id":"app:0192a","note":"${'x'.repeat(200)}"}`
    const input = inputFor([calling(['application.note', args])])
    expect(input).toContain(`application.note(${args.slice(0, 160)}…)`)
    expect(input).not.toContain(args.slice(0, 161))
    // Exactly at the limit is shown whole, with no mark of a cut.
    const exact = `{"note":"${'y'.repeat(149)}"}`
    expect(exact).toHaveLength(160)
    expect(inputFor([calling(['application.note', exact])])).toContain(`application.note(${exact})`)
    expect(inputFor([calling(['application.note', exact])])).not.toContain('…')
  })

  it('lists several calls on one turn in order', () => {
    const input = inputFor([
      calling(['memory.list', '{"type":"application"}'], ['memory.get', '{"id":"app:1"}']),
    ])
    expect(input).toContain('memory.list({"type":"application"}), memory.get({"id":"app:1"})')
  })

  it('shows what the assistant said, which is where the ids it established live', () => {
    expect(inputFor(bulky())).toContain('app:0192a')
  })

  it('cannot be handed a person’s turn', () => {
    // The type is the contract. A caller has to go through `summarisable` (or
    // build assistant messages by hand) to reach this function at all.
    // @ts-expect-error — a user message is not Summarisable
    compactionMessages([user('hi')])
  })

  it('asks for the four slots, by name and in order', () => {
    // A free-form summary spends its words on whatever the model found
    // interesting. The slots are what the assistant needs next turn.
    const [system] = compactionMessages([said('x')])
    const text = system?.content ?? ''
    let last = -1
    for (const slot of SUMMARY_SLOTS) {
      const at = text.indexOf(`${slot}:`)
      expect(at, slot).toBeGreaterThan(last)
      last = at
    }
    expect(text).toContain('write "none" under a heading with nothing to record')
  })

  it('tells the summariser the person’s messages are not in front of it', () => {
    // Otherwise a model asked for "facts the person stated" with no person in
    // the transcript reconstructs them.
    const [system] = compactionMessages([said('x')])
    expect(system?.content).toContain('The person’s messages are not shown')
  })

  it('tells done from open in each slot’s words, so finished work is never restated as a request', () => {
    // GPT-OSS, after a fresh summary whose FACTS slot said "waiting on the
    // team match": on the next read turn it re-applied the completed write,
    // because nothing in the note said the match was DONE. The wording is
    // pinned: RECORDS ESTABLISHED is finished work, FACTS is what they said
    // and never what they asked, and OPEN REQUESTS says in words that a
    // request with a record under RECORDS ESTABLISHED is finished.
    const [system] = compactionMessages([said('x')])
    const text = system?.content ?? ''
    expect(text).toContain(
      `${SUMMARY_SLOTS[0]}: what the assistant’s replies show the person TOLD it — which record they meant, names, dates, preferences. What they told it, never what they asked it to do.`,
    )
    expect(text).toContain(
      `${SUMMARY_SLOTS[1]}: things DONE — each record the assistant created, found or changed, as name and id; the ids are in the arguments and replies, copy them exactly. A record here is finished work: do not restate it as a request.`,
    )
    expect(text).toContain(
      `${SUMMARY_SLOTS[2]}: anything the person corrected, declined, or asked the assistant not to touch.`,
    )
    expect(text).toContain(
      `${SUMMARY_SLOTS[3]}: only what the person asked for that was NOT finished. A request whose record appears under ${SUMMARY_SLOTS[1]} is finished and does not belong here.`,
    )
  })

  it('tells the summariser not to invent agreement, and to copy ids exactly', () => {
    const [system] = compactionMessages([said('x')])
    expect(system?.content).toContain('never write that they agreed')
    expect(system?.content).toContain('State only what is in the messages')
    expect(system?.content).toContain('copy them exactly')
  })

  it('puts the notes’ share of the budget in the prompt, so the model writes to it rather than being cut at it', () => {
    // The ledger takes up to a third of the budget ahead of the notes. A model
    // told the whole figure writes over the ledger's third and is cut there.
    const [system] = compactionMessages([said('x')], { budget: 2_700 })
    expect(system?.content).toContain('At most 1800 characters')
    expect(system?.content).not.toContain('2700')
    // And without one, the only limit stated is the one always enforced.
    const [bare] = compactionMessages([said('x')])
    expect(bare?.content).not.toContain('At most')
    expect(bare?.content).toContain('shorter than what it stands in for')
  })

  it('carries the earlier summary in, labelled as what it is', () => {
    // A second compaction supersedes the first. Passed as text with a label
    // rather than as a `user` message, so nothing reads it as something said.
    const [, input] = compactionMessages([said('x')], { earlier: 'They filed the CV as doc:7.' })
    expect(input?.content).toContain('earlier summary, superseded by yours')
    expect(input?.content).toContain('They filed the CV as doc:7.')
    const [, without] = compactionMessages([said('x')])
    expect(without?.content).not.toContain('earlier summary')
  })

  it('withholds the earlier summary’s ledger line from the model', () => {
    // The harness merges those ids into the new ledger itself. A model shown
    // them copies them under RECORDS ESTABLISHED, and the appended ledger
    // then says them twice.
    const earlier = `They filed the CV as doc:7.\n${ledger('Rice University (app:0192a)')}`
    const [, input] = compactionMessages([said('x')], { earlier })
    expect(input?.content).toContain('They filed the CV as doc:7.')
    expect(input?.content).not.toContain(LEDGER_HEADING)
    expect(input?.content).not.toContain('app:0192a')
    // An earlier summary that is a ledger alone carries no notes to show.
    const [, bare] = compactionMessages([said('x')], {
      earlier: ledger('Rice University (app:0192a)'),
    })
    expect(bare?.content).not.toContain('earlier summary')
  })

  it('tells the summariser the transcript stays readable, only when it does', () => {
    const [withThread] = compactionMessages([said('x')], { thread: { id: 'thread:01' } })
    expect(withThread?.content).toContain('readable as record thread:01')
    const [without] = compactionMessages([said('x')])
    expect(without?.content).not.toContain('readable as record')
  })
})

describe('MIN_SUMMARY_CHARS — the floor', () => {
  it('is three empty skeletons, and above both measured collapses', () => {
    // The four headings with "none" under each are 106 characters. The ledger
    // is reserved a third, the headings take a third, and only the last third
    // says anything — under three skeletons a call buys headings alone.
    // long-vault-convention on Qwen spent calls at 90 and 172.
    const skeleton = SUMMARY_SLOTS.map((slot) => `${slot}: none`).join('\n')
    expect(skeleton).toHaveLength(106)
    expect(MIN_SUMMARY_CHARS).toBe(3 * skeleton.length + 2)
    expect(MIN_SUMMARY_CHARS).toBeGreaterThan(172)
  })
})

describe('recordsIn — the ledger without a model', () => {
  it('recovers label and id from a Matches envelope, in the order listed', () => {
    const dropped = [
      result(page(record('app:0192a', 'Rice University'), record('app:0193b', 'Stripe'))),
    ]
    expect(recordsIn(dropped)).toEqual([
      { id: 'app:0192a', label: 'Rice University' },
      { id: 'app:0193b', label: 'Stripe' },
    ])
  })

  it('recovers from a bare array and from a single record', () => {
    expect(
      recordsIn([result(JSON.stringify([record('org:1', 'Rice'), record('org:2', 'Baylor')]))]),
    ).toEqual([
      { id: 'org:1', label: 'Rice' },
      { id: 'org:2', label: 'Baylor' },
    ])
    expect(recordsIn([result(JSON.stringify(record('doc:7', 'CV 2026')))])).toEqual([
      { id: 'doc:7', label: 'CV 2026' },
    ])
  })

  it('walks into a memory.get result: the record, then its related[]', () => {
    // `{ found, record, related }`, and each related entry carries the other
    // end's id and label. Document order: the record first.
    const got = JSON.stringify({
      found: true,
      record: record('app:0192a', 'Rice University'),
      related: [
        { rel: 'AT', direction: 'out', id: 'org:1', type: 'organisation', label: 'Rice' },
        { rel: 'HAS', direction: 'in', id: 'doc:7', type: 'document', label: 'CV 2026' },
      ],
    })
    expect(recordsIn([result(got)])).toEqual([
      { id: 'app:0192a', label: 'Rice University' },
      { id: 'org:1', label: 'Rice' },
      { id: 'doc:7', label: 'CV 2026' },
    ])
  })

  it('ignores a result that is not JSON, and never throws', () => {
    expect(
      recordsIn([result('Rice University — Interview'), result('{not json'), result('')]),
    ).toEqual([])
    expect(
      recordsIn([result('null'), result('"app:1"'), result('[1,2,3]'), result('true')]),
    ).toEqual([])
  })

  it('reads a write’s prose result for its (id: …) tail, in renderOutcome’s exact shapes', () => {
    // A write comes back as `title — description (id: result)`, not JSON, so
    // the JSON walk saw nothing of it: on the chain case the turn-one note of
    // all three models had no RECORDS SEEN while the model wrote "keyword:
    // consensus (id: consensus)" — the record it had CREATED, id guessed.
    expect(recordsIn([wrote('consensus added', 'kw:01a0b2c3')])).toEqual([
      { id: 'kw:01a0b2c3', label: 'consensus added' },
    ])
    expect(recordsIn([wrote('Note saved — Stripe — Systems Engineer', 'note:0193c')])).toEqual([
      { id: 'note:0193c', label: 'Note saved — Stripe — Systems Engineer' },
    ])
    // No announcement: `renderOutcome` says "Done." and still appends the id.
    expect(recordsIn([wrote('Done.', 'app:0194d')])).toEqual([{ id: 'app:0194d', label: 'Done.' }])
  })

  it('takes nothing from prose without the tail, and does not read the tail mid-line', () => {
    // A stage change ("Rice University — Interview"), an error, a plain
    // "Done." — none names a record the tool returned. And the tail must END
    // the line: an id quoted in the middle of a sentence is a mention.
    expect(
      recordsIn([
        result('Rice University — Interview'),
        result('Error: not found'),
        result('Done.'),
      ]),
    ).toEqual([])
    expect(recordsIn([result('Note saved (id: note:1) for the Stripe application')])).toEqual([])
    expect(recordsIn([result('Note saved (id: note:1) (id: note:2)')])).toEqual([
      { id: 'note:2', label: 'Note saved (id: note:1)' },
    ])
    // The tail needs whitespace before it, as `renderOutcome` always writes.
    expect(recordsIn([result('Note saved(id: note:1)')])).toEqual([])
    expect(recordsIn([result('Note saved (id: )')])).toEqual([])
  })

  it('reads prose one line at a time, trimming the label and cutting it at 60 characters', () => {
    const two = result(`Note saved — Stripe (id: note:1)\n  consensus added   (id: kw:2)`)
    expect(recordsIn([two])).toEqual([
      { id: 'note:1', label: 'Note saved — Stripe' },
      { id: 'kw:2', label: 'consensus added' },
    ])
    // A description can run on; the ledger needs enough to recognise the record.
    const long = `Note saved — ${'d'.repeat(80)}`
    expect(recordsIn([wrote(long, 'note:3')])).toEqual([{ id: 'note:3', label: long.slice(0, 60) }])
    expect(recordsIn([wrote(`  ${'e'.repeat(60)}`, 'note:4')])[0]?.label).toBe('e'.repeat(60))
    expect(recordsIn([wrote('e'.repeat(61), 'note:5')])[0]?.label).toBe('e'.repeat(60))
  })

  it('leaves a JSON result to the JSON walk, whatever its text says', () => {
    // A JSON string is JSON: it parses, and a parsed string holds no record.
    expect(recordsIn([result(JSON.stringify('consensus added (id: kw:1)'))])).toEqual([])
    // A label holding the tail is a label, not a second record.
    expect(recordsIn([result(JSON.stringify(record('app:1', 'Rice (id: app:2)')))])).toEqual([
      { id: 'app:1', label: 'Rice (id: app:2)' },
    ])
  })

  it('dedupes prose and JSON records together, first seen first', () => {
    // The record the assistant created at turn two is then listed at turn
    // nine: one entry, where it first appeared, under its first label.
    const dropped = [
      wrote('consensus added', 'kw:1'),
      result(page(record('kw:1', 'consensus'), record('kw:2', 'raft'))),
      wrote('raft added', 'kw:2'),
    ]
    expect(recordsIn(dropped)).toEqual([
      { id: 'kw:1', label: 'consensus added' },
      { id: 'kw:2', label: 'raft' },
    ])
  })

  it('ignores objects lacking either field, or with either not a string', () => {
    const odd = JSON.stringify([
      { id: 'app:1' },
      { label: 'no id' },
      { id: 7, label: 'numeric id' },
      { id: 'app:2', label: ['not', 'a', 'string'] },
      { id: 'app:3', label: 'kept' },
    ])
    expect(recordsIn([result(odd)])).toEqual([{ id: 'app:3', label: 'kept' }])
  })

  it('reads only tool results — never the person’s turn or the assistant’s', () => {
    const asJson = JSON.stringify(record('app:9', 'from a person'))
    expect(recordsIn([user(asJson), said(asJson)])).toEqual([])
  })

  it('dedupes by id, keeping the first label and the first position', () => {
    // A record listed at turn two and read again at turn nine is one entry,
    // where it first appeared — and a later rename does not move it.
    const dropped = [
      result(page(record('app:1', 'Rice'), record('app:2', 'Baylor'))),
      result(JSON.stringify(record('app:1', 'Rice (renamed)'))),
      result(page(record('app:3', 'Stripe'))),
    ]
    expect(recordsIn(dropped).map((e) => `${e.label} (${e.id})`)).toEqual([
      'Rice (app:1)',
      'Baylor (app:2)',
      'Stripe (app:3)',
    ])
  })
})

describe('ledgerLine and ledgerIn — the line and its parse', () => {
  it('renders the contract’s line exactly', () => {
    const line = ledgerLine([
      { id: 'app:0192a', label: 'Rice University' },
      { id: 'app:0193b', label: 'Stripe' },
    ])
    expect(line).toBe('RECORDS SEEN (ids exact): Rice University (app:0192a); Stripe (app:0193b)')
  })

  it('holds one uuid entry in its third at budget 328, which round two’s heading could not', () => {
    // Gemma's vault case, turn four: heading 59 + one 59-character entry =
    // 118 > floor(328 / 3) = 109, and all four records were dropped. The
    // heading is 26 now, and the same entry fits with room to spare.
    const entry = { id: 'kw:0193c4a2-7b1e-4f0a-9c3d-2e5f6a7b8c9d', label: 'Vault conventions' }
    const text = `${entry.label} (${entry.id})`
    expect(text).toHaveLength(59)
    expect(ledgerRoundTwo('')).toHaveLength(59)
    expect(ledgerRoundTwo('').length + text.length).toBeGreaterThan(Math.floor(328 / 3))
    expect(ledger('')).toHaveLength(26)
    expect(ledgerLine([entry], Math.floor(328 / 3))).toBe(ledger(text))
    expect(ledgerLine([entry], ledger(text).length - 1)).toBe('')
  })

  it('parses round two’s heading as well as its own, and rewrites it on the next render', () => {
    // Stored contexts carry the old heading. Its ids must survive the
    // change, and a re-render must not carry the old heading forward.
    const entries = [
      { id: 'app:1', label: 'Stripe (Payments)' },
      { id: 'app:3', label: 'Rice (B' },
    ]
    const old = ledgerRoundTwo('Stripe (Payments) (app:1)', 'Rice (B (app:3)')
    expect(ledgerIn(old)).toEqual(entries)
    expect(ledgerIn(`${filled}\n${old}`)).toEqual(entries)
    expect(asMessage(`${filled}\n${old}`).content).toContain(
      ledger('Stripe (Payments) (app:1)', 'Rice (B (app:3)'),
    )
    expect(asMessage(`${filled}\n${old}`).content).not.toContain('no longer shown')
    // The LAST line is the ledger, whichever heading it carries.
    expect(ledgerIn(`${old}\n${ledger('New (app:9)')}`)).toEqual([{ id: 'app:9', label: 'New' }])
    expect(ledgerIn(`${ledger('New (app:9)')}\n${old}`)).toEqual(entries)
    // And neither heading is shown to the model as earlier notes.
    const [, input] = compactionMessages([said('x')], { earlier: `${filled}\n${old}` })
    expect(input?.content).toContain(filled)
    expect(input?.content).not.toContain(LEDGER_HEADING)
    expect(input?.content).not.toContain('app:1')
  })

  it('fits the room by whole entries, dropping from the end, and stands no heading alone', () => {
    // Half an id is worse than none: a model completes it. And the first-seen
    // record is the one the person established, so the tail goes first.
    const entries = [
      { id: 'app:1', label: 'Rice' },
      { id: 'app:2', label: 'Baylor' },
      { id: 'app:3', label: 'Stripe' },
    ]
    const one = ledgerLine(entries.slice(0, 1))
    const two = ledgerLine(entries.slice(0, 2))
    expect(ledgerLine(entries, two.length)).toBe(two)
    expect(ledgerLine(entries, two.length - 1)).toBe(one)
    expect(ledgerLine(entries, one.length - 1)).toBe('')
    expect(ledgerLine([], 10_000)).toBe('')
  })

  it('caps at forty entries when there is no budget', () => {
    // One full `memory.list` page. Longer is a result being replayed.
    const many = Array.from({ length: 45 }, (_, i) => ({
      id: `app:${String(i)}`,
      label: `Org ${String(i)}`,
    }))
    const line = ledgerLine(many)
    expect(line).toContain('(app:39)')
    expect(line).not.toContain('(app:40)')
    expect(ledgerIn(line)).toHaveLength(40)
  })

  it('parses back what it rendered, parentheses in labels included', () => {
    // Balanced, and unbalanced: the id is the LAST parenthesised token and an
    // id never holds a parenthesis, so "Rice (B (app:3)" is label "Rice (B".
    const entries = [
      { id: 'app:1', label: 'Stripe (Payments)' },
      { id: 'org:2', label: 'Rice University' },
      { id: 'app:3', label: 'Rice (B' },
    ]
    expect(ledgerIn(ledgerLine(entries))).toEqual(entries)
    expect(ledgerIn(`${filled}\n${ledgerLine(entries)}`)).toEqual(entries)
    expect(ledgerIn(filled)).toEqual([])
    expect(ledgerIn('')).toEqual([])
    // A malformed entry yields nothing, never a garbage id a model would try.
    expect(ledgerIn(ledger('Odd (x) y)'))).toEqual([])
  })

  it('takes the LAST ledger line as the ledger, so quoted headings in the notes are notes', () => {
    // The model never sees the heading, but a stored context can hold one in
    // its notes (a person's own text, an earlier format). The harness's line
    // is the last one.
    const quoted = `${filled}\n${ledger('Old (app:old)')}\n${ledger('Rice (app:1)')}`
    expect(ledgerIn(quoted)).toEqual([{ id: 'app:1', label: 'Rice' }])
    const [, input] = compactionMessages([said('x')], { earlier: quoted })
    expect(input?.content).toContain('Old (app:old)')
    expect(input?.content).not.toContain('Rice (app:1)')
  })

  it('keeps the separator out of labels, and folds their whitespace', () => {
    const line = ledgerLine([{ id: 'org:1', label: 'Rice;  University\nHouston' }])
    expect(line).toBe(ledger('Rice, University Houston (org:1)'))
    expect(ledgerIn(line)).toEqual([{ id: 'org:1', label: 'Rice, University Houston' }])
  })
})

describe('replacedBy — what the summary stands in for', () => {
  it('counts assistant prose, call arguments, tool results and earlier notes, never the person', () => {
    const dropped: ChatMessage[] = [
      user('a'.repeat(1_000)),
      calling(['memory.list', '{"type":"application"}']),
      result('r'.repeat(6_000)),
      said('s'.repeat(50)),
      { role: 'system', content: 'z'.repeat(7) },
    ]
    expect(replacedBy(dropped)).toBe('{"type":"application"}'.length + 6_000 + 50 + 7)
    expect(replacedBy(dropped, 'e'.repeat(11))).toBe(
      '{"type":"application"}'.length + 6_000 + 50 + 7 + 11,
    )
    expect(replacedBy([])).toBe(0)
  })
})

describe('asMessage', () => {
  it('is a system note, not something the assistant believes it said', () => {
    // An assistant message is prior speech, and a model will defend its own
    // prior speech. A system note is context, which is what this is.
    expect(asMessage('they filed the CV').role).toBe('system')
  })

  it('labels itself as a summary, so nothing reads it as verbatim', () => {
    expect(asMessage('  x  ').content).toBe(
      'Earlier in this conversation (summarised, not verbatim): x',
    )
  })

  it('cannot grow past the budget it is given', () => {
    // A summary that grew with the conversation would just move the overflow.
    // The budget is the caller's share of the window, not a constant here.
    const huge = asMessage('y'.repeat(5_000), { budget: 1_000 })
    expect((huge.content ?? '').length).toBeLessThan(1_000 + 100)
    expect(huge.content).toContain('y'.repeat(1_000))
    expect(huge.content).not.toContain('y'.repeat(1_001))
  })

  it('keeps the ledger when a stored summary is cut to a smaller budget', () => {
    // A later turn can place the stored summary under a smaller share. The
    // old cut took the tail, and the tail is where the ids are.
    const line = ledger('Rice University (app:0192a)', 'Stripe (app:0193b)')
    const stored = `${'y'.repeat(2_000)}\n${line}`
    const note = asMessage(stored, { budget: 600 }).content ?? ''
    expect(note).toContain(line)
    expect(note).toContain('y'.repeat(600 - line.length - 1))
    expect(note).not.toContain('y'.repeat(600 - line.length))
  })

  it('ends with where the full exchange lives, when the caller says where', () => {
    // A model that needs a detail the summary left out reads it instead of
    // guessing. `memory.get` on a thread id returns its entries in full.
    const note = asMessage('they filed the CV', {
      thread: { id: 'thread:01', title: 'CV for Rice' },
    })
    expect(note.content).toMatch(/memory\.get on that id reads it back if a detail is needed\.$/)
    expect(note.content).toContain('id thread:01')
    expect(note.content).toContain('"CV for Rice"')
    // Without a title, no quoted blank — the id is what a read needs.
    const untitled = asMessage('x', { thread: { id: 'thread:02' } })
    expect(untitled.content).toContain('the conversation with id thread:02')
    expect(untitled.content).not.toContain('""')
  })

  it('fabricates no pointer when the caller has no thread', () => {
    // The loop does not always know its own thread. An invented id would send
    // the model to read a record that does not exist.
    const note = asMessage('they filed the CV')
    expect(note.content).not.toContain('memory.get')
    expect(note.content).not.toContain('full earlier exchange')
  })
})

describe('compact', () => {
  const rice = ledger('Rice University (app:0192a)', 'Baylor (app:0192b)')

  it('sends the summariser the schema, the budget, and only the assistant’s prose', async () => {
    // The whole contract, through the real entry point: what the model is
    // actually asked for when the loop calls this with the raw evicted prefix.
    const { seen, ask } = scripted(filled)
    const out = await compact({ ask }, bulky(), { budget: 2_700, thread: { id: 'thread:01' } })
    expect(out).toBe(`${filled}\n${rice}`)
    const [system, input] = seen[0] ?? []
    for (const slot of SUMMARY_SLOTS) expect(system?.content).toContain(`${slot}:`)
    expect(system?.content).toContain('At most 1800 characters')
    expect(input?.role).toBe('user')
    expect(input?.content).not.toContain('at Houston')
    expect(input?.content).not.toContain('nnnn')
    expect(input?.content).toContain('memory.list({"type":"application"})')
  })

  it('returns the summary itself, not a message', async () => {
    // The prefix belongs to `asMessage`. Returning a prefixed MESSAGE and
    // storing its content is what made a twice-compacted thread carry the
    // boilerplate twice.
    const out = await compact({ ask: answering('They moved Rice to interview.') }, plain())
    expect(out).toBe('They moved Rice to interview.')
    expect(out).not.toContain('summarised, not verbatim')
    expect(out).not.toContain('memory.get')
  })

  it('wraps exactly once, however many times it is compacted', () => {
    const once = asMessage('they filed the CV')
    const twice = asMessage(once.content ?? '')
    const marker = /summarised, not verbatim/g
    expect((once.content ?? '').match(marker)).toHaveLength(1)
    // Wrapping an already-wrapped value is what the loop used to do every turn.
    expect((twice.content ?? '').match(marker)?.length).toBeGreaterThan(1)
  })

  it('allows a summary the size of its own headings over a prefix smaller than that', async () => {
    // GPT-OSS, long-profile-then-applications run 1 turn 3 (2026-09-05): a
    // three-message prefix of about 260 non-user characters drew a 398-char
    // summary carrying both facts, refused against 260 — paid for, then thrown
    // away. The headings are a fixed cost; `MIN_SUMMARY_CHARS` is the allowance.
    const tiny: ChatMessage[] = [
      user('I have a PhD in Computer Science and I was a Research Engineer.'),
      calling(['profile_background_add', '{"facts":["PhD in Computer Science","Research Engineer"]}']),
      result('2 facts recorded — PhD in Computer Science, Research Engineer'),
    ]
    expect(replacedBy(tiny)).toBeLessThan(MIN_SUMMARY_CHARS)
    const within = [
      'FACTS THE PERSON STATED: PhD in Computer Science; Research Engineer.',
      'RECORDS ESTABLISHED: two background entries.',
      'CORRECTIONS AND REFUSALS: none',
      'OPEN REQUESTS: none',
    ]
      .join('\n')
      .padEnd(MIN_SUMMARY_CHARS, '.')
    expect(within).toHaveLength(MIN_SUMMARY_CHARS)
    expect(await compact({ ask: answering(within) }, tiny)).toBe(within)
    // One over the allowance, over a prefix this small, is still refused.
    expect(await compact({ ask: answering(`${within}!`) }, tiny)).toBeNull()
  })

  it('discards notes that say none under every heading, keeping the ledger', async () => {
    // Qwen3 14B, long-chain-across-a-summary, both runs (2026-09-05): four
    // "none"s for a 19-message prefix holding a keyword.create and a listing,
    // placed beside a ledger naming the keyword — then "I cannot find any
    // applications" without a call.
    const empty = SUMMARY_SLOTS.map((slot) => `${slot}: none  `).join('\n')
    expect(await compact({ ask: answering(empty) }, bulky())).toBe(rice)
    expect(await compact({ ask: answering(empty) }, plain())).toBeNull()
    // Case is the model's choice, not information.
    expect(await compact({ ask: answering(empty.toLowerCase()) }, plain())).toBeNull()
    // Anything under any heading is kept, and so is a shape it cannot read:
    // the check refuses only what it can prove empty.
    const partly = [
      `${SUMMARY_SLOTS[0]}: none`,
      `${SUMMARY_SLOTS[1]}: the Rice application (app:0192a)`,
      `${SUMMARY_SLOTS[2]}: none.`,
      `${SUMMARY_SLOTS[3]}: none`,
    ].join('\n')
    expect(await compact({ ask: answering(partly) }, plain())).toBe(partly)
    const bold = SUMMARY_SLOTS.map((slot) => `**${slot}:** none`).join('\n')
    expect(await compact({ ask: answering(bold) }, plain())).toBe(bold)
    // "none" at the head of a sentence is not an empty slot.
    const sentence = [
      `${SUMMARY_SLOTS[0]}: none of the Rice ones; they meant Baylor.`,
      `${SUMMARY_SLOTS[1]}: none`,
      `${SUMMARY_SLOTS[2]}: none`,
      `${SUMMARY_SLOTS[3]}: none`,
    ].join('\n')
    expect(await compact({ ask: answering(sentence) }, plain())).toBe(sentence)
  })

  it('accepts a reply longer than its tiny input when it is shorter than the results it replaces', async () => {
    // THE round-two failure. The input is a few hundred characters of prose
    // and calls; the result being dropped is ~6,000. Measuring against the
    // input refused 12/34 GPT-OSS summaries for being "longer than their
    // source"; Gemini's rule measures against what the summary REPLACES.
    const given = inputFor(bulky()).length
    const reply = `${filled}\n${'more. '.repeat(200)}`.trim()
    expect(reply.length).toBeGreaterThan(given)
    expect(reply.length).toBeLessThan(6_000)
    const out = await compact({ ask: answering(reply) }, bulky())
    expect(out).toBe(`${reply}\n${rice}`)
  })

  /**
   * Where a refusal begins: what the reply replaces, or the headings' fixed
   * cost when the prefix is smaller than that — `MIN_SUMMARY_CHARS`. The
   * boundary tests below used `replacedBy` alone until the allowance was
   * added (2026-09-05), and `plain()` at ~250 non-user characters now sits
   * under it, so its boundary is the allowance, not its size.
   */
  const refusedAbove = (dropped: readonly ChatMessage[], earlier = ''): number =>
    Math.max(replacedBy(dropped, earlier), MIN_SUMMARY_CHARS)

  it('refuses a reply longer than what it replaces, and returns the ledger alone', async () => {
    // A summary cannot be longer than what it stands in for without inventing
    // or padding, and cutting such a reply keeps the front of something
    // already wrong. The ledger was written without the model, so it stands.
    const replaces = refusedAbove(bulky())
    expect(replaces).toBe(replacedBy(bulky())) // bulky is far over the allowance
    expect(await compact({ ask: answering('z'.repeat(replaces + 1)) }, bulky())).toBe(rice)
    // Exactly as long is the edge, and it is allowed: no longer, not shorter.
    expect(await compact({ ask: answering('z'.repeat(replaces)) }, bulky())).toBe(
      `${'z'.repeat(replaces)}\n${rice}`,
    )
    // With nothing to walk, a refusal is a plain trim.
    expect(replacedBy(plain())).toBeLessThan(MIN_SUMMARY_CHARS)
    expect(await compact({ ask: answering('z'.repeat(refusedAbove(plain()) + 1)) }, plain())).toBeNull()
    expect(await compact({ ask: answering('z'.repeat(refusedAbove(plain()))) }, plain())).toBe(
      'z'.repeat(refusedAbove(plain())),
    )
  })

  it('refuses rather than cuts an over-long reply, even when the budget would fit it', async () => {
    const replaces = refusedAbove(plain())
    expect(
      await compact({ ask: answering('z'.repeat(replaces + 1)) }, plain(), { budget: 10_000 }),
    ).toBeNull()
  })

  it('counts the earlier notes it supersedes as replaced, not their ledger', async () => {
    // Dropped can be a person's turn alone with earlier notes to carry. The
    // reply replaces those notes; the ledger line is carried by the harness.
    // The notes are sized past the allowance so the boundary is theirs.
    const notes = 'e'.repeat(MIN_SUMMARY_CHARS + 40)
    const earlier = `${notes}\n${rice}`
    expect(replacedBy([user('hi')], notes)).toBe(notes.length)
    const reply = 'r'.repeat(notes.length)
    expect(await compact({ ask: answering(reply) }, [user('hi')], { earlier })).toBe(
      `${reply}\n${rice}`,
    )
    expect(await compact({ ask: answering(`${reply}r`) }, [user('hi')], { earlier })).toBe(rice)
  })

  it('makes no call under MIN_SUMMARY_CHARS, and still returns the ledger it can fit', async () => {
    // long-vault-convention on Qwen: budgets of 90 and 172 each bought a
    // summariser call for a note cut mid-heading. The ledger costs no call.
    const { seen, ask } = scripted(filled)
    // Just under the floor a third is 106 and the two-entry line is 73; at
    // 172 the third is 57 and holds the first entry (53) alone; at 90 it is
    // 30 and holds none. (Under round two's 59-character heading the line
    // was 106 and 172 held nothing — the heading was the cost; see
    // `ledgerLine`'s budget-328 test.)
    expect(rice).toHaveLength(73)
    expect(await compact({ ask }, bulky(), { budget: MIN_SUMMARY_CHARS - 1 })).toBe(rice)
    expect(await compact({ ask }, bulky(), { budget: 172 })).toBe(
      ledger('Rice University (app:0192a)'),
    )
    expect(await compact({ ask }, bulky(), { budget: 90 })).toBeNull()
    expect(seen).toHaveLength(0)
    // At the floor, the call is made.
    expect(await compact({ ask }, bulky(), { budget: MIN_SUMMARY_CHARS })).toContain(
      SUMMARY_SLOTS[0],
    )
    expect(seen).toHaveLength(1)
  })

  it('reserves the ledger first and shortens the model’s text to what is left', async () => {
    // The ledger is deterministic and holds the ids; the notes are the
    // model's, in a fixed order with the person's facts first, so a cut
    // loses their tail and never the ledger.
    const long = `${filled}\n${'more. '.repeat(300)}`.trim()
    const out = await compact({ ask: answering(long) }, bulky(), { budget: 400 })
    expect(out).toBe(`${long.slice(0, 400 - rice.length - 1).trimEnd()}\n${rice}`)
    expect((out ?? '').length).toBeLessThanOrEqual(400)
    expect(out).toContain(SUMMARY_SLOTS[0])
  })

  it('cuts the notes at a word’s end cleanly, with no space before the ledger', async () => {
    // 'word ' repeats every five characters; a room that is a multiple of
    // five lands the cut on the space, which is then not kept. (399, not
    // 402: the ledger line is 33 characters shorter since its heading was.)
    const room = 399 - rice.length - 1
    expect(room % 5).toBe(0)
    const out = await compact({ ask: answering('word '.repeat(100)) }, bulky(), { budget: 399 })
    expect(out).toBe(`${'word '.repeat(room / 5).trimEnd()}\n${rice}`)
    expect(out).not.toContain(' \n')
  })

  it('gives the ledger at most a third of the budget, by whole entries', async () => {
    // Forty ids at ~30 characters fill a third of the ordinary share exactly.
    // Past that the notes need the room, and a cut entry is a completed id.
    const many = Array.from({ length: 30 }, (_, i) =>
      record(`app:${String(i)}`, `Organisation ${String(i)}`),
    )
    const dropped = [...plain(), result(page(...many))]
    const out = (await compact({ ask: answering(filled) }, dropped, { budget: 600 })) ?? ''
    const [notes, line] = out.split('\n' + LEDGER_HEADING)
    expect(line).toBeDefined()
    expect((LEDGER_HEADING + (line ?? '')).length).toBeLessThanOrEqual(200)
    expect(ledgerIn(out).length).toBeGreaterThan(2)
    expect(ledgerIn(out)[0]).toEqual({ id: 'app:0', label: 'Organisation 0' })
    // The notes were not touched: the ledger's third was enough.
    expect(notes).toBe(filled)
  })

  it('returns the ledger alone when the model refuses, fails, or answers nothing', async () => {
    expect(await compact({ ask: () => Promise.reject(new Error('down')) }, bulky())).toBe(rice)
    expect(
      await compact(
        { ask: async (): Promise<Turn> => ({ ok: false, kind: 'refused', reason: '429' }) },
        bulky(),
      ),
    ).toBe(rice)
    expect(await compact({ ask: answering('   ') }, bulky())).toBe(rice)
  })

  it('returns the ledger alone for a page with nothing of the assistant’s on it, without a call', async () => {
    // Dropped exchanges can be a person's turn and a tool result and nothing
    // else. Asking for notes on that is asking for invention; the ids are
    // still recoverable.
    const { seen, ask } = scripted(filled)
    expect(await compact({ ask }, [user('hi'), result(page(record('app:1', 'Rice')))])).toBe(
      ledger('Rice (app:1)'),
    )
    expect(await compact({ ask }, [user('hi'), result('{}')])).toBeNull()
    // An earlier summary that is a ledger alone carries no notes, so no call —
    // but its ids come through.
    expect(await compact({ ask }, [user('hi')], { earlier: ledger('Rice (app:1)') })).toBe(
      ledger('Rice (app:1)'),
    )
    expect(seen).toHaveLength(0)
    // Unless there are earlier notes to carry forward, which is real work.
    const { seen: again, ask: askAgain } = scripted('They filed the CV as doc:7.')
    expect(
      await compact({ ask: askAgain }, [user('hi')], {
        earlier: 'They filed the CV as doc:7 last week.',
      }),
    ).toBe('They filed the CV as doc:7.')
    expect(again).toHaveLength(1)
  })

  it('puts a record the assistant created into the ledger, from the write’s prose result', async () => {
    // The chain case's turn-one note: the assistant added a keyword, the
    // result was a sentence, and the ledger had no RECORDS SEEN at all.
    const dropped = [
      user('add the keyword consensus'),
      calling(['keyword.add', '{"label":"consensus"}']),
      wrote('consensus added', 'kw:01a0b2c3'),
      said('Added the keyword consensus.'),
    ]
    // A short reply: the exchange replaced is under a hundred characters.
    const { seen, ask } = scripted('Added the keyword consensus.')
    expect(await compact({ ask }, dropped)).toBe(
      `Added the keyword consensus.\n${ledger('consensus added (kw:01a0b2c3)')}`,
    )
    // The result itself is still withheld from the summariser.
    expect(seen[0]?.[1]?.content).not.toContain('consensus added (id:')
  })

  it('merges an earlier ledger under round two’s heading, and writes the new one', async () => {
    const earlier = `They filed the CV as doc:7.\n${ledgerRoundTwo('Stripe (app:0193b)')}`
    const out = await compact({ ask: answering(filled) }, bulky(), { earlier })
    expect(out).toBe(
      `${filled}\n${ledger('Stripe (app:0193b)', 'Rice University (app:0192a)', 'Baylor (app:0192b)')}`,
    )
  })

  it('merges the earlier ledger ahead of the new one, deduped by id', async () => {
    // Ids accumulate across compactions without a model copying them, and the
    // earlier records were seen first — first-seen is what a tight room keeps.
    const earlier = `They filed the CV as doc:7.\n${ledger('Stripe (app:0193b)', 'Rice (app:0192a)')}`
    const { seen, ask } = scripted(filled)
    const out = await compact({ ask }, bulky(), { earlier })
    // app:0192a is in both; the earlier label "Rice" is the one first seen.
    expect(out).toBe(
      `${filled}\n${ledger('Stripe (app:0193b)', 'Rice (app:0192a)', 'Baylor (app:0192b)')}`,
    )
    // And the model saw the earlier notes, not the earlier ledger.
    expect(seen[0]?.[1]?.content).toContain('They filed the CV as doc:7.')
    expect(seen[0]?.[1]?.content).not.toContain(LEDGER_HEADING)
    expect(seen[0]?.[1]?.content).not.toContain('app:0193b')
  })

  it('never lets the person’s words into the input or the ledger', async () => {
    // Belt and braces on the one rule that cannot be broken: a person's turn
    // that happens to be JSON with an id and a label is still a person's turn.
    const spoken = JSON.stringify(record('app:9', 'from the person, in Waco'))
    const { seen, ask } = scripted(filled)
    const out = await compact({ ask }, [user(spoken), ...bulky()])
    expect(seen[0]?.[1]?.content).not.toContain('at Houston')
    expect(seen[0]?.[1]?.content).not.toContain('Waco')
    expect(out).not.toContain('app:9')
    expect(out).not.toContain('Waco')
  })

  it('returns null for nothing to do', async () => {
    expect(await compact({ ask: answering('anything') }, [])).toBeNull()
    // A budget of nothing leaves nothing, and nothing is a failure, not a summary.
    expect(await compact({ ask: answering('x') }, bulky(), { budget: 0 })).toBeNull()
  })

  it('returns null on every kind of failure when there is no ledger, so a chat still trims', async () => {
    // Compaction improves a long chat. It is never what makes one possible —
    // the caller falls back to a plain trim, which is what it would have done.
    expect(await compact({ ask: () => Promise.reject(new Error('down')) }, plain())).toBeNull()
    expect(
      await compact(
        { ask: async (): Promise<Turn> => ({ ok: false, kind: 'refused', reason: '429' }) },
        plain(),
      ),
    ).toBeNull()
    expect(await compact({ ask: answering('   ') }, plain())).toBeNull()
  })
})
