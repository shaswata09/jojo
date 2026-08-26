/**
 * `useReadFit`, wired to this app's model transport and document reader.
 *
 * The reading is `@jojo/service/react/use-read-fit`, shared with the phone; see
 * `cv-agent.ts` for why the two platform functions are parameters.
 */
import {
  useReadFit as usePortableReadFit,
  cachedRequirements,
  haveRequirements,
} from '@jojo/service/react/use-read-fit'
import type { FitOutcome, FitStep, ReadFitOptions as PortableOptions } from '@jojo/service/react/use-read-fit'
import { agentTurn } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

export type ReadFitOptions = PortableOptions<AbortSignal>
export type { FitOutcome, FitStep }
export { cachedRequirements, haveRequirements }

export function useReadFit(): (options: ReadFitOptions) => Promise<FitOutcome> {
  const readDocument = useReadDocument()
  return usePortableReadFit<AbortSignal>({ turn: agentTurn, readDocument })
}
