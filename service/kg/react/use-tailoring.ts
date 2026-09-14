/**
 * L4 — everything the tailoring card does, once, for both apps.
 *
 * The shape of `use-fit.ts`, for the reason that file gives: two panels that
 * each held a state machine drifted, and a card whose whole point is that a
 * model wrote something on the person's behalf must not behave differently on
 * the two screens they will read it on.
 *
 * ## What is different from the fit card
 *
 * Nothing starts on its own. The fit panel reads a posting the moment it can,
 * because a verdict is cheap and nobody has to review it. A tailored document
 * is minutes of a model's time and a thing the person will paste into an
 * application, so it happens when they choose a document and press — and the
 * choosing is half the card.
 *
 * ## The work is not this hook's
 *
 * It belongs to `react/jobs.ts`, mounted above the router, and this hook only
 * queues it and reads it back. The first version held the promise and the
 * `AbortController` here and aborted them from an unmount cleanup, which was
 * reported the day it shipped: "if I click tailor material and then while the
 * agent is writing the snippet I go to other tabs, this job gets cancelled".
 * It did, and a minute of a local model was thrown away by a click on a tab.
 *
 * So there is no promise in this file, no signal and no abort. `start` queues a
 * job whose id is what the work is ABOUT — the application and the document —
 * so pressing twice, remounting under StrictMode, or opening the same record in
 * a second place cannot start it twice; `cancel` asks the registry to stop one,
 * which is now the ONLY thing that stops one.
 */

import { useCallback, useMemo } from 'react'
import { agoLabel } from '../core/dates'
import { isOver, workState } from '../core/jobs'
import type { Job } from '../core/jobs'
import type { NodeId, ProfileDocument, SnippetTag } from '../core/model'
import { postingSourceFor } from '../core/posting-source'
import type { PostingSource } from '../core/posting-source'
import { dayOf } from '../core/project'
import type { ModelSettings } from '../core/provider'
import { TAILOR_STEP_LABEL } from './use-tailor'
import { candidatesFor, tailoredFor, titleFor } from '../core/tailoring'
import type { TailorCandidate } from '../core/tailoring'
import type { HasBytes } from '../core/twin'
import type { ToolResult } from '../tools/runtime'
import type { Cancellation } from '../agent/loop'
import { useGraph, useKg } from './kg-context'
import { useJobs, useJobsAbout } from './jobs-context'
import type { JobControl } from './jobs'
import { undoableWith } from './undo'
import type { RestoreOutcome } from './undo'
import { useRun } from './use-tool'
import type { TailorOptions, TailorOutcome } from './use-tailor'

/** One tailored document, as the card lists it. */
export type TailoredSnippet = {
  readonly id: string
  readonly title: string
  readonly tag: SnippetTag
  readonly body: string
  readonly kind: ProfileDocument
  /** The base document's name, or a sentence when it has since been deleted. */
  readonly from: string
  readonly model: string
  /** 'today', '3 days ago', 'Sep 2'. */
  readonly when: string
}

/**
 * Why the card offers nothing, when it offers nothing.
 *
 * Three, said differently, for the reason the fit card gives. A card that
 * lists tailored documents is NOT blocked by any of them — what is already
 * written stays readable with no model and no posting.
 */
export type TailoringBlocked =
  /** Typed in by hand, or captured before jojo kept pages. Nothing to tailor for. */
  | 'no-posting'
  /** Settings. */
  | 'no-model'
  /** Nothing in the Vault with bytes behind it that is not a posting. */
  | 'no-documents'

export type TailoringView = {
  source: PostingSource | null
  /** Why a new one cannot be made. Null when the chooser should be offered. */
  blocked: TailoringBlocked | null
  candidates: readonly TailorCandidate[]
  tailored: readonly TailoredSnippet[]
  /**
   * The tailoring job for this record that is still going, or null.
   *
   * From the registry above the router, so it is the same job whether the
   * person is looking at this record, another one, or the Vault. `step` on it
   * is what the card prints while it runs.
   */
  running: Job | null
  /**
   * Doubts the newest finished job raised about what it produced.
   *
   * Not an error: the document was written and saved. `readTailored` raises
   * these when a reply came back with nothing marked, or much shorter than the
   * source — things the person should know before they paste it into an
   * application, and which used to be computed and then dropped on the floor.
   */
  notes: readonly string[]
  /** What the last job for this record failed with, until another is started. */
  error: string | null
  /** Queue this document. Returns at once — the work is not this screen's. */
  start: (candidate: TailorCandidate) => void
  /** Stop the running job. The card's "Cancel". */
  cancel: () => void
  /**
   * Delete a tailored snippet, guarded the same way the fit card's Clear is —
   * see `use-fit.ts` on why not `result.undo`. Null when it is already gone.
   */
  remove: (
    snippetId: string,
  ) => { result: ToolResult<void>; restore: (() => RestoreOutcome) | null } | null
}

/** The job family this card owns. One string, so nothing spells it twice. */
export const KIND = 'tailor'

