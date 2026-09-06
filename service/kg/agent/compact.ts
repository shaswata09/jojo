/**
 * Summarising the part of a conversation that no longer fits, so a long chat
 * loses detail instead of losing memory.
 *
 * ## Why trimming alone is not enough
 *
 * `budget.ts` drops the oldest exchanges until the request fits, which stops
 * the server truncating from the front. It is the right floor and it is not
 * enough on its own: what it drops is gone, so at turn twelve the assistant has
 * no idea that at turn three you told it which Rice application you meant, or
 * that it already filed the CV, or that you asked it not to touch the Baylor
 * one. It will ask again, or worse, act as though none of it happened.
 *
 * ## What replaces them
 *
 * One short message, in the model's own words, describing what happened in the
 * exchanges being dropped — decisions, ids that matter, things the person
 * asked for and things they refused. It sits where those exchanges were, so
 * the conversation still reads in order. Under it, one line the harness writes
 * itself: every record that appeared in the tool results being dropped, as
 * label and exact id (the "ledger", below).
 *
 * ## What the summariser is shown, and what it is not
 *
 * The first version joined EVERY dropped message into one text — the person's
 * turns, the assistant's, and every tool result — and asked for 150 words.
 * Measured on the six `endurance` benchmark cases, where compaction fires four
 * to seven times per case, that lost the person's turn-one fact in 17 of 18
 * model×case cells (Gemma 1/6 clean, Qwen 0/6, GPT-OSS 0/6). The arithmetic
 * says why: one `memory.list` result is about 6,000 characters, so the
 * sentence that mattered was compressed ~20:1 alongside forty serialised
 * records. No model survives that ratio.
 *
 * So the summariser sees the assistant's own prose and the tools it called,
 * and nothing else. The person's turns are never sent to it — they are the
 * thing most worth keeping and the budget layer keeps them verbatim, the way
 * Codex keeps user messages and drops assistant and tool content. Tool OUTPUTS
 * are not sent either: a record that matters is one the assistant said
 * something about, and anything else can be read again.
 *
 * Tool ARGUMENTS are sent, from round two. Round one sent names only, and the
 * measured cost was ids: Qwen and GPT-OSS summaries read "app: unknown" / "id
 * not shown", and Qwen then updated the Rice application instead of Stripe
 * (long-correction-after-drift) or answered "cannot find the Stripe
 * application" instead of re-reading. The summariser could not fill "name and
 * id" because nothing it was shown held an id. The arguments do — they are
 * exactly the ids and values the assistant acted on — and they are small
 * (cut at 160 characters a call), so they cost nothing like a result.
 *
 * ## The ledger: ids without a model
 *
 * The other half of the same measure. Every `AgentRecord` a READ returns
 * renders as `{ id, type, label, ...props }` (`queries.ts` `render`), and a
 * list as `{ matches, shown, total }`, so a JSON walk that collects any object
 * with a string `id` AND a string `label` recovers "label (id)" for every
 * record the assistant was shown, deterministically. A WRITE returns prose —
 * `execute.ts` `renderOutcome` gives back `title — description (id: result)`,
 * "consensus added (id: kw:01a0…)" — and round two's walk, JSON only, put
 * nothing of it in the ledger: on the chain case the turn-one note of all
 * three models had no RECORDS SEEN, while the model's own text read
 * "keyword: consensus (id: consensus)" — the record the assistant had just
 * CREATED, with its id guessed. So a prose result is read line by line for
 * that exact `(id: …)` tail. `recordsIn` is both walks; the line it produces
 * is appended to the summary, reserved before the model's text, and carried
 * forward across compactions (see `compact`).
 *
 * ## Ids are the ledger's, and are taken out of the notes
 *
 * The ledger is derived; the notes are written by a model, so the notes are the
 * only place in a summary where a wrong id can enter. Round two saw exactly
 * that — `app:…7649` (Stripe) called Baylor, and a keyword created as
 * `kw:01a0…` written back as `(id: consensus)`.
 *
 * Re-measured 2026-09-06 across all three bench models, 108 summaries: 0
 * fabricated and 0 mislabelled ids out of the 25 that appear in notes at all.
 * The denominator is the finding. Only 10 of 36 conversations ever put an id in
 * the notes — 0.23 ids per summary — while the ledger carried them on every one
 * (395 id-carry-forward checks). The models had already mostly stopped writing
 * ids; what was left was 9 of 25 named only generically ("application_note_set:
 * app:…d149"), which is an id with no information beside it.
 *
 * So the summariser is told not to write ids, and `stripIds` removes any it
 * writes anyway — the token, and a wrapping `(id: …)` or bare parenthetical
 * with it, so the sentence still reads. What it is SHOWN keeps them: the tool
 * arguments are how it knows which record it means, and they are what round two
 * added to stop "app: unknown".
 *
 * ## Append-only, because a rewrite of a rewrite loses facts
 *
 * Each compaction used to hand the previous notes to the model as `earlier` and
 * ask it to carry forward what still mattered, so summary five was a rewrite of
 * a rewrite of a rewrite. MEASURED on 2026-09-06 over 72 summary→summary
 * transitions in 36 `full` conversations: 21 of 85 statements were wholly gone
 * from the next summary (24.7%) and 25 more lost more of their fact tokens than
 * they kept; 73 of 336 fact tokens vanished (Gemma 6/82, Qwen 22/50, GPT-OSS
 * 45/204). What rules out noise is that the losses REPEAT across both runs of
 * the same cell: long-scout-threshold's 60-point threshold — the case's whole
 * point — is lost in all four Gemma and GPT-OSS run-cells, and
 * long-vault-convention's house rule ("note 'found by assistant' on every URL")
 * at t2→t3 in both runs of two models. Amp removed auto-compaction over this.
 *
 * So the earlier notes are no longer rewritten. They are kept verbatim, the
 * model is asked for notes on the NEW messages only, and the two are joined
 * oldest-first with `SECTION_MARK` between them. When the budget cannot hold
 * them all the OLDEST section is dropped whole. A fact written once is then
 * either present as it was written or gone — never rewritten into a wrong one.
 * The cost is bounded the other way: a model that filled the whole budget every
 * time would evict every earlier section, so the room it is ASKED for is what
 * is left after the earlier notes, and never less than a third (`sectionRoom`).
 *
 * ## What it must not do
 *
 * Invent, and speak as though it were the person. A summary that says "you
 * agreed to close the Baylor application" when you did not is worse than the
 * amnesia it replaces, because the assistant will then act on it. The prompt
 * asks for facts already in the transcript and nothing else, and the result is
 * clearly marked as a summary so a model reading it knows it is not verbatim.
 *
 * ## When it runs
 *
 * Only when trimming would otherwise drop something, so an ordinary short
 * conversation never pays for it. It costs one model call at the moment a chat
 * gets long, and it is allowed to fail: a compaction that does not come back is
 * a plain trim, which is what would have happened anyway. And the model is not
 * called at all under `MIN_SUMMARY_CHARS`, where a call could only buy
 * headings — but `compact` is, because the ledger costs no call and is the part
 * that carries the ids. The floor lives here and only here: the loop used to
 * keep a copy of it and skip `compact` outright, which is what stopped the
 * ledger being placed on the four long-vault-convention turns where the budget
 * came out at 18-275 characters.
 *
 * The budget is the size of the PLACED NOTE, wrapper included. `asMessage`'s
 * prefix is 57 characters and its pointer another ~130, and counting them
 * outside the budget was how a ledger-only note could be placed in a fifth more
 * room than the fit had left (`textBudget`).
 */

