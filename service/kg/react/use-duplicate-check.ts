import { useCallback } from 'react'
import { findDuplicate } from '../core/duplicates'
import type { DuplicateCandidate, DuplicateOf } from '../core/duplicates'
import type { ModelSettings } from '../core/provider'
import type { Cancellation } from '../agent/loop'
import type { AgentTurnFn } from './use-read-cv'
import {
  duplicateCandidates,
  duplicateJudgeMessages,
  readDuplicateVerdict,
} from '../agent/judge-duplicate'
import type { DuplicateSubject } from '../agent/judge-duplicate'

/**
 * Whether the application about to be saved is one the person already has —
 * by arithmetic first, and by the model only when arithmetic finds nothing
 * and there is something at the same employer to compare against.
 *
 * Shared by both create forms, so the phone and the browser cannot disagree
 * about when a model is asked. The model is asked AFTER Save is pressed, never
 * while typing: a call per keystroke would be a call per keystroke, and the
 * static rule already warns as they type.
 *
 * `null` means "nothing found — save". A found duplicate carries which half
 * found it, because the two are different claims: the arithmetic is certain
 * and says why; the model is a reading the person is about to check.
 */
export type DuplicateFound<T> = DuplicateOf<T> & {
  how: 'static' | 'model'
  /** The model's sentence, when it was the model. */
  because?: string
}

export type DuplicateCheckOptions<T, S extends Cancellation> = {
  existing: readonly T[]
  candidate: DuplicateCandidate & DuplicateSubject
  skipId?: string | undefined
  settings: ModelSettings
  signal?: S
}

export function useDuplicateCheck<S extends Cancellation>({
  turn,
}: {
  turn: AgentTurnFn<S>
}): <T extends DuplicateCandidate & DuplicateSubject & { id: string }>(
  options: DuplicateCheckOptions<T, S>,
) => Promise<DuplicateFound<T> | null> {
  return useCallback(
    async ({ existing, candidate, skipId, settings, signal }) => {
      const found = findDuplicate(existing, candidate, skipId)
      if (found) return { ...found, how: 'static' }

      if (settings.model.trim() === '') return null
      const offered = duplicateCandidates(existing, candidate, skipId)
      if (offered.length === 0) return null

      const reply = await turn(settings, duplicateJudgeMessages(candidate, offered), [], signal)
      // A refused or empty answer is not a duplicate. The static rule has
      // already had its say, and a save must not hang on a model being down.
      if (!reply.ok || reply.text === null) return null
      const verdict = readDuplicateVerdict(reply.text, offered)
      if (verdict === null) return null
      const record = offered.find((r) => r.id === verdict.duplicateOf)
      if (record === undefined) return null
      return { record, reason: 'name', how: 'model', because: verdict.reason }
    },
    [turn],
  )
}
