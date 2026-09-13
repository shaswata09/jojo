/**
 * L4 — everything the fit panel does, once, for both apps.
 *
 * ## Why this exists
 *
 * It was written twice. `web/src/components/applications/detail/FitPanel.tsx`
 * and `mobile/src/components/applications/FitPanel.tsx` held 127 byte-identical
 * lines of state machine — five pieces of state, two refs, two effects and the
 * guidance memo — differing only by `const c = useColors()`. Nothing enforced
 * that: `check-no-copies` compares whole files and the JSX around them is
 * genuinely different, so the two copies were kept in step by whoever
 * remembered. The last person to change them left Re-run in the header on one
 * platform and at the foot of the card on the other.
 *
 * Persisting the reading would have been the third change to make twice, and
 * the first one where drifting means the two platforms DISAGREE ABOUT THE
 * STORE — one writing readings the other re-reads over. So the logic came here
 * and the panels kept what they are actually for, which is looking right on a
 * 13-inch screen and on a phone.
 *
 * ## What stays outside
 *
 * The decisions, because a hook cannot be tested under D20 — no component is
 * ever mounted, and that includes the one a renderer would mount to exercise
 * this. `nextFitAction` in `core/fit-request.ts` decides whether to read;
 * `core/fit-reading.ts` decides what a stored reading means; `assess` and
 * `tailor` decide the verdict. Every rule in this file's body is about React:
 * when an effect fires, what a ref remembers, what a cleanup aborts.
 *
 * The toast, too. Clearing a reading is undoable and both apps say so — but
 * `service/react/toast.ts` types its action as `{label, onClick}` and the
 * phone's as `{label, onPress}`, so `clear()` hands back the tool's result and
 * each app raises the toast its own provider understands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assess } from '../core/assess'
import { agoLabel } from '../core/dates'
import { answered, isCleared, readingOn, staleOf } from '../core/fit-reading'
import type { Stale } from '../core/fit-reading'
import { nextFitAction } from '../core/fit-request'
import type { NodeId, PostingReading } from '../core/model'
import { postingSourceFor } from '../core/posting-source'
import type { PostingSource } from '../core/posting-source'
import type { ModelSettings } from '../core/provider'
import { dayOf } from '../core/project'
import { guidanceFrom } from '../core/tailor'
import type { Guidance } from '../core/tailor'
import type { ToolResult } from '../tools/runtime'
import { useGraph, useKg } from './kg-context'
import { undoableWith } from './undo'
import type { RestoreOutcome } from './undo'
import { useRun } from './use-tool'
import type { FitStep, ReadFitOptions, FitOutcome } from './use-read-fit'
import type { Cancellation } from '../agent/loop'

/**
 * Why the panel has nothing to say, when it has nothing.
 *
 * Three of them rather than one "not enough information", because they are
 * genuinely different situations with different fixes and only one is about
 * this application. A card that renders the same sentence for all three is a
 * card people stop reading. The fourth way of having nothing to show — the
 * posting was read and states nothing measurable — is not here because it is
 * not a gap: it is an answer, and it arrives as a verdict like any other.
 */
export type FitBlocked =
  /** Typed in by hand, or captured before jojo kept pages. Nothing is wrong. */
  | 'no-posting'
  /** Settings. */
  | 'no-model'
  /** The Vault and the profile offer — this one resolves itself. */
  | 'no-background'

export type FitView = {
  /** The document being measured against, and how it was found. */
  source: PostingSource | null
  /** Why there is nothing to show. Null when there is something. */
  blocked: FitBlocked | null
  /** What was read and kept, when anything was. */
  reading: PostingReading | undefined
  /** Whether the person threw the reading away. */
  cleared: boolean
  /** The verdict, recomputed from the background on every render. */
  guidance: Guidance | null
  /** What is worth doubting about a stored reading. */
  stale: Stale | null
  /** 'Read by gemma_4_31b · 3 days ago', or null when nothing is stored. */
  readNote: string | null
  /** The step a read is on, or null when nothing is running. */
  step: FitStep | null
  error: string | null
  /**
   * Whether a read could happen — what Re-run is offered on.
   *
   * Not the same as whether the MENU is offered. A reading stored on a laptop
   * and opened on a phone with no model connected can still be cleared, and a
   * control that vanishes with the setting that produced it would leave the
   * person looking at a verdict they cannot get rid of.
   */
  ready: boolean
  /** Read the posting again, whatever is stored. Also clears a failure. */
  rerun: () => void
  /**
   * Throw the stored reading away, or null when there was nothing to clear.
   *
   * `restore` rather than the tool result's own `undo`: a toast lives for eight
   * seconds while the person keeps working, and `react/use-tool.ts` spells out
   * what an unguarded revert does when they have touched the same record since
   * — it puts a whole before-image back over what they did. This one declines
   * that case and names it, which is what `undoableWith` is for. Null when
   * nothing was committed to take back.
   */
  clear: () => { result: ToolResult<void>; restore: (() => RestoreOutcome) | null } | null
}

