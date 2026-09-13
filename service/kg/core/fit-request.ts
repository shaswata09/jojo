/**
 * Whether the fit panel should ask for a posting to be read. L1 core.
 *
 * A three-line decision that exists as its own module for one reason: it is the
 * part of the panel that can be wrong, and under D20 the panel itself cannot be
 * tested at all. Components are never mounted here, so a rule left inside a
 * `useEffect` is a rule checked by clicking. Pulled out, it is five assertions.
 *
 * ## The bug it was extracted from
 *
 * The first version had the effect guard on its own React state — "do not start
 * if a step is showing" — with that state in the dependency array. The read
 * reports its first step synchronously, so starting a read set state, the state
 * change re-ran the effect, and the effect's cleanup aborted the request it had
 * just started. The panel could never load, and no test in the repository could
 * have said so.
 *
 * The fix is to decide from values that do not change as a side effect of
 * deciding. A key over the document and the attempt is exactly that: it moves
 * when the user picks a different application or presses Try again, and at no
 * other time.
 *
 * ## Why `started` is not an input
 *
 * It was, and that put the bug back by another door. The panel keys its effect
 * on this decision, and a decision that answered "nothing, that one is already
 * running" CHANGED the moment the request was recorded — which is immediately,
 * because `use-read-fit` reports its first step before its first await. The
 * dependency array moved, React ran the cleanup, and the cleanup aborted the
 * read that had just started. Same failure, one level up.
 *
 * So this names the request it wants and says so on every render, unchanged for
 * as long as the same one is wanted. Asking exactly once is the CALLER's job,
 * and belongs where it cannot be observed: a ref, compared inside the effect,
 * after the dependency array has already been decided.
 */

/**
 * Identifies one request, so it can be made exactly once.
 *
 * The attempt is part of it because "read this again" has to be distinguishable
 * from "read this", and a boolean cannot express that: after a failure the
 * document is unchanged, so any key built from the document alone says the work
 * is already done and Try again does nothing.
 *
 * It carries more weight since the reading was persisted. The key used to be
 * session-scoped by accident — a reload emptied the cache and every question
 * was asked fresh — and now the only thing that distinguishes "show me the
 * stored answer" from "go and read it again" is this counter.
 */
export const fitRequestKey = (fileId: string, attempt: number): string =>
  `${fileId}#${String(attempt)}`

export type FitAction =
  /** Nothing to ask about, nothing to ask with, or an answer already refused. */
  | { do: 'nothing' }
  /** Already read. Show what is stored; do not spend a round trip. */
  | { do: 'use-cache' }
  /** Ask. The caller records the key so it never asks twice. */
  | { do: 'start'; key: string }

/**
 * What the panel should do on this render.
 *
 * `started` is what the caller last asked for — a ref rather than state,
 * deliberately: recording that a request began must not itself cause a render,
 * or the decision changes as a consequence of having been taken, which is the
 * loop this module was extracted from.
 */
export function nextFitAction(input: {
  /** A posting, a model and something to weigh against it. */
  ready: boolean
  /** The document to read. Absent means there is no posting behind this record. */
  fileId: string | undefined
  /** Bumped by Try again and by Re-run, and by nothing else. */
  attempt: number
  /** Whether a reading of this document is stored. See `core/fit-reading.ts`. */
  cached: boolean
  /** Whether the person threw the stored reading away. */
  cleared: boolean
}): FitAction {
  const { ready, fileId, attempt, cached, cleared } = input
  if (!ready || fileId === undefined) return { do: 'nothing' }

  /*
   * A discarded reading is an answer, and the answer was no.
   *
   * Before the reading was stored, the panel could not be asked this: a delete
   * lost the list and the next mount read the posting again, which was invisible
   * because the next mount was usually the next session. Stored, it is the whole
   * behaviour of the button — somebody presses Clear, the card empties, and
   * without this line the effect starts a model call on the very next render and
   * the verdict they just discarded comes straight back.
   *
   * ABOVE the cache check rather than folded into it, because the two say
   * different things to a reader: `cached` is "there is an answer", this is
   * "there is a person who does not want one". And below `ready`, because a
   * cleared reading on a record with no model connected is still nothing to do.
   *
   * Attempt zero only. Re-run is somebody asking, and asking outranks having
   * declined — the same reason it outranks the cache below, spelled out there.
   */
  if (cleared && attempt === 0) return { do: 'nothing' }

  /*
   * The cache answers for the FIRST attempt only.
   *
   * A document read for one application is read for every application pointing
   * at the same posting — the cache is keyed on the document for exactly that
   * reason — so a second record shows the answer rather than paying for it
   * again. But Re-run is somebody saying "read it again" about a posting that
   * has already been read: the capture was replaced, or the model was, or they
   * simply do not believe it. The cache holds the very answer they are
   * rejecting, so it has to yield to them.
   */
  if (cached && attempt === 0) return { do: 'use-cache' }

  return { do: 'start', key: fitRequestKey(fileId, attempt) }
}
