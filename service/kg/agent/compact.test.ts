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
  SECTION_MARK,
  SUMMARY_SLOTS,
  asMessage,
  compact,
  compactionMessages,
  ledgerIn,
  ledgerLine,
  recordsIn,
  replacedBy,
  stripIds,
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

/**
 * A well-formed reply: every slot, in order, and every one of them FILLED.
 * Long enough to be worth keeping, and with no id in it — a model is told not
 * to write one and `stripIds` takes out any it writes anyway, so a fixture
 * carrying one would be testing the stripper by accident everywhere it is
 * used. It is tested on purpose instead, and so is the empty slot: the last
 * heading here said "none." until 2026-09-06, which made every expectation in
 * this file quietly a test of `withoutEmptySlots` as well.
 */
const filled = [
  `${SUMMARY_SLOTS[0]}: they meant the Rice application, the one at Houston.`,
  `${SUMMARY_SLOTS[1]}: the Rice University application, moved to Interview.`,
  `${SUMMARY_SLOTS[2]}: do not touch the Baylor one.`,
  `${SUMMARY_SLOTS[3]}: file the CV against the Houston one.`,
].join('\n')

/**
 * The wrapper `asMessage` puts round a summary, in characters — asked of the
 * code rather than written down, since what is pinned about it is that the
 * BUDGET pays for it (`asMessage`'s own tests spell the text out).
 */
const WRAPPER = (asMessage('').content ?? '').length

/** The join between two sections of append-only notes. */
const join = (...sections: readonly string[]): string => sections.join(`\n${SECTION_MARK}\n`)

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
      `${SUMMARY_SLOTS[1]}: things DONE — each record the assistant created, found or changed, by NAME. Do not write ids: every id is listed exactly on the line under your notes. A record here is finished work: do not restate it as a request.`,
    )
    expect(text).toContain(
      `${SUMMARY_SLOTS[2]}: anything the person corrected, declined, or asked the assistant not to touch.`,
    )
    expect(text).toContain(
      `${SUMMARY_SLOTS[3]}: only what the person asked for that was NOT finished. A request whose record appears under ${SUMMARY_SLOTS[1]} is finished and does not belong here.`,
    )
  })

  it('tells the summariser not to invent agreement, and not to write ids at all', () => {
    // Ids are the ledger's: it is derived, the notes are not, so the notes are
    // the only place in a summary where a wrong id can enter (round two:
    // app:…7649, Stripe in the ledger, called Baylor in the notes). The model
    // is told where they are so it does not think they have been lost.
    const [system] = compactionMessages([said('x')])
    expect(system?.content).toContain('never write that they agreed')
    expect(system?.content).toContain('State only what is in the messages')
    expect(system?.content).toContain('Never write a record id')
    expect(system?.content).toContain('on the line directly under your notes')
    expect(system?.content).not.toContain('copy them exactly')
  })

  it('puts this section’s room in the prompt, wrapper and ledger and earlier sections all taken off first', () => {
    // A model told a figure writes to it, so the figure must be what is
    // actually left: the budget is the whole placed NOTE, the wrapper comes
    // off it (57 characters), the ledger keeps a third of the rest, and the
    // earlier sections are already written. 2700 − 57 = 2643; a third of that
    // is 881 for the ledger; 1762 is the notes' room and there is nothing
    // earlier, so the whole of it is this section's.
    expect(WRAPPER).toBe(57)
    const [system] = compactionMessages([said('x')], { budget: 2_700 })
    expect(system?.content).toContain('At most 1762 characters')
    expect(system?.content).not.toContain('2700')
    // With earlier sections written, the ask is what they left: 1762 − 400 −
    // 42 (the section mark and its two newlines).
    const [after] = compactionMessages([said('x')], {
      budget: 2_700,
      earlier: 'e'.repeat(400),
    })
    expect(after?.content).toContain(
      `At most ${String(1762 - 400 - SECTION_MARK.length - 2)} characters`,
    )
    // And never below a third of the notes' room, however full they are: a
    // chain so full that nothing new could be written would freeze the summary
    // at the oldest facts. Past that the oldest section is dropped instead.
    const [full] = compactionMessages([said('x')], { budget: 2_700, earlier: 'e'.repeat(5_000) })
    expect(full?.content).toContain(`At most ${String(Math.floor(1762 / 3))} characters`)
    // And without a budget, the only limit stated is the one always enforced.
    const [bare] = compactionMessages([said('x')])
    expect(bare?.content).not.toContain('At most')
    expect(bare?.content).toContain('shorter than what it stands in for')
  })

  it('shows the summariser nothing of the earlier notes, so it cannot rewrite them', () => {
    // THE round-three failure. Handing the earlier notes over as "carry
    // forward what still matters" made every summary a rewrite of a rewrite,
    // and measured over 72 summary→summary transitions on 2026-09-06, 21 of 85
    // statements were wholly gone from the next summary. They are kept
    // verbatim by `compact` now, so there is nothing here to rewrite — and
    // nothing to copy an id out of either.
    const earlier = `They filed the CV as doc:7.\n${ledger('Rice University (app:0192a)')}`
    const [system, input] = compactionMessages([said('x')], { earlier })
    expect(input?.content).not.toContain('They filed the CV')
    expect(input?.content).not.toContain('earlier summary')
    expect(input?.content).not.toContain(LEDGER_HEADING)
    expect(input?.content).not.toContain('app:0192a')
    // It is told they exist, so it does not restate them or think them lost.
    expect(system?.content).toContain('kept exactly as they were written and are not shown to you')
    expect(system?.content).toContain('later notes supersede earlier ones where they disagree')
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
    // And neither heading reaches the model: the notes are not shown to it at
    // all now, and the ids on either heading are the harness's to merge.
    const [, input] = compactionMessages([said('x')], { earlier: `${filled}\n${old}` })
    expect(input?.content).not.toContain(filled)
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
    // The quoted line stays in the NOTES, and the notes are carried verbatim,
    // so it comes back out as text — while the harness's line is the last one.
    const out = asMessage(quoted).content ?? ''
    expect(out).toContain('Old (app:old)')
    expect(out.endsWith(ledger('Rice (app:1)'))).toBe(true)
  })

  it('keeps the separator out of labels, and folds their whitespace', () => {
    const line = ledgerLine([{ id: 'org:1', label: 'Rice;  University\nHouston' }])
    expect(line).toBe(ledger('Rice, University Houston (org:1)'))
    expect(ledgerIn(line)).toEqual([{ id: 'org:1', label: 'Rice, University Houston' }])
  })
})