export function useTailoring<S extends Cancellation>({
  applicationId,
  settings,
  tailor,
  hasBytes,
  documentsReady = true,
}: {
  applicationId: string
  settings: ModelSettings
  tailor: (options: TailorOptions<S>) => Promise<TailorOutcome>
  /** The web's blob store answers this; the phone's file records answer it themselves. */
  hasBytes?: HasBytes
  /**
   * Whether `hasBytes` can answer yet. The web's blob index lists asynchronously
   * on mount, and until it has, every document reads as having no bytes — so
   * for a moment the card would tell a person with a Vault full of documents
   * that there is nothing to tailor. False here means "not yet", and the card
   * says nothing rather than something wrong.
   */
  documentsReady?: boolean
}): TailoringView {
  const graph = useGraph()
  const { repo, today, projections } = useKg()
  const run = useRun()

  /*
   * The employer, for the job's label. A toast that fires while the person is
   * three screens away has to name WHICH application finished, and "Tailored
   * CV is ready" about one of five open applications is not an answer.
   */
  const org = projections.application(graph, applicationId)?.org ?? ''

  const source = useMemo(() => postingSourceFor(graph, applicationId), [graph, applicationId])
  const candidates = useMemo(
    () => candidatesFor(graph, applicationId, hasBytes),
    [graph, applicationId, hasBytes],
  )
  const tailored = useMemo<TailoredSnippet[]>(
    () =>
      tailoredFor(graph, applicationId).map((n) => {
        const t = n.props.tailored
        const from =
          t === undefined ? undefined : graph.node(t.source as NodeId, 'file')?.props.name
        return {
          id: n.id,
          title: n.props.title,
          tag: n.props.tag,
          body: n.props.body,
          kind: t?.kind ?? 'other',
          from: from ?? 'a document no longer in the Vault',
          model: t?.model ?? '',
          when: t === undefined ? '' : agoLabel(dayOf(t.at), today),
        }
      }),
    [graph, applicationId, today],
  )

  const queue = useJobs()
  const all = useJobsAbout(applicationId)
  /*
   * The rule lives in `core/jobs.ts` so it can be asserted without a tree.
   *
   * It used to be three lines here, and it was wrong in a way nothing could
   * catch: the failure was hidden only while SOMETHING was live, so a failure
   * from an earlier document came back the moment a different one succeeded.
   */
  const { running, error, notes } = workState(all, KIND)
  const mine = all.filter((j) => j.kind === KIND)

  const cancel = useCallback(() => {
    if (running !== null) queue.cancel(running.id)
  }, [queue, running])

  const start = useCallback(
    (candidate: TailorCandidate): void => {
      /*
       * The id is what the work is about, not when it was asked for, so the
       * registry can refuse a second copy of it. A document already tailored
       * for this record and asked for again is a NEW job with the same name —
       * `enqueue` replaces a settled one, which is exactly "do it again".
       */
      queue.start({
        id: `${KIND}:${applicationId}:${candidate.id}`,
        kind: KIND,
        label: titleFor(candidate.kind, org),
        about: applicationId,
        /*
         * The point of the queue, from the person's side: they asked for this
         * and then went to another screen, so finishing has to announce itself.
         */
        notify: true,
        /*
         * Typed as this app's signal rather than the structural `Cancellation`
         * the registry names: `newSignal` on the provider is the app's, so the
         * signal a job is handed IS an `AbortSignal` on both platforms, and
         * `tailor` passes it to a transport that requires one.
         */
        run: async ({ signal, onStep }: JobControl<S>) => {
          /*
           * `onDelta` is what selects the STREAMED road, and dropping it in the
           * move to the queue quietly turned streaming off for web tailoring.
           * That is not cosmetic: a timeout is TOTAL on the batched road and
           * IDLE on the streamed one. Web tailoring passes its own
           * `DOCUMENT_TIMEOUT_MS` (four minutes), so the batched road gives a
           * long CV four minutes end to end however steadily it is arriving,
           * where the streamed road re-arms on every chunk and only gives up on
           * a model that has actually stopped.
           * It also puts the progress back on the card, which is the only sign
           * a person has that a minute of silence is work.
           */
          let said = 0
          const outcome = await tailor({
            applicationId,
            fileId: candidate.id,
            name: candidate.name,
            settings,
            signal,
            onStep: (next) => {
              onStep(`${TAILOR_STEP_LABEL[next]} · ${candidate.name}`)
            },
            onDelta: (soFar) => {
              // Every chunk notifies the whole registry, so the card is told in
              // steps of twenty words rather than on each token.
              const words = soFar.trim() === '' ? 0 : soFar.trim().split(/\s+/).length
              if (words < said + 20) return
              said = words
              onStep(`Writing · ${candidate.name} · ${String(words)} words`)
            },
          })
          return outcome.ok
            ? // The doubts travel with the job, because the person who asked
              // for this may be on another screen by the time it lands.
              { ok: true, ...(outcome.notes.length === 0 ? {} : { notes: outcome.notes }) }
            : { ok: false, reason: outcome.reason }
        },
      })
    },
    [queue, applicationId, tailor, settings, org],
  )

  const remove = useCallback(
    (snippetId: string) => {
      if (graph.node(snippetId as NodeId, 'snippet') === undefined) return null
      const { value, restore } = undoableWith(repo, () =>
        run('vault.snippet.delete', { id: snippetId as NodeId }),
      )
      /*
       * And the job that produced it is forgotten, so its doubts go with it.
       *
       * `workState` reports the notes of the newest finished job, and nothing
       * but a new job cleared them — so deleting the tailored document left its
       * "nothing in the reply was marked" sitting under a card with no document
       * on it, describing something that no longer exists.
       */
      if (value.ok) {
        for (const j of mine) {
          if (isOver(j) && (j.notes?.length ?? 0) > 0) queue.forget(j.id)
        }
      }
      return { result: value, restore }
    },
    [graph, repo, run, mine, queue],
  )

  const configured = settings.model.trim() !== ''

  return {
    source,
    blocked:
      source === null
        ? 'no-posting'
        : !configured
          ? 'no-model'
          : candidates.length === 0
            ? documentsReady
              ? 'no-documents'
              : null
            : null,
    candidates,
    tailored,
    running,
    notes,
    error,
    start,
    cancel,
    remove,
  }
}
