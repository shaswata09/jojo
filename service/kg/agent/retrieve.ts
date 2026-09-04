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
 * tool names, titles, summaries, enum values and field names; a floor; a ranked
 * cut; a family lift; and a graph closure. Anything subtler would abstain less
 * often, which is the wrong direction.
 *
 * ## How MUCH it offers, which is the other half of the job
 *
 * Abstention is a safety property and narrowing is a performance one, and for a
 * long time this file only had the first. Measured across the 48 conversations
 * of `bench-conversations.ts`, driving `offeredFor` turn by turn exactly as
 * `bench.test.ts` does, it put a MEAN of 37.9 tools in front of the model per
 * turn — median 34, ninetieth percentile 67, and nine of 99 turns offering the
 * entire catalogue. The published knee for retrieval over a catalogue this size
 * is K=3 (hit rate 85.0% at K=1, 97.1% at K=3, 98.6% at K=10, with precision
 * collapsing from 92.1% to 26.5% across that range), and MCPGauge measured a
 * 9.5% average task-performance decline from tools that are merely ATTACHED and
 * never called — a cost the small models this app runs pay harder than the
 * commercial ones it was measured on.
 *
 * Four changes brought that to a mean of 18.9, median 18, p90 25, max 34, and
 * no turn offering the catalogue, while gold-tool recall went UP from 114/116
 * of the benchmark's own workflow nodes to 116/116:
 *
 *   1. a RANKED seed cut at `SEED_LIMIT`, replacing a flat threshold that
 *      admitted a whole domain for one domain word;
 *   2. a FAMILY lift (`timeline.item.*`) replacing a domain lift (`timeline.*`,
 *      `vault.*` — nineteen tools for one file word);
 *   3. four reads that are earned rather than resident — see `EARNED_READS`;
 *   4. vocabulary for the sentences that scored zero, since scoring zero means
 *      offering everything.
 *
 * `retrieve.test.ts` asserts the sizes with headroom. They are a floor on the
 * property, not a fingerprint of today's catalogue.
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
 * The reads that are ACTIONS, and are therefore asked for rather than assumed.
 *
 * `RESIDENT` used to be every read in `queries.ts` — ten tools in front of the
 * model on every turn, whatever the question, which is a floor no narrowing can
 * get below. Six of those are the graph reads the system prompt's "look before
 * you write" depends on: they are how an id is found, and nearly every write
 * needs one.
 *
 * These four are not that. Opening a document, searching a job board, working
 * out a number, reporting the numbers — each is a thing somebody asks for in
 * words of its own, and none of them produces an id another tool needs, so the
 * closure never has to reach for one. Measured over the benchmark, moving them
 * out cut the mean offered set from 23.4 tools a turn to 18.5 and cost exactly
 * one gold node — `stats.report` on "do referrals do better than the job
 * boards", a comparison question with no analytics word in it, which the
 * `better`/`compare` aliases then recovered.
 *
 * The property they keep is REACHABILITY, not residency, and `retrieve.test.ts`
 * asserts it one tool at a time.
 */
const EARNED_READS: readonly string[] = [
  'vault.file.read',
  'board.search',
  'calc.eval',
  'stats.report',
]

/**
 * The reads that are always offered, whatever the question.
 *
 * Most of the catalog needs an id that only a read can produce, and the system
 * prompt tells the model to look before it writes. A narrowed set that dropped
 * these would make that instruction unfollowable — and they are the cheapest
 * part of the catalog to keep.
 */
