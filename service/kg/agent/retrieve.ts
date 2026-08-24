/**
 * Choosing which tools to offer, from what the person actually asked. L3.
 *
 * The Assistant offers the WHOLE catalog on every request — comfortably over
 * fifteen thousand tokens before anybody has typed anything. That is survivable
 * on a large window and fatal on a small one, and either way it asks a model to
 * pick one name out of eighty-odd when the question was "add a reminder for
 * Thursday". This narrows it, using the graph in `tool-graph.ts` so that
 * narrowing can never hand the model a chain it cannot finish.
 *
 * Deliberately no exact count anywhere below. The registry grows, and a comment
 * carrying a number goes stale silently — this one said 82 and was wrong within
 * a day.
 *
 * ## The safety property, which everything else is subordinate to
 *
 * **It may only ever remove tools it is confident about, and when it is not
 * confident it removes nothing.** `select` returns `null` — meaning "offer
 * everything" — for any message it does not understand. A retriever that
 * guesses wrong costs a person their answer and gives them no way to tell why;
 * a retriever that abstains costs some tokens. Those are not comparable, so the
 * rule is not a threshold to tune, it is the shape of the thing.
 *
 * This is why there is no cleverness below. Weighted term matching over the
 * tool names, titles and summaries, a floor, and a graph closure. Anything
 * subtler would abstain less often, which is the wrong direction.
 *
 * ## Why it is lexical
 *
 * Because there is no embedding endpoint in this app and adding one means a
 * second model on the user's machine to save tokens off a prefix the server
 * already caches. The corpus is the catalog's own titles and summaries — a few
 * thousand words of deliberately plain English, written for exactly this
 * purpose and kept current by being the same text the model reads.
 *
 * ## Why it runs once per run and not per round
 *
 * `loop.ts` hoists the tool array out of the loop so it is byte-identical on
 * every round, which is what lets a server reuse the prompt prefix. Reselecting
 * each round would move the first difference to the front of the prompt and
 * force a full re-read of a growing conversation every time. So the set is
 * chosen once, from the first message, and only ever GROWS after that.
 */

import { CATALOG } from './catalog'
import { READS } from './queries'
import { closeOver } from './tool-graph'

/**
 * The reads, always offered, whatever the question.
 *
 * Most of the catalog needs an id that only a read can produce, and the system
 * prompt tells the model to look before it writes. A narrowed set that dropped
 * the reads would make that instruction unfollowable — and they are 1,750
 * tokens, the cheapest part of the catalog to keep.
 */
export const RESIDENT: readonly string[] = Object.keys(READS)

/**
 * Words that mean a tool without naming it.
 *
 * This table is the whole recall story and it is unapologetically hand-written.
 * "Rice rejected me" scores zero without it — "reject" appears nowhere in the
 * catalog, because the tool is called `application.stage.set` and its summary
 * talks about stages. Every entry here is a word a person would plausibly use
 * for something the catalog spells differently.
 *
 * Each family needs a test fixture, so deleting one fails loudly rather than
 * quietly costing recall.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  reject: ['stage', 'application'],
  rejected: ['stage', 'application'],
  offer: ['stage', 'application'],
  interview: ['stage', 'timeline', 'application'],
  applied: ['stage', 'application'],
  job: ['application', 'posting'],
  role: ['application'],
  cv: ['file', 'vault'],
  resume: ['file', 'vault'],
  pdf: ['file', 'vault'],
  doc: ['file', 'vault'],
  document: ['file', 'vault'],
  remind: ['timeline', 'reminder'],
  reminder: ['timeline'],
  deadline: ['timeline'],
  calendar: ['timeline'],
  due: ['timeline'],
  tag: ['keyword'],
  label: ['keyword'],
  bookmark: ['link', 'vault'],
  url: ['link'],
  template: ['snippet'],
  draft: ['snippet'],
  note: ['snippet', 'application'],
  search: ['scout', 'pipeline'],
  board: ['scout', 'posting'],
  profile: ['profile'],
  wipe: ['memory'],
  reset: ['memory'],
  clear: ['memory'],
  delete: ['delete'],
  remove: ['delete'],
}

/** Words that carry no signal about a tool. */
const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'was', 'were', 'are',
  'you', 'your', 'can', 'please', 'would', 'could', 'should', 'about', 'into', 'onto', 'when',
  'what', 'which', 'who', 'why', 'how', 'all', 'any', 'some', 'get', 'got', 'put', 'set',
  'make', 'made', 'need', 'want', 'like', 'just', 'now', 'then', 'there', 'here', 'out',
  'add', 'new', 'one', 'two', 'also', 'but', 'not', 'its', 'it', 'my', 'me', 'i',
])

/**
 * A message, as scorable terms.
 *
 * Two details here are load-bearing and both were found by a message that
 * should have narrowed and did not.
 *
 * **Aliases are looked up on the RAW word, before the length filter**, because
 * "cv" and "pdf" are the two- and three-letter words that matter most and a
 * filter running first would drop them.
 *
 * **And on the singular too.** "What CVs do I have" produces "cvs", which is
 * not in the table — so the whole message scored zero and the retriever
 * abstained on one of the clearest requests it will ever see. A plural is not
 * an edge case in a sentence about records; it is how people talk about them.
 * The fold is applied at three letters and up for the alias lookup, but the
 * BARE term still only folds past four, because "has" and "its" folding to
 * "ha" and "it" would be noise scored against the catalog.
 */
