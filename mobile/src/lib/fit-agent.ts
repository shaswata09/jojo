import { useCallback } from 'react'
import { readRequirements, requirementMessages } from '@jojo/service/agent/read-requirements'
import type { Requirement } from '@jojo/service/core/assess'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

/**
 * What a saved posting asks for, read once per document.
 *
 * The phone's half of web's `lib/fit-agent.ts`, and the same file twice for the
 * same reason its sibling `cv-agent.ts` is: opening a stored document and
 * sending a turn are the two things that differ between the platforms, and both
 * are already behind imports that resolve to this app's own copies.
 *
 * One consequence IS worth restating here, because the cache is module-level
 * and the phone's lifecycle is not the browser's: this Map lives as long as the
 * JS context does. A reload in the browser clears it; on a phone the context
 * survives backgrounding, so a posting read this morning is still read this
 * evening. That is the intended behaviour — requirements are a fact about a
 * document and the document has not changed — and it is why the cache is keyed
 * on the file rather than on the application.
 *
 * The rest of the reasoning is on the web file: why the expensive half is
 * cached and the arithmetic is not, and why nothing here is persisted.
 */
const requirementsFor = new Map<string, readonly Requirement[]>()

/**
 * How many postings are remembered.
 *
 * Small entries — a dozen short phrases each — so this is a bound on principle
 * rather than a fix for a measured problem: a Map that only ever grows is one
 * whose worst case nobody has thought about, and on a phone the JS context
 * outlives every screen the person visits. Oldest first, which for an
 * insertion-ordered Map is what `keys().next()` gives; losing the oldest costs
 * one re-read of a posting nobody has opened in a hundred applications.
 */
const REMEMBERED = 128

function remember(fileId: string, requirements: readonly Requirement[]): void {
  requirementsFor.set(fileId, requirements)
  while (requirementsFor.size > REMEMBERED) {
    const oldest = requirementsFor.keys().next()
    if (oldest.done) break
    requirementsFor.delete(oldest.value)
  }
}

export type FitStep = 'reading' | 'asking'

export type FitOutcome =
  | { ok: true; requirements: readonly Requirement[]; cached: boolean }
  | { ok: false; step: FitStep; reason: string }

export type ReadFitOptions = {
  /** The saved posting, from `postingSourceFor`. */
  fileId: string
  /** Its name. Goes to the model as the posting's title. */
  name: string
  settings: ModelSettings
  onStep?: (step: FitStep) => void
  signal?: AbortSignal
}

/** Whether this posting has already been read this session. */
export const haveRequirements = (fileId: string): boolean => requirementsFor.has(fileId)

/** What was read, or undefined. Never triggers a read of its own. */
export const cachedRequirements = (fileId: string): readonly Requirement[] | undefined =>
  requirementsFor.get(fileId)

/**
 * Below this, the capture holds no posting.
 *
 * The same guard `posting-agent.ts` applies to a freshly fetched page, applied
 * here to a stored one — a capture of a JavaScript-only board is a shell, and
 * it is worth catching before paying for a model call to be told so.
 */
const TOO_SHORT = 200

export function useReadFit(): (options: ReadFitOptions) => Promise<FitOutcome> {
  const readDocument = useReadDocument()

  return useCallback(
    async ({ fileId, name, settings, onStep, signal }: ReadFitOptions): Promise<FitOutcome> => {
      const held = requirementsFor.get(fileId)
      if (held) return { ok: true, requirements: held, cached: true }

      /* ----------------------------- 1. read ----------------------------- */
      onStep?.('reading')
      const document = await readDocument(fileId)
      if (!document.ok) return { ok: false, step: 'reading', reason: document.reason }

      if (document.markdown.trim().length < TOO_SHORT) {
        return {
          ok: false,
          step: 'reading',
          reason: `${name} came back nearly empty. A board that renders with JavaScript sends a blank shell to anything but a browser, and that is what was saved.`,
        }
      }

      /* ----------------------------- 2. ask ------------------------------ */
      onStep?.('asking')
      const turn = await agentTurn(
        settings,
        requirementMessages(name, document.markdown),
        [],
        signal,
      )
      if (!turn.ok) return { ok: false, step: 'asking', reason: turn.reason }
      if (turn.text === null || turn.text.trim() === '') {
        return { ok: false, step: 'asking', reason: 'The model answered with nothing at all.' }
      }

      const read = readRequirements(turn.text)
      if (!read.ok) return { ok: false, step: 'asking', reason: read.reason }

      remember(fileId, read.requirements)
      return { ok: true, requirements: read.requirements, cached: false }
    },
    [readDocument],
  )
}
