/**
 * L1 — what a pipeline is allowed to propose, and what makes a proposal stale.
 *
 * The Job Scout page runs two agent pipelines, and the difference between them
 * is not their prompt but their POWER. One is allowed to write to the graph on
 * the user's behalf once approved; the other is allowed to add rows to a review
 * list and nothing else, ever, even in a mode the user has asked to trust. That
 * distinction has to be a data structure rather than a sentence in a prompt,
 * because a prompt is a request and an allowlist is a rule — a model that
 * decides to `application.delete` cannot be talked into it if the tool was never
 * in its catalog to begin with.
 *
 * So this module holds the policy and none of the machinery. No clock, no
 * fetch, no storage: `check-platform` forbids all three here, and the reason it
 * is worth obeying rather than working around is that every rule below is then
 * testable as a pure function over plain data, which is what the tests do.
 *
 * WHAT LIVES ELSEWHERE. Turning a proposal into a real write is `tools/pipeline.ts`,
 * because only a tool may open a transaction. Driving the loop and deciding
 * WHEN to run is `react/use-pipelines.ts`, because only the app shells own a
 * timer. This file only answers: may it, and is it new.
 */

import { canonicalPostingUrl } from './capture'
import type { Instant, PipelineKind, ProposalStatus } from './model'

/* ------------------------------- the two kinds ---------------------------- */

/**
 * Only `twin` may ever run unattended.
 *
 * The asymmetry is deliberate and is the user's, not an implementation limit.
 * A twin proposal edits records the user already owns — a note on their own
 * application, a keyword on their own file — and the worst unattended outcome
 * is tidying they did not ask for, which undo reverses. A scout proposal adds a
 * JOB, and a job that appears in someone's application list without them
 * choosing it is a false memory of having applied. So the scout has no auto
 * mode, and this constant is what every surface reads rather than each one
 * deciding for itself.
 */
export const AUTO_CAPABLE: { readonly [K in PipelineKind]: boolean } = {
  twin: true,
  scout: false,
}

/* ------------------------------- the allowlists --------------------------- */

/**
 * What a twin pipeline may propose.
 *
 * Everything here is additive or corrective on records the user already has:
 * write a note, file a document under the job it belongs to, tag something, add
 * a reminder, draft a snippet. There is no `*.delete` in this list and there
 * will not be one — an agent that noticed a record looked redundant and
 * proposed removing it would be right often enough to be trusted and wrong
 * exactly when it mattered.
 *
 * `application.update` is absent for the same reason in miniature: it can
 * rewrite the stage, the salary and the company in one call, and "keep the
 * graph up to date" does not require the power to restage someone's interview.
 * Notes, tags and reminders carry the value; the destructive half is not worth
 * the blast radius.
 */
export const TWIN_TOOLS = [
  /*
   * The two that make it a twin rather than a tidier.
   *
   * Everything below this pair rearranges facts the graph already holds. These
   * are the only entries that ADD one — they are how a CV in the Vault becomes
   * something the app can score a posting against, and without them the
   * pipeline named "twin" could read a document and had nowhere to put what it
   * found.
   *
   * `profile.background.delete` is deliberately absent, under the same rule as
   * every other delete here. A wrongly-read fact is jojo's mistake rather than
   * the person's, and the fix belongs in front of them — the Assistant can
   * remove one when asked, and undo takes back a bad import wholesale.
   */
  'profile.background.add',
  'profile.background.update',
  'application.note.set',
  'vault.file.note.set',
  'vault.file.update',
  'vault.link.update',
  'vault.link.save',
  'vault.snippet.create',
  'vault.snippet.update',
  'timeline.item.create',
  'timeline.item.update',
  'keyword.create',
  'keyword.attach',
  'keyword.record.set',
  'assistant.thread.file',
] as const

/**
 * What a scout pipeline may propose. Two tools, and both of them are inboxes.
 *
 * `scout.posting.save` and `scout.match.save` write to lists the user reviews;
 * neither creates an application. Promoting a posting to an application stays a
 * button the user presses, which is the guarantee the page's copy makes.
 */
export const SCOUT_TOOLS = ['scout.posting.save', 'scout.match.save'] as const

export const PIPELINE_TOOLS: { readonly [K in PipelineKind]: readonly string[] } = {
  twin: TWIN_TOOLS,
  scout: SCOUT_TOOLS,
}

/**
 * The gate, as a function, so no caller reimplements the `includes`.
 *
 * Called twice per proposal on purpose: once when the agent proposes, so an
 * out-of-scope call becomes a sentence back to the model rather than a queued
 * card, and once again at approval, so a proposal that was stored before the
 * allowlist changed cannot be applied under the old rules.
 */