export const RESIDENT: readonly string[] = Object.keys(READS).filter(
  (name) => !EARNED_READS.includes(name),
)

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
  /*
   * Withdrawing is a STAGE change, and the app's word for it is an outcome
   * value the person never sees.
   *
   * `OUTCOME_VALUES` in `core/model.ts` has `withdrawn`; the sentence people
   * write is "I am withdrawing from Baylor", and the naive plural fold cannot
   * turn `withdrawing` into `withdrawn`. Measured: that exact sentence abstained
   * — ninety tools offered for a one-field stage change — and so did the
   * follow-up "is there anything left over from that I should deal with",
   * because a conversation whose first turn abstains carries nothing into its
   * second.
   */
  withdraw: ['stage', 'application', 'outcome'],
  withdrawing: ['stage', 'application', 'outcome'],
  withdrew: ['stage', 'application', 'outcome'],
  withdrawal: ['stage', 'application', 'outcome'],
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
  /*
   * The calendar words that carry no calendar word.
   *
   * Every one of these was measured abstaining on the benchmark — the whole
   * catalogue offered, ninety tools, for a sentence about one dated item.
   * "Anything overdue in there?", "I never got to that UT Austin chase and it's
   * a week late — push it out to a week from today", "what is the weather in
   * Houston tomorrow" (out of scope, and it still got ninety tools).
   *
   * `overdue` and `late` are `due` with a judgement attached; `push`,
   * `postpone` and `defer` are what people say instead of `snooze` or
   * `reschedule`, neither of which anybody types. `tomorrow` and `today` are in
   * here because a date is the only thing they can be about, and the cost of
   * being wrong is a handful of timeline tools rather than the catalogue.
   */
  overdue: ['timeline', 'due'],
  late: ['timeline', 'due'],
  upcoming: ['timeline'],
  push: ['timeline', 'snooze'],
  postpone: ['timeline', 'snooze'],
  defer: ['timeline', 'snooze'],
  today: ['timeline'],
  tomorrow: ['timeline'],
  yesterday: ['timeline'],
  /*
   * A month name is a calendar reference and nothing else in this app.
   *
   * "What does the rest of September look like — how much is on?" was the last
   * sentence in the benchmark that scored zero against the whole index, and
   * zero means the entire catalogue: ninety tools for a question about one
   * month of one calendar. There is no way to derive these from the registry —
   * a month is a value, not a word any tool contains — so they are written
   * down, like the degree abbreviations above and for the same reason.
   */
  /*
   * `may` is deliberately absent. It is a modal verb far more often than a
   * month — "may I", "you may", "that may be out of date" — and aliasing it
   * would put the timeline family in front of the model on sentences with no
   * date in them at all.
   */
  january: ['timeline'],
  february: ['timeline'],
  march: ['timeline'],
  april: ['timeline'],
  june: ['timeline'],
  july: ['timeline'],
  august: ['timeline'],
  september: ['timeline'],
  october: ['timeline'],
  november: ['timeline'],
  december: ['timeline'],
  /*
   * `attach`, not just `keyword` — because the noun alone cannot rank.
   *
   * Every one of the seven `keyword.*` tools carries `keyword` as a name word,
   * so the bare alias scored all seven identically at 3 and the ranked seed
   * broke the tie on catalog order: `create`, `rename`, `delete`. Measured on
   * "tag my Stripe application with a new keyword called negotiation" and on
   * "tag the UT Austin application with the keyword I made at the start" —
   * `keyword.attach` is the gold node in both and was in neither offered set,
   * while `keyword.rename` was in both.
   *
   * "Tag X with Y" is the verb `attach` and nothing else in this registry; the
   * word is in that tool's NAME, so pointing at it costs one table entry and
   * lifts the whole keyword family behind it.
   */
  tag: ['keyword', 'attach'],
  label: ['keyword', 'attach'],
  untag: ['keyword', 'detach'],
  bookmark: ['link', 'vault'],
  url: ['link'],
  template: ['snippet'],
  draft: ['snippet'],
  note: ['snippet', 'application'],
  search: ['scout', 'pipeline'],
  board: ['scout', 'posting'],
  /*
   * The analytics vocabulary, none of which is a tool name.
   *
   * `stats.report` is the tool; "what is my reply rate so far" is the question,
   * and it abstained. `rate`, `average` and `percentage` are how a number about
   * the whole store gets asked for, and `stats` appears in no sentence anybody
   * types.
   */
  rate: ['stats', 'report'],
  average: ['stats', 'report'],
  percentage: ['stats', 'report'],
  proportion: ['stats', 'report'],
  /*
   * Comparison is analytics, and `stats.report` is the only tool that can do it
   * honestly.
   *
   * "Do referrals do better than the job boards for me?" — the benchmark's
   * source-comparison case, whose whole point is that six applications cannot
   * separate two sources and only `stats.report` knows that, because it returns
   * `differenceIsReal` per split. Nothing in the sentence says `stats`; `board`
   * aliases to the scout domain and carried the message somewhere else
   * entirely.
   */
  better: ['stats', 'report'],
  worse: ['stats', 'report'],
  compare: ['stats', 'report'],
  comparison: ['stats', 'report'],
  versus: ['stats', 'report'],
  /*
   * A scout IS a pipeline, and the vocabulary does not say so anywhere.
   *
   * The app calls them scouts on screen and `scout.pipeline.*` in the registry,
   * so `scout` alone scores all twelve `scout.*` tools at 3 and the four that
   * are actually pipelines never separate from the eight that are postings and
   * matches. Measured on "which of my job scouts is not actually running":
   * `job` aliases to application and posting, so `scout.posting.*` scored 7 and
   * ranked first, and `scout.pipeline.enable.set` — the gold node for the turn
   * after it, "turn it back on" — was never offered on either turn, because
   * that sentence contains no indexable word at all and can only inherit.
   *
   * `running`, `paused` and `resume` are the words for a pipeline's enabled
   * flag. Nothing in the registry spells it that way: the tool is
   * `scout.pipeline.enable.set` and its title is "Pause or resume a pipeline",
   * so `pause` matches at title weight and `running` matches nothing whatever.
   */
  scout: ['scout', 'pipeline'],
  running: ['pipeline', 'enable'],
  paused: ['pipeline', 'enable'],
  /*
   * NOT `resume`. It is already in this table, meaning a CV — which is what the
   * word means to the people this app is for far more often than "un-pause",
   * and a duplicate key would have silently taken the later of the two.
   * `unpause` and `restart` carry the pipeline sense without the collision.
   */
  unpause: ['pipeline', 'enable'],
  restart: ['pipeline', 'enable'],
  watch: ['pipeline', 'scout'],
  monitor: ['pipeline', 'scout'],
  feed: ['scout', 'match'],
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
    /*
     * And the `-es` plural, which the naive fold turns into a non-word.
     *
     * "Are any of my saved searches switched off?" produces `searches`, folds
     * to `searche`, matches nothing, and the whole message scored zero — so a
     * question about scouts was answered with the entire catalogue. English
     * makes `-es` plurals of exactly the stems this app is full of: searches,
     * matches, pitches, batches. Tried second, so a word that is genuinely a
     * bare `-s` plural still folds the ordinary way first.
     */
    const esSingular = word.length > 4 && word.endsWith('es') ? word.slice(0, -2) : word
    for (const alias of ALIASES[word] ?? ALIASES[singular] ?? ALIASES[esSingular] ?? [])
      out.add(alias)
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

  /*
   * Every FIELD the tool's own schema declares, at title weight.
   *
   * Derived like the enum values above and for the same reason: the field name
   * is the word for the thing being changed, and half the time it appears
   * nowhere else. `application.update` takes a `deadline`; nothing in its name
   * ("Edit application") or its title says so, and the summary mentions it once,
   * at prose weight.
   *
   * Measured on the sentence the benchmark calls its most dangerous —
   * **"Clear the deadline on the Rice assistant professor application"**, whose
   * gold move is `application.update { deadline: null }`. Before this, `clear`
   * aliases to the memory domain and `application` scores every application
   * tool alike, so `application.offer.clear` ranked first and
   * `application.update` — the one tool that can do it — was ranked fourteenth
   * and cut. The field name is the only place in the registry where the word
   * `deadline` is attached to the tool that owns it.
   *
   * `id` and the other structural names cost nothing: the tokeniser drops
   * anything under three letters, and `query`, `limit` and `record` are already
   * ordinary catalog words. What this adds is the domain vocabulary — deadline,
   * stage, colour, url, note — which is what people type.
   */
  const fieldWords = (schema: unknown, into: Set<string>): void => {
    if (typeof schema !== 'object' || schema === null) return
    if (Array.isArray(schema)) {
      for (const item of schema) fieldWords(item, into)
      return
    }
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (
        key === 'properties' &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        for (const field of Object.keys(value)) for (const word of words(field)) into.add(word)
      }
      fieldWords(value, into)
    }
  }

  for (const entry of CATALOG) {
    for (const word of entry.name.split('.')) add(word.toLowerCase(), entry.name, 3)
    for (const word of words(entry.title)) add(word, entry.name, 2)
    for (const word of words(entry.summary)) add(word, entry.name, 1)
    const fromEnums = new Set<string>()
    enumWords(entry.parameters, fromEnums)
    for (const word of fromEnums) add(word, entry.name, 2)
    const fromFields = new Set<string>()
    fieldWords(entry.parameters, fromFields)
    for (const word of fromFields) add(word, entry.name, 2)
  }
  return out
})()

