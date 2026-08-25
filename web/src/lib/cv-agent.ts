import { useCallback } from 'react'
import { cvMessages, readCv } from '@jojo/service/agent/read-cv'
import type { BackgroundDraft } from '@jojo/service/agent/read-cv'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

/**
 * A document in the Vault, read by the model into facts about the person.
 *
 * The sibling of `posting-agent.ts` and built the same way: a single round
 * trip, outside the pipeline machinery, reported in steps rather than behind
 * one spinner. The steps fail differently and the user can act on each — "no
 * reader" is a Settings problem, "that document came back empty" is a scanned
 * PDF problem, "the model did not answer" is a third thing — and one "could
 * not read it" would flatten all three into a shrug.
 *
 * ## Why this is not the twin pipeline
 *
 * The twin pipeline can do this and does. But a pipeline is a schedule the user
 * set up, and the offer this serves fires when they file a document — which
 * most people will do before they have ever opened the Pipelines screen. Making
 * consent depend on having configured a pipeline first would mean the CV of
 * anybody who never did is silently never read, which is the exact gap this
 * feature exists to close.
 *
 * So the offer runs the read directly and the pipeline keeps its own job: the
 * connecting work, which is a schedule's kind of task rather than a moment's.
 *
 * ## Nothing here writes
 *
 * It returns drafts. The caller shows them and the person approves them, which
 * is what the consent copy in `core/twin.ts` promises — "every entry it adds is
 * shown to you first". A version of this that called `profile.background.add`
 * itself would make that sentence false, so the write deliberately lives one
 * layer up where the approval is.
 */

export type CvStep = 'reading' | 'asking'

export type CvOutcome =
  | { ok: true; background: readonly BackgroundDraft[]; skipped: readonly string[] }
  | { ok: false; step: CvStep; reason: string }

export type ReadCvOptions = {
  fileId: string
  /** The document's name. Goes to the model, and into the failure sentence. */
  name: string
  settings: ModelSettings
  onStep?: (step: CvStep) => void
  signal?: AbortSignal
}

/**
 * Below this, the reader found no text worth sending.
 *
 * The scanned-CV case, and worth catching here rather than paying for a model
 * call to be told the same thing. Lower than `posting-agent`'s 200: a one-page
 * CV of somebody early in their career is genuinely short, and the model is the
 * better judge above this line.
 */
const TOO_SHORT = 120

export function useReadCv(): (options: ReadCvOptions) => Promise<CvOutcome> {
  const readDocument = useReadDocument()

  return useCallback(
    async ({ fileId, name, settings, onStep, signal }: ReadCvOptions): Promise<CvOutcome> => {
      /* ----------------------------- 1. read ----------------------------- */
      onStep?.('reading')
      const document = await readDocument(fileId)
      if (!document.ok) return { ok: false, step: 'reading', reason: document.reason }

      if (document.markdown.trim().length < TOO_SHORT) {
        return {
          ok: false,
          step: 'reading',
          reason: `${name} came back with almost no text. A CV that was scanned rather than typed is a picture as far as the reader is concerned — there is nothing in it to read.`,
        }
      }

      /* ----------------------------- 2. ask ------------------------------ */
      onStep?.('asking')
      const turn = await agentTurn(settings, cvMessages(name, document.markdown), [], signal)
      if (!turn.ok) return { ok: false, step: 'asking', reason: turn.reason }
      if (turn.text === null || turn.text.trim() === '') {
        return { ok: false, step: 'asking', reason: 'The model answered with nothing at all.' }
      }

      const read = readCv(turn.text)
      if (!read.ok) return { ok: false, step: 'asking', reason: read.reason }

      return { ok: true, background: read.background, skipped: read.skipped }
    },
    [readDocument],
  )
}
