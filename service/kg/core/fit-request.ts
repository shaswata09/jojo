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
 */

/**
 * Identifies one request, so it can be made exactly once.
 *
 * The attempt is part of it because "read this again" has to be distinguishable
 * from "read this", and a boolean cannot express that: after a failure the
 * document is unchanged, so any key built from the document alone says the work
 * is already done and Try again does nothing.
 */
export const fitRequestKey = (fileId: string, attempt: number): string =>
  `${fileId}#${String(attempt)}`

export type FitAction =
  /** Nothing to ask about, or nothing to ask with. */
  | { do: 'nothing' }
  /** Already read this session. Show it; do not spend a round trip. */
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
  /** Bumped by Try again, and by nothing else. */
  attempt: number
  /** Whether this document has already been read this session. */
  cached: boolean
  /** The key of the request already made, or null. */
  started: string | null
}): FitAction {
  const { ready, fileId, attempt, cached, started } = input
  if (!ready || fileId === undefined) return { do: 'nothing' }

  /*
   * Before the started check, not after. A document read for one application
   * is read for every application pointing at the same posting — the cache is
   * keyed on the document for exactly that reason — so a second record must
   * show the answer rather than pay for it again, even though it has never
   * started a request of its own.
   */
  if (cached) return { do: 'use-cache' }

  const key = fitRequestKey(fileId, attempt)
  return started === key ? { do: 'nothing' } : { do: 'start', key }
}
