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
import { useJob, useJobs } from './jobs-context'
import type { JobControl } from './jobs'
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
}: {
  applicationId: string
  settings: ModelSettings
  readFit: (options: ReadFitOptions<S>) => Promise<FitOutcome>
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

  const [attempt, setAttempt] = useState(0)

  const configured = settings.model.trim() !== ''
  const ready = fileId !== undefined && configured && background.length > 0

  const queue = useJobs()
  const latest = useRef({ readFit, settings })
  latest.current = { readFit, settings }

  const action = nextFitAction({
    ready,
    fileId,
    attempt,
    cached: answered(reading),
    cleared: isCleared(reading),
  })

  /*
   * The request key IS the job's id, which is what replaced the `started` ref.
   *
   * That ref existed because the decision must not change as a consequence of
   * having been taken — `fit-request.ts` says so at length — so the record of
   * "already asked" had to live somewhere nothing renders on. A registry above
   * the router is a better somewhere: it survives the panel, so a read is not
   * asked for twice when the person comes back mid-read, and `enqueue` refuses
   * a second copy of a live id without this file owning a ref at all.
   */
  const startKey = action.do === 'start' ? action.key : null
  const job = useJob(startKey)
  const step = job?.state === 'running' ? ((job.step ?? null) as FitStep | null) : null
  const error = job?.state === 'failed' ? (job.error ?? null) : null

  useEffect(() => {
    if (startKey === null || fileId === undefined || name === undefined) return
    const { readFit: read, settings: model } = latest.current
    queue.start({
      id: startKey,
      kind: 'fit',
      label: `How you fit — ${name}`,
      about: applicationId,
      /*
       * Quiet. This starts on its own the moment a record is opened, and a
       * toast for every application somebody looks at is the app talking about
       * its own housekeeping. The verdict appearing on the card is the news.
       */
      run: async ({ signal, onStep }: JobControl<S>) => {
        const outcome = await read({
          fileId,
          name,
          settings: model,
          // Every start that gets here with an attempt on it is a person asking
          // again. The stored reading is the answer they are rejecting, so it
          // must not be handed back to them.
          force: attempt > 0,
          onStep,
          signal,
        })
        return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason }
      },
    })
    // No cleanup. A read abandoned when the person changed screens was a read
    // paid for twice; the queue owns it now, and only `cancel` stops one.
  }, [queue, startKey, fileId, name, applicationId, attempt])

  const guidance = useMemo(
    () =>
      answered(reading) && reading !== undefined
        ? guidanceFrom(assess(reading.requirements, background))
        : null,
    [reading, background],
  )

  const rerun = useCallback(() => {
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
    /*
     * The counter goes back to zero, and nothing else needs resetting: the job
     * for `f#1` has settled by the time there is a reading to clear, and
     * `enqueue` replaces a settled job with the same id. That is what makes
     * "Measure this posting" work after a Re-run — the dead button this hook
     * had when the record of "already asked" was a ref it never reset.
     */
    setAttempt(0)
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
