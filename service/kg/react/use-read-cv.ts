import { useCallback } from 'react'
import {
  cvMessages,
  cvPasses,
  mergeBackground,
  missedMessages,
  readCv,
} from '../agent/read-cv'
import type { BackgroundDraft, RelationDraft } from '../agent/read-cv'
import { linkProfile } from '../agent/link-profile'
import type { LinkResult } from '../agent/link-profile'
import { documentKindOf, DOCUMENT_LABEL } from '../core/document-kind'
import type { ModelSettings } from '../core/provider'
import type { ConvertResult } from '../agent/markitdown'
import type { ChatMessage, Turn } from '../core/model-server'
import type { Cancellation } from '../agent/loop'

/**
 * A document in the Vault, read by the model into facts about the person.
 *
 * The sibling of `posting-agent.ts`: a round trip outside the pipeline
 * machinery, reported in steps rather than behind one spinner, because the
 * steps fail differently and the user can act on each.
 *
 * ## Why it is here and not in each app
 *
 * It was in both, twice, and byte-identical once the header comments were
 * stripped — 122 lines of extraction logic that the two platforms had no
 * reason to disagree about and every opportunity to drift over. The argument
 * for the copies was that it touches two platform things: opening a stored
 * document, and sending a turn. Both are single functions, so they are
 * parameters now, and each app keeps a three-line hook that supplies its own.
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


/**
 * Sending one turn to whichever model is configured.
 *
 * Injected rather than imported because the two apps reach a model by different
 * routes — a browser `fetch` and React Native's — and this file is compiled into
 * both.
 */
export type AgentTurnFn<S extends Cancellation> = (
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  tools: readonly unknown[],
  signal?: S,
) => Promise<Turn>

/** Opening a stored document as text. Injected for the same reason. */
export type ReadDocumentFn = (fileId: string) => Promise<ConvertResult>

/*
 * Generic in the signal for one narrow reason: both apps hold a real
 * `AbortSignal` and hand it straight to their own transport, while this file
 * only ever reads `.aborted` and may not name a DOM type. Pinning the parameter
 * to the structural `Cancellation` would make `agentTurn` unassignable — a
 * function that requires an `AbortSignal` cannot stand in for one that accepts
 * any `{aborted}` — and the fix people reach for under that error is a cast.
 */
export type ReadCvDeps<S extends Cancellation> = {
  turn: AgentTurnFn<S>
  readDocument: ReadDocumentFn
}

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
      /**
       * What the linking pass cost, when one ran at all.
       *
       * ABSENT rather than null when it did not: fewer than two entries came
       * back, or the read was cancelled before step 5. `asked` and `failed` are
       * the only way a caller can tell a graph that is genuinely sparse from one
       * whose edges were lost to failed batches — which is the sentence
       * `linkProfile`'s header promises the caller will be able to say, "the
       * graph is thin rather than complete".
       *
       * It was already being spread into this arm and was not declared on it, so
       * `outcome.linking` was a compile error at every call site: the field the
       * pass exists to report was invisible to the one consumer that could act
       * on it, reachable only through an assertion. Declared here, not removed,
       * because removing it would delete the report rather than the defect.
       */
      linking?: LinkResult
    }
  | { ok: false; reason: string }

export type ReadCvOptions<S extends Cancellation = Cancellation> = {
  fileId: string
  /** The document's name. Goes to the model, and into the failure sentence. */
  name: string
  settings: ModelSettings
  /** A line to show while it works. Already worded for a person. */
  onStep?: (label: string) => void
  signal?: S
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

export function useReadCv<S extends Cancellation>({
  turn,
  readDocument,
}: ReadCvDeps<S>): (options: ReadCvOptions<S>) => Promise<CvOutcome> {
  return useCallback(
    async ({ fileId, name, settings, onStep, signal }: ReadCvOptions<S>): Promise<CvOutcome> => {
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

        const reply = await turn(settings, cvMessages(name, pass, kind), [], signal)
        if (!reply.ok) {
          skipped.push(`${pass.label}: ${reply.reason}`)
          continue
        }
        if (reply.text === null || reply.text.trim() === '') {
          skipped.push(`${pass.label}: the model answered with nothing at all.`)
          continue
        }
        const read = readCv(reply.text)
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
        const reply = await turn(
          settings,
          missedMessages(name, markdown, merged, kind),
          [],
          signal,
        )
        if (reply.ok && reply.text !== null && reply.text.trim() !== '') {
          const read = readCv(reply.text)
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
      let linking: LinkResult | null = null
      if (!signal?.aborted && background.length > 1) {
        /*
         * A SEPARATE AGENT PASS, over every pair, in batches.
         *
         * This was one request carrying all thirty entries, inside a `catch {}`
         * described as deliberately silent. Thirty entries is the shape that
         * hits a model's output limit; a truncated reply parses to nothing; and
         * nothing said so — which is how the graph came to be a collection of
         * nodes with no edges at all.
         *
         * `linkProfile` asks about the records in front of it and no more, and
         * `pairBatches` guarantees every pair is in front of it once. It never
         * throws: a batch that fails is counted, and the count comes back here
         * so the caller can say the graph is thin rather than implying it is
         * complete.
         */
        linking = await linkProfile(
          { ask: (messages) => turn(settings, messages, [], signal) },
          name,
          markdown,
          background,
          {
            ...(signal === undefined ? {} : { signal }),
            onBatch: (done, total) =>
              onStep?.(`Working out how these connect — ${String(done)} of ${String(total)}`),
          },
        )
        relations = linking.relations
      }

      return {
        ok: true,
        background,
        relations,
        skipped,
        ...(linking === null ? {} : { linking }),
      }
    },
    [readDocument, turn],
  )
}