/** Below this, a match is noise. */
const SEED_FLOOR = 3

/**
 * How many tools a message may seed on SCORE ALONE.
 *
 * The published knee, and the single largest change this file has had.
 *
 * Before this, seeding was a flat threshold: every tool at or above
 * `SEED_FLOOR` got in. A tool's own name words weigh 3 and the floor IS 3, so
 * one domain word admitted its whole domain outright — "application" seeded all
 * ten `application.*`, "vault" all nineteen, "timeline" all nine — before any
 * lift or closure ran. Measured over the 48 benchmark conversations that put a
 * MEAN of 37.9 tools in front of the model per turn, median 34, with nine turns
 * offering the entire safe catalogue.
 *
 * The retrieval literature this is taken from measures hit rate against K over
 * a catalogue this size: 85.0% at K=1, 97.1% at K=3, 98.6% at K=10, while
 * precision collapses from 92.1% to 26.5% across that range. K=3 is the knee —
 * nearly all of the recall for a quarter of the noise. MCPGauge measured the
 * other side of it: attaching tools a task never uses costs 9.5% of task
 * performance on its own, and the models this app runs on are smaller than the
 * ones it measured.
 *
 * Five rather than three, and the two extra places are paid for: this seeds
 * REGISTRY tools that are then closed over the graph and joined by `RESIDENT`,
 * so K here is not the offered count — it is the number of guesses allowed
 * before the closure and the reads have their say. Swept over the benchmark at
 * 3, 4, 5, 6 and 8 with everything else fixed: gold-tool recall was 106, 108,
 * 108, 109 and 109 of 116, and mean offered size 24.1, 25.1, 26.1, 27.1 and
 * 28.8. Five is where recall stops paying for size.
 */
