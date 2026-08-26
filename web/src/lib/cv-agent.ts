/**
 * `useReadCv`, wired to this app's model transport and document reader.
 *
 * The reading itself is `@jojo/service/react/use-read-cv`, shared with the
 * phone. What is left here is the two things that genuinely differ between the
 * platforms, which is what the shared hook takes as parameters.
 */
import { useReadCv as usePortableReadCv } from '@jojo/service/react/use-read-cv'
import type { CvOutcome, ReadCvOptions as PortableOptions } from '@jojo/service/react/use-read-cv'
import { agentTurn } from '@/lib/llm'
import { useReadDocument } from '@/lib/read-document'

export type ReadCvOptions = PortableOptions<AbortSignal>
export type { CvOutcome }

export function useReadCv(): (options: ReadCvOptions) => Promise<CvOutcome> {
  const readDocument = useReadDocument()
  return usePortableReadCv<AbortSignal>({ turn: agentTurn, readDocument })
}
