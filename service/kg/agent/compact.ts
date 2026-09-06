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
 * a plain trim, which is what would have happened anyway. And not at all under
 * `MIN_SUMMARY_CHARS`, where a call could only buy headings.
 */

import type { NodeId } from '../core/model'
import type { ChatMessage, Turn } from '../core/model-server'

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
   * A previous compaction's summary, which the new one supersedes.
   *
   * Passed here rather than as a message so the summariser is told what it is
   * — earlier notes to carry forward, not something anyone said this time.
   * Its ledger line, if it has one, is not shown to the model at all: it is
   * merged into the new ledger by the harness, so the ids survive without a
   * model copying them.
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
  `${SUMMARY_SLOTS[1]}: things DONE — each record the assistant created, found or changed, as name and id; the ids are in the arguments and replies, copy them exactly. A record here is finished work: do not restate it as a request.`,
  `${SUMMARY_SLOTS[2]}: anything the person corrected, declined, or asked the assistant not to touch.`,
  `${SUMMARY_SLOTS[3]}: only what the person asked for that was NOT finished. A request whose record appears under ${SUMMARY_SLOTS[1]} is finished and does not belong here.`,
] as const

const SYSTEM = [
  'You summarise part of a conversation between a person and their job-application assistant, so the assistant can keep working after the earlier messages are dropped.',
  'You are shown the assistant’s own replies and the tools it called, with the arguments it called them with. The person’s messages are not shown: they stay in the conversation verbatim, so do not reconstruct them.',
  'Write notes in the third person under exactly these four headings, in this order, and write "none" under a heading with nothing to record:',
  ...SLOT_GUIDANCE,
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
 * layer stubbed or cut them — plus the earlier notes it supersedes (the
 * notes, not their ledger line: the harness carries that). The person's
 * turns are not counted because they are not replaced: the budget layer
 * carries them verbatim.
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
export const replacedBy = (dropped: readonly ChatMessage[], earlier = ''): number =>
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
  }, earlier.length)

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
 * The share of a budget the ledger may take: a third, in whole entries.
 *
 * A third because the four-heading notes need the rest to say anything, and
 * because forty ids at ~30 characters each fill a third of the ordinary
 * 2,600-character share exactly — the whole of a list page, and no more.
 */
const ledgerRoom = (budget: number): number => Math.floor(budget / 3)

/**
 * Notes and ledger fitted into `budget`, ledger reserved first.
 *
 * The ledger is deterministic and small and holds the ids; the notes are
 * the model's and can be cut. So the ledger gets its third by whole entries,
 * and the notes get what is left, cut at the tail: the headings are in a
 * fixed order with the person's facts first, so a cut loses the tail. Absent
 * a budget nothing is cut except the ledger's forty-entry cap.
 */
