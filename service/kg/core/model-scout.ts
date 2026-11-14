/**
 * L1 — pipelines, the proposals they raise, matches and saved postings, and the
 * reading a model takes of a posting. Re-exported by `core/model.ts`.
 */

import type { Instant, ISODate } from './model-graph'

export type Pipeline = {
  id: string
  name: string
  source: string
  schedule: string
  filter: string
  enabled: boolean
  /** Absent on every pipeline written before there were two kinds. */
  kind?: PipelineKind
  auto?: boolean
  lastRunAt?: Instant
  idleRounds?: number
}

/**
 * A queued suggestion, as a screen reads it.
 *
 * `pipelineId` is the `FROM` edge flattened, exactly as `Match.applicationId`
 * flattens `BECAME` — the edge is the storage and the scalar is a reading of
 * it. `null` rather than absent because a card whose pipeline has been deleted
 * still has to render, and "which pipeline?" then has a real answer: none.
 */
export type Proposal = {
  id: string
  pipelineId: string | null
  /** See `ProposalProps.swept`. Filtered out before any screen sees it. */
  swept?: boolean
  kind: PipelineKind
  tool: string
  input: string
  title: string
  rationale: string
  status: ProposalStatus
  proposedAt: Instant
  decidedAt?: Instant
  error?: string
  /** See `ProposalProps.reading`. */
  reading?: string
}

export type Match = {
  id: string
  role: string
  detail: string
  fit: number
  /** Set once the match has been promoted. The match itself stays in the feed. */
  applicationId?: string
}

export type SavedPosting = {
  id: string
  title: string
  url: string
  /** ISO date the snapshot was taken. Rendered through `agoLabel`. */
  savedOn: string
  size: string
  /** One or two sentences on what the job is, written by the scout from what the board showed. */
  summary?: string
  /** The employer and place the listing named. See `PostingProps`. */
  org?: string
  location?: string
  /** Derived: whether a BECAME edge exists. Never stored — see project.ts. */
  linked: boolean
  applicationId?: string
}

/**
 * The longest a posting's summary may be. Two sentences, not the advert: it is
 * there so a person can tell from the queue whether a link is worth opening,
 * and anything longer is a reason to open it.
 */
export const MAX_POSTING_SUMMARY = 300

/**
 * The longest a suggestion's stored reading may be, as JSON text. A dozen short
 * fields and a few keyword names come to well under a kilobyte; anything near
 * this did not come from the reader.
 */
export const MAX_PROPOSAL_READING = 4000

export type PostingProps = {
  slug: string
  title: string
  url: string
  savedOn: ISODate
  size: string
  summary?: string
  /**
   * The employer and place as the listing named them. The address names the
   * BOARD ("cra.org") and not the employer, so these are what recognise the
   * same job reposted elsewhere (`core/same-job.ts`) and what a draft made
   * from the posting is named after.
   */
  org?: string
  location?: string
}

export type MatchProps = {
  slug: string
  role: string
  detail: string
  fit: number
}

export type PipelineProps = {
  slug: string
  name: string
  source: string
  schedule: string
  filter: string
  enabled: boolean
  /**
   * Which of the two agents this pipeline runs. Absent means `scout`.
   *
   * Optional rather than required, and the default is not arbitrary: every
   * pipeline that existed before there were two kinds was described on the page
   * as "a saved search — a board to watch, the terms that matter, and how often
   * to look", which is what `scout` is. So an old row read under the new type
   * keeps the meaning it was written with. Making it required would have been
   * the other choice, and `validateRows` deletes what it cannot parse — the
   * cost of that decision is measured in the user's saved searches.
   */
  kind?: PipelineKind
  /**
   * Run without asking. Twin only — see `AUTO_CAPABLE` in `core/proposal.ts`.
   *
   * The tools do not enforce this and cannot usefully: a pipeline's kind and its
   * auto flag are two props on one record, and a tool that refused to set them
   * inconsistently would still be one commit away from a graph where they are.
   * The gate is at the point of USE — the driver reads `AUTO_CAPABLE[kind]`
   * before it decides whether to bypass the queue — which is the only place the
   * answer matters.
   */
  auto?: boolean
  /** When the last round finished. Absent means it has never run. */
  lastRunAt?: Instant
  /** Consecutive rounds that raised nothing. See `shouldOfferShutdown`. */
  idleRounds?: number
}