import type { NodeId } from '../core/model'
import type { ChatMessage, Turn } from '../core/model-server'
import { TYPE_PREFIX } from '../core/ref'

/**
 * A message the budget layer has marked for the summariser.
 *
 * Only the assistant's own turns. The type is the contract: `compactionMessages`
 * cannot be handed a person's message, so a caller that wants to send one has
 * to write the code that does it, and the reason it must not is above.
 */
export type Summarisable = Extract<ChatMessage, { role: 'assistant' }>

/**
 * The messages of `dropped` that may be summarised — the marking itself.
 *
 * `user` turns are excluded because they are kept verbatim elsewhere and must
 * never be paraphrased by a model. `tool` results are excluded because they
 * are the bulk that drowned everything else (see the file comment); the tool
 * names and arguments survive on the assistant message that called them, and
 * the records in the results survive through `recordsIn`. `system` messages
 * are excluded because a system message in dropped history is a previous
 * summary, and that arrives through `CompactOptions.earlier` instead, where
 * the summariser is told what it is.
 */
export const summarisable = (dropped: readonly ChatMessage[]): Summarisable[] =>
  dropped.filter((message): message is Summarisable => message.role === 'assistant')

/** Where the full earlier exchange lives, for the pointer at the end. */
export type ThreadRef = {
  readonly id: NodeId
  /** The person's name for the conversation, when the caller has it. */
  readonly title?: string
}

export type CompactOptions = {
  /**
   * The most characters the summary may be, ledger included.
   *
   * A share of the model's window, decided by the caller — never a constant
   * here. The fixed 1,200 it replaces was the same size at an 8k window and a
   * 128k one, and at the large end it was the cap, not the model, that was
   * losing facts. Absent means the only ceiling is the refusal in `compact`: a
   * summary may never be longer than what it replaces.
   */
  readonly budget?: number
  /**
   * The conversation the dropped exchanges belong to, so the summary can say
   * where the verbatim version still is. Absent means no pointer — a model
   * told a record exists will go and read it, so the id is never guessed.
   */
  readonly thread?: ThreadRef
  /**
   * A previous compaction's summary, which the new one is APPENDED TO.
   *
   * Not shown to the summariser at all, since 2026-09-06: a model handed its
   * own earlier notes to carry forward rewrites them, and 24.7% of statements
   * did not survive the rewrite (see the file comment). Its notes are kept
   * verbatim as the older sections of the new summary, and its ledger line is
   * merged into the new ledger by the harness — so the ids survive without a
   * model copying them, and the sentences survive without one rephrasing them.
   */
  readonly earlier?: string
}

/**
 * The four slots every summary has to fill.
 *
 * A fixed schema rather than "notes", because a free-form summary spends its
 * words on whatever the model found most interesting, and what the assistant
 * needs next turn is not interesting: which record the person meant, and what
 * they said not to do. Gemini's `<state_snapshot>` and Codex's context
 * checkpoint are the models. `none` under an empty heading is required so a
 * missing slot is visible as a choice rather than an omission.
 */
export const SUMMARY_SLOTS = [
  'FACTS THE PERSON STATED',
  'RECORDS ESTABLISHED',
  'CORRECTIONS AND REFUSALS',
  'OPEN REQUESTS',
] as const

