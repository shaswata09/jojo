import { useCallback } from 'react'
import { readRequirements, requirementMessages } from '@jojo/service/agent/read-requirements'
import type { Requirement } from '@jojo/service/core/assess'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

/**
 * What a saved posting asks for, read once per document.
 *
 * ## Why the cache is on the DOCUMENT and not on the application
 *
 * The obvious cache key is the application — it is what the screen is about.
 * It is the wrong one, and the difference matters. Requirements are a fact
 * about a posting: they do not change when the person adds a publication,
 * moves the application to Interview or renames the employer. The assessment
 * DOES change on the first of those, and it is arithmetic — free, and correct
 * to recompute on every render.
 *
 * So the expensive half is keyed by the thing it actually depends on, and the
 * cheap half is not cached at all. Somebody who reads their CV into their
 * profile and then opens an application sees the score move without paying for
 * a second read of the posting.
 *
 * ## Why it is a module-level Map and not state
 *
 * It has to survive navigation — the whole point is not re-reading the posting
 * when somebody returns to an application — and it must NOT survive a reload,
 * because a stale requirement list is a wrong score with no way to notice. A
 * module Map is exactly session-scoped, which is what both of those describe.
 * Nothing here is persisted: requirements are derived, and a derived thing in
 * the graph is a thing that can disagree with what it was derived from.
 */
const requirementsFor = new Map<string, readonly Requirement[]>()

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

      requirementsFor.set(fileId, read.requirements)
      return { ok: true, requirements: read.requirements, cached: false }
    },
    [readDocument],
  )
}
