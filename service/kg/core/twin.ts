/**
 * What is missing from the picture the app has of the person. L1 core.
 *
 * The twin pipeline's job is to build a graph that stands in for the user —
 * what they studied, what they have held, what they can do — so that scoring a
 * posting against it means something. This is the half of that job which does
 * not need a model: working out what is ABSENT.
 *
 * ## Why this is computed and not asked
 *
 * A pipeline round could simply tell the model "look for anything missing", and
 * that is roughly what the twin prompt used to say. It produces a model that
 * lists every record and reasons about all of them — expensive, and worse,
 * unreliable in a specific direction: absence is exactly what a language model
 * is worst at noticing. It sees what is there.
 *
 * So the gaps are found by counting, deterministically, and handed to the model
 * as part of its instructions. What is left for the model is the part that
 * genuinely needs judgement: reading a document and deciding what its sentences
 * mean. That division is the same one `assess.ts` draws, and it is the reason
 * both files are arithmetic.
 *
 * ## The gaps are ordered by how much they unlock
 *
 * An unread document is first by a wide margin. Everything else the twin can do
 * — connecting a skill to a keyword, filing a document under the job it belongs
 * to — is a rearrangement of facts already known. Reading a CV is the only
 * operation that adds facts the graph did not have, and until it happens the
 * twin is a picture of somebody's applications rather than of them.
 */

import type { GraphSnapshot } from './snapshot'
import type { StoredNode } from './model'
import { fold } from './text'

/** One thing the twin could do next, and why it is worth doing. */
export type TwinGap = {
  readonly kind: 'unread-document' | 'skill-not-keyword' | 'unfiled-document' | 'no-background'
  /** What a person would call the thing. Used in the prompt and on screen. */
  readonly subject: string
  /** The record this is about, when there is one to point at. */
  readonly id?: string
  /** One sentence the pipeline can act on, addressed to the model. */
  readonly instruction: string
}

export type TwinState = {
  /** How many facts about the person the graph holds. */
  readonly facts: number
  /** Documents whose text has never been turned into facts. */
  readonly unread: number
  readonly gaps: readonly TwinGap[]
}

/**
 * Documents worth reading for facts about the person.
 *
 * Deliberately not every file. A job posting somebody saved as a PDF, or an
 * offer letter, is a document about an EMPLOYER — reading it for the person's
 * background would file the employer's requirements as though they were the
 * person's qualifications, which is the worst inversion available here.
 *
 * THE BUCKET IS THE PRIMARY SIGNAL and the name is the fallback, which is the
 * opposite of how this started. `Applications` is defined in `core/model.ts` as
 * "the drawer for the things a person WROTE — the CV, the statements, the cover
 * letters", so filing something there is the user saying what kind of document
 * it is, in the app's own vocabulary. A name pattern is a guess about the same
 * question, and it fails on `Shaswata.pdf`.
 *
 * The name test stays for documents put somewhere else — a CV dropped into
 * "To read" is still a CV — and it is why this is an OR rather than a bucket
 * check alone.
 */
const ABOUT_THE_PERSON = /\b(cv|resume|résumé|vitae|statement|bio|portfolio|transcript)\b/i

/**
 * Names that mean the document is somebody else's, whatever drawer it is in.
 *
 * A VETO, checked before the bucket, and it exists because making the bucket
 * the primary signal reopened a hole the name test had been closing by
 * accident: a posting a person filed into `Applications` by hand would have
 * been read for their background, filing the employer's requirements as their
 * qualifications. That is the worst inversion available here, and the resulting
 * records look exactly like real ones.
 *
 * `Job postings` exists as its own drawer for this reason and the extension
 * uses it — so this only fires for something put in the wrong place by hand,
 * which is precisely the case a bucket signal cannot catch.
 */
const ABOUT_AN_EMPLOYER = /\b(posting|vacancy|advert|advertisement|job.?description|offer.?letter)\b/i