export function mayPropose(kind: PipelineKind, tool: string): boolean {
  return PIPELINE_TOOLS[kind].includes(tool)
}

/** Decided one way or the other — the card stops asking. */
export function isSettled(status: ProposalStatus): boolean {
  return status !== 'pending'
}

/**
 * The values a proposal would actually write, as one readable line.
 *
 * The card's title names the OPERATION — "Edit note · Baylor — CS" — which was
 * everything it showed until a run of the real page made the gap obvious: the
 * user was being asked to approve a note without being shown the note. A title,
 * a rationale and a tool name are three ways of describing a change and none of
 * them is the change.
 *
 * Reads the payload rather than the tool's schema, because the tool's schema is
 * L3 and this is L1 — and because what a reader wants is the values, not the
 * field names. Ids are dropped: they are the one string in a payload that means
 * nothing to the person reading it, and the title already names the record.
 */
export function proposalDetail(inputJson: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(inputJson)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const parts: string[] = []
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') {
      const clean = value.trim().replace(/\s+/g, ' ')
      if (clean.length > 0 && !isId(clean)) parts.push(clean)
    } else if (typeof value === 'number') {
      parts.push(String(value))
    } else if (Array.isArray(value)) {
      /*
       * A bulk write, which this used to render as nothing at all.
       *
       * Every scalar tool had a preview and every array tool silently did not —
       * `proposalDetail` read only strings and numbers, so an input shaped
       * `{ background: [ … thirty facts … ] }` produced `null` and the card
       * showed a title with no values under it. That is precisely the gap the
       * note above records having closed once already, reopened by a tool whose
       * payload happened to be a list.
       *
       * It matters most for exactly this tool. The things in that array are
       * claims about the person, read by a model out of their own CV, and being
       * asked to approve them unseen is worse than being asked to approve an
       * unseen note about a job.
       */
      const rows = value.filter((v) => typeof v === 'object' && v !== null)
      if (rows.length === 0) continue
      // Three, then a count. A card is a few lines and the fourth entry never
      // changes anybody's decision — but the TOTAL does, because approving
      // seven things and approving thirty are different acts.
      const named = rows
        .map((row) => summarise(row as Record<string, unknown>))
        .filter((line): line is string => line !== null)
      if (named.length === 0) continue
      parts.push(named.slice(0, 3).join(', '))
      if (named.length > 3) parts.push(`and ${String(named.length - 3)} more`)
    }
  }
  if (parts.length === 0) return null
  const line = parts.join(' · ')
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line
}

/**
 * One row of a bulk payload, in as few words as identify it.
 *
 * Prefers the field a person would recognise. `title` and `name` are what every
 * record in this app is called on screen; anything else is a fallback for a
 * shape this has not met, and an id is never it.
 */
function summarise(row: Record<string, unknown>): string | null {
  for (const key of ['title', 'name', 'text', 'role']) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  const first = Object.values(row).find(
    (v) => typeof v === 'string' && v.trim().length > 0 && !isId(v.trim()),
  )
  return typeof first === 'string' ? first.trim() : null
}

const DETAIL_MAX = 220

/** `app:01a02da4-…` — the store's own id shape, from `core/ref.ts`. */
const isId = (value: string): boolean => /^[a-z]+:[0-9a-f-]{8,}$/i.test(value)

/* -------------------------------- dedupe ---------------------------------- */

/**
 * The key two postings are "the same job" under.
 *
 * Canonicalising first is what makes this worth having: the same LinkedIn job
 * reached from a search, from an alert email and from a shared link is three
 * URLs with the same id buried in them, and `canonicalPostingUrl` already knows
 * how to dig it out — it was written for the capture feature and this is the
 * second caller that needed it, which is the usual sign a helper was put in the
 * right place.
 *
 * Everything after canonicalisation is the cheap half: lowercase the host,
 * drop a trailing slash, ignore the fragment. Tracking parameters are NOT
 * stripped in general, because on a board we do not have a canonicaliser for,
 * a query string is often the whole identity of the posting.
 */