/**
 * `twin` keeps the graph honest; `scout` looks outward.
 *
 * Named for what they are FOR rather than what they do, because both of them
 * "run an agent over the graph" and that tells a reader nothing. The digital
 * twin fills in what the user forgot to write down; the scout finds jobs. What
 * each is ALLOWED to do is `core/proposal.ts`, which is policy and belongs
 * somewhere testable rather than in a prompt.
 */
export const PIPELINE_KINDS = ['twin', 'scout'] as const

export type PipelineKind = (typeof PIPELINE_KINDS)[number]

export const PROPOSAL_STATUSES = ['pending', 'approved', 'discarded', 'failed'] as const

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/**
 * One thing an agent wants to do, kept until a person answers.
 *
 * `input` is JSON text rather than a structured value, and that is the one
 * decision in this type worth defending. The alternative is a
 * `Record<string, unknown>` in the node's props, which the store would happily
 * keep — but then the shape of a stored proposal depends on the shape of a
 * tool's input schema at the moment it was written, and a tool whose schema
 * tightens later has proposals in the store that no longer parse and no way to
 * tell that from a bug. As text it is inert: it round-trips through storage
 * unexamined, and the only thing that ever interprets it is `ctx.call`, which
 * parses it with the target tool's own schema at the moment of approval and
 * fails cleanly if it no longer fits.
 */
export type ProposalProps = {
  slug: string
  kind: PipelineKind
  /** The registry name, `timeline.item.create`. */
  tool: string
  /** The tool's input, as JSON text. See the note above. */
  input: string
  /** One line, in the user's language: "Add a follow-up reminder for Stripe". */
  title: string
  /** Why the agent thinks so — shown under the title on the card. */
  rationale: string
  status: ProposalStatus
  proposedAt: Instant
  decidedAt?: Instant
  /**
   * Why it failed, when `status` is 'failed'. The tool's own sentence.
   *
   * Written by a SECOND commit, not by the approval that failed, and the reason
   * is the transaction: `ctx.call` throwing is what rolls the approval back, so
   * by the time there is a message to record, the transaction that would have
   * recorded it no longer exists. `pipeline.proposal.fail` is that second
   * commit. It only ever runs on the failure path, which is the rare one.
   *
   * There is deliberately no `journalId` beside this. An approval's write and
   * its status change are one transaction and therefore one journal row, so
   * reverting that row already puts both back — a stored id would name the row
   * that undo can already find, and a field nothing writes is worse than no
   * field, as the never-written `FROM` edge on `match` has been demonstrating.
   */
  error?: string
  /**
   * Answered, and cleared off the queue — but still remembered.
   *
   * `pipeline.proposal.sweep` used to DELETE these rows, and once the scout
   * started deduping against every proposal rather than only the pending ones,
   * that delete became a hole: pressing Clear forgot which jobs the person had
   * already turned down, and the next round proposed them again. The button
   * meant to empty the queue refilled it.
   *
   * So sweeping marks instead. The card goes — `use-pipelines` filters these
   * out and no screen ever sees one — and the record stays where
   * `knownPostingUrls` can still read it. A discarded suggestion is the strongest
   * evidence there is that a job should not be offered again, and it was the
   * one piece of evidence being thrown away.
   *
   * Optional, so every proposal written before this field existed reads back as
   * unswept, which is what it was.
   */
  swept?: boolean
  /**
   * What reading the posting's page said, before anyone decided on it — JSON
   * text, parsed by `scoutReading` in `core/proposal`.
   *
   * Only on a `scout.posting.save` suggestion. The scout writes a suggestion
   * from a board's listing — a few words and a link — and the person is asked
   * to decide on that. So each one is read in the background, the way approving
   * reads one (`pipeline.proposal.reading.set`): the page kept in the Vault, and
   * the employer, role, place and keywords put on the card. Approving then uses
   * this rather than opening the page a second time.
   *
   * Text rather than a typed prop for the reason `input` is: it is the app's
   * own scratch about one card, and a shape that changes must never make a boot
   * drop queued suggestions. A reading that does not parse is simply not shown.
   */
  reading?: string
}

/**
 * One thing a posting asks for, as a reader would state it.
 *
 * Declared here rather than in `core/assess.ts`, which owned it until it became
 * a stored shape — everything that goes on disk is described in `core/model.ts`, and
 * a type that is half in the scorer and half in the store is one nobody can
 * check against `NODE_PROP_SCHEMAS`. `assess.ts` re-exports it, so every reader
 * of the scorer still finds it where it expects to.
 */
