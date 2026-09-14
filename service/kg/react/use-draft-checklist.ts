/**
 * L4 — one drafting run for an application's checklist.
 *
 * `use-tailor.ts`'s shape, with two deliberate differences.
 *
 * It uses the FIT transport rather than the tailoring one: no `onDelta`, and
 * the default timeout rather than the four-minute document budget. The reply is
 * a few hundred tokens of JSON, not a rewritten CV, and `LIMIT` is one — so a
 * four-minute budget on this would let a hung server hold the queue's only slot
 * while the person's fit read and tailoring wait behind it.
 *
 * And everything it reads is already on disk or is arithmetic: the posting
 * document, the reading the fit panel stored, the guidance that falls out of it,
 * and the NAMES of what is filed under the job. No second model call, and no
 * document body but the posting's — a filed CV in the prompt is thousands of
 * tokens on every draft and tells the model nothing about what to go and do.
 */

import { useCallback } from 'react'
import { answered, readingOn } from '../core/fit-reading'
import { assess } from '../core/assess'
import { checklistMessages, readChecklist } from '../agent/draft-checklist'
import { itemsOf } from '../core/checklist'
import { postingSourceFor } from '../core/posting-source'
import { guidanceFrom } from '../core/tailor'
import type { ChatMessage, Turn } from '../core/model-server'
import type { ModelSettings } from '../core/provider'
import type { NodeId } from '../core/model'
import type { Cancellation } from '../agent/loop'
import { useKg } from './kg-context'

/** What the person is told while it runs. */
export type ChecklistStep = 'posting' | 'drafting' | 'saving'

export const CHECKLIST_STEP_LABEL: Readonly<Record<ChecklistStep, string>> = {
  posting: 'Reading the posting',
  drafting: 'Drafting the steps',
  saving: 'Saving',
}

export type DraftOutcome =
  | {
      ok: true
      /** How many steps actually landed. Zero is a real answer, not a failure. */
      added: number
      /** Doubts about a list that WAS produced. Travels on the job. */
      notes: readonly string[]
    }
  | { ok: false; step: ChecklistStep; reason: string }

export type DraftOptions<S extends Cancellation = Cancellation> = {
  applicationId: string
  settings: ModelSettings
  onStep?: (step: ChecklistStep) => void
  signal?: S
}

export type DraftDeps<S extends Cancellation> = {
  turn: (settings: ModelSettings, messages: readonly ChatMessage[], signal?: S) => Promise<Turn>
  readDocument: (fileId: string) => Promise<{ ok: true; markdown: string } | { ok: false; reason: string }>
}

export function useDraftChecklist<S extends Cancellation>({
  turn,
  readDocument,
}: DraftDeps<S>): (options: DraftOptions<S>) => Promise<DraftOutcome> {
  const { repo, runtime, projections } = useKg()

  return useCallback(
    async ({ applicationId, settings, onStep, signal }: DraftOptions<S>): Promise<DraftOutcome> => {
      // Committed before the press, so the snapshot is the right reading.
      const memory = repo.getSnapshot()
      const application = projections.application(memory, applicationId)
      if (!application) {
        return { ok: false, step: 'posting', reason: 'That application is no longer in the store.' }
      }
      const source = postingSourceFor(memory, applicationId)
      if (source === null) {
        return {
          ok: false,
          step: 'posting',
          reason:
            'There is no saved posting behind this application, so there is nothing to read a checklist out of. You can still add your own steps.',
        }
      }

      /* --------------------------- 1. the posting ------------------------- */
      onStep?.('posting')
      const posting = await readDocument(source.fileId)
      if (!posting.ok) return { ok: false, step: 'posting', reason: posting.reason }

      const node = memory.node(applicationId as NodeId, 'application')
      const existing = itemsOf(node?.props.checklist).map((i) => ({
        text: i.text,
        done: i.doneOn !== undefined,
      }))

      const reading = readingOn(memory.node(source.fileId as NodeId, 'file'))
      const requirements = answered(reading) && reading !== undefined ? reading.requirements : []
      const background = projections.background(memory)
      const guidance =
        requirements.length > 0 && background.length > 0
          ? guidanceFrom(assess(requirements, background))
          : null

      /*
       * NAMES, never bodies. What is already filed tells the model which steps
       * are done; what is in those documents tells it nothing it needs.
       */
      const filed = [
        ...memory.many(applicationId as NodeId, 'FILED_UNDER', 'in', 'file').map((n) => n.props.name),
        ...memory.many(applicationId as NodeId, 'FILED_UNDER', 'in', 'link').map((n) => n.props.title),
        ...memory
          .many(applicationId as NodeId, 'FILED_UNDER', 'in', 'person')
          .map((n) => n.props.name),
      ]
      // So the list does not re-propose what is already a reminder.
      const dated = memory
        .many(applicationId as NodeId, 'ABOUT', 'in', 'timelineItem')
        .map((n) => `${n.props.title} · ${n.props.date}`)

      if (signal?.aborted) return { ok: false, step: 'posting', reason: 'Stopped.' }

      /* ---------------------------- 2. the draft -------------------------- */
      onStep?.('drafting')
      const reply = await turn(
        settings,
        checklistMessages({
          org: application.org,
          role: application.role,
          postingName: source.name,
          posting: posting.markdown,
          requirements: requirements.map((r) => r.text),
          guidance: guidance === null ? [] : guidance.prepare.map((p) => p.requirement),
          existing,
          filed,
          dated,
        }),
        signal,
      )
      if (!reply.ok) return { ok: false, step: 'drafting', reason: reply.reason }
      if (reply.text === null || reply.text.trim() === '') {
        return { ok: false, step: 'drafting', reason: 'The model answered with nothing at all.' }
      }

      const read = readChecklist(reply.text, existing, {
        ...(reply.finishReason === 'length' ? { cutOff: true } : {}),
      })
      if (!read.ok) return { ok: false, step: 'drafting', reason: read.reason }

      if (signal?.aborted) return { ok: false, step: 'drafting', reason: 'Stopped.' }

      /* ----------------------------- 3. keep ------------------------------ */
      onStep?.('saving')
      /*
       * The result IS checked. The card renders from the graph, so a refused
       * write is not a lost head start — it is an unchanged list under a run
       * that said it worked, with nothing to press.
       */
      const kept = runtime.run('application.checklist.draft.add', {
        id: applicationId as NodeId,
        items: read.items.map((text) => ({ text })),
        model: settings.model,
      })
      if (!kept.ok) {
        return {
          ok: false,
          step: 'saving',
          reason:
            kept.errors[0]?.message ??
            'The steps were drafted, but they could not be saved against this application.',
        }
      }

      const added = kept.output
      return {
        ok: true,
        added,
        notes:
          added === 0
            ? [
                ...read.notes,
                'Everything it suggested was already on your list, so nothing was added.',
              ]
            : read.notes,
      }
    },
    [turn, readDocument, repo, runtime, projections],
  )
}