export function postingKey(url: string): string {
  const canonical = canonicalPostingUrl(url.trim())
  // The fragment goes from the TEXT rather than from the parsed URL.
  // `types/portable-globals.d.ts` declares only the URL members this layer
  // reads — `hash` is deliberately not one of them, and the note there says
  // why: declaring all thirteen fields is an invitation to use them.
  const bare = canonical.split('#')[0] ?? canonical
  try {
    const parsed = new URL(bare)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}${parsed.search}`
  } catch {
    // Not a URL we can parse — compare the text, folded. A pipeline that
    // proposes a bare slug twice should still only ask once.
    return bare.toLowerCase()
  }
}

/**
 * Has this job been seen before, under any of its spellings?
 *
 * Takes the known URLs rather than a snapshot so it stays pure and so the
 * caller decides what "known" means — which it must, because the answer differs
 * by surface: the scout dedupes against postings AND applications AND its own
 * pending proposals, and a test dedupes against a two-element array.
 */
export function isKnownPosting(known: Iterable<string>, url: string): boolean {
  const key = postingKey(url)
  for (const candidate of known) {
    if (postingKey(candidate) === key) return true
  }
  return false
}

/* --------------------------------- idling --------------------------------- */

/**
 * How many empty rounds before a pipeline offers to switch itself off.
 *
 * Two, not one. A single empty round is the normal state of a healthy pipeline
 * — the graph was already tidy this morning — and offering to shut down every
 * time nothing happened would train the user to dismiss the prompt. Two in a
 * row, with a model call between them, is weak evidence that there is nothing
 * left rather than nothing right now.
 */
export const IDLE_ROUNDS_BEFORE_SHUTDOWN = 2

/**
 * Should the user be asked whether to switch this pipeline off?
 *
 * Pending work counts as work even if the last round found nothing new: a queue
 * the user has not answered yet is the opposite of "nothing left to do", and
 * asking to shut down while five cards sit unanswered reads as the app giving
 * up on its own suggestions.
 */
export function shouldOfferShutdown(idleRounds: number, pending: number): boolean {
  return pending === 0 && idleRounds >= IDLE_ROUNDS_BEFORE_SHUTDOWN
}

/* -------------------------------- scheduling ------------------------------ */

/**
 * The three cadences a pipeline can be set to.
 *
 * Here rather than in each app's dialog, which is where the list lived twice
 * with nothing keeping the copies in step — and where `frequencyOf` existed on
 * both platforms specifically to cope with a stored value that matched neither
 * copy. One list, and a parser that still tolerates whatever is already stored.
 */
export const PIPELINE_SCHEDULES = ['hourly', 'daily', 'weekly'] as const

export type PipelineSchedule = (typeof PIPELINE_SCHEDULES)[number]

const HOUR = 60 * 60 * 1000

const INTERVAL: { readonly [S in PipelineSchedule]: number } = {
  hourly: HOUR,
  daily: 24 * HOUR,
  weekly: 7 * 24 * HOUR,
}

/** Whatever is stored, read as one of the three. Anything else is daily. */
export function scheduleOf(stored: string): PipelineSchedule {
  const folded = stored.trim().toLowerCase()
  return (PIPELINE_SCHEDULES as readonly string[]).includes(folded)
    ? (folded as PipelineSchedule)
    : 'daily'
}

export function intervalMs(stored: string): number {
  return INTERVAL[scheduleOf(stored)]
}

/**
 * The pause between rounds while a pipeline still has work to do.
 *
 * A pipeline that is finding things should keep going — "switch it on and it
 * works through the backlog" is what the toggle promises — so the schedule does
 * NOT apply until the work runs out. This is the floor that keeps "keep going"
 * from meaning "hammer the model": a round is a whole conversation and takes
 * seconds, so five is a pause between rounds rather than a rate limit.
 */
export const WORKING_GAP_MS = 5_000

/**
 * Is this pipeline's next round due?
 *
 * Three cases, and the middle one is the whole design:
 *
 *   1. Never run — due now. That is what makes switching a pipeline on feel
 *      like switching it on rather than like scheduling it.
 *   2. Still finding things, or not yet finished proving it has run out — due
 *      after `WORKING_GAP_MS`. The `schedule` is deliberately ignored here. A
 *      daily pipeline that found six things this morning has no business
 *      waiting until tomorrow to look for a seventh, and waiting would also put
 *      the second empty round — the one that decides whether to offer to shut
 *      down — a full day after the first, which is not a question anybody would
 *      connect to an answer.
 *   3. Proven idle — the schedule takes over. This is the state a pipeline
 *      spends most of its life in, and it is the one `schedule` was written
 *      for: how often to come back and check.
 *
 * Takes the instants rather than reading a clock, because this is L1 and a test
 * that cannot control "now" cannot test a scheduler at all.
 */
export function isDue(
  stored: string,
  lastRunAt: Instant | undefined,
  now: Instant,
  idleRounds = 0,
): boolean {
  if (lastRunAt === undefined) return true
  const last = Date.parse(lastRunAt)
  const at = Date.parse(now)
  if (Number.isNaN(last) || Number.isNaN(at)) return true
  const wait = idleRounds >= IDLE_ROUNDS_BEFORE_SHUTDOWN ? intervalMs(stored) : WORKING_GAP_MS
  return at - last >= wait
}