const SEED_LIMIT = 5

/**
 * A tool this strongly matched brings its VERB SIBLINGS — not its whole domain.
 *
 * This was `DOMAIN_LIFT`, and a domain is far too coarse a unit: one strong
 * match on `vault.file.add` used to pull in every link, person and snippet tool
 * as well, nineteen in all, because they happen to share a first name segment.
 *
 * The sibling set is the useful one, and the benchmark says why. The misses
 * that a ranked seed introduces are almost all FOLLOW-UP turns naming a
 * different verb on the same noun: "make that the 21st instead" after a
 * reminder was created (`timeline.item.reschedule`), "put that back on my list"
 * after one was ticked off (`timeline.item.reopen`), "turn it back on" after a
 * scout was found paused (`scout.pipeline.enable.set`). None of those sentences
 * carries a term the index knows; they are reachable only because the turn
 * BEFORE them offered the sibling.
 *
 * So the lift is by family — `timeline.item.*`, `scout.pipeline.*`,
 * `application.stage.*` — which is 2 to 9 tools rather than 10 to 19.
 */
const FAMILY_LIFT = 6

/**
 * Where a tool sits in the catalog, for a deterministic tie-break.
 *
 * Built once. A linear `findIndex` per comparison would be O(n log n) scans of
 * a ninety-entry array on every message, for a value that never changes.
 */
const ORDER: ReadonlyMap<string, number> = new Map(CATALOG.map((entry, at) => [entry.name, at]))
const catalogIndex = (name: string) => ORDER.get(name) ?? CATALOG.length

