/**
 * `useDuplicateCheck`, wired to the phone's model transport. The check itself
 * is shared — see web's `lib/duplicate-agent.ts`.
 */
import { useDuplicateCheck as usePortable } from '@jojo/service/react/use-duplicate-check'
import type { DuplicateFound } from '@jojo/service/react/use-duplicate-check'
import { agentTurn } from '@/lib/llm'

export type { DuplicateFound }

export function useDuplicateCheck() {
  return usePortable<AbortSignal>({ turn: agentTurn })
}
