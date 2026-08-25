import { useCallback } from 'react'
import { cvMessages, readCv } from '@jojo/service/agent/read-cv'
import type { BackgroundDraft } from '@jojo/service/agent/read-cv'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

/**
 * A document in the Vault, read by the model into facts about the person.
 *
 * The phone's half of web's `lib/cv-agent.ts`, and unusually for these pairs it
 * is the same file twice. The two things that normally differ between the
 * platforms — how a stored document is opened, and how a turn is sent to a
 * model — are both already behind an import here: `useReadDocument` resolves to
 * this app's copy, and so does `agentTurn`. There is nothing left for the
 * phone's version to say differently, and inventing a difference to justify the
 * file would be worse than the duplication.
 *
 * The reasoning that matters is on the web file and is not repeated: why the
 * steps are reported separately rather than behind one spinner, why this runs
 * outside the twin pipeline, and why nothing here writes — it returns drafts,
 * and the approval that the consent copy promises lives one layer up with the
 * list the person is looking at.
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