/**
 * The verb family a tool belongs to, as a name PREFIX.
 *
 * `timeline.item.create` -> `timeline.item`; `keyword.attach` -> `keyword`.
 * Two segments where there are three or more, one where there are two, because
 * the second segment is the NOUN — the thing the verb acts on — and a
 * two-segment name has no noun of its own.
 *
 * FIRST TWO, not a prefix walk, and that is what puts the four-segment names
 * where they belong: `scout.pipeline.enable.set` and `timeline.item.remind.set`
 * fold to `scout.pipeline` and `timeline.item`, alongside
 * `scout.pipeline.create` and `timeline.item.create`. Taking the whole name
 * minus its last segment would have left each of them alone in a family of one
 * — no lift at all, on exactly the tools the follow-up turns reach for.
 *
 * And membership is EQUALITY of this fold, not a prefix test. A prefix test
 * makes `application` — the family of `application.create` — swallow
 * `application.stage.set`, `application.offer.clear` and the rest, which is the
 * whole-domain lift this replaced, back again by the side door. Measured: "which
 * of my job scouts is not actually running" seeded fourteen tools that way, ten
 * of them the entire application domain, on a question about scouts.
 */
const familyOf = (name: string): string => {
  const parts = name.split('.')
  return parts.length > 2 ? `${parts[0]}.${parts[1]}` : (parts[0] ?? name)
}

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
      /*
       * The two whole-store wipes never compete for a slot.
       *
       * They are stripped from the offered set at the end of `offeredFor`
       * unless `asksToWipe` said the person's own words asked for them, and
       * they are ADDED there when it did — so their presence here changes
       * nothing about whether they are offered. What it changed was what ELSE
       * was: `clear` and `reset` alias to the memory domain, so "clear the
       * deadline on the Rice application" scored `memory.clear` at 6 — above
       * every application tool — and under a ranked seed that spent one of five
       * places on a tool guaranteed to be deleted three steps later.
       */
      if (NEVER_IMPLICIT.includes(tool)) continue
      scores.set(tool, (scores.get(tool) ?? 0) + weight)
    }
  }

  let best = 0
  for (const score of scores.values()) best = Math.max(best, score)
  if (best < SEED_FLOOR) return null

  /*
   * Ranked, then cut — and ties broken by CATALOG ORDER rather than by
   * whatever order the index happened to build in.
   *
   * A tie at the cut is the common case, not the exception: a bare domain word
   * scores every tool in that domain identically, so which three of ten survive
   * is decided entirely by the tie-break. Catalog order puts the creates and
   * the edits ahead of the duplicates and the recolours, which is the right
   * prior when the words give no other signal — and, being deterministic, it
   * keeps the offered array byte-identical between runs, which is what the
   * prefix cache is built on.
   */
  const ranked = [...scores]
    .filter(([, score]) => score >= SEED_FLOOR)
    .sort((a, b) => b[1] - a[1] || catalogIndex(a[0]) - catalogIndex(b[0]))

  const seed = new Set(ranked.slice(0, SEED_LIMIT).map(([tool]) => tool))

  /*
   * Every term that matched anything keeps its best tool, whatever the rank.
   *
   * A global top-K reads a sentence as one intent, and plenty of these are two.
   * Measured: "add a reminder to tell my referees about it, on the 18th" spent
   * all five ranked places on `vault.person.*` and `vault.link.*`, on the
   * strength of `referees`, and `timeline.item.create` — the other half of the
   * request, and the gold node of the benchmark's `offer-to-timeline`
   * conversation — fell outside the cut. "Read my CV and build my profile" is
   * the same shape with the halves the other way round.
   *
   * One tool per matched term is a bound of the same order as K (a message has
   * a handful of content words), and it is the cheapest possible guarantee that
   * no intent in the sentence is dropped in silence. Over the benchmark it is
   * worth six gold nodes of recall at K=3 (100/116 to 106/116) and one in the
   * configuration that shipped (115/116 to 116/116), for 0.3 tools a turn.
   */
  for (const term of wanted) {
    const row = INDEX.get(term)
    if (row === undefined) continue
    let bestTool: string | null = null
    let bestScore = 0
    for (const tool of row.keys()) {
      const score = scores.get(tool) ?? 0
      if (score < SEED_FLOOR) continue
      if (
        score > bestScore ||
        (score === bestScore && bestTool !== null && catalogIndex(tool) < catalogIndex(bestTool))
      ) {
        bestScore = score
        bestTool = tool
      }
    }
    if (bestTool !== null) seed.add(bestTool)
  }

  /*
   * A strongly matched tool brings its siblings, and so does the BEST match
   * whatever it scored.
   *
   * The second half is not a weakening of the threshold, it is the case the
   * threshold cannot see. "I replied to Stripe on the 12th — tick that one off
   * as done that day" matches `timeline.item.complete` at 5 and nothing else at
   * all: an unambiguous single-tool request, below `FAMILY_LIFT` precisely
   * because only one word pointed anywhere. The turn after it is "put that back
   * on my list, and give me until the 18th", which needs
   * `timeline.item.reopen` and `timeline.item.reschedule` and names neither —
   * and got neither, in the version of this file before the ranked seed and in
   * the version before that. A top match is a family the conversation is now
   * in.
   */
  const families = new Set<string>()
  for (const [tool, score] of scores) if (score >= FAMILY_LIFT) families.add(familyOf(tool))
  const top = ranked[0]
  if (top !== undefined) families.add(familyOf(top[0]))
  for (const entry of CATALOG) {
    if (NEVER_IMPLICIT.includes(entry.name)) continue
    if (families.has(familyOf(entry.name))) seed.add(entry.name)
  }

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
 * What a wipe request is offered ALONGSIDE the wipes, when nothing else is known.
 *
 * The abstaining wipe path used to answer with `EVERYTHING_SAFE`, and the
 * comment justifying that is still below and still right about the failure it
 * was fixing: handing the model exactly `memory.reset` and `memory.clear`, with
 * no reads and no alternative action, on the one pair of calls in this app that
 * cannot be undone. **A wipe offer is not a menu of two.**
 *
 * But the catalogue was never what made it not-a-menu-of-two. Measured, "erase
 * everything" and "purge everything that is out of date" — two sentences the
 * lexicon indexes no term of — each put all ninety-two tools in front of a
 * model, which is the largest offered set this app can produce, on its most
 * dangerous request. Sixteen thousand tokens of schema, on a small window,
 * immediately before an irreversible call: exactly the condition MCPGauge
 * measured a 9.5% task-performance cost for, at the moment there is least
 * margin for a mistake.
 *
 * The alternative to a total wipe is a SCOPED one, so this is every read plus
 * every scoped delete — the model can look at what is there, and it can remove
 * one thing rather than everything. That is the whole of what the wide
 * fallback was providing that mattered, at about a quarter of the size, and it
 * is derived from the catalog's own `effect` rather than listed here, so a
 * delete added tomorrow is in it.
 */
