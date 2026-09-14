/**
 * L4 — the checklist card's state, shared by both apps.
 *
 * `use-tailoring.ts`'s shape, with one difference that changes the whole card:
 * this is the only panel on the record a person TOUCHES rather than reads. So
 * it is never blocked. A hand-typed list on a hand-entered application with no
 * model connected is still a checklist, and `blocked` withholds the Draft
 * button alone — the list and the add box render in every state.
 *
 * ## Which writes raise a toast
 *
 * Delete does. Ticking, unticking and adding do not, and that is a reading of
 * the Undo law rather than a lapse from it: the law asks that nothing be
 * unrecoverable, and a checkbox is its own visible inverse sitting under the
 * person's finger. Eight ticks would be eight toasts, the toast host discards
 * the early ones anyway, and ⌘Z still reverts every one of them. The line: a
 * write that can destroy something the person typed raises a toast with Undo;
 * a write whose inverse IS the control in front of them does not.
 */

import { useCallback, useMemo } from 'react'
import { addBlocker, itemsOf, openCount } from '../core/checklist'
import { workState } from '../core/jobs'
import type { Job } from '../core/jobs'
import type { ChecklistItem, NodeId } from '../core/model'
import { postingSourceFor } from '../core/posting-source'
import type { PostingSource } from '../core/posting-source'
import type { ModelSettings } from '../core/provider'
import type { Cancellation } from '../agent/loop'
import type { ToolResult } from '../tools/runtime'
import { CHECKLIST_STEP_LABEL } from './use-draft-checklist'
import type { DraftOptions, DraftOutcome } from './use-draft-checklist'
import { useGraph, useKg } from './kg-context'
import { useJobs, useJobsAbout } from './jobs-context'
import type { JobControl } from './jobs'
import { undoableWith } from './undo'
import type { RestoreOutcome } from './undo'
import { useRun } from './use-tool'

const KIND = 'checklist'

/** Why a new list cannot be DRAFTED. The card itself is never blocked. */
export type ChecklistBlocked =
  /** Typed in by hand, or captured before jojo kept pages. */
  | 'no-posting'
  /** Settings. */
  | 'no-model'

export type ChecklistView = {
  items: readonly ChecklistItem[]
  /** How many are still open, and how many there are. The panel's hint. */
  open: number
  source: PostingSource | null
  /** Why Draft is not offered. The list and the add box do not consult this. */
  blocked: ChecklistBlocked | null
  /** The drafting job for this record that is still going, or null. */
  running: Job | null
  /** What it is doing now, in the person's words. */
  step: string | null
  notes: readonly string[]
  error: string | null
  /** Queue a drafting run. Returns at once — the work is not this screen's. */
  draft: () => void
  cancel: () => void
  /** Why the add box cannot take this text, or null. Shown on the control. */
  blockerFor: (text: string) => string | null
  add: (text: string) => ToolResult<void>
  tick: (itemId: string, done: boolean) => void
  rename: (itemId: string, text: string) => void
  /** Deleting is the one action that can lose something the person typed. */
  remove: (
    itemId: string,
  ) => { result: ToolResult<void>; restore: (() => RestoreOutcome) | null } | null
}

export function useChecklist<S extends Cancellation>({
  applicationId,
  settings,
  draft: run,
}: {
  applicationId: string
  settings: ModelSettings
  draft: (options: DraftOptions<S>) => Promise<DraftOutcome>
}): ChecklistView {
  const graph = useGraph()
  const { repo } = useKg()
  const runTool = useRun()
  const queue = useJobs()

  const node = graph.node(applicationId as NodeId, 'application')
  const items = itemsOf(node?.props.checklist)

  const source = useMemo(() => postingSourceFor(graph, applicationId), [graph, applicationId])
  const configured = settings.model.trim() !== ''

  const { running, error, notes } = workState(useJobsAbout(applicationId), KIND)
  const step =
    running?.state === 'queued'
      ? 'Queued'
      : running?.state === 'running'
        ? (running.step ?? CHECKLIST_STEP_LABEL.drafting)
        : null

  const draft = useCallback(() => {
    if (source === null || !configured) return
    queue.start({
      // What it is ABOUT, not when it was asked for: pressing twice, or
      // remounting under StrictMode, must not queue two runs.
      id: `${KIND}:${applicationId}`,
      kind: KIND,
      label: 'Your checklist',
      about: applicationId,
      /*
       * A minute of a local model's time, asked for by a button press. The
       * person is expected to walk away from it, which is what the toast on the
       * other end is for.
       */
      notify: true,
      run: async ({ signal, onStep }: JobControl<S>) => {
        const outcome = await run({
          applicationId,
          settings,
          signal,
          onStep: (next) => {
            onStep(CHECKLIST_STEP_LABEL[next])
          },
        })
        return outcome.ok
          ? { ok: true, ...(outcome.notes.length === 0 ? {} : { notes: outcome.notes }) }
          : { ok: false, reason: outcome.reason }
      },
    })
  }, [queue, applicationId, run, settings, source, configured])

  const cancel = useCallback(() => {
    if (running !== null) queue.cancel(running.id)
  }, [queue, running])

  const blockerFor = useCallback((text: string) => addBlocker(items, text), [items])

  const add = useCallback(
    (text: string) => runTool('application.checklist.item.add', { id: applicationId as NodeId, text }),
    [runTool, applicationId],
  )

  const tick = useCallback(
    (itemId: string, done: boolean) => {
      runTool('application.checklist.item.set', { id: applicationId as NodeId, itemId, done })
    },
    [runTool, applicationId],
  )

  const rename = useCallback(
    (itemId: string, text: string) => {
      runTool('application.checklist.item.set', { id: applicationId as NodeId, itemId, text })
    },
    [runTool, applicationId],
  )

  const remove = useCallback(
    (itemId: string) => {
      if (!items.some((i) => i.id === itemId)) return null
      /*
       * `undoableWith` rather than the tool's own undo, for the reason
       * `use-tool.ts` gives: a toast lives eight seconds while the person keeps
       * working, and an unguarded revert puts a whole before-image back over
       * whatever they did since. Here that before-image is the entire list, so
       * the guard is doing more work than usual — a delete undone after a tick
       * declines and says so rather than silently unticking.
       */
      const { value, restore } = undoableWith(repo, () =>
        runTool('application.checklist.item.remove', { id: applicationId as NodeId, itemId }),
      )
      return { result: value, restore }
    },
    [repo, runTool, applicationId, items],
  )

  return {
    items,
    open: openCount(items),
    source,
    blocked: source === null ? 'no-posting' : !configured ? 'no-model' : null,
    running,
    step,
    notes,
    error,
    draft,
    cancel,
    blockerFor,
    add,
    tick,
    rename,
    remove,
  }
}