/**
 * Whether a file is one the twin should read.
 *
 * Three conditions, and the third was found by looking at what the demo data
 * set would do.
 *
 * ONE: it has to be about the person. A name that says otherwise vetoes first;
 * then the bucket, and failing that the name.
 *
 * TWO: it must not be filed UNDER an application. Anything attached to a job is
 * about that job — a tailored cover letter, a submitted packet — and its facts
 * are the person's only incidentally. A CV sits loose, which is what makes the
 * absence of a `FILED_UNDER` edge a usable signal rather than a coincidence.
 *
 * THREE: THERE HAVE TO BE BYTES. A record can exist with no document behind it,
 * and it is not a rare case: the seeded data set ships `CV-2026-academic.pdf`
 * and two statements, and every file in a backup restored onto a machine that
 * never held the originals is one too. Without this, a fresh install of the
 * demo set opens with an offer to read a CV that cannot be opened — a consent
 * prompt whose only possible outcome is an error, which is the worst kind to
 * put in front of somebody on their first run.
 *
 * `path` is the web's flag and `uri` the phone's; `core/model.ts` says of the
 * first that "its PRESENCE is the 'has bytes' flag". Both are checked here
 * rather than in each app because the question — can this be opened at all — is
 * the same question on both.
 */
function worthReading(memory: GraphSnapshot, file: StoredNode<'file'>): boolean {
  const { name, bucket, path, uri } = file.props
  if (ABOUT_AN_EMPLOYER.test(name)) return false
  if (bucket !== 'Applications' && !ABOUT_THE_PERSON.test(name)) return false
  if (path === undefined && uri === undefined) return false
  return memory.many(file.id, 'FILED_UNDER', 'out', 'application').length === 0
}

/**
 * What the twin knows, and the next things worth doing about it.
 *
 * Pure, and takes a snapshot rather than a repository, so a pipeline round can
 * be reasoned about without one. `limit` exists because the result goes into a
 * prompt: a model handed forty instructions follows none of them, and the
 * twin's whole value is a short list somebody will actually approve.
 */
export function twinState(memory: GraphSnapshot, limit = 6): TwinState {
  const background = memory.ofType('background')
  const files = memory.ofType('file')

  /*
   * A document counts as read when a fact points back at it. That is what
   * `BackgroundProps.source` is for, and it is why the field exists at all:
   * without it there is no way to ask this question, and the pipeline would
   * re-read the same CV on every round for as long as it was enabled.
   */
  const readFrom = new Set(
    background.map((n) => n.props.source).filter((s): s is string => typeof s === 'string'),
  )

  const unread = files.filter((f) => !readFrom.has(f.id) && worthReading(memory, f))

  const gaps: TwinGap[] = []

  for (const file of unread) {
    gaps.push({
      kind: 'unread-document',
      subject: file.props.name,
      id: file.id,
      instruction: `Read “${file.props.name}” with vault.file.read and record what it says about the person with profile.background.add. Use its id as the source on every entry.`,
    })
  }

  /*
   * Said only when there is nothing AND nothing to read, because otherwise it
   * duplicates the instruction above. An empty twin with a CV sitting there is
   * one problem with one fix; an empty twin with no documents at all is a
   * different situation and the honest thing is to say so rather than to
   * invent work.
   */
  if (background.length === 0 && unread.length === 0) {
    gaps.push({
      kind: 'no-background',
      subject: 'nothing recorded yet',
      instruction:
        'Nothing is recorded about the person and there is no CV or statement in the Vault to read. Say that a document is needed rather than guessing at a background from the applications.',
    })
  }

  /*
   * A skill the person has that is not a keyword in their own system.
   *
   * This is the "connecting" half of the twin, and it is what turns a list of
   * facts into a graph: once "Rust" is a keyword, every application tagged with
   * it is joined to the CV entry that proves it, and a query can walk from a
   * posting's requirement to the evidence for it in one hop.
   */
  const keywords = new Set(memory.ofType('keyword').map((n) => fold(n.props.name)))
  for (const skill of background.filter((n) => n.props.kind === 'skill')) {
    if (keywords.has(fold(skill.props.title))) continue
    gaps.push({
      kind: 'skill-not-keyword',
      subject: skill.props.title,
      id: skill.id,
      instruction: `“${skill.props.title}” is in the person’s background but is not one of their keywords. Create it with keyword.create and attach it to any application it plainly applies to.`,
    })
  }

  return {
    facts: background.length,
    unread: unread.length,
    // Ordered by the array above — unread documents first, because reading is
    // the only operation that adds facts the graph did not already hold.
    gaps: gaps.slice(0, limit),
  }
}

/**
 * Documents that have become worth reading since the last look.
 *
 * The trigger for offering a profile update, and it is a DIFFERENCE rather than
 * a count on purpose. "There are unread documents" is true for as long as the
 * person declines, so an offer built on it reappears on every render and
 * becomes the thing they click away without reading. "This document is new
 * since you last saw this question" is true once.
 *
 * Ids rather than a boolean, because the offer has to name what it found. "Read
 * your CV into your profile?" is a question somebody can answer; "update your
 * profile?" is one they have to open something else to understand.
 *
 * Only unread documents, never the rearranging gaps. Connecting a skill to a
 * keyword moves facts the person already approved; asking permission for that
 * would train them to click through the prompt that matters.
 *
 * Pure, and the caller owns the remembering. Where the previous set is kept is
 * a decision about storage — this only says what changed.
 */
