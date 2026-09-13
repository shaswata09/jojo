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
 * choosing is half the card. There is therefore no `nextFitAction` here and no
 * started-ref; what there is instead is the same abort discipline, because a
 * navigation away mid-write must not leave a spinner behind or write a
 * snippet under a record nobody is looking at.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agoLabel } from '../core/dates'
import type { NodeId, ProfileDocument, SnippetTag } from '../core/model'
import { postingSourceFor } from '../core/posting-source'
import type { PostingSource } from '../core/posting-source'
import { dayOf } from '../core/project'
import type { ModelSettings } from '../core/provider'
import { candidatesFor, tailoredFor } from '../core/tailoring'
import type { TailorCandidate } from '../core/tailoring'
import type { HasBytes } from '../core/twin'
import type { ToolResult } from '../tools/runtime'
import type { Cancellation } from '../agent/loop'
import { useGraph, useKg } from './kg-context'
import { undoableWith } from './undo'
import type { RestoreOutcome } from './undo'
import { useRun } from './use-tool'
import type { TailorOptions, TailorOutcome, TailorStep } from './use-tailor'

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
  /** The step a run is on, or null when nothing is running. */
  step: TailorStep | null
  /** The name of the document being tailored, while one is. */
  target: string | null
  /** The reply so far, on a transport that streams. Empty otherwise. */
  draft: string
  error: string | null
  /** Tailor this document now. Resolves when it is saved or has failed. */
  start: (candidate: TailorCandidate) => Promise<TailorOutcome>
  /** Stop a run. The card's "Cancel". */
  cancel: () => void
  /**
   * Delete a tailored snippet, guarded the same way the fit card's Clear is —
   * see `use-fit.ts` on why not `result.undo`. Null when it is already gone.
   */
  remove: (
    snippetId: string,
  ) => { result: ToolResult<void>; restore: (() => RestoreOutcome) | null } | null
}

export function useTailoring<S extends Cancellation>({
  applicationId,
  settings,
  tailor,
  newSignal,
  hasBytes,
  documentsReady = true,
}: {
  applicationId: string
  settings: ModelSettings
  tailor: (options: TailorOptions<S>) => Promise<TailorOutcome>
  newSignal: () => { signal: S; abort: () => void }
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
  const { repo, today } = useKg()
  const run = useRun()

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

  const [step, setStep] = useState<TailorStep | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const running = useRef<{ abort: () => void } | null>(null)

  const latest = useRef({ tailor, settings, newSignal })
  latest.current = { tailor, settings, newSignal }

  // A navigation away mid-write stops the write. The snippet, had it landed,
  // would have been filed under a record nobody was looking at.
  useEffect(
    () => () => {
      running.current?.abort()
      running.current = null
    },
    [],
  )

  const cancel = useCallback(() => {
    running.current?.abort()
    running.current = null
    setStep(null)
    setTarget(null)
    setDraft('')
  }, [])

  const start = useCallback(
    async (candidate: TailorCandidate): Promise<TailorOutcome> => {
      running.current?.abort()
      const stop = latest.current.newSignal()
      running.current = stop
      setError(null)
      setDraft('')
      setTarget(candidate.name)
      setStep('posting')

      const { tailor: run_, settings: model } = latest.current
      let outcome: TailorOutcome
      try {
        outcome = await run_({
          applicationId,
          fileId: candidate.id,
          name: candidate.name,
          settings: model,
          signal: stop.signal,
          // Guarded, as the fit hook's is: an abandoned run must not go on
          // reporting into a card that has moved on.
          onStep: (next) => {
            if (!stop.signal.aborted) setStep(next)
          },
          onDelta: (soFar) => {
            if (!stop.signal.aborted) setDraft(soFar)
          },
        })
      } catch (thrown: unknown) {
        outcome = {
          ok: false,
          step: 'writing',
          reason: thrown instanceof Error ? thrown.message : 'Tailoring the document failed.',
        }
      }

      if (stop.signal.aborted) {
        return { ok: false, step: 'writing', reason: 'Stopped.' }
      }
      running.current = null
      setStep(null)
      setTarget(null)
      setDraft('')
      setError(outcome.ok ? null : outcome.reason)
      return outcome
    },
    [applicationId],
  )

  const remove = useCallback(
    (snippetId: string) => {
      if (graph.node(snippetId as NodeId, 'snippet') === undefined) return null
      const { value, restore } = undoableWith(repo, () =>
        run('vault.snippet.delete', { id: snippetId as NodeId }),
      )
      return { result: value, restore }
    },
    [graph, repo, run],
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
    step,
    target,
    draft,
    error,
    start,
    cancel,
    remove,
  }
}