export function terms(message: string): Set<string> {
  const words = message.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const out = new Set<string>()
  for (const word of words) {
    const singular = word.length > 2 && word.endsWith('s') ? word.slice(0, -1) : word
    for (const alias of ALIASES[word] ?? ALIASES[singular] ?? []) out.add(alias)
    if (word.length < 3 || STOP.has(word)) continue
    out.add(word)
    if (word.length > 4) out.add(singular)
  }
  return out
}

/**
 * How strongly each term points at each tool.
 *
 * Built once at module load and costing nothing at request time. A term in a
 * tool's NAME is worth more than one in its title, which is worth more than one
 * in its summary — the name is what the tool is, the summary is prose around it.
 */
const INDEX: ReadonlyMap<string, ReadonlyMap<string, number>> = (() => {
  const out = new Map<string, Map<string, number>>()
  const add = (term: string, tool: string, weight: number) => {
    const row = out.get(term) ?? new Map<string, number>()
    row.set(tool, Math.max(row.get(tool) ?? 0, weight))
    out.set(term, row)
  }
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  for (const entry of CATALOG) {
    for (const word of entry.name.split('.')) add(word.toLowerCase(), entry.name, 3)
    for (const word of words(entry.title)) add(word, entry.name, 2)
    for (const word of words(entry.summary)) add(word, entry.name, 1)
  }
  return out
})()

/** Below this, a match is noise. */
const SEED_FLOOR = 3
/** A tool this strongly matched brings its whole domain — `vault.*`, `scout.*`. */
const DOMAIN_LIFT = 6

/** The domain half of a registry name: `vault.file.add` -> `vault`. */
const domainOf = (name: string) => name.split('.')[0] ?? name

/**
 * The tools a message points at, or null when it points at nothing clearly.
 *
 * Null is not a failure and is not rare — "hello", "thanks", and any message
 * that refers to earlier context by pronoun all land here. It means offer
 * everything, which is what this app did before this file existed, so the worst
 * case is exactly the old behaviour.
 */
export function select(message: string): Set<string> | null {
  const wanted = terms(message)
  if (wanted.size === 0) return null

  const scores = new Map<string, number>()
  for (const term of wanted) {
    for (const [tool, weight] of INDEX.get(term) ?? []) {
      scores.set(tool, (scores.get(tool) ?? 0) + weight)
    }
  }

  let best = 0
  for (const score of scores.values()) best = Math.max(best, score)
  if (best < SEED_FLOOR) return null

  const seed = new Set<string>()
  const domains = new Set<string>()
  for (const [tool, score] of scores) {
    if (score >= SEED_FLOOR) seed.add(tool)
    if (score >= DOMAIN_LIFT) domains.add(domainOf(tool))
  }
  // A strongly matched tool brings its neighbours: somebody asking about files
  // usually wants more than the one file verb their words happened to hit.
  for (const entry of CATALOG) if (domains.has(domainOf(entry.name))) seed.add(entry.name)

  return seed
}

/**
 * The two operations a narrowed set must never quietly include.
 *
 * `memory.reset` and `memory.clear` replace or empty the whole store. They are
 * not the only writes outside the journal — `assistant.thread.set` is
 * `undoable: false` too — but they are the only ones that are also DESTRUCTIVE,
 * which is the property that matters here: the others lose bookkeeping, these
 * lose the person's records. They are also ROOTS, callable with no id at all,
 * from a standing start.
 *
 * A retriever that keeps every root resident would put both in every prompt
 * forever, which is a safety regression wearing an optimisation's clothes. They
 * are offered only when the person's own words asked for them.
 */
const NEVER_IMPLICIT: readonly string[] = ['memory.reset', 'memory.clear']

/**
 * The full offered set for a run: what was asked for, closed over the graph.
 *
 * `carried` is the set a conversation has already accumulated. It only ever
 * grows — a second question never takes away a tool the first one earned —
 * because the transcript replays earlier tool calls, and offering a set that no
 * longer contains a tool the history shows being called invites the model to
 * call it again and be refused.
 *
 * Returns null for "offer everything", which propagates from `select`.
 */
export function offeredFor(
  message: string,
  carried: ReadonlySet<string> | null,
  /** Names the conversation has already called. Always kept — see above. */
  fromHistory: Iterable<string> = [],
): Set<string> | null {
  const picked = select(message)
  if (picked === null) {
    // Abstaining. If the conversation already had a narrowed set, keep exactly
    // it — byte-identical, so the prefix cache still hits — rather than widening
    // to everything and throwing the cache away on "thanks".
    if (carried === null) return null
    const kept = new Set(carried)
    for (const name of fromHistory) kept.add(name)
    return kept
  }

  const asked = new Set(picked)
  const out = closeOver(asked)
  for (const name of RESIDENT) out.add(name)
  for (const name of carried ?? []) out.add(name)
  for (const name of fromHistory) out.add(name)
  // Stripped unless the person's own words seeded them.
  for (const name of NEVER_IMPLICIT) if (!asked.has(name)) out.delete(name)
  return out
}

/**
 * The set in catalog order, so equal sets serialise identically.
 *
 * A `Set`'s iteration order is insertion order, and two runs that chose the
 * same tools by different routes would otherwise produce different arrays — and
 * therefore a different prompt prefix, and therefore a cache miss for no reason.
 */
export const inCatalogOrder = (names: ReadonlySet<string>): string[] =>
  CATALOG.filter((e) => names.has(e.name)).map((e) => e.name)
