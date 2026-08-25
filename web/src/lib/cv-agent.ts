import { useCallback } from 'react'
import {
  cvMessages,
  cvPasses,
  mergeBackground,
  missedMessages,
  readCv,
  readRelations,
  relationMessages,
} from '@jojo/service/agent/read-cv'
import type { BackgroundDraft, RelationDraft } from '@jojo/service/agent/read-cv'
import { documentKindOf, DOCUMENT_LABEL } from '@jojo/service/core/document-kind'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

/**
 * A document in the Vault, read by the model into facts about the person.
 *
 * The sibling of `posting-agent.ts`: a round trip outside the pipeline
 * machinery, reported in steps rather than behind one spinner, because the
 * steps fail differently and the user can act on each.
 *
 * ## Why it is several calls and not one
 *
 * It was one, and one is where most of the extraction was lost. A model asked
 * for every fact in 24k characters returns ten to fifteen entries and stops —
 * long-list generation degrades, and the tail of a CV is where the publications
 * are. `cvPasses` cuts the document on its own headings, and each call is then
 * asked for everything in a section rather than everything in a career.
 *
 * A final call shows the model what was found and asks only what was missed.
 * That raises recall at some cost to precision, which is the right way round
 * here: a wrong entry is in the review list and costs one click to drop, and a
 * missing one is invisible forever.
 *
 * ## A failed pass costs that pass
 *
 * The same rule the parser applies to a row. Six sections read and one
 * time-out should file five sections' worth of facts and say what was lost, not
 * discard a whole CV — the model call is a round trip to somebody's GPU and
 * throwing away five good answers to punish one bad one costs them all six
 * again.
 *
 * ## Nothing here writes
 *
 * It returns drafts. The caller shows them and the person approves them, which
 * is what the consent copy in `core/twin.ts` promises: every entry is shown
 * first. A version of this that called `profile.background.add` itself would
 * make that sentence false.
 */

export type CvOutcome =
  | {
      ok: true
      background: readonly BackgroundDraft[]
      /**
       * How the entries relate, with both ends as positions in `background`.
       *
       * Positions rather than ids because nothing is written yet — the person
       * has not approved anything. The caller resolves them after the write,
       * against the ids `profile.background.add` hands back in order.
       */
      relations: readonly RelationDraft[]
      skipped: readonly string[]
    }
  | { ok: false; reason: string }

export type ReadCvOptions = {
  fileId: string
  /** The document's name. Goes to the model, and into the failure sentence. */
  name: string
  settings: ModelSettings
  /** A line to show while it works. Already worded for a person. */
  onStep?: (label: string) => void
  signal?: AbortSignal
}

/**
 * Below this, the reader found no text worth sending.
 *
 * The scanned-CV case, caught here rather than paying for a model call to be
 * told the same thing. Lower than `posting-agent`'s 200: a one-page CV of
 * somebody early in their career is genuinely short, and above this line the
 * model is the better judge.
 */
const TOO_SHORT = 120

/**
 * How many section passes are worth making.
 *
 * A bound on the round trips, not on the document: eight passes of 24k is
 * 192k characters, which is longer than any CV anybody has written. Reaching it
 * means the sectioning found something pathological, and the honest response is
 * to read the first eight and say so rather than to spend an unbounded number
 * of calls on somebody's GPU without asking.
 */
const MAX_PASSES = 8