const SCOPED_ERASE: readonly string[] = [
  ...RESIDENT,
  ...CATALOG.filter((e) => e.effect === 'delete' && !NEVER_IMPLICIT.includes(e.name)).map(
    (e) => e.name,
  ),
]

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
    if (wipes) {
      /*
       * A WIPE OFFER IS NOT A MENU OF TWO, and this branch used to make it one.
       *
       * Measured on "erase everything" and "purge everything that is out of
       * date" — two sentences the lexicon indexes no term of, so `select`
       * abstains. With nothing carried, `kept` was `NEVER_IMPLICIT` and nothing
       * else: the model was handed EXACTLY `memory.reset` and `memory.clear`,
       * no reads, no alternative action, on the one pair of calls in this app
       * that cannot be undone. The same request in words the lexicon DOES know
       * — "clear everything", "delete all my records" — came back with 18 and
       * 42 tools with every read among them, so the harm was specific to
       * abstention, which is the case where the request is least understood and
       * therefore the worst possible place to narrow to two destructive roots.
       *
       * Note the shape of the trap, because it is easy to reintroduce: the
       * `carried === null` early return below is skipped exactly when `wipes`
       * is true, so the wipe path was the one path out of this function that
       * never reached `closeOver`, `RESIDENT` or `EVERYTHING_SAFE`.
       *
       * So abstention means here what it means everywhere else — no opinion,
       * offer everything — with the two wipes ADDED because the person's own
       * words asked for them. On the carried path `RESIDENT` is a floor rather
       * than a widening: the system prompt tells the model to look before it
       * writes, and a set with no reads in it makes that unfollowable.
       */
      for (const name of carried === null ? SCOPED_ERASE : RESIDENT) kept.add(name)
      for (const name of NEVER_IMPLICIT) kept.add(name)
      return closeOver(kept)
    }
    for (const name of NEVER_IMPLICIT) {
      kept.delete(name)
      kept.delete(toWireName(name))
    }
    // Nothing carried and nothing asked for: genuinely no opinion.
    if (carried === null) return null
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