export function useFit<S extends Cancellation>({
  applicationId,
  settings,
  readFit,
  newSignal,
}: {
  applicationId: string
  settings: ModelSettings
  readFit: (options: ReadFitOptions<S>) => Promise<FitOutcome>
  /**
   * A fresh cancellation, from the platform.
   *
   * `AbortController` is in both runtimes, but the signal type is what makes
   * `useReadFit` generic (see `use-read-cv.ts`), and a hook that constructed one
   * itself would have to name that type here and lose the seam.
   */
  newSignal: () => { signal: S; abort: () => void }
}): FitView {
  const graph = useGraph()
  const { projections, today, repo } = useKg()
  const run = useRun()

  const source = useMemo(() => postingSourceFor(graph, applicationId), [graph, applicationId])
  const background = projections.background(graph)

  const fileId = source?.fileId
  const name = source?.name

  /*
   * The answer, read straight off the graph rather than copied into state.
   *
   * This is what the whole change buys: the panel no longer holds a list that a
   * navigation or a reload can lose, so returning to a record shows the verdict
   * on the first frame with nothing running. It also removes the reset effect
   * the old panels needed — a different application is a different `fileId` and
   * therefore a different lookup, which is not a thing that can go out of step.
   */
  const file = fileId === undefined ? undefined : graph.node(fileId as NodeId, 'file')
  const reading = readingOn(file)

  const [step, setStep] = useState<FitStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by Try again and by Re-run. See `fitRequestKey` — half the request's identity. */
  const [attempt, setAttempt] = useState(0)
  /**
   * The request already made, as a ref rather than state.
   *
   * Deliberately: recording that a request began must not cause a render, or
   * the decision changes as a consequence of having been taken. That is exactly
   * the loop the panels had — the read reported its first step synchronously,
   * the step was in the effect's dependency array, and the re-run's cleanup
   * aborted the request it had just started.
   */
  const started = useRef<string | null>(null)

  const configured = settings.model.trim() !== ''
  const ready = fileId !== undefined && configured && background.length > 0

  /*
   * `readFit`, `settings` and `newSignal` are read through a ref so that none of
   * them appears in the dependency array below. `readFit`'s identity changes
   * when the blob store finishes opening, and a dependency that moves while a
   * request is in flight makes the cleanup abort it. What the effect must react
   * to is the DECISION changing, and that is what `action` is.
   */
  const latest = useRef({ readFit, settings, newSignal })
  latest.current = { readFit, settings, newSignal }

  const action = nextFitAction({
    ready,
    fileId,
    attempt,
    cached: answered(reading),
    cleared: isCleared(reading),
  })

  /*
   * Hoisted out of the dependency array, because a ternary in there cannot be
   * checked statically and this is the value the effect actually turns on.
   * `null` covers both non-start actions, and neither needs to be distinguished
   * from the other by an identity — `action.do` carries that.
   */
  const startKey = action.do === 'start' ? action.key : null

  useEffect(() => {
    if (startKey === null || fileId === undefined || name === undefined) return
    /*
     * Asked exactly once, and checked HERE rather than in the decision above.
     *
     * The decision is a dependency of this effect, so anything it says has to
     * survive the request being recorded — see `fit-request.ts`. The ref does
     * not: nothing renders when it changes, which is precisely why the guard
     * belongs on this side of the dependency array.
     */
    if (started.current === startKey) return

    started.current = startKey
    const stop = latest.current.newSignal()
    const { readFit: read, settings: model } = latest.current

    void read({
      fileId,
      name,
      settings: model,
      // Every start that gets here with an attempt on it is a person asking
      // again. The stored reading is the answer they are rejecting, so it must
      // not be handed back to them — which is what it was, silently, before
      // `force` existed.
      force: attempt > 0,
      /*
       * Not `setStep` directly: an aborted read goes on reporting.
       *
       * `use-read-fit` calls this at each stage, and the stages are `await`ed
       * apart — so a read abandoned during "Opening the posting" still says
       * "Reading what it asks for" a few seconds later, after the cleanup below
       * has cleared the step and nothing is left to clear it again. Every
       * control on both panels is gated on `step === null`, so the card kept a
       * spinner and lost its menu for as long as it stayed mounted. Measured in
       * the browser: a Re-run under StrictMode left the step line under the new
       * verdict and the ⋯ menu gone.
       */
      onStep: (next) => {
        if (!stop.signal.aborted) setStep(next)
      },
      signal: stop.signal,
    })
      .then((outcome) => {
        if (stop.signal.aborted) return
        setStep(null)
        // Cleared on success as well as on failure. Without it a retry that
        // worked left the red line from the attempt before it sitting under a
        // fresh answer.
        setError(outcome.ok ? null : outcome.reason)
      })
      /*
       * Every layer under this reports failure as a value, so reaching here
       * means something threw that none of them expected. Without the catch
       * that is an unhandled rejection and a panel that spins on "Opening the
       * posting" for the rest of the session — the failure mode a person cannot
       * tell from a slow model.
       */
      .catch((thrown: unknown) => {
        if (stop.signal.aborted) return
        setStep(null)
        setError(thrown instanceof Error ? thrown.message : 'Reading the posting failed.')
      })

    return () => {
      stop.abort()
      /*
       * And the step goes with it.
       *
       * The `.then` above returns early when the signal is aborted — correctly,
       * since it must not write state for a read nobody is waiting for — which
       * left `step` on whatever the abort interrupted. Every control on both
       * panels is gated on `step === null`, so the card kept a spinner and no
       * menu for as long as it stayed mounted. StrictMode reproduces it on
       * every dev mount: effect, cleanup, effect, and the second pass finds the
       * request already made and starts nothing that would clear it.
       *
       * Safe against a read that is still wanted: React runs this cleanup
       * immediately before the next effect body, which sets its own step in the
       * same commit.
       */
      setStep(null)
    }
    // `startKey`, not `action` — the object is rebuilt on every render and would
    // re-run this on every one of them. `attempt` is read rather than watched:
    // it cannot change without `startKey` changing with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey, fileId, name])

  const guidance = useMemo(
    () =>
      answered(reading) && reading !== undefined
        ? guidanceFrom(assess(reading.requirements, background))
        : null,
    [reading, background],
  )

  const rerun = useCallback(() => {
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  const clear = useCallback(() => {
    if (fileId === undefined || reading === undefined) return null
    /*
     * The attempt counter goes back to zero in the same gesture, and it has to.
     * Clearing after a Re-run leaves `attempt` at 1, and `nextFitAction` lets an
     * attempt outrank the tombstone — so the next render would start a read of
     * the posting the person just discarded. Zero is also what the record would
     * be on if they had never pressed anything, which is the state a clear puts
     * them back into.
     */
    setAttempt(0)
    setError(null)
    /*
     * And the ref goes with it, or the way back is a dead button.
     *
     * `started` remembers the request key it last made. Re-run at attempt 1
     * makes `f#1`; a clear puts the counter back to 0; pressing "Measure this
     * posting" makes `f#1` AGAIN — and the effect, finding it has already asked
     * for that exact request, does nothing at all. The panel then cannot be
     * measured again for as long as it stays mounted, with no error and no
     * spinner to say why.
     */
    started.current = null
    const { value, restore } = undoableWith(repo, () =>
      run('fit.reading.clear', { fileId: fileId as NodeId }),
    )
    return { result: value, restore }
  }, [run, repo, fileId, reading])

  /*
   * `dayOf`, not `readAt.slice(0, 10)`.
   *
   * The instant is UTC and `today` is the user's own day, so slicing the string
   * compares one calendar against another: measured in the browser at 19:30
   * local, a reading taken seconds earlier rendered "Read by gemma_4_31b ·
   * Sep 13" — tomorrow, for something that had just happened. `tools/tool.ts`
   * names this exact mistake ("the calendar day comes out of that instant with
   * `dayOf` — never `.slice(0, 10)`").
   */
  const readNote =
    reading === undefined || isCleared(reading)
      ? null
      : `Read by ${reading.model} · ${agoLabel(dayOf(reading.readAt), today)}`

  return {
    source,
    /*
     * An answer outranks every reason for not having one.
     *
     * Without this the panel says both at once. A stored reading opened with no
     * model connected rendered "Reading what a posting asks for needs a model"
     * directly above the verdict it had already read; with no background it
     * rendered "jojo has not read anything about your background yet" above
     * `guidanceFrom`'s not-measured summary, which is the same sentence again.
     * Each of these three is a reason the panel is EMPTY, so each of them has
     * to yield the moment it is not.
     */
    blocked: answered(reading)
      ? null
      : source === null
        ? 'no-posting'
        : !configured
          ? 'no-model'
          : background.length === 0
            ? 'no-background'
            : null,
    reading,
    cleared: isCleared(reading),
    guidance,
    stale: staleOf(reading, settings.model),
    readNote,
    step,
    error,
    ready,
    rerun,
    clear,
  }
}
