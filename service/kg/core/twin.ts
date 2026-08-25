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
 * The bucket is the signal the app already has: `profile.document.add` files
 * into `Applications`, and that is where a CV lands. Matching on the name as
 * well catches the ones added through the Vault directly.
 */
const ABOUT_THE_PERSON = /\b(cv|resume|résumé|vitae|statement|bio|portfolio|transcript)\b/i

/**
 * Whether a file is one the twin should read.
 *
 * Anything filed UNDER an application is about that application — a tailored
 * cover letter, a submitted packet — and its facts are already the person's
 * only incidentally. A CV sits loose, which is what makes the absence of a
 * `FILED_UNDER` edge a usable signal rather than a coincidence.
 */
function worthReading(memory: GraphSnapshot, id: string, name: string): boolean {
  if (!ABOUT_THE_PERSON.test(name)) return false
  return memory.many(id as never, 'FILED_UNDER', 'out', 'application').length === 0
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

  const unread = files.filter(
    (f) => !readFrom.has(f.id) && worthReading(memory, f.id, f.props.name),
  )

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
