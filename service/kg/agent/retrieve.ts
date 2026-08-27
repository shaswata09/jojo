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

import { CATALOG, toWireName } from './catalog'
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
/**
 * Prototype-less, and that is load-bearing rather than tidy.
 *
 * A plain object literal inherits from `Object.prototype`, so `ALIASES['constructor']`
 * returns a FUNCTION rather than undefined. The `??` fallback below never fires
 * on it, and iterating a function throws `TypeError: function is not iterable` —
 * out of `terms()`, out of the retriever, and into the bare promise that drives
 * an agent run, where nothing catches it and the thread spins forever.
 *
 * "How did the constructor round go" is an ordinary sentence for the people this
 * app is built for. `toString`, `valueOf` and the rest are safe only by accident
 * of lower-casing; `constructor` is already lower case.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = Object.assign(Object.create(null), {
  /*
   * The person's own words for their own background.
   *
   * These map onto the enum values `profile.background.add` already declares —
   * `education`, `publication`, `teaching` — rather than onto a tool name, so a
   * renamed or split tool cannot strand them.
   *
   * Measured before they existed: "Record my background: PhD from Rice"
   * selected the tool, on the literal word "background", and "Record that I
   * have an MSc from UT Austin" did not. Both Gemma 3 31B and GPT-OSS 120B then
   * answered that they had no way to create such a record — correct, useless,
   * and the same shape as the failure reported from a real CV import.
   *
   * A degree abbreviation is not derivable from anything in the code. This is
   * the one part of the vocabulary that has to be written down.
   */
  phd: ['education', 'background'],
  msc: ['education', 'background'],
  msee: ['education', 'background'],
  bsc: ['education', 'background'],
  mba: ['education', 'background'],
  doctorate: ['education', 'background'],
  degree: ['education', 'background'],
  graduated: ['education', 'background'],
  paper: ['publication', 'background'],
  preprint: ['publication', 'background'],
  taught: ['teaching', 'background'],
  lectured: ['teaching', 'background'],

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
  /*
   * The words people use for a person, none of which was here.
   *
   * `vault.person.create` had no alias at all, so "add Dr Chen as a referee on
   * the Rice application" seeded a set of twenty-four tools that did not include
   * the one it needed, while the barer "add a person" happened to match on the
   * tool's own name and worked. Same request, different phrasing, different
   * outcome — and nothing on screen to say why.
   *
   * `referee`, `recruiter` and `chair` are what this app's users actually write:
   * a search chair and a referee are the two people an academic job search is
   * mostly about, and neither word contains "person".
   */
  person: ['person', 'vault'],
  people: ['person', 'vault'],
  referee: ['person', 'vault'],
  reference: ['person', 'vault'],
  recruiter: ['person', 'vault'],
  contact: ['person', 'vault'],
  chair: ['person', 'vault'],
  supervisor: ['person', 'vault'],
  profile: ['profile'],
  wipe: ['memory'],
  reset: ['memory'],
  clear: ['memory'],
  delete: ['delete'],
  remove: ['delete'],
})