export function useReadCv(): (options: ReadCvOptions) => Promise<CvOutcome> {
  const readDocument = useReadDocument()

  return useCallback(
    async ({ fileId, name, settings, onStep, signal }: ReadCvOptions): Promise<CvOutcome> => {
      /* ----------------------------- 1. read ----------------------------- */
      onStep?.('Opening the document')
      const document = await readDocument(fileId)
      if (!document.ok) return { ok: false, reason: document.reason }

      const markdown = document.markdown
      if (markdown.trim().length < TOO_SHORT) {
        return {
          ok: false,
          reason: `${name} came back with almost no text. A document that was scanned rather than typed is a picture as far as the reader is concerned — there is nothing in it to read.`,
        }
      }

      /* --------------------------- 2. section --------------------------- */
      /*
       * What kind of document this is, decided before anything is asked of the
       * model. A research statement read as a CV returns three entries out of
       * thirty — it is prose and the list guidance does not fit it — and a
       * cover letter read as anything else files the employer's qualifications
       * as the person's. See `core/document-kind.ts`.
       */
      const kind = documentKindOf(name, markdown)
      const all = cvPasses(markdown)
      const passes = all.slice(0, MAX_PASSES)
      const found: BackgroundDraft[][] = []
      const skipped: string[] = []

      if (all.length > passes.length) {
        skipped.push(
          `The document has ${String(all.length)} sections and only the first ${String(passes.length)} were read.`,
        )
      }

      /* ----------------------------- 3. ask ----------------------------- */
      for (const [i, pass] of passes.entries()) {
        if (signal?.aborted) break
        onStep?.(
          passes.length === 1
            ? `Reading your ${DOCUMENT_LABEL[kind]}`
            : `Reading ${pass.label} (${String(i + 1)} of ${String(passes.length)})`,
        )

        const turn = await agentTurn(settings, cvMessages(name, pass, kind), [], signal)
        if (!turn.ok) {
          skipped.push(`${pass.label}: ${turn.reason}`)
          continue
        }
        if (turn.text === null || turn.text.trim() === '') {
          skipped.push(`${pass.label}: the model answered with nothing at all.`)
          continue
        }
        const read = readCv(turn.text)
        if (!read.ok) {
          // Not fatal, and often not even wrong: a "Referees" or "Interests"
          // section legitimately holds nothing this app records, and the
          // parser's refusal for it reads the same as a failure.
          skipped.push(`${pass.label}: ${read.reason}`)
          continue
        }
        found.push([...read.background])
        skipped.push(...read.skipped.map((s) => `${pass.label}: ${s}`))
      }

      const merged = mergeBackground(found)
      if (merged.length === 0) {
        return {
          ok: false,
          reason:
            skipped[0] ??
            'Nothing in that document could be read as a fact about you.',
        }
      }

      /* -------------------------- 4. look again -------------------------- */
      /*
       * Skipped when the document was one pass anyway AND that pass succeeded:
       * asking a model to check its own single answer against the same text it
       * just read is the case where the omission pass earns least and costs a
       * whole round trip.
       */
      if (!signal?.aborted && (passes.length > 1 || skipped.length > 0)) {
        onStep?.('Checking for anything missed')
        const turn = await agentTurn(
          settings,
          missedMessages(name, markdown, merged, kind),
          [],
          signal,
        )
        if (turn.ok && turn.text !== null && turn.text.trim() !== '') {
          const read = readCv(turn.text)
          // A second look that finds nothing is the commonest correct outcome,
          // and `readCv` reports an empty list as a refusal — so its failure is
          // not worth reporting to anybody.
          if (read.ok) found.push([...read.background])
        }
      }

      const background = mergeBackground(found)

      /* ------------------------ 5. how they relate ----------------------- */
      /*
       * Last, and separately, because a model asked for facts AND how they
       * relate in one reply does neither well — and the entries have to be
       * numbered before anything can point at them, which is only possible once
       * they are final.
       *
       * Its failure costs the relations and never the entries: this runs after
       * a reading that already succeeded, and a person who uploaded a CV should
       * get their thirty facts whether or not the graph also learned that one
       * of them evidences another.
       */
      let relations: readonly RelationDraft[] = []
      if (!signal?.aborted && background.length > 1) {
        onStep?.('Working out how these connect')
        try {
          const turn = await agentTurn(
            settings,
            relationMessages(name, markdown, background),
            [],
            signal,
          )
          if (turn.ok && turn.text !== null) relations = readRelations(turn.text, background.length)
        } catch {
          // Deliberately silent. See above.
        }
      }

      return { ok: true, background, relations, skipped }
    },
    [readDocument],
  )
}