/**
 * The budget under which no summariser call is made.
 *
 * The empty skeleton — the four headings with "none" under each — is 106
 * characters, and a real one with a fact under the first heading is 110–112
 * before it says anything. The ledger is reserved a third of the budget ahead
 * of the model's text. So 320 is three skeletons: one third for the ledger,
 * one for the headings, and only the last third for facts. Under that a call
 * buys headings with nothing beneath them, which is what the measurement
 * showed — long-vault-convention on Qwen had `summaryChars` of 90 and 172
 * (window 26,100), and each spent a summariser call on a note cut
 * mid-heading. Both are below this line; the ordinary share (10% of the
 * window, ~2,600 there) is far above it.
 *
 * It bounds the MODEL CALL and nothing else. Under it `compact` still returns
 * whatever ledger the budget can hold, which costs nothing and is the half of a
 * summary that carries ids. The loop kept a second copy of this constant and
 * skipped `compact` entirely under it, so on long-vault-convention's turns 4-7
 * (budgets 112, 53, 18, 275, measured 2026-09-06) neither a summary nor the
 * ledger was placed. One floor, in the file that owns the call.
 */
export const MIN_SUMMARY_CHARS = 320

/** The heading of the harness-written line of records. */
export const LEDGER_HEADING = 'RECORDS SEEN'

/**
 * The most characters of a prose result's leading text kept as a label.
 *
 * A write's sentence can carry a whole description ("Note saved — Stripe —
 * Systems Engineer — call back after the take-home"); the ledger needs enough
 * to recognise the record, and a third of the budget has to hold many.
 */
const PROSE_LABEL_CHARS = 60

/** The `(id: …)` tail `renderOutcome` puts on every write result that has an id. */
const PROSE_RECORD = /^(.*)\s\(id: ([^)]+)\)$/

/**
 * Most ledger entries when there is no budget to reserve a third of.
 *
 * Forty is one full `memory.list` page: a ledger longer than that is a result
 * being replayed, which is the thing this file exists to stop.
 */
const LEDGER_ENTRIES_UNBUDGETED = 40

/** How much of the arguments of one call the summariser is shown. */
const ARGS_SHOWN = 160

/**
 * What goes under each heading — and, as much, what does not.
 *
 * Done and open are kept apart in words, because a model reading a summary
 * that restates finished work as a request does the work again. Measured on
 * GPT-OSS after a fresh summary whose FACTS slot said "waiting on the team
 * match": on the next READ turn it re-applied the completed write, since
 * nothing in the note said the match had been made. So RECORDS ESTABLISHED
 * is defined as things DONE, FACTS holds what the person said and never what
 * they asked, and OPEN REQUESTS says in so many words that a request whose
 * record is under RECORDS ESTABLISHED is finished.
 */
const SLOT_GUIDANCE = [
  `${SUMMARY_SLOTS[0]}: what the assistant’s replies show the person TOLD it — which record they meant, names, dates, preferences. What they told it, never what they asked it to do.`,
  `${SUMMARY_SLOTS[1]}: things DONE — each record the assistant created, found or changed, by NAME. Do not write ids: every id is listed exactly on the line under your notes. A record here is finished work: do not restate it as a request.`,
  `${SUMMARY_SLOTS[2]}: anything the person corrected, declined, or asked the assistant not to touch.`,
  `${SUMMARY_SLOTS[3]}: only what the person asked for that was NOT finished. A request whose record appears under ${SUMMARY_SLOTS[1]} is finished and does not belong here.`,
] as const

const SYSTEM = [
  'You summarise part of a conversation between a person and their job-application assistant, so the assistant can keep working after the earlier messages are dropped.',
  'You are shown the assistant’s own replies and the tools it called, with the arguments it called them with. The person’s messages are not shown: they stay in the conversation verbatim, so do not reconstruct them.',
  'Notes on earlier parts of this conversation are kept exactly as they were written and are not shown to you. Write notes on the messages below and nothing else; yours are appended after the earlier ones, and later notes supersede earlier ones where they disagree.',
  'Write notes in the third person under exactly these four headings, in this order, and write "none" under a heading with nothing to record:',
  ...SLOT_GUIDANCE,
  'Never write a record id. The ids are listed exactly, by the program, on the line directly under your notes; an id you copy is one that can be wrong, and any you write will be removed.',
  'Drop: pleasantries, the assistant’s explanations, anything already undone.',
  'State only what is in the messages. Do not guess what the person wanted, and never write that they agreed to something unless they said so — the assistant will act on this.',
].join(' ')

/**
 * The text of an assistant turn: what it said, and what it called, with what.
 *
 * Arguments and not results, on purpose. `application.stage.set({"id":
 * "app:0193b","stage":"Interview"})` is the fact that decides the next turn
 * in fifty characters; the forty records `memory.list` returned are the
 * reason the earlier summariser could not see anything else. Cut at
 * `ARGS_SHOWN` so a long `note` or a pasted posting stays a fragment: the id
 * is at the front of every call this app makes.
 */
const textOf = (message: Summarisable): string => {
  const calls = message.tool_calls
    ?.map((c) => {
      const args = c.function.arguments
      return `${c.function.name}(${args.length > ARGS_SHOWN ? `${args.slice(0, ARGS_SHOWN)}…` : args})`
    })
    .join(', ')
  const said = message.content ?? ''
  return calls ? `assistant called ${calls} (results not shown). ${said}` : `assistant: ${said}`
}

/**
 * What the summary replaces in the request, in characters.
 *
 * Every non-user message of the evicted prefix — assistant prose, the
 * arguments of its calls, and the tool results in full whether the budget
 * layer stubbed or cut them. The person's turns are not counted because they
 * are not replaced: the budget layer carries them verbatim. Nor, since
 * 2026-09-06, are the earlier notes: a section is appended to them rather than
 * standing in for them, so they are not part of what a reply replaces.
 *
 * This is what the refusal in `compact` measures against. Round one measured
 * against the summariser's INPUT, which by then was prose and tool names —
 * 87–831 characters — so a four-heading summary was "longer than its source":
 * GPT-OSS lost 12/34 summaries, Gemma 4/34, Qwen 4/31, and every Gemma/Qwen
 * refusal had an input of ≤202 characters against a 106-character skeleton.
 * Gemini's rule is the sound one: a summary may not be longer than what it
 * stands in for, and what it stands in for includes the 6,000-character
 * results.
 */
