import { useCallback } from 'react'
import { assess } from '../core/assess'
import { documentKindOf } from '../core/document-kind'
import { answered, readingOn } from '../core/fit-reading'
import type { NodeId } from '../core/model'
import type { ChatMessage, Turn } from '../core/model-server'
import { postingSourceFor } from '../core/posting-source'
import type { ModelSettings } from '../core/provider'
import { guidanceFrom } from '../core/tailor'
import { TAG_FOR_KIND, titleFor } from '../core/tailoring'
import { CUT_OFF, readTailored, tailorMessages } from '../agent/tailor-material'
import type { TailorBrief } from '../agent/tailor-material'
import type { Cancellation } from '../agent/loop'
import { useKg } from './kg-context'
import { undoableWith } from './undo'
import type { RestoreOutcome } from './undo'
import type { ReadDocumentFn } from './use-read-cv'

/**
 * Tailoring one document for one application, end to end. L4.
 *
 * The shape of `use-read-fit.ts`, with one more step at each end: the posting
 * is opened as well as the document, and the result is WRITTEN — as a snippet
 * filed under the application, carrying where it came from — rather than
 * handed back for somebody to review. That is a different contract from
 * `use-read-cv.ts`, which returns drafts on purpose: a tailored cover letter is
 * not a claim about the person that needs their consent, it is text they asked
 * for, and the place they asked for it to go is the card that will show it.
 *
 * ## Why the turn function is its own type
 *
 * `AgentTurnFn` has no progress callback, because nothing that used it needed
 * one — a requirement list is a few hundred tokens. A tailored document is a
 * few thousand, and on the local box that is minutes, not seconds. The web's
 * transport streams and re-arms its timeout on every chunk; the phone's cannot
 * stream and takes a longer total budget instead. Both are wired in each app's
 * `lib/tailor-agent.ts`, and this hook asks for nothing but "a function that
 * returns a Turn and may tell me how it is going".
 */

export type TailorTurnFn<S extends Cancellation> = (
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  signal?: S,
  onDelta?: (delta: string) => void,
) => Promise<Turn>

export type TailorDeps<S extends Cancellation> = {
  turn: TailorTurnFn<S>
  readDocument: ReadDocumentFn
}

export type TailorStep = 'posting' | 'document' | 'writing' | 'saving'

export const TAILOR_STEP_LABEL: Readonly<Record<TailorStep, string>> = {
  posting: 'Opening the posting',
  document: 'Opening your document',
  writing: 'Writing the tailored version',
  saving: 'Saving it under this application',
}

export type TailorOutcome =
  | {
      ok: true
      snippetId: string
      title: string
      /** Whether anything in it is marked. False is worth a sentence on the card. */
      marked: boolean
      /** Doubts the reader raised. Shown, never a reason to have refused it. */
      notes: readonly string[]
      /** The guarded Undo for the toast. Null when nothing was committed. */
      restore: (() => RestoreOutcome) | null
    }
  | { ok: false; step: TailorStep; reason: string }

export type TailorOptions<S extends Cancellation = Cancellation> = {
  applicationId: string
  /** The document to tailor, from `candidatesFor`. */
  fileId: string
  /** Its name. Goes to the model, and into the kind classifier. */
  name: string
  settings: ModelSettings
  onStep?: (step: TailorStep) => void
  /** The reply so far, whole, on every chunk. Only the web transport calls it. */
  onDelta?: (soFar: string) => void
  signal?: S
}

/** Below this the document is a picture, not text. Same bar `use-read-cv` sets. */
const TOO_SHORT = 120