export type Requirement = {
  /** The phrase from the posting: 'distributed systems', 'PhD in CS'. */
  readonly text: string
  /**
   * Whether the posting states this as required or preferred.
   *
   * Weighted differently by `assess`, because missing a "must have" and missing
   * a "nice to have" are not the same news.
   */
  readonly essential: boolean
}

/**
 * How many requirements are worth having.
 *
 * A posting that yields forty is one where the model has started listing
 * sentences, and `assess` would then divide a real score across thirty pieces
 * of boilerplate. Twelve is more than any posting genuinely asks for and few
 * enough that the gap list stays readable.
 *
 * Here rather than in `agent/read-requirements.ts`, which owned it: it stopped
 * being only the reader's ceiling the day a reading went on disk, and the trust
 * boundary that has to enforce it — `NODE_PROP_SCHEMAS` in `core/validate.ts` —
 * may not import from `agent`. The reader re-exports it.
 */
export const MAX_REQUIREMENTS = 12

/**
 * The longest a requirement phrase may be.
 *
 * A cap on the STORE, and `read-requirements.ts` applies the same one so a
 * reply can never produce a reading the store refuses — a schema refusal is
 * all-or-nothing, so one 300-character entry would throw away the other eleven
 * and the model call that found them. Two hundred characters is longer than any
 * real requirement and shorter than the paragraph a model writes when it has
 * started paraphrasing.
 */
export const MAX_REQUIREMENT_TEXT = 200

/**
 * One model's reading of one posting, and enough about it to be doubted.
 *
 * Every field beside `requirements` is here so the panel can say where the
 * answer came from rather than presenting it as a fact of nature. That is the
 * price of persisting it: a reading that outlives its session has to carry the
 * means of noticing it is old, because a reload is no longer doing that job.
 *
 * There is no fingerprint of the document beside them, and that is deliberate
 * rather than an omission. A re-captured posting mints a NEW file id, so the
 * common way a page changes takes the reading out of reach on its own. What is
 * left is one narrow path — bytes evicted from the blob store, then refilled
 * from a different file with the same name — and nothing in the graph can see
 * it: `FileProps.hash` is declared and written by nobody, and a check against a
 * field nothing writes is a check that never fires, which is the failure the
 * never-written `FROM` edge on `match` already recorded. When the folder port
 * starts writing hashes, `staleOf` in `core/fit-reading.ts` is where the
 * comparison goes.
 *
 * `clearedAt` is the tombstone, and it is why this is not simply deleted when
 * somebody discards it. `pipeline.proposal.sweep` learned this the hard way —
 * deleting the row was amnesia, and the queue refilled with what the person had
 * just turned down. Here the amnesia is worse than a refill: the panel reads a
 * posting automatically when it finds no reading, so a delete that left nothing
 * behind would start a fresh model call on the very next render, and the button
 * would look broken. Cleared keeps the row, empties it, and tells the panel a
 * person has already answered this question.
 */
export type PostingReading = {
  /**
   * What the posting asks for. Capped at `MAX_REQUIREMENTS` by the reader, so
   * this is a dozen short phrases and not the page — D27 is intact, and the
   * argument in `posting-source.ts` against storing the posting TEXT (40k of
   * somebody else's prose in every `getAll('nodes')`) does not reach a list
   * this size.
   *
   * Empty when `clearedAt` is set: discarding the answer discards the answer.
   */
  requirements: Requirement[]
  /**
   * The model that read it — 'gemma_4_31b'. Shown, never used to decide
   * anything on its own.
   *
   * The name only. Not the endpoint, which is a fact about a machine rather
   * than about this reading, and never the key: `core/provider.ts` says where
   * that must not go, and the graph is the first place it names.
   */
  model: string
  /** When it was read, from `ctx.now`. */
  readAt: Instant
  /**
   * How many lines the reader could not use, when any.
   *
   * `readRequirements` has always returned this and every caller threw it away.
   * "Four of sixteen were skipped" is exactly the kind of thing a person wants
   * when a verdict reads lower than they expected, and it costs one number.
   */
  skipped?: number
  /**
   * Set when the person discarded the reading. See the note above on why the
   * row survives being deleted.
   *
   * Optional, so every file written before this field existed reads back as a
   * document nobody has cleared — which is what it was.
   */
  clearedAt?: Instant
}