export const replacedBy = (dropped: readonly ChatMessage[]): number =>
  dropped.reduce((total, message) => {
    if (message.role === 'user') return total
    if (message.role === 'assistant') {
      return (
        total +
        (message.content ?? '').length +
        (message.tool_calls ?? []).reduce((n, call) => n + call.function.arguments.length, 0)
      )
    }
    return total + message.content.length
  }, 0)

/**
 * An id as this app mints one, for taking one back OUT of a model's notes.
 *
 * `core/ref.ts` mints `${prefix}:${uuidv7}`, and the prefixes come from there
 * rather than being spelled again here — a second list is a second thing that
 * can stop agreeing. The tail is hex and dashes rather than the exact uuid
 * shape on purpose: a HALF id is the dangerous one, because a model reading
 * `kw:01a0b2c3` completes it, and it would pass a uuid-shaped test.
 */
const ID_TOKEN = `\\b(?:${[...new Set(Object.values(TYPE_PREFIX))]
  .sort((a, b) => b.length - a.length)
  .join('|')}):[0-9a-f][0-9a-f-]*…?`

/** `(app:0192a)`, `(id: app:0192a)`, `(id: app:0192a, kw:1)` — the whole thing goes. */
const ID_IN_PARENS = new RegExp(
  `[ \\t]*\\((?:id:\\s*)?${ID_TOKEN}(?:\\s*[,;]\\s*${ID_TOKEN})*\\)`,
  'gi',
)

/** What is left after the parentheticals: `id: app:0192a`, or the token alone. */
const ID_LOOSE = new RegExp(`(?:\\bid:\\s*)?${ID_TOKEN}`, 'gi')

/**
 * The model's notes with every id taken out of them.
 *
 * The ledger is derived and the notes are not, so an id in the notes is the
 * one id in a summary that can be wrong — round two's `app:…7649` labelled
 * Baylor, and a created keyword written back as `(id: consensus)`. The
 * summariser is told not to write them; this is what happens when it does
 * anyway, and it runs on the model's reply ONLY — never on the ledger line,
 * which is appended afterwards.
 *
 * A wrapping parenthetical goes with the token so the sentence still reads:
 * "Note saved (id: note:0193c)" becomes "Note saved", not "Note saved ()".
 * A line that loses nothing is returned byte-identical, so the whitespace
 * tidying can never reformat notes it did not touch.
 */
export const stripIds = (notes: string): string =>
  notes
    .split('\n')
    .map((line) => {
      const stripped = line.replace(ID_IN_PARENS, '').replace(ID_LOOSE, '')
      if (stripped === line) return line
      return stripped
        .replace(/\(\s*\)/g, '')
        .replace(/ {2,}/g, ' ')
        .replace(/ ([,.;:])/g, '$1')
        .trimEnd()
    })
    .join('\n')

/** One line of the ledger: a record the assistant was shown. */
export type LedgerEntry = { readonly id: string; readonly label: string }

const isRecordLike = (value: unknown): value is { id: string; label: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { label?: unknown }).label === 'string'

/**
 * Every object with a string `id` and a string `label` in `value`, in
 * document order, collected into `into` by first-seen id.
 *
 * Document order matters: a `memory.get` result is `{ record, related }`, so
 * the record comes before the things joined to it, and a list is `matches` in
 * the order the tool ranked them. Arrays need no branch of their own:
 * `Object.values` yields their items in index order.
 */
function collect(value: unknown, into: Map<string, string>): void {
  if (typeof value !== 'object' || value === null) return
  if (isRecordLike(value) && !into.has(value.id)) into.set(value.id, value.label)
  for (const inner of Object.values(value)) collect(inner, into)
}

/**
 * The records named in a prose result, one per line, collected into `into`.
 *
 * `renderOutcome` writes a write's result as `title — description (id:
 * result)` — "Note saved — Stripe — Systems Engineer (id: note:0193c)" — and
 * only when the result was a string, so a line without that tail names no
 * record and contributes nothing. The label is the leading text, trimmed and
 * cut at `PROSE_LABEL_CHARS`. Only whole lines: the tail is anchored at the
 * end, so an id mentioned mid-sentence is not a record this tool returned.
 */
function collectProse(text: string, into: Map<string, string>): void {
  for (const line of text.split('\n')) {
    const match = PROSE_RECORD.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) continue
    if (!into.has(match[2])) into.set(match[2], match[1].trim().slice(0, PROSE_LABEL_CHARS))
  }
}

/**
 * The records that appeared in the tool results of `dropped`.
 *
 * Deduped by id in first-seen order — a record listed at turn two and read
 * again at turn nine is one entry, placed where it first appeared. A JSON
 * result is walked for `{ id, label }` objects; anything else is read as
 * prose for `renderOutcome`'s `(id: …)` tail, so a record the assistant
 * CREATED enters the ledger too (see the file comment for what its absence
 * cost). A result that is neither — "Rice University — Interview", an error
 * line — contributes nothing and never throws: the ledger is a courtesy,
 * and a compaction must not fail because one tool answered in prose.
 */
export const recordsIn = (dropped: readonly ChatMessage[]): readonly LedgerEntry[] => {
  const seen = new Map<string, string>()
  for (const message of dropped) {
    if (message.role !== 'tool') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(message.content)
    } catch {
      collectProse(message.content, seen)
      continue
    }
    collect(parsed, seen)
  }
  return [...seen].map(([id, label]) => ({ id, label }))
}

