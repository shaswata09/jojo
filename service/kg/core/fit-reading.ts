/**
 * What a stored posting reading means to the panel that shows it. L1 core.
 *
 * `PostingReading` in `core/model.ts` is the shape on disk; this is every
 * question the two fit panels ask about one. It is a separate module for the
 * reason `fit-request.ts` gives about itself: under D20 no component is ever
 * mounted, so a rule left inside a panel is a rule checked by clicking, and
 * there are two panels to click.
 *
 * ## The three states, and why "cleared" is one of them
 *
 * A file either has no reading, has one, or has one the person threw away. The
 * third is not the same as the first and collapsing them is the bug this file
 * exists to prevent: the panel reads a posting automatically when it finds no
 * reading, so "deleted" and "never read" being one state means the delete
 * button starts a model call on the next render and the answer comes straight
 * back. `pipeline.proposal.sweep` learned the same lesson one screen over —
 * marking, not deleting, is what makes a discard stick.
 *
 * ## Doubt is a first-class answer
 *
 * `staleOf` exists because persisting a verdict means a reload no longer throws
 * away a wrong one. Exactly one thing can change under a stored reading that
 * this layer can actually see: the model that produced it is no longer the
 * model that is connected. It does not make the reading wrong, and it is worth
 * saying out loud beside it, because the alternative is a confident sentence
 * about a page read by something the person has since replaced.
 *
 * The obvious second doubt — the document changed — is NOT here, and the reason
 * is on `PostingReading` in `core/model.ts`: re-capturing a posting mints a new
 * file id, which removes the reading from view without anybody comparing
 * anything, and the one path that is left cannot be detected because nothing in
 * the app writes `FileProps.hash`. A check against a field nothing writes is a
 * warning that never fires.
 */

import type { PostingReading, StoredNode } from './model'

/** The reading on a file, when it has one. Central so nothing reaches in twice. */
export const readingOn = (file: StoredNode<'file'> | undefined): PostingReading | undefined =>
  file?.props.reading

/**
 * Whether the person discarded this reading.
 *
 * The tombstone is `clearedAt` rather than an empty list, because a posting can
 * genuinely state nothing measurable — `assess` has a case for it and the panel
 * says so — and "the model found nothing" must not read as "the person said
 * no". One of the two has to stop the automatic read; the other must not.
 */
export const isCleared = (reading: PostingReading | undefined): boolean =>
  reading?.clearedAt !== undefined

/**
 * Whether this reading is an answer the panel can render.
 *
 * A cleared reading is not, and neither is a missing one. `requirements` being
 * empty IS an answer — see `isCleared` — so it is deliberately not tested here.
 */
export const answered = (reading: PostingReading | undefined): boolean =>
  reading !== undefined && !isCleared(reading)

/**
 * Why a stored reading might no longer describe what the panel is showing.
 *
 * A union of one. It stays a union because the question it answers — what is
 * worth doubting — has more than one possible answer the moment a document
 * fingerprint is available to compare, and because `STALE_NOTE` being a
 * `Record` over it is what stops a second doubt shipping without copy.
 */
export type Stale =
  /** Read by a model the person is no longer connected to. */
  'model'

/**
 * What is worth doubting about this reading, or null.
 *
 * A blank `model` argument — nobody is connected — is NOT stale. It means the
 * question cannot be asked at the moment, and telling somebody their reading is
 * out of date at the same time as telling them to connect a model is two pieces
 * of bad news for one missing setting.
 *
 * A cleared reading is never stale either: there is nothing on screen for the
 * doubt to attach to, and a card that says "you threw this away, and it was out
 * of date" is arguing with somebody who has already left.
 */
export function staleOf(reading: PostingReading | undefined, model: string): Stale | null {
  if (reading === undefined || isCleared(reading)) return null

  const connected = model.trim()
  if (connected !== '' && connected !== reading.model) return 'model'

  return null
}

/** What the panel says about each doubt. Here, so both platforms say it once. */
export const STALE_NOTE: Readonly<Record<Stale, string>> = {
  model: 'Read by a different model than the one you have connected now.',
}