function fit(notes: string, entries: readonly LedgerEntry[], budget: number | undefined): string {
  const ledger = ledgerLine(entries, budget === undefined ? undefined : ledgerRoom(budget))
  // Never negative: the ledger is at most a third of the budget.
  const roomForNotes =
    budget === undefined ? notes.length : budget - (ledger === '' ? 0 : ledger.length + 1)
  const kept = notes.slice(0, roomForNotes).trimEnd()
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

/**
 * The request to the summariser: what it is asked for, and what it is shown.
 *
 * Takes `Summarisable` and nothing wider — see the type. The budget is put in
 * the prompt as well as enforced afterwards, because a model told its limit
 * writes to it, and one that is merely cut at it loses its last heading. The
 * budget it is told is the NOTES' share — the ledger's third is taken by the
 * harness, so a model told the whole figure would write over it.
 *
 * `earlier` is shown without its ledger line: those ids are merged into the
 * new ledger by the harness, and a model shown them copies them under
 * RECORDS ESTABLISHED, where the appended ledger then repeats them.
 */
export function compactionMessages(
  input: readonly Summarisable[],
  options: CompactOptions = {},
): ChatMessage[] {
  const limits = [
    options.budget === undefined
      ? 'Keep it shorter than what it stands in for.'
      : `At most ${String(options.budget - ledgerRoom(options.budget))} characters in total.`,
    options.thread === undefined
      ? ''
      : `The full transcript stays readable as record ${options.thread.id}, so leave out anything the assistant could read back and keep what decides its next action.`,
  ]
    .filter((line) => line !== '')
    .join(' ')
  const notes = options.earlier === undefined ? '' : split(options.earlier).notes
  const earlier =
    notes === ''
      ? ''
      : `[earlier summary, superseded by yours — carry forward what still matters]\n${notes}\n\n`
  return [
    { role: 'system', content: `${SYSTEM} ${limits}` },
    {
      role: 'user',
      content: `${earlier}[assistant replies being dropped]\n${input.map(textOf).join('\n')}`,
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
 * Cut to the budget the same way `compact` cuts — ledger reserved, notes
 * shortened — because a stored summary placed under a smaller budget on a
 * later turn used to lose its tail, and the tail is where the ids are.
 */
export const asMessage = (
  summary: string,
  options: Pick<CompactOptions, 'budget' | 'thread'> = {},
): ChatMessage => {
  const { notes } = split(summary.trim())
  const body = fit(notes, ledgerIn(summary.trim()), options.budget)
  const where = options.thread === undefined ? '' : ` ${pointer(options.thread)}`
  return {
    role: 'system',
    content: `Earlier in this conversation (summarised, not verbatim): ${body}${where}`,
  }
}

export type CompactDeps = {
  /** The summariser's model call. May be a different, smaller model. */
  readonly ask: (messages: readonly ChatMessage[]) => Promise<Turn>
}

/**
 * The summariser's notes on `dropped`, or `null` for every kind of not-working.
 *
 * Not called at all under `MIN_SUMMARY_CHARS`, and not for a page with nothing
 * of the assistant's on it and no earlier notes: asking a model to summarise an
 * empty page is asking it to invent one.
 */
async function notesFor(
  { ask }: CompactDeps,
  dropped: readonly ChatMessage[],
  options: CompactOptions,
): Promise<string | null> {
  const input = summarisable(dropped)
  if (options.budget !== undefined && options.budget < MIN_SUMMARY_CHARS) return null
  // The earlier NOTES: an earlier summary that is a ledger alone carries no
  // notes to supersede, and its ids are merged by the harness, not the model.
  const carried = options.earlier === undefined ? '' : split(options.earlier).notes
  if (input.length === 0 && carried === '') return null
  let turn: Turn
  try {
    turn = await ask(compactionMessages(input, options))
  } catch {
    return null
  }
  if (!turn.ok || turn.text === null) return null
  // An empty reply is refused by `fit`, which keeps no empty part.
  const text = turn.text.trim()
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
  if (text.length > Math.max(replacedBy(dropped, carried), MIN_SUMMARY_CHARS)) return null
  /*
   * Four headings with "none" under each are not notes, and they are worse
   * than no notes: "RECORDS ESTABLISHED: none" placed beside a ledger that
   * names the keyword the assistant just created is a contradiction the model
   * has to resolve, and a small one resolves it the wrong way. Qwen3 14B wrote
   * exactly that for a 19-message prefix holding a `keyword.create` and a
   * listing (long-chain-across-a-summary, both runs, 2026-09-05) and then
   * answered "I cannot find any applications" without calling anything.
   * Discarded, so the ledger — which does name them — stands alone.
   */
  return isEmptyNotes(text) ? null : text
}

/** The heading-and-"none" line a summariser writes for a slot with nothing in it. */
const EMPTY_SLOT = new RegExp(
  `^(?:${SUMMARY_SLOTS.map((slot) => slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}):\\s*none\\.?$`,
  'i',
)

/**
 * Whether notes say "none" under every heading and nothing else.
 *
 * Every non-blank line has to be an empty slot, and there has to be at least
 * one: a reply that says anything at all under any heading is kept, and a
 * reply in a shape this cannot read (bold headings, prose) is kept too — the
 * check refuses only what it can prove empty.
 */
const isEmptyNotes = (text: string): boolean => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.length > 0 && lines.every((line) => EMPTY_SLOT.test(line))
}

/**
 * Summarise the messages being dropped, or return `null`.
 *
 * `dropped` is the FULL evicted prefix as the loop holds it — the person's
 * turns, the assistant's, and the ORIGINAL tool results. The marking happens
 * here, so a person's turn in it is ignored rather than paraphrased, and the
 * results are walked for the ledger rather than shown to a model.
 *
 * What comes back is the model's notes with the ledger appended, fitted to the
 * budget with the ledger reserved first — so the stored context, and the next
 * turn's `earlier`, carry the ids whatever the model wrote. The ledger is the
 * records in THIS prefix's results plus the ones the earlier summary's ledger
 * already held, so ids accumulate across compactions without a model copying
 * them (and are capped by the third, oldest first).
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
  const notes = await notesFor(deps, dropped, options)
  const out = fit(notes ?? '', entries, options.budget)
  return out === '' ? null : out
}