describe('replacedBy — what the summary stands in for', () => {
  it('counts assistant prose, call arguments and tool results, never the person and never the earlier notes', () => {
    const dropped: ChatMessage[] = [
      user('a'.repeat(1_000)),
      calling(['memory.list', '{"type":"application"}']),
      result('r'.repeat(6_000)),
      said('s'.repeat(50)),
      { role: 'system', content: 'z'.repeat(7) },
    ]
    expect(replacedBy(dropped)).toBe('{"type":"application"}'.length + 6_000 + 50 + 7)
    expect(replacedBy([])).toBe(0)
    // The earlier notes were counted here until the notes became append-only:
    // a new section is added to them, so nothing it says stands in for them.
    expect(replacedBy([{ role: 'system', content: 'z'.repeat(7) }])).toBe(7)
  })
})

describe('stripIds — the notes are the only place a wrong id can enter', () => {
  // A real one, as `core/ref.ts` mints them: a type prefix and a uuidv7.
  const real = 'app:0193c4a2-7b1e-4f0a-9c3d-2e5f6a7b8c9d'

  it('takes the id and its wrapper, leaving a sentence that still reads', () => {
    // "Note saved (id: note:…)" must not become "Note saved ()", and the
    // space before the parenthesis goes with it.
    expect(stripIds(`Note saved (id: ${real}) for Rice.`)).toBe('Note saved for Rice.')
    expect(stripIds(`Moved the Rice application (${real}) to Interview.`)).toBe(
      'Moved the Rice application to Interview.',
    )
    expect(stripIds(`Rice (${real}).`)).toBe('Rice.')
    expect(stripIds(`Two records (${real}, kw:01a0b2c3) were added.`)).toBe(
      'Two records were added.',
    )
  })

  it('takes a bare id out of the middle of a sentence, label and all', () => {
    expect(stripIds(`${SUMMARY_SLOTS[1]}: Rice University — ${real}.`)).toBe(
      `${SUMMARY_SLOTS[1]}: Rice University —.`,
    )
    expect(stripIds(`the application id: ${real} was updated`)).toBe('the application was updated')
  })

  it('takes a HALF id too, which is the dangerous one', () => {
    // A model reading `kw:01a0b2c3` completes it, and a uuid-shaped test
    // would pass it through. Round two wrote "keyword: consensus (id:
    // consensus)" — a guess — for a record it had just created.
    expect(stripIds('consensus added (id: kw:01a0b2c3)')).toBe('consensus added')
    expect(stripIds('the note app:0193c4a2… was saved')).toBe('the note was saved')
  })

  it('returns a line with no id in it byte-identical', () => {
    // The tidying only runs where something was removed, so notes it does not
    // touch cannot be reformatted — indentation, double spaces and all.
    const prose = `${SUMMARY_SLOTS[0]}:  they meant the Rice one, at Houston.\n   - do not touch Baylor`
    expect(stripIds(prose)).toBe(prose)
    expect(stripIds(filled)).toBe(filled)
    // Nor is a colon that is not an id one: the prefix has to be one this app
    // mints, and the tail has to start immediately and be hex.
    const near = 'link: https://stripe.com/jobs, interview: 3pm, notes: added, org: Rice'
    expect(stripIds(near)).toBe(near)
  })

  it('strips what the summariser sends, whatever it was told', async () => {
    // The prompt asks for no ids; this is what happens when one comes anyway,
    // and the ledger's own ids are untouched because it is appended after.
    // The two empty slots go with them — see `withoutEmptySlots`.
    const reply = [
      `${SUMMARY_SLOTS[0]}: they meant Rice.`,
      `${SUMMARY_SLOTS[1]}: Rice University (id: app:0192b) — the WRONG one.`,
      `${SUMMARY_SLOTS[2]}: none`,
      `${SUMMARY_SLOTS[3]}: none`,
    ].join('\n')
    const out = (await compact({ ask: answering(reply) }, bulky())) ?? ''
    const line = ledger('Rice University (app:0192a)', 'Baylor (app:0192b)')
    expect(out).toBe(
      `${[
        `${SUMMARY_SLOTS[0]}: they meant Rice.`,
        `${SUMMARY_SLOTS[1]}: Rice University — the WRONG one.`,
      ].join('\n')}\n${line}`,
    )
    // The id survives only where it is derived: on the line, against the label
    // the tool actually returned for it.
    expect(out.slice(0, out.length - line.length)).not.toContain('app:')
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

  it('cannot grow past the budget it is given, wrapper counted inside it', () => {
    // A summary that grew with the conversation would just move the overflow.
    // The budget is the caller's share of the window, not a constant here —
    // and it is the room for the whole MESSAGE. The wrapper used to be spent
    // outside it, which at the budgets that matter is up to a fifth more room
    // than the fit had left (see the loop, where a ledger-only note is placed).
    const huge = asMessage('y'.repeat(5_000), { budget: 1_000 })
    expect((huge.content ?? '').length).toBe(1_000)
    expect(huge.content).toContain('y'.repeat(1_000 - WRAPPER))
    expect(huge.content).not.toContain('y'.repeat(1_000 - WRAPPER + 1))
    // The pointer is part of the wrapper and is paid for the same way.
    const pointed = asMessage('y'.repeat(5_000), { budget: 1_000, thread: { id: 'thread:01' } })
    expect((pointed.content ?? '').length).toBe(1_000)
    expect(pointed.content).toContain('thread:01')
  })

  it('keeps the ledger when a stored summary is cut to a smaller share', () => {
    // A later turn can place the stored summary under a smaller share. The
    // old cut took the tail, and the tail is where the ids are.
    const line = ledger('Rice University (app:0192a)', 'Stripe (app:0193b)')
    const stored = `${'y'.repeat(2_000)}\n${line}`
    const note = asMessage(stored, { budget: 600 }).content ?? ''
    const room = 600 - WRAPPER
    expect(note).toContain(line)
    expect(note).toContain('y'.repeat(room - line.length - 1))
    expect(note).not.toContain('y'.repeat(room - line.length))
  })

  it('drops the OLDEST section of append-only notes, and cuts only a section standing alone', () => {
    // A fact written once is kept as it was written or dropped whole; it is
    // never rewritten into a wrong one. So a budget that cannot hold every
    // section loses the front — while the ledger's first-seen rule points the
    // other way, so the ids of the oldest records survive on the line.
    const empty = asMessage('').content ?? ''
    const notes = join('a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100))
    const both = asMessage(notes, { budget: WRAPPER + 200 + SECTION_MARK.length + 2 })
    expect(both.content).toBe(`${empty}${join('b'.repeat(100), 'c'.repeat(100))}`)
    // One short of that and only the newest survives, whole.
    const one = asMessage(notes, { budget: WRAPPER + 200 + SECTION_MARK.length + 1 })
    expect(one.content).toBe(`${empty}${'c'.repeat(100)}`)
    // Below one whole section there is nothing left to drop, so the newest is
    // cut at its tail — the headings run facts-first, so the tail loses least.
    const cut = asMessage(notes, { budget: WRAPPER + 40 })
    expect(cut.content).toBe(`${empty}${'c'.repeat(40)}`)
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
    // 2700 less the wrapper (57 of label and 124 of pointer), less the
    // ledger's third of what remains: 2519 → 1680.
    expect(system?.content).toContain('At most 1680 characters')
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
      calling([
        'profile_background_add',
        '{"facts":["PhD in Computer Science","Research Engineer"]}',
      ]),
      result('2 facts recorded — PhD in Computer Science, Research Engineer'),
    ]
    expect(replacedBy(tiny)).toBeLessThan(MIN_SUMMARY_CHARS)
    // Every slot filled, so what is measured here is the allowance and not
    // the empty-slot strip: an all-"none" tail would be removed before the
    // length this test is about could be compared.
    const within = [
      'FACTS THE PERSON STATED: PhD in Computer Science; Research Engineer.',
      'RECORDS ESTABLISHED: two background entries.',
      'CORRECTIONS AND REFUSALS: they corrected the year to 2021.',
      'OPEN REQUESTS: file the CV against the Houston application.',
    ]
      .join('\n')
      .padEnd(MIN_SUMMARY_CHARS, '.')
    expect(within).toHaveLength(MIN_SUMMARY_CHARS)
    expect(await compact({ ask: answering(within) }, tiny)).toBe(within)
    // One over the allowance, over a prefix this small, is still refused.
    expect(await compact({ ask: answering(`${within}!`) }, tiny)).toBeNull()
  })

  it('removes an empty slot, and keeps nothing when every slot is empty', async () => {
    /*
     * An empty slot is a contradiction waiting to happen, not a gap. Qwen3
     * 14B wrote four "none"s for a 19-message prefix holding a keyword.create
     * and a listing, beside a ledger naming the keyword, and then answered "I
     * cannot find any applications" without a call (2026-09-05); GPT-OSS wrote
     * "RECORDS ESTABLISHED: none" on the turn it re-created a keyword whose id
     * its own ledger carried (2026-09-06). MEASURED over that run's 138 notes:
     * 38 said "none" under a heading while their ledger named records, and 299
     * empty slot lines were stored at ~30 characters each.
     */
    const empty = SUMMARY_SLOTS.map((slot) => `${slot}: none  `).join('\n')
    expect(await compact({ ask: answering(empty) }, bulky())).toBe(rice)
    expect(await compact({ ask: answering(empty) }, plain())).toBeNull()
    // Case is the model's choice, not information.
    expect(await compact({ ask: answering(empty.toLowerCase()) }, plain())).toBeNull()
    // A slot with something in it stays, and only the empty ones go.
    const partly = [
      `${SUMMARY_SLOTS[0]}: none`,
      `${SUMMARY_SLOTS[1]}: the Rice application`,
      `${SUMMARY_SLOTS[2]}: none.`,
      `${SUMMARY_SLOTS[3]}: none`,
    ].join('\n')
    expect(await compact({ ask: answering(partly) }, plain())).toBe(
      `${SUMMARY_SLOTS[1]}: the Rice application`,
    )
    // A shape this cannot read is kept whole: it refuses only what it proves.
    const bold = SUMMARY_SLOTS.map((slot) => `**${slot}:** none`).join('\n')
    expect(await compact({ ask: answering(bold) }, plain())).toBe(bold)
    // A heading on its own line, with "none" under it. Measured on 2026-09-06:
    // 6 of 108 summaries were written this way and every one got past the
    // check this replaces.
    const twoLine = SUMMARY_SLOTS.map((slot) => `${slot}:\nnone`).join('\n\n')
    expect(await compact({ ask: answering(twoLine) }, bulky())).toBe(rice)
    expect(await compact({ ask: answering(twoLine) }, plain())).toBeNull()
    // And an all-"none" new section leaves the earlier sections as they were,
    // rather than appending a section that says nothing and costs room.
    expect(await compact({ ask: answering(twoLine) }, plain(), { earlier: 'The fact.' })).toBe(
      'The fact.',
    )
    // A heading on its own line with something real under it is kept, folded
    // onto one line; the three empty ones after it are not.
    const spread = [
      `${SUMMARY_SLOTS[0]}:`,
      'they only want roles in Austin',
      `${SUMMARY_SLOTS[1]}:`,
      'none',
      `${SUMMARY_SLOTS[2]}:`,
      'none',
      `${SUMMARY_SLOTS[3]}:`,
      'none',
    ].join('\n')
    expect(await compact({ ask: answering(spread) }, plain())).toBe(
      `${SUMMARY_SLOTS[0]}: they only want roles in Austin`,
    )
    // A heading with nothing under it at all proves nothing, so it is kept.
    const dangling = `${SUMMARY_SLOTS[0]}: none\n${SUMMARY_SLOTS[1]}:`
    expect(await compact({ ask: answering(dangling) }, plain())).toBe(`${SUMMARY_SLOTS[1]}:`)
    // "none" at the head of a sentence is not an empty slot.
    const sentence = [
      `${SUMMARY_SLOTS[0]}: none of the Rice ones; they meant Baylor.`,
      `${SUMMARY_SLOTS[1]}: none`,
      `${SUMMARY_SLOTS[2]}: none`,
      `${SUMMARY_SLOTS[3]}: none`,
    ].join('\n')
    expect(await compact({ ask: answering(sentence) }, plain())).toBe(
      `${SUMMARY_SLOTS[0]}: none of the Rice ones; they meant Baylor.`,
    )
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
  const refusedAbove = (dropped: readonly ChatMessage[]): number =>
    Math.max(replacedBy(dropped), MIN_SUMMARY_CHARS)

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
    expect(
      await compact({ ask: answering('z'.repeat(refusedAbove(plain()) + 1)) }, plain()),
    ).toBeNull()
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

  it('appends a new section to the earlier notes instead of replacing them', async () => {
    // THE round-three change, at the entry point. The earlier notes come back
    // character for character with the new section under a mark that says
    // which way the two point — no model is asked to carry them forward, and
    // measured over 72 transitions on 2026-09-06 the carrying lost 21 of 85
    // statements outright. The ledger is merged under both.
    const notes = 'These are the earlier notes, kept as they were written.'
    const { seen, ask } = scripted(filled)
    const out = await compact({ ask }, bulky(), {
      earlier: `${notes}\n${ledger('Stripe (app:0193b)')}`,
    })
    expect(out).toBe(
      `${join(notes, filled)}\n${ledger('Stripe (app:0193b)', 'Rice University (app:0192a)', 'Baylor (app:0192b)')}`,
    )
    // The model was shown neither the notes nor their ledger.
    expect(seen[0]?.[1]?.content).not.toContain('kept as they were written')
    expect(seen[0]?.[1]?.content).not.toContain('app:0193b')
    // A third compaction appends again: three sections, oldest first.
    const again = await compact({ ask: answering('A third section.') }, plain(), {
      earlier: out ?? '',
    })
    expect(again).toBe(
      `${join(notes, filled, 'A third section.')}\n${ledger('Stripe (app:0193b)', 'Rice University (app:0192a)', 'Baylor (app:0192b)')}`,
    )
  })

  it('keeps the earlier notes with no call at all when nothing of the assistant’s was dropped', async () => {
    // Dropped can be a person's turn alone. There is nothing new to write, and
    // rewriting the earlier notes to say the same thing is the drift this
    // stopped — so the summary is the earlier notes, unchanged, and free.
    const { seen, ask } = scripted('a rewrite nobody asked for')
    const notes = 'They filed the CV as doc 7.'
    expect(await compact({ ask }, [user('hi')], { earlier: `${notes}\n${rice}` })).toBe(
      `${notes}\n${rice}`,
    )
    expect(seen).toHaveLength(0)
  })

  it('measures a refusal against the evicted prefix alone, not the notes it is appended to', async () => {
    // A reply is refused when it is longer than what it REPLACES, and it no
    // longer replaces the earlier notes — it is added to them. Counting them
    // would let a long chain buy a long summary of a short exchange.
    const earlier = `${'e'.repeat(4_000)}\n${rice}`
    const over = 'z'.repeat(replacedBy(plain()) + MIN_SUMMARY_CHARS)
    expect(over.length).toBeLessThan(4_000)
    expect(await compact({ ask: answering(over) }, plain(), { earlier })).toBe(earlier)
  })

  it('makes no call under MIN_SUMMARY_CHARS, and still returns the ledger it can fit', async () => {
    // long-vault-convention on Qwen: budgets of 90 and 172 each bought a
    // summariser call for a note cut mid-heading. The ledger costs no call —
    // and with no notes to leave room for it takes the whole budget rather
    // than a third of it, which is what makes it fit at all down here.
    const { seen, ask } = scripted(filled)
    expect(rice).toHaveLength(73)
    // The four budgets measured on long-vault-convention turns 4-7 on
    // 2026-09-06: 112, 53, 18, 275. Net of the 57-character wrapper, 275
    // holds both entries and 112 holds the first (53 of 55); 53 and 18 do
    // not pay for the wrapper at all.
    expect(await compact({ ask }, bulky(), { budget: 275 })).toBe(rice)
    expect(await compact({ ask }, bulky(), { budget: 112 })).toBe(
      ledger('Rice University (app:0192a)'),
    )
    expect(
      (asMessage(ledger('Rice University (app:0192a)')).content ?? '').length,
    ).toBeLessThanOrEqual(112)
    expect(await compact({ ask }, bulky(), { budget: 53 })).toBeNull()
    expect(await compact({ ask }, bulky(), { budget: 18 })).toBeNull()
    expect(seen).toHaveLength(0)
    // The floor is the budget NET of the wrapper, so the call begins one
    // wrapper above it — not at the number itself, which would be a note the
    // wrapper had already eaten a fifth of.
    expect(await compact({ ask }, bulky(), { budget: MIN_SUMMARY_CHARS })).toBe(rice)
    expect(seen).toHaveLength(0)
    expect(await compact({ ask }, bulky(), { budget: MIN_SUMMARY_CHARS + WRAPPER - 1 })).toBe(rice)
    expect(seen).toHaveLength(0)
    expect(await compact({ ask }, bulky(), { budget: MIN_SUMMARY_CHARS + WRAPPER })).toContain(
      SUMMARY_SLOTS[0],
    )
    expect(seen).toHaveLength(1)
  })

  it('reserves the ledger first and shortens the model’s text to what is left', async () => {
    // The ledger is deterministic and holds the ids; the notes are the
    // model's, in a fixed order with the person's facts first, so a cut
    // loses their tail and never the ledger. The cut lands on the last line
    // break inside the room — see the sibling test below for why.
    const long = `${filled}\n${'more. '.repeat(300)}`.trim()
    const room = 400 - WRAPPER
    const out = await compact({ ask: answering(long) }, bulky(), { budget: 400 })
    const cut = long.slice(0, room - rice.length - 1)
    expect(out).toBe(`${cut.slice(0, cut.lastIndexOf('\n')).trimEnd()}\n${rice}`)
    expect((out ?? '').length).toBeLessThanOrEqual(room)
    expect(out).toContain(SUMMARY_SLOTS[0])
  })

  it('cuts a section at a line break, never mid-fact', async () => {
    /*
     * MEASURED once in the 130 notes of the 2026-09-06 endurance run: a
     * section ended "- Application record: Assistan", which a reader cannot
     * tell from a complete line and a model will finish for itself.
     */
    const line = '- Application record: Assistant Professor, Computer Science — Rice University'
    const notes = [`${SUMMARY_SLOTS[0]}: they meant the Houston one.`, ...Array(8).fill(line)].join(
      '\n',
    )
    const out = (await compact({ ask: answering(notes) }, bulky(), { budget: 420 + WRAPPER })) ?? ''
    expect(out).not.toBe('')
    expect(out).toContain(SUMMARY_SLOTS[0])
    expect(out.length).toBeLessThanOrEqual(420)
    // Every line of what survives is a WHOLE line of what was written — the
    // ledger, which the harness wrote, being the one line that is not.
    for (const kept of out.split('\n')) {
      if (kept.startsWith(LEDGER_HEADING)) continue
      expect(notes.split('\n')).toContain(kept)
    }
    // The cut happened: this is not the whole of the notes.
    expect(out).not.toContain(notes)
  })

  it('reserves the ledger a third, and gives it whatever the notes do not use', async () => {
    /*
     * The third is a FLOOR, not a ceiling. It was a ceiling until 2026-09-06,
     * and over 130 notes the median summary used 0.41 of its room while none
     * ever exceeded it — so a quarter of every budget was thrown away and the
     * ledger fell from 5.87 entries a note to 2.94. Entries are the half of a
     * note a model can act on: GPT-OSS went from five ids to one on
     * long-chain-across-a-summary and then re-created the keyword it had.
     */
    const many = Array.from({ length: 30 }, (_, i) =>
      record(`app:${String(i)}`, `Organisation ${String(i)}`),
    )
    const dropped = [...plain(), result(page(...many))]
    const out = (await compact({ ask: answering(filled) }, dropped, { budget: 600 })) ?? ''
    const [notes, line] = out.split('\n' + LEDGER_HEADING)
    expect(line).toBeDefined()
    // The notes were not touched: the ledger never eats into their two thirds.
    expect(notes).toBe(filled)
    expect(out.length).toBeLessThanOrEqual(600 - WRAPPER)
    expect(ledgerIn(out)[0]).toEqual({ id: 'app:0', label: 'Organisation 0' })
    // A third of 600 − 57 is 181, and the ledger has more than that, because
    // `filled` left it more: every character the notes did not use.
    const third = Math.floor((600 - WRAPPER) / 3)
    expect((LEDGER_HEADING + (line ?? '')).length).toBeGreaterThan(third)
    // And the budget is nearly all used: what is left is under one entry.
    expect(600 - WRAPPER - out.length).toBeLessThan(30)
  })

  it('never reserves for ids that do not exist', async () => {
    // Reserving the third unconditionally would shorten the notes on behalf
    // of a ledger with nothing in it: two records are a 90-character line.
    // Line-broken throughout, so what the notes get is decided by the room
    // and not by where the last line break happens to fall.
    const long = [filled, ...Array(40).fill('- more detail about the Rice application.')].join('\n')
    // Wordy enough that the reply is not refused, and carrying no id at all.
    const wordy = [...plain(), result('The vault holds three documents. '.repeat(100))]
    expect(replacedBy(wordy)).toBeGreaterThan(long.length)
    const withTwo = (await compact({ ask: answering(long) }, bulky(), { budget: 900 })) ?? ''
    const withNone = (await compact({ ask: answering(long) }, wordy, { budget: 900 })) ?? ''
    expect(withNone).not.toContain(LEDGER_HEADING)
    const room = 900 - WRAPPER
    const notesOf = (out: string) => out.split(`\n${LEDGER_HEADING}`)[0] ?? ''
    // With no ledger the notes get the whole room, not two thirds of it.
    expect(notesOf(withNone).length).toBeGreaterThan(Math.floor((room * 2) / 3))
    // With a two-entry ledger they get all but its ~90 characters — still
    // more than the two thirds a reserved third would have left them.
    expect(notesOf(withTwo).length).toBeGreaterThan(Math.floor((room * 2) / 3))
    expect(notesOf(withNone).length - notesOf(withTwo).length).toBeLessThan(rice.length + 45)
  })

  it('keeps the earlier notes when the fresh call refuses, fails, or answers nothing', async () => {
    /*
     * The wipe. MEASURED on the 2026-09-06 drift run, before the notes were
     * append-only: 2 of 72 transitions (Qwen, long-profile-then-applications,
     * both runs, at a 2,984-character budget) went from a summary with notes
     * to a ledger alone — "Research Engineer at Cloudflare" and everything
     * else stated before it discarded permanently, because one summariser
     * call failed and `compact` rebuilt the summary from that call alone.
     * Carrying `earlier` verbatim is what makes a bad call cost only its own
     * turn.
     */
    const earlier = `${SUMMARY_SLOTS[0]}: Research Engineer at Cloudflare since 2024.\n${rice}`
    const asks: readonly ((messages: readonly ChatMessage[]) => Promise<Turn>)[] = [
      async (): Promise<Turn> => ({ ok: false, kind: 'refused', reason: '429' }),
      () => Promise.reject(new Error('the summariser is down')),
      answering('   '),
      answering('z'.repeat(replacedBy(bulky()) + 1)),
    ]
    for (const ask of asks) {
      const out = (await compact({ ask }, bulky(), { earlier, budget: 3_000 })) ?? ''
      expect(out).toContain('Research Engineer at Cloudflare')
      expect(out).toContain(LEDGER_HEADING)
    }
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
    // And earlier notes are no longer a reason to call: they are kept as
    // written rather than rewritten, so an empty page has nothing to write.
    const { seen: again, ask: askAgain } = scripted('They filed the CV as doc 7.')
    expect(
      await compact({ ask: askAgain }, [user('hi')], {
        earlier: 'They filed the CV as doc 7 last week.',
      }),
    ).toBe('They filed the CV as doc 7 last week.')
    expect(again).toHaveLength(0)
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
    const earlier = `They filed the CV as doc 7.\n${ledgerRoundTwo('Stripe (app:0193b)')}`
    const out = await compact({ ask: answering(filled) }, bulky(), { earlier })
    expect(out).toBe(
      `${join('They filed the CV as doc 7.', filled)}\n${ledger('Stripe (app:0193b)', 'Rice University (app:0192a)', 'Baylor (app:0192b)')}`,
    )
  })

  it('merges the earlier ledger ahead of the new one, deduped by id', async () => {
    // Ids accumulate across compactions without a model copying them, and the
    // earlier records were seen first — first-seen is what a tight room keeps.
    const earlier = `They filed the CV as doc 7.\n${ledger('Stripe (app:0193b)', 'Rice (app:0192a)')}`
    const { seen, ask } = scripted(filled)
    const out = await compact({ ask }, bulky(), { earlier })
    // app:0192a is in both; the earlier label "Rice" is the one first seen.
    expect(out).toBe(
      `${join('They filed the CV as doc 7.', filled)}\n${ledger('Stripe (app:0193b)', 'Rice (app:0192a)', 'Baylor (app:0192b)')}`,
    )
    // And the model saw neither the earlier notes nor the earlier ledger.
    expect(seen[0]?.[1]?.content).not.toContain('They filed the CV')
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
