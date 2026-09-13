/**
 * `useDuplicateCheck`, wired to this app's model transport.
 *
 * The check is `@jojo/service/react/use-duplicate-check`, shared with the
 * phone; the only platform thing it needs is a way to send a turn. See
 * `cv-agent.ts` for why the transport is a parameter.
 */
import { useDuplicateCheck as usePortable } from '@jojo/service/react/use-duplicate-check'
import type { DuplicateFound } from '@jojo/service/react/use-duplicate-check'
import { agentTurn } from '@/lib/llm'

export type { DuplicateFound }

export function useDuplicateCheck() {
  return usePortable<AbortSignal>({ turn: agentTurn })
}