export function useTailor<S extends Cancellation>({
  turn,
  readDocument,
}: TailorDeps<S>): (options: TailorOptions<S>) => Promise<TailorOutcome> {
  const { repo, runtime, projections } = useKg()

  return useCallback(
    async ({
      applicationId,
      fileId,
      name,
      settings,
      onStep,
      onDelta,
      signal,
    }: TailorOptions<S>): Promise<TailorOutcome> => {
      /*
       * `repo.getSnapshot()` rather than a rendered graph: this runs from a
       * button press, and everything it reads was committed before that press.
       */
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
          reason: 'There is no saved posting behind this application to tailor for.',
        }
      }

      /* ---------------------------- 1. posting --------------------------- */
      onStep?.('posting')
      const posting = await readDocument(source.fileId)
      if (!posting.ok) return { ok: false, step: 'posting', reason: posting.reason }

      // What the fit panel already read off it, and how the person measures
      // against it. Both are free — the reading is stored, the score is
      // arithmetic — and both make the model's job a great deal easier.
      const reading = readingOn(memory.node(source.fileId as NodeId, 'file'))
      const requirements = answered(reading) && reading !== undefined ? reading.requirements : []
      const background = projections.background(memory)
      const guidance =
        requirements.length > 0 && background.length > 0
          ? guidanceFrom(assess(requirements, background))
          : null

      /* --------------------------- 2. document --------------------------- */
      onStep?.('document')
      const base = await readDocument(fileId)
      if (!base.ok) return { ok: false, step: 'document', reason: base.reason }
      if (base.markdown.trim().length < TOO_SHORT) {
        return {
          ok: false,
          step: 'document',
          reason: `${name} came back with almost no text. A document that was scanned rather than typed is a picture as far as the reader is concerned — there is nothing in it to tailor.`,
        }
      }

      // With the text in hand the classifier can do better than the filename.
      const kind = documentKindOf(name, base.markdown)
      const brief: TailorBrief = {
        kind,
        org: application.org,
        role: application.role,
        postingName: source.name,
        posting: posting.markdown,
        requirements,
        guidance,
        baseName: name,
        base: base.markdown,
      }

      /*
       * The two document reads above do not take the signal — `readDocument`
       * is a local blob read or a reader round trip — so a cancel that lands
       * during them is only noticed here. Noticed it must be: without this the
       * model turn started anyway, and its reply was saved under a record the
       * person had already left.
       */
      if (signal?.aborted) return { ok: false, step: 'document', reason: 'Stopped.' }

      /* ---------------------------- 3. write ----------------------------- */
      onStep?.('writing')
      let soFar = ''
      const reply = await turn(
        settings,
        tailorMessages(brief),
        signal,
        onDelta === undefined
          ? undefined
          : (delta) => {
              soFar += delta
              onDelta(soFar)
            },
      )
      if (!reply.ok) return { ok: false, step: 'writing', reason: reply.reason }
      if (reply.text === null || reply.text.trim() === '') {
        return { ok: false, step: 'writing', reason: 'The model answered with nothing at all.' }
      }
      /*
       * A cut reply is an OK turn on every transport — the server just stops.
       * Nothing in the app checked this before, because nothing asked for more
       * than a screenful. A tailored document that ends mid-sentence must not
       * be saved as if it were the document.
       */
      if (reply.finishReason === 'length') return { ok: false, step: 'writing', reason: CUT_OFF }

      const read = readTailored(reply.text, brief)
      if (!read.ok) return { ok: false, step: 'writing', reason: read.reason }

      /*
       * And once more before the write. A transport that does not honour the
       * signal — the extension relay answers whole — hands back a finished
       * reply after the person pressed Cancel, and the one thing they pressed
       * it for was that nothing be saved.
       */
      if (signal?.aborted) return { ok: false, step: 'writing', reason: 'Stopped.' }

      /* ----------------------------- 4. keep ----------------------------- */
      onStep?.('saving')
      const title = titleFor(kind, application.org)
      const { value, restore } = undoableWith(repo, () =>
        runtime.run('tailor.snippet.create', {
          applicationId: applicationId as NodeId,
          source: fileId,
          kind,
          model: settings.model,
          title,
          tag: TAG_FOR_KIND[kind],
          body: read.body,
        }),
      )
      if (!value.ok) {
        return {
          ok: false,
          step: 'saving',
          reason: value.errors[0]?.message ?? 'The tailored text could not be saved.',
        }
      }

      return {
        ok: true,
        snippetId: value.output,
        title,
        marked: read.marked,
        notes: read.notes,
        restore,
      }
    },
    [turn, readDocument, repo, runtime, projections],
  )
}