/**
 * The heading as written now, and as round two wrote it.
 *
 * Round two's heading was 59 characters, and at a small budget the ledger's
 * third could not hold it plus one uuid entry: heading 59 + a 59-character
 * entry = 118 > floor(328 / 3) = 109, so Gemma's vault case dropped all four
 * of its records at turn four. The line explains itself well enough in 26.
 * Stored contexts still carry the old heading, so it is parsed as well as
 * the new one (`split`) and rewritten on the next render.
 */
const LEDGER_PREFIX = `${LEDGER_HEADING} (ids exact): `
const LEDGER_PREFIX_ROUND_TWO = `${LEDGER_HEADING} (in tool results no longer shown; ids exact): `
const LEDGER_PREFIXES = [LEDGER_PREFIX, LEDGER_PREFIX_ROUND_TWO] as const

/**
 * One entry as it reads on the line. Whitespace folded and the separator
 * removed from the label, so the line parses back into the same entries
 * (`ledgerIn`) whatever a person named their organisation.
 */
const entryText = (entry: LedgerEntry): string =>
  `${entry.label.replace(/\s+/g, ' ').replace(/;/g, ',').trim()} (${entry.id})`

/**
 * The ledger line, fitted to `room` characters by whole entries.
 *
 * Never cut mid-entry: half an id is worse than no id, because a model will
 * complete it. Entries are dropped from the END, so what survives a tight
 * room is what was seen first — the turn-two record the person meant, not
 * the fortieth match of the last list. `room` absent means no budget, and
 * the cap is `LEDGER_ENTRIES_UNBUDGETED`. The empty string when nothing fits,
 * so a heading never stands alone.
 */
export function ledgerLine(entries: readonly LedgerEntry[], room?: number): string {
  const kept: string[] = []
  let length = LEDGER_PREFIX.length
  for (const entry of entries) {
    if (room === undefined && kept.length >= LEDGER_ENTRIES_UNBUDGETED) break
    const text = entryText(entry)
    const grown = length + text.length + (kept.length === 0 ? 0 : 2)
    if (room !== undefined && grown > room) break
    kept.push(text)
    length = grown
  }
  return kept.length === 0 ? '' : `${LEDGER_PREFIX}${kept.join('; ')}`
}

/**
 * A stored summary split into the model's notes and the harness's ledger.
 *
 * The ledger is the LAST line and starts with the heading — this round's or
 * round two's, which stored contexts still carry; anything else is notes.
 * `ledgerIn` parses the entries back so a second compaction can merge them
 * into its own ledger rather than showing them to a model to copy.
 */
const split = (summary: string): { notes: string; ledger: string } => {
  const at = Math.max(...LEDGER_PREFIXES.map((prefix) => summary.lastIndexOf(`\n${prefix}`)))
  if (at >= 0) return { notes: summary.slice(0, at), ledger: summary.slice(at + 1) }
  if (LEDGER_PREFIXES.some((prefix) => summary.startsWith(prefix)))
    return { notes: '', ledger: summary }
  return { notes: summary, ledger: '' }
}

/**
 * The entries of a ledger line, in order. Empty when there is no line.
 *
 * `label (id)` pairs separated by `; `. A label may itself hold parentheses —
 * "Stripe (Payments)" — so the id is the LAST parenthesised token before the
 * separator, and `entryText` keeps `;` out of labels so the separator is
 * unambiguous.
 */
export const ledgerIn = (summary: string): readonly LedgerEntry[] => {
  const { ledger } = split(summary)
  if (ledger === '') return []
  const prefix = LEDGER_PREFIXES.find((candidate) => ledger.startsWith(candidate)) ?? ''
  const entries: LedgerEntry[] = []
  for (const part of ledger.slice(prefix.length).split('; ')) {
    const match = /^(.*) \(([^()]+)\)$/.exec(part)
    if (match?.[1] !== undefined && match[2] !== undefined)
      entries.push({ label: match[1], id: match[2] })
  }
  return entries
}

/**
 * `first` then `then`, deduped by id in first-seen order.
 *
 * The earlier ledger goes first: its records were seen before this prefix's
 * were, and "first-seen" is the order that keeps the record the person
 * established at turn two when the room runs out.
 */
const merged = (
  first: readonly LedgerEntry[],
  then: readonly LedgerEntry[],
): readonly LedgerEntry[] => {
  const seen = new Map<string, string>()
  for (const entry of [...first, ...then]) if (!seen.has(entry.id)) seen.set(entry.id, entry.label)
  return [...seen].map(([id, label]) => ({ id, label }))
}

/**
 * The line between one compaction's notes and the next one's.
 *
 * The notes are append-only (see the file comment), so a stored summary is one
 * section per compaction, oldest first, and this is both the join and the parse
 * — it has to round-trip, so it is a whole line and nothing a model writes.
 *
 * It says which way the sections point, because the note's READER is the
 * assistant on the next turn: two sections that disagree — the person corrected
 * something between them — are not a contradiction if it knows which is later.
 */
export const SECTION_MARK = '——— later, and superseding the above ———'

const SECTION_JOIN = `\n${SECTION_MARK}\n`

/** The sections of `notes`, oldest first. Empty for empty notes. */
const sectionsIn = (notes: string): readonly string[] =>
  notes === '' ? [] : notes.split(SECTION_JOIN)

/**
 * The notes fitted to `room` by dropping WHOLE sections from the front.
 *
 * The oldest goes first, which is the one trade append-only makes: a fact is
 * kept as it was written or dropped, never rewritten into a wrong one. Only
 * when a single section is still too big is anything cut mid-notes, and then it
 * is the newest section's tail — the headings are in a fixed order with the
 * person's facts first, so a tail cut loses the least.
 */