/** Words that carry no signal about a tool. */
const STOP = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'have',
  'has',
  'was',
  'were',
  'are',
  'you',
  'your',
  'can',
  'please',
  'would',
  'could',
  'should',
  'about',
  'into',
  'onto',
  'when',
  'what',
  'which',
  'who',
  'why',
  'how',
  'all',
  'any',
  'some',
  'get',
  'got',
  'put',
  'set',
  'make',
  'made',
  'need',
  'want',
  'like',
  'just',
  'now',
  'then',
  'there',
  'here',
  'out',
  'add',
  'new',
  'one',
  'two',
  'also',
  'but',
  'not',
  'its',
  'it',
  'my',
  'me',
  'i',
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
  const words = message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
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
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  /*
   * Every enum VALUE the tool's own schema declares, at title weight.
   *
   * Derived, not authored — the vocabulary is already in the code, as the
   * closed list the tool accepts. `profile.background.add` takes a `kind` of
   * education, publication, skill, teaching, award, grant, patent and ten more:
   * exactly the words somebody uses to describe the thing they want recorded,
   * and none of them appear in the tool's name, title or summary.
   *
   * The gap was measured, not guessed. "Record my background: PhD from Rice"
   * selected the tool (on the word "background"); "Record my publications"
   * did not, and neither did anything else phrased the way a person phrases it.
   * Both Gemma 3 31B and GPT-OSS 120B then answered, correctly and uselessly,
   * that they had no way to create such a record — the same shape as the
   * failure reported from a real CV import.
   *
   * Weight 2 rather than 1, because an enum value is structured vocabulary the
   * tool guarantees it accepts, not prose that happens to mention a word.
   */
  const enumWords = (schema: unknown, into: Set<string>): void => {
    if (typeof schema !== 'object' || schema === null) return
    if (Array.isArray(schema)) {
      for (const item of schema) enumWords(item, into)
      return
    }
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (key === 'enum' && Array.isArray(value)) {
        for (const option of value) {
          if (typeof option === 'string') for (const word of words(option)) into.add(word)
        }
        continue
      }
      enumWords(value, into)
    }
  }

  for (const entry of CATALOG) {
    for (const word of entry.name.split('.')) add(word.toLowerCase(), entry.name, 3)
    for (const word of words(entry.title)) add(word, entry.name, 2)
    for (const word of words(entry.summary)) add(word, entry.name, 1)
    const fromEnums = new Set<string>()
    enumWords(entry.parameters, fromEnums)
    for (const word of fromEnums) add(word, entry.name, 2)
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
/**
 * Whether the person asked to wipe the whole store, in their own words.
 *
 * The one gate on `NEVER_IMPLICIT`, and it is deliberately explicit rather than
 * derived from the lexicon. `select` cannot tell "clear the tags off Baylor"
 * from "clear everything": `clear` aliases to the memory domain, name words
 * weigh 3, `SEED_FLOOR` is 3, so `memory.clear` scores the same either way.
 * Measured — before this, that sentence about KEYWORDS put both whole-store
 * wipes in front of the model.
 *
 * So it asks for two things in one sentence: a verb that means erase, and an
 * object that means the whole store. Either alone is ordinary. "Clear the
 * tags", "reset the stage", "delete this application" and "what is in my
 * memory" all have one and not the other, and none of them offers a wipe.
 *
 * Deliberately narrow, and it fails CLOSED. Somebody who means it and phrases
 * it unusually gets a model that does not offer the tool, says so, and can be
 * told again — while Settings has the button with its own confirmation. The
 * other direction ends with an emptied store.
 */
const WIPE_VERB = /\b(clear|wipe|erase|delete|remove|reset|empty|nuke|purge)\b/i
const WHOLE_STORE =
  /\b(everything|all (of )?(my |the )?(records|data|applications|stuff)|the (whole|entire) (store|thing|lot|database)|my (whole|entire) (store|database|history)|start over|start again|from scratch|factory reset)\b/i

/**
 * A kind of record, which a whole-store wipe never names.
 *
 * "Delete everything I wrote in the note on Rice" has the verb and it has
 * "everything", and it is a request about ONE note. Naming a record type is
 * what separates a scoped erase from a total one, and getting this wrong in
 * that direction ends with an emptied store rather than with a model saying it
 * cannot help.
 *
 * `records`, `data` and `stuff` are deliberately absent: "delete all my
 * records" IS the whole store, and they are the words people reach for when
 * they mean it.
 */
const NAMES_A_RECORD =
  /\b(note|notes|application|applications|keyword|keywords|tag|tags|file|files|document|documents|reminder|reminders|snippet|snippets|posting|postings|deadline|deadlines|interview|interviews|calendar|stage|offer|thread|conversation|person|referee)\b/i

export function asksToWipe(message: string): boolean {
  if (NAMES_A_RECORD.test(message)) return false
  return WIPE_VERB.test(message) && WHOLE_STORE.test(message)
}

export const NEVER_IMPLICIT: readonly string[] = ['memory.reset', 'memory.clear']

/**
 * Every tool except the two that empty the store.
 *
 * The set a caller must fall back to when the retriever abstains. `offeredFor`
 * strips `NEVER_IMPLICIT` on the branch where it recognised something — but
 * abstention returns `null`, and the caller's own fallback was
 * `CATALOG.map(e => e.name)`: the WHOLE catalog, both whole-store wipes
 * included.
 *
 * That fired on the first message of every new conversation, because nothing is
 * carried forward yet and an opener like "hi" or "help me tidy this up" matches
 * no seed. So a small model was handed `memory.clear` at exactly the moment it
 * had least context — against a written promise in the guide that those two are
 * "never offered to the assistant unless your own words ask for them".
 *
 * Exported so the fallback is a named thing rather than a expression a caller
 * has to get right, and so a test can assert what is in it.
 */
export const EVERYTHING_SAFE: readonly string[] = CATALOG.map((e) => e.name).filter(
  (name) => !NEVER_IMPLICIT.includes(name),
)

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
/**
 * How many previously-offered tools a turn carries forward.
 *
 * The carry existed for prefix caching: keeping the list byte-identical between
 * turns lets the provider reuse the prompt prefix, and on a small model that is
 * most of the latency. What it did NOT have was a bound — every turn unioned
 * the whole previous set, so a ten-turn session went from 33 schemas to 62,
 * about 11,000 tokens of a 16,000-token window, and the trim in `budget.ts`
 * then had to throw away the CONVERSATION to make room for tools nothing had
 * touched in eight turns.
 *
 * Twelve is chosen against what a turn actually uses: across the whole
 * multi-turn benchmark no conversation called more than four distinct tools in
 * one turn, so twelve is three turns' worth of real reach. Tools the model
 * actually CALLED are carried ahead of ones merely offered.
 */
export const CARRY_LIMIT = 12

export function offeredFor(
  message: string,
  carried: ReadonlySet<string> | null,
  /** Names the conversation has already called. Always kept — see above. */
  fromHistory: Iterable<string> = [],
  /**
   * A better picker's answer, when the caller has one.
   *
   * `retrieve-llm.ts` asks a model which tools a request needs; its picks come
   * in here so they go through exactly the same closure, resident set and
   * `NEVER_IMPLICIT` strip as a lexical pick. Absent means "use the lexicon" —
   * every caller with no model to spend on choosing, and the fallback for every
   * caller that has one and did not get an answer.
   */
  chosen?: ReadonlySet<string> | null,
): Set<string> | null {
  /*
   * A chooser SUPPLEMENTS the lexicon. It never replaces it.
   *
   * Measured, and it cost five conversations: asked to "File CV-2026.pdf under
   * the UT Austin application", the chooser picked `memory.search`,
   * `vault.file.add` and `keyword.attach` — and not `vault.file.update`, which
   * is the tool the task needs. Offered `add` and not `update`, the model did
   * the only thing it could and created a SECOND CV. Gemma scored 30/30 with
   * the lexicon alone and 25/30 with the chooser in its place.
   *
   * That is the failure mode of narrowing by intent: omitting the right tool
   * does not make a model ask, it makes it reach for the nearest wrong one. The
   * lexicon has the opposite weakness — it reads words, so it misses intent —
   * and the two are complementary rather than competing.
   *
   * So: the union when the lexicon recognised something, and the chooser's own
   * picks only when it did not. That keeps the floor at the lexicon's coverage
   * (a superset cannot omit what the lexicon would have offered) and keeps the
   * win where it was largest — an unrecognised first message used to mean
   * "offer all ninety-two".
   */
  const lexical = select(message)
  const picked =
    chosen === undefined
      ? lexical
      : chosen === null
        ? lexical
        : lexical === null
          ? chosen
          : new Set([...lexical, ...chosen])
  /*
   * The wipe decision is made BEFORE the abstention path, because that path
   * returns early and used to skip it entirely.
   *
   * "erase all of my data" is not a sentence the lexicon recognises — no term
   * it indexes — so `select` abstained, `offeredFor` returned null, and the
   * caller fell back to `EVERYTHING_SAFE`, which excludes exactly the two tools
   * the person had just asked for. The person asking most plainly got the
   * answer meant for someone who asked for nothing.
   */
  const wipes = asksToWipe(message)

  if (picked === null) {
    // Abstaining. If the conversation already had a narrowed set, keep exactly
    // it — byte-identical, so the prefix cache still hits — rather than widening
    // to everything and throwing the cache away on "thanks".
    const kept = new Set(carried ?? [])
    for (const name of fromHistory) kept.add(name)
    if (wipes) for (const name of NEVER_IMPLICIT) kept.add(name)
    else
      for (const name of NEVER_IMPLICIT) {
        kept.delete(name)
        kept.delete(toWireName(name))
      }
    // Nothing carried and nothing asked for: genuinely no opinion.
    if (carried === null && !wipes) return null
    return kept
  }

  const asked = new Set(picked)
  const out = closeOver(asked)
  for (const name of RESIDENT) out.add(name)
  /*
   * What was USED comes before what was merely offered, and only `CARRY_LIMIT`
   * of the latter survives. `fromHistory` is what this conversation actually
   * called — what a follow-up is most likely to need again — so it is added
   * without a bound. `carried` is everything ever put in front of the model,
   * which grew without limit and is mostly tools nothing touched.
   */
  for (const name of fromHistory) out.add(name)

  /*
   * Counted in TOOLS, not in spellings.
   *
   * `resolveOffered` in `loop.ts` deliberately puts both `name` and `wireName`
   * into the offered set, so that the enforcement check matches whichever the
   * model sends. That set becomes the next turn's `carried` — so a naive count
   * spent two of twelve slots on one tool, and a turn carried about six.
   *
   * Registry names are the unit here, and both spellings are added together
   * once a tool is chosen.
   */
  let room = CARRY_LIMIT
  for (const name of carried ?? []) {
    const entry = CATALOG.find((e) => e.name === name || e.wireName === name)
    if (entry === undefined) continue
    if (out.has(entry.name)) continue
    if (room <= 0) break
    out.add(entry.name)
    room -= 1
  }
  /*
   * Stripped unless the PERSON'S OWN WORDS asked to wipe the store.
   *
   * This is the third version of this guard and the first one that holds. It
   * tested `asked` (what was picked), which was wrong the moment a model could
   * pick. It then tested `select(message)` — the lexicon on the person's own
   * words — which sounded right and was ALSO wrong, because `select` is not a
   * test of what the person named:
   *
   *   - name words weigh 3 and `SEED_FLOOR` is 3, so the bare term "memory"
   *     matches every `memory.*` tool outright;
   *   - `ALIASES` maps `clear`, `reset` and `wipe` to the memory domain
   *     unconditionally;
   *   - `DOMAIN_LIFT` then pulls in every sibling of any strongly-matched tool.
   *
   * Measured, before this: **"clear the tags off the Baylor application"** — an
   * ordinary request about keywords — offered `memory.clear` AND `memory.reset`
   * to the model. So did "reset the stage on this one back to applied", and so
   * did "what is in my memory". The guide's written promise that these two are
   * offered only when asked for was not true, and the comment here said it was.
   *
   * A general-purpose lexicon cannot make this distinction: "clear" scores the
   * same whether the object is the store or a keyword. So the exemption gets
   * its own explicit test — see `asksToWipe`, which requires a wipe verb AND a
   * whole-store object in the person's own sentence.
   */
  for (const name of NEVER_IMPLICIT) {
    if (wipes) {
      /*
       * ADDED, not merely spared.
       *
       * Sparing them only kept what the lexicon happened to seed, and the
       * lexicon seeds on the word "clear" rather than on the meaning: "clear
       * everything" offered the wipes and "delete all my records" — the same
       * request, different verb — offered nothing, so the person was told no by
       * an accident of phrasing. If their words asked for it, offer it.
       */
      out.add(name)
      continue
    }
    /*
     * BOTH spellings, and that is not belt-and-braces.
     *
     * `fromHistory` carries what the WIRE called — `memory_clear`, underscores
     * — and `inCatalogOrder` matches `wireName` as well as `name`. So deleting
     * only the dotted spelling left the wire one in the set and the offered
     * ARRAY got `memory.clear` back. Reachable without any misbehaviour: ask to
     * clear everything, decline at the approval gate, and the declined call is
     * still in the transcript — so the next unrelated turn re-offers the tool
     * the person just refused.
     */
    out.delete(name)
    out.delete(toWireName(name))
  }
  return out
}

/**
 * The set in catalog order, so equal sets serialise identically.
 *
 * A `Set`'s iteration order is insertion order, and two runs that chose the
 * same tools by different routes would otherwise produce different arrays — and
 * therefore a different prompt prefix, and therefore a cache miss for no reason.
 */
/**
 * The named subset, in catalog order, accepting either spelling.
 *
 * EITHER SPELLING IS THE FIX. This matched `e.name` only — the registry
 * spelling, `vault.person.create` — while `fromHistory` supplies what the WIRE
 * carried, `vault_person_create`. The two never matched, so the clause meant to
 * keep a conversation's own tools available across turns silently dropped every
 * one of them, and a tool used successfully in one turn was gone by the next.
 *
 * It showed up worst with approvals switched off, because a run that never
 * pauses makes more calls per turn, so more names went through the broken door.
 */
export const inCatalogOrder = (names: ReadonlySet<string>): string[] =>
  CATALOG.filter((e) => names.has(e.name) || names.has(e.wireName)).map((e) => e.name)
