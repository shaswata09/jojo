import { useCallback } from 'react'
import { readingOn } from '../core/fit-reading'
import { readRequirements, requirementMessages } from '../agent/read-requirements'
import type { Requirement } from '../core/assess'
import type { NodeId } from '../core/model'
import type { ModelSettings } from '../core/provider'
import { useKg } from './kg-context'
import type { ReadCvDeps } from './use-read-cv'
import type { Cancellation } from '../agent/loop'

/**
 * What a saved posting asks for, read once per document and kept.
 *
 * ## What changed, and why the old answer was wrong
 *
 * This held its answers in a module-level `Map` and said, at length, that they
 * must NOT survive a reload: "a stale requirement list is a wrong score with no
 * way to notice", and a reload was the invalidation. That reasoning had one
 * cost nobody had measured, and it is the cost the user reported — every
 * refresh re-read the posting. Opening the same application twice in a morning
 * spent two model calls and thirty seconds of spinner to arrive back at the
 * answer it already had, and on a laptop that sleeps, "the session" is an hour.
 *
 * A cache whose only invalidation is losing the tab is not a strategy; it is an
 * outage on a timer. The answers live in the graph now — on the `file` node
 * they were read from, as `PostingReading` — and the invalidation that a reload
 * was standing in for is done properly instead:
 *
 *   - A re-captured posting is a NEW file node, so its reading is not found and
 *     the page is read again. That is the case the old comment was really about.
 *   - A model swap is reported beside the verdict rather than silently redoing
 *     it. See `staleOf` in `core/fit-reading.ts`.
 *   - Re-run reads again on demand, which is what a person does when they
 *     disbelieve an answer — and it now works, which it did not: the Map was
 *     consulted BEFORE anything else, so the button returned the same list
 *     without asking anybody. `force` is that fix.
 *
 * What is emphatically NOT stored is the SCORE. `assess` and `guidanceFrom` run
 * on every render against the background of the moment, so recording a new
 * publication moves the verdict without a model call. The expensive half is
 * kept; the cheap half stays honest.
 *
 * ## Why this one writes when `use-read-cv` refuses to
 *
 * Its header says "Nothing here writes. It returns drafts", and that is still
 * right there: reading a CV proposes facts about a person, and a person has to
 * agree to them before they are recorded. Nobody reviews a requirement list.
 * It is not a claim about the user — it is what a page says — and it goes
 * straight into arithmetic nobody is asked to approve. Storing it here is the
 * difference between a cache and a consent flow.
 */

/*
 * The same two platform functions `use-read-cv.ts` takes, and generic in the
 * signal for the same reason its comment gives.
 */
export type ReadFitDeps<S extends Cancellation> = ReadCvDeps<S>

export type FitStep = 'reading' | 'asking'

export type FitOutcome =
  | { ok: true; requirements: readonly Requirement[]; cached: boolean }
  | { ok: false; step: FitStep; reason: string }

export type ReadFitOptions<S extends Cancellation = Cancellation> = {
  /** The saved posting, from `postingSourceFor`. */
  fileId: string
  /** Its name. Goes to the model as the posting's title. */
  name: string
  settings: ModelSettings
  /**
   * Read it again even though a reading is stored. What Re-run means.
   *
   * Without this the stored answer short-circuits every call, which is exactly
   * what the module Map did — and the button that exists to say "I do not
   * believe this" returned the answer being disbelieved. Persisting made that
   * permanent rather than merely session-long, so the two changes had to ship
   * together.
   */
  force?: boolean
  onStep?: (step: FitStep) => void
  signal?: S
}

/**
 * Below this, the capture holds no posting.
 *
 * The same guard `posting-agent.ts` applies to a freshly fetched page, applied
 * here to a stored one — a capture of a JavaScript-only board is a shell, and
 * it is worth catching before paying for a model call to be told so.
 */
const TOO_SHORT = 200

export function useReadFit<S extends Cancellation>({
  turn,
  readDocument,
}: ReadFitDeps<S>): (options: ReadFitOptions<S>) => Promise<FitOutcome> {
  const { repo, runtime } = useKg()

  return useCallback(
    async ({
      fileId,
      name,
      settings,
      force = false,
      onStep,
      signal,
    }: ReadFitOptions<S>): Promise<FitOutcome> => {
      /*
       * `repo.getSnapshot()` rather than a rendered graph, for the reason
       * `read-back.ts` gives: this runs from an effect, after the render that
       * decided to call it, and a prewarm calls it with no render at all.
       */
      const held = readingOn(repo.getSnapshot().node(fileId as NodeId, 'file'))
      /*
       * A CLEARED reading stops this too, and that is the whole point of the
       * tombstone rather than an accident of the check.
       *
       * The panel never asks about a cleared posting — `nextFitAction` answers
       * "nothing" — but the panel is not the only caller. Both apps prewarm from
       * the create form, unasked, and a prewarm that read past a clear would
       * quietly re-read a posting the person had discarded and overwrite the
       * tombstone with a fresh verdict. `force` is the one way past, and only a
       * person pressing Re-run sets it.
       *
       * The empty list a cleared reading hands back is right for every caller:
       * the prewarm discards its result, and nothing else reaches here without
       * `force`.
       */
      if (!force && held !== undefined) {
        return { ok: true, requirements: held.requirements, cached: true }
      }

      /* ----------------------------- 1. read ----------------------------- */
      onStep?.('reading')
      const document = await readDocument(fileId)
      if (!document.ok) return { ok: false, step: 'reading', reason: document.reason }

      if (document.markdown.trim().length < TOO_SHORT) {
        return {
          ok: false,
          step: 'reading',
          reason: `${name} came back nearly empty. A board that renders with JavaScript sends a blank shell to anything but a browser, and that is what was saved.`,
        }
      }

      /* ----------------------------- 2. ask ------------------------------ */
      onStep?.('asking')
      const reply = await turn(settings, requirementMessages(name, document.markdown), [], signal)
      if (!reply.ok) return { ok: false, step: 'asking', reason: reply.reason }
      if (reply.text === null || reply.text.trim() === '') {
        return { ok: false, step: 'asking', reason: 'The model answered with nothing at all.' }
      }

      const read = readRequirements(reply.text)
      if (!read.ok) return { ok: false, step: 'asking', reason: read.reason }

      /* ---------------------------- 3. keep ------------------------------ */
      /*
       * The write's result IS checked, and that is a consequence of storing the
       * reading rather than caution.
       *
       * The panels render from the graph now — that is what makes an answer
       * survive a reload — so a refused write is not a lost head start, it is a
       * blank card under a read that worked, with no error and nothing to press.
       * The realistic refusal is the document being deleted while the model was
       * thinking; whatever it is, the person needs to be told, and `Try again`
       * is exactly the right control to be looking at.
       */
      const kept = runtime.run('fit.reading.set', {
        fileId: fileId as NodeId,
        requirements: read.requirements.map((r) => ({ text: r.text, essential: r.essential })),
        model: settings.model,
        ...(read.skipped.length === 0 ? {} : { skipped: read.skipped.length }),
      })
      if (!kept.ok) {
        return {
          ok: false,
          step: 'asking',
          reason:
            kept.errors[0]?.message ??
            `${name} was read, but the reading could not be saved against it.`,
        }
      }

      return { ok: true, requirements: read.requirements, cached: false }
    },
    [readDocument, turn, repo, runtime],
  )
}