const fitSections = (notes: string, room: number): string => {
  const sections = sectionsIn(notes)
  for (let from = 0; from < sections.length; from += 1) {
    const kept = sections.slice(from).join(SECTION_JOIN)
    if (kept.length <= room) return kept
  }
  /*
   * `from === 0` above is the whole of the notes, so reaching here means not
   * even the newest section fits. It needs no guard for a room of zero or less:
   * a room that small is one the ledger took, which only happens when there are
   * no notes at all — and no sections means no last one, so this is `''` before
   * the slice ever sees the number. Two guards stood here and mutation showed
   * both were dead: `room <= 0` and a fast path for notes that already fit.
   */
  const cut = (sections.at(-1) ?? '').slice(0, room)
  /*
   * Back to the last line break, so a cut never leaves half a fact standing.
   * MEASURED once in 130 notes (GPT-OSS, long-recall-early-fact): a section
   * ended "- Application record: Assistan", which a reader cannot tell from a
   * complete line and a model will finish for itself. A single line too long
   * for the room is kept as the slice — there is no boundary to fall back to,
   * and the headings are ordered facts-first so what it holds is the most
   * worth keeping.
   */
  const boundary = cut.lastIndexOf('\n')
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()
}

/**
 * The share of a budget the ledger may take: a third, in whole entries.
 *
 * A third because the four-heading notes need the rest to say anything, and
 * because forty ids at ~30 characters each fill a third of the ordinary
 * 2,600-character share exactly — the whole of a list page, and no more.
 */
const ledgerRoom = (budget: number): number => Math.floor(budget / 3)

/**
 * What the summariser is asked to write, in characters: what the notes' room
 * has left once the earlier sections have had theirs, and never under a third.
 *
 * A model told the whole notes room writes to it, and a section that fills the
 * room evicts every section before it — which would make an append-only chain
 * one section long and lose more than the rewriting it replaced. So the ask
 * shrinks as the earlier notes grow. The floor of a third is what stops the
 * opposite failure, a chain so full that nothing new can ever be recorded: past
 * that point the newest section takes its third and the oldest are dropped.
 *
 * Measured 2026-09-06 over 108 summaries: the median summary was 0.41 of its
 * budget and none exceeded it, so on the ordinary shape this asks for what the
 * models were already writing and drops nothing.
 */
const sectionRoom = (budget: number, carried: string): number => {
  const notes = budget - ledgerRoom(budget)
  const taken = carried === '' ? 0 : carried.length + SECTION_JOIN.length
  return Math.max(notes - taken, Math.floor(notes / 3))
}

/**
 * Notes and ledger fitted into `budget`: a third RESERVED for the ledger, and
 * everything the notes do not use given back to it.
 *
 * The ledger is deterministic, holds the ids, and is the half of a note a
 * model can act on; the notes are the model's and can be cut. So the ledger's
 * third is a floor rather than a ceiling, and the order is: reserve no more
 * than the ledger could actually use, fit the notes by whole sections into
 * what is left, then give the ledger the rest. Absent a budget nothing is cut
 * except the ledger's forty-entry cap.
 *
 * The third was a ceiling until 2026-09-06, and it cost the thing the ledger
 * exists for. MEASURED over 130 notes on three models: the median summary uses
 * 0.41 of the room it is given and none has ever exceeded it, so a quarter of
 * every budget was being thrown away — the ledger fell to a mean of 2.94
 * entries a note where it had carried 5.87, and GPT-OSS's
 * long-chain-across-a-summary went from five ids to one and then re-created
 * the keyword it already had (`wrote-on-a-question`, both runs). What the
 * notes leave is exactly what the ledger should have.
 *
 * With NO notes the ledger gets the whole budget. The third exists to leave
 * the notes room to say something; where there are no notes it only threw ids
 * away — and that is precisely the under-the-floor case, where the ledger is
 * the entire summary. At the 112-character budget measured on
 * long-vault-convention turn 4, a third is 37 and the heading alone is 26, so
 * not one entry fitted.
 */
function fit(notes: string, entries: readonly LedgerEntry[], budget: number | undefined): string {
  if (budget === undefined) {
    return [fitSections(notes, notes.length), ledgerLine(entries)]
      .filter((part) => part !== '')
      .join('\n')
  }
  /*
   * Reserved: what the ledger could use, and never more than its third. Taking
   * the third unconditionally would shorten the notes on behalf of ids that do
   * not exist — a conversation whose evicted results carried two records would
   * have lost a third of its notes to a 90-character line.
   */
  const whole = ledgerLine(entries)
  const reserved = whole === '' ? 0 : Math.min(whole.length + 1, ledgerRoom(budget))
  const kept = fitSections(notes, budget - reserved)
  const ledger = ledgerLine(entries, budget - (kept === '' ? 0 : kept.length + 1))
  return [kept, ledger].filter((part) => part !== '').join('\n')
}

/**
 * The line that says where the verbatim exchange still is.
 *
 * jojo keeps every thread in the graph, and `memory.get` on a thread's id
 * returns its `entries` in full. A model that needs a detail the summary left
 * out can read it rather than guess — Copilot names the pre-compaction
 * transcript in its summary for the same reason. Without a `ThreadRef` there
 * is no line, because the alternative is an id nobody can read.
 */
const pointer = (thread: ThreadRef): string =>
  `The full earlier exchange is ${thread.title === undefined ? 'the conversation' : `the conversation "${thread.title}"`} with id ${thread.id}; memory.get on that id reads it back if a detail is needed.`

/** What `asMessage` puts AROUND the summary: the label, and the pointer. */
const NOTE_PREFIX = 'Earlier in this conversation (summarised, not verbatim): '