export function newlyReadable(seen: Iterable<string>, state: TwinState): readonly TwinGap[] {
  const already = new Set(seen)
  return state.gaps.filter(
    (g) => g.kind === 'unread-document' && g.id !== undefined && !already.has(g.id),
  )
}

/**
 * What to ask, for one or more newly readable documents.
 *
 * Written here rather than in a component because both apps ask it and the
 * wording is the whole of the consent: a person agreeing to this is agreeing
 * that a model may read a document about them and write what it finds into
 * their records. Saying "update your profile?" would be asking for permission
 * to do something quieter than what happens.
 */
export function twinOfferCopy(gaps: readonly TwinGap[]): { title: string; body: string } {
  const first = gaps[0]?.subject ?? 'that document'
  const more = gaps.length - 1
  return {
    // `<= 1`, not `=== 1`. An empty list is reachable — a document can be filed
    // under an application between the render that raised the offer and the one
    // that draws it — and `=== 1` sent that case to the plural branch, where it
    // asked to read a document "and -1 more".
    title:
      gaps.length <= 1
        ? `Read ${first} into your profile?`
        : `Read ${first} and ${String(more)} more into your profile?`,
    body:
      'jojo will read what is inside and record the facts it states — your degrees, posts, publications and skills — so it can weigh a job posting against what you have actually done. Every entry it adds is shown to you first, and says which document it came from.',
  }
}

/**
 * How many document ids the offer remembers having asked about.
 *
 * A bound, because the set only ever grows and both apps keep it in a store
 * measured in megabytes for the whole origin — the graph shares it. Oldest go
 * first, so overflowing costs one repeated question about a document declined
 * two hundred files ago, which is the right thing to lose.
 */
export const OFFER_MEMORY_LIMIT = 200

/**
 * The remembered ids, from whatever the platform's store handed back.
 *
 * Here rather than in each app because the FAILURE DIRECTION is the whole
 * design and it must not be decided twice. Anything that does not parse as an
 * array of strings reads as "nothing asked yet", which asks again. Asking twice
 * is a nuisance; failing the other way would leave a document silently never
 * read while the record claimed the person had been consulted.
 *
 * `null` in — no value stored — is the ordinary first-run case, not an error.
 */
export function parseOffered(raw: string | null): readonly string[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * The set to store after asking about `ids`.
 *
 * Takes both answers, deliberately. Accepting and declining differ in what
 * happens next and not at all in what has to be remembered — and a version that
 * recorded only declines would re-offer a document the moment its extraction
 * failed, which is exactly when the person least wants the question again.
 *
 * Re-asked ids move to the end rather than being left where they were, so the
 * limit drops what has genuinely been quiet longest.
 */
export function mergeOffered(
  current: readonly string[],
  ids: readonly string[],
): readonly string[] {
  if (ids.length === 0) return current
  const fresh = [...new Set(ids)]
  const merged = [...current.filter((id) => !fresh.includes(id)), ...fresh]
  return merged.length > OFFER_MEMORY_LIMIT
    ? merged.slice(merged.length - OFFER_MEMORY_LIMIT)
    : merged
}

/**
 * The gaps as a paragraph for the pipeline's prompt.
 *
 * Empty string when there is nothing to say, so the caller can append it
 * unconditionally — a prompt ending in "Here is what is missing:" followed by
 * nothing reads as a truncated instruction and models treat it as one.
 */
export function twinBriefing(state: TwinState): string {
  // "holds 1 facts" is the kind of line that makes a person trust the rest of
  // the output less, and it appears in a prompt a model then echoes back.
  const facts = `${String(state.facts)} ${state.facts === 1 ? 'fact' : 'facts'}`

  if (state.gaps.length === 0) {
    return state.facts > 0
      ? `The person’s background already holds ${facts} and nothing obvious is missing from it. Look at their applications instead, and if those are in good order say so and stop.`
      : ''
  }
  return [
    state.facts === 0
      ? 'Nothing is recorded about the person yet, so building that comes first.'
      : `The person’s background holds ${facts} so far.`,
    'These are the gaps, most useful first:',
    ...state.gaps.map((g, i) => `${String(i + 1)}. ${g.instruction}`),
  ].join(' ')
}