/**
 * The budget for the summary TEXT: the caller's budget less that wrapper.
 *
 * The caller's number is the room the fitted request actually left, so it is
 * the room for the whole placed MESSAGE. The wrapper is 57 characters of label
 * and, with a thread, another ~130 of pointer, and it used to be spent outside
 * the budget — which at the small budgets that matter is up to a fifth more
 * room than the fit had left, for a note that is a line of ids and no words.
 * Counted here, once, so `compact` and `asMessage` agree on what fits.
 */
const textBudget = (options: Pick<CompactOptions, 'budget' | 'thread'>): number | undefined =>
  options.budget === undefined
    ? undefined
    : Math.max(
        0,
        options.budget -
          NOTE_PREFIX.length -
          (options.thread === undefined ? 0 : 1 + pointer(options.thread).length),
      )

/**
 * The request to the summariser: what it is asked for, and what it is shown.
 *
 * Takes `Summarisable` and nothing wider — see the type. The budget is put in
 * the prompt as well as enforced afterwards, because a model told its limit
 * writes to it, and one that is merely cut at it loses its last heading. The
 * figure it is told is this SECTION's room (`sectionRoom`): the wrapper and the
 * ledger's third are the harness's, and the earlier sections are already
 * written, so a model told the whole budget would write over all three.
 *
 * `earlier` is NOT shown. It used to be, labelled "carry forward what still
 * matters", and 24.7% of its statements did not survive the carrying — see the
 * file comment. It is kept verbatim by `compact` instead, so there is nothing
 * here for a model to rewrite and nothing for it to repeat.
 */
export function compactionMessages(
  input: readonly Summarisable[],
  options: CompactOptions = {},
): ChatMessage[] {
  const budget = textBudget(options)
  const carried = options.earlier === undefined ? '' : split(options.earlier).notes.trim()
  const limits = [
    budget === undefined
      ? 'Keep it shorter than what it stands in for.'
      : `At most ${String(sectionRoom(budget, carried))} characters in total.`,
    options.thread === undefined
      ? ''
      : `The full transcript stays readable as record ${options.thread.id}, so leave out anything the assistant could read back and keep what decides its next action.`,
  ]
    .filter((line) => line !== '')
    .join(' ')
  return [
    { role: 'system', content: `${SYSTEM} ${limits}` },
    {
      role: 'user',
      content: `[assistant replies being dropped]\n${input.map(textOf).join('\n')}`,
    },
  ]
}

/**
 * The summary as a message to put where the dropped exchanges were.
 *
 * `system` rather than `assistant`, and the distinction matters: an assistant
 * message is something the model believes it SAID, and a model that reads its
 * own summary as its own prior speech will defend it. A system note is context.
 *
 * Prefixed so it can never be mistaken for verbatim history by a person reading
 * the transcript or by a model reading the prompt. The pointer is appended
 * HERE, not stored: the thread keeps the raw summary, and a stored pointer
 * would be fed back to the next summariser as part of `earlier`, which is the
 * same doubling the prefix used to suffer.
 *
 * Cut to the budget the same way `compact` cuts — ledger reserved, oldest
 * sections dropped — because a stored summary placed under a smaller budget on
 * a later turn used to lose its tail, and the tail is where the ids are. The
 * budget it is cut to is `textBudget`: what is left of the caller's number once
 * this wrapper has been paid for out of it.
 */
export const asMessage = (
  summary: string,
  options: Pick<CompactOptions, 'budget' | 'thread'> = {},
): ChatMessage => {
  const trimmed = summary.trim()
  const body = fit(split(trimmed).notes, ledgerIn(trimmed), textBudget(options))
  const where = options.thread === undefined ? '' : ` ${pointer(options.thread)}`
  return { role: 'system', content: `${NOTE_PREFIX}${body}${where}` }
}

export type CompactDeps = {
  /** The summariser's model call. May be a different, smaller model. */
  readonly ask: (messages: readonly ChatMessage[]) => Promise<Turn>
}

/**
 * The summariser's notes on `dropped` — ONE new section — or `null` for every
 * kind of not-working.
 *
 * Not called at all under `MIN_SUMMARY_CHARS`, measured against the budget net
 * of the wrapper, and not for a page with nothing of the assistant's on it:
 * asking a model to summarise an empty page is asking it to invent one. Earlier
 * notes are no longer a reason to call either — they are kept as they were
 * written, so a page with nothing new on it has nothing to write.
 */
async function notesFor(
  { ask }: CompactDeps,
  dropped: readonly ChatMessage[],
  options: CompactOptions,
): Promise<string | null> {
  const budget = textBudget(options)
  if (budget !== undefined && budget < MIN_SUMMARY_CHARS) return null
  const input = summarisable(dropped)
  if (input.length === 0) return null
  let turn: Turn
  try {
    turn = await ask(compactionMessages(input, options))
  } catch {
    return null
  }
  if (!turn.ok || turn.text === null) return null
  // An empty reply is refused by `fit`, which keeps no empty part. Ids come
  // out first: they belong to the ledger, and the notes are the only place a
  // wrong one can enter (`stripIds`). The length rules then measure what is
  // actually kept, not what the model sent.
  const text = stripIds(turn.text.trim()).trim()
  /*
   * Longer than what it replaces is refused outright, not cut down.
   *
   * A summary cannot be longer than what it stands in for without inventing
   * or padding, and cutting such a reply at the budget would keep the front
   * of something already wrong. The caller falls back to a plain trim, which
   * costs detail and never costs truth. See `replacedBy` for why the measure
   * is the evicted prefix and not the summariser's input.
   *
   * With one allowance, `MIN_SUMMARY_CHARS`: the four headings are a fixed
   * cost every summary pays before it says anything, so a prefix smaller than
   * that cannot be summarised in fewer characters than it replaces however
   * good the notes. Measured (GPT-OSS, long-profile-then-applications, run 1
   * turn 3, 2026-09-05): a three-message prefix — one `profile.background.add`
   * whose arguments and reply came to about 260 characters — drew a 398-char
   * summary carrying both facts, refused here against 260, the call paid for
   * and the person told the messages were "left out".
   */
  if (text.length > Math.max(replacedBy(dropped), MIN_SUMMARY_CHARS)) return null
  /*
   * An empty slot is dropped, and a reply that is nothing but empty slots is
   * no reply at all.
   *
   * "RECORDS ESTABLISHED: none" beside a ledger that names the keyword the
   * assistant just created is not a gap, it is a CONTRADICTION, and a small
   * model resolves it the wrong way: Qwen3 14B wrote exactly that and then
   * answered "I cannot find any applications" without calling anything
   * (long-chain-across-a-summary, both runs, 2026-09-05), and GPT-OSS wrote it
   * on the turn it re-created a keyword whose id its own ledger was carrying
   * (2026-09-06). MEASURED over the 138 notes of the 2026-09-06 endurance run:
   * 38 of them — more than one in four — said "none" under a heading while
   * their own ledger named records, and 299 empty slot lines were stored
   * across the run at about thirty characters each, budget spent to say
   * nothing. The prompt still ASKS for "none" so a skipped heading is
   * visible as a choice rather than an omission; what it buys is checked
   * here and then thrown away.
   */
  const kept = withoutEmptySlots(text)
  return kept === '' ? null : kept
}

const SLOTS_PATTERN = SUMMARY_SLOTS.map((slot) => slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
  '|',
)

/** The heading-and-"none" line a summariser writes for a slot with nothing in it. */
const EMPTY_SLOT = new RegExp(`^(?:${SLOTS_PATTERN}):\\s*none\\.?$`, 'i')

/** A heading that ends at the line break, with whatever it holds on the next line. */
const HEADING_ALONE = new RegExp(`^(?:${SLOTS_PATTERN}):$`, 'i')

/**
 * The notes with every empty slot removed, and nothing else changed.
 *
 * A heading on its own line counts as the head of the line under it, and that
 * is not a nicety. MEASURED on 2026-09-06 over the 108 summaries of the drift
 * run: 6 of them said "none" under all four headings and nothing else,
 * written across two lines by Gemma and GPT-OSS, and every one got past the
 * check this replaces — so exactly the contradiction it exists to prevent was
 * still shipping. Folding the pair into one line is also how a kept two-line
 * slot is stored, which costs a line break and reads the same.
 *
 * Only what it can PROVE empty goes: a slot with anything under it stays, a
 * shape this cannot read (bold headings, prose, a model that answers in one
 * paragraph) stays whole, and "none of the Rice ones" is not "none".
 */
const withoutEmptySlots = (text: string): string => {
  const lines: string[] = []
  for (const line of text.split('\n').map((raw) => raw.trim())) {
    if (line === '') continue
    const open = lines.at(-1)
    if (open !== undefined && HEADING_ALONE.test(open)) lines[lines.length - 1] = `${open} ${line}`
    else lines.push(line)
  }
  return lines.filter((line) => !EMPTY_SLOT.test(line)).join('\n')
}

/**
 * Summarise the messages being dropped, or return `null`.
 *
 * `dropped` is the FULL evicted prefix as the loop holds it — the person's
 * turns, the assistant's, and the ORIGINAL tool results. The marking happens
 * here, so a person's turn in it is ignored rather than paraphrased, and the
 * results are walked for the ledger rather than shown to a model.
 *
 * What comes back is the earlier notes with a NEW SECTION appended and the
 * ledger under both, fitted to the budget with the ledger reserved first — so
 * the stored context, and the next turn's `earlier`, carry the ids whatever the
 * model wrote. The earlier notes are copied, not rewritten: see the file
 * comment for the 24.7% of statements that did not survive being rewritten. The
 * ledger is the records in THIS prefix's results plus the ones the earlier
 * summary's ledger already held, so ids accumulate across compactions without a
 * model copying them (and are capped by the third, oldest first).
 *
 * The ledger alone when the model refused, failed, was skipped, or had nothing
 * to summarise: ids recovered without a model are still ids. `null` only when
 * there is nothing at all, and the caller then does a plain trim — which is
 * what it would have done anyway. Compaction improves a long chat; it is never
 * what makes one possible.
 *
 * The RAW summary, not the message: `asMessage` owns the prefix and the
 * pointer. It used to return the message and the loop stored its content, so a
 * twice-compacted conversation carried "Earlier in this conversation
 * (summarised, not verbatim): Earlier in this conversation (…" — a line of
 * boilerplate per compaction inside the thing that exists to stop growth.
 */
export async function compact(
  deps: CompactDeps,
  dropped: readonly ChatMessage[],
  options: CompactOptions = {},
): Promise<string | null> {
  const entries = merged(
    options.earlier === undefined ? [] : ledgerIn(options.earlier),
    recordsIn(dropped),
  )
  // The earlier NOTES, verbatim: an earlier summary that is a ledger alone
  // carries none, and its ids are merged above rather than copied by a model.
  const carried = options.earlier === undefined ? '' : split(options.earlier).notes.trim()
  const fresh = await notesFor(deps, dropped, options)
  const notes = [carried, fresh ?? ''].filter((part) => part !== '').join(SECTION_JOIN)
  const out = fit(notes, entries, textBudget(options))
  return out === '' ? null : out
}
