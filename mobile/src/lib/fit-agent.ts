/**
 * `useFit`, wired to this app's model transport, document reader and settings.
 *
 * The panel's state machine is `@jojo/service/react/use-fit`, shared with the
 * phone — it used to be 127 byte-identical lines in both panel files with
 * nothing comparing them. What stays here is what cannot be shared: the two
 * `@/`-aliased platform functions (see `cv-agent.ts`), and an `AbortController`,
 * which `kg/react` may not name because `AbortSignal` is a DOM global the
 * portable layers deliberately do not have.
 */
import { useFit as usePortableFit } from '@jojo/service/react/use-fit'
import type { FitView } from '@jojo/service/react/use-fit'
import { useReadFit as usePortableReadFit } from '@jojo/service/react/use-read-fit'
import type { FitOutcome, FitStep } from '@jojo/service/react/use-read-fit'
import type { ReadFitOptions as PortableOptions } from '@jojo/service/react/use-read-fit'
import { agentTurn } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadDocument } from '@/lib/read-document'

export type ReadFitOptions = PortableOptions<AbortSignal>
export type { FitOutcome, FitStep, FitView }

/** A fresh controller, in the two-field shape the hook takes. */
const newSignal = () => {
  const stop = new AbortController()
  return {
    signal: stop.signal,
    abort: () => {
      stop.abort()
    },
  }
}

/** The read alone. The create form uses it to warm a posting it has just saved. */
export function useReadFit(): (options: ReadFitOptions) => Promise<FitOutcome> {
  const readDocument = useReadDocument()
  return usePortableReadFit<AbortSignal>({ turn: agentTurn, readDocument })
}

export function useFit(applicationId: string): FitView {
  const { settings } = useModelSettings()
  const readFit = useReadFit()
  return usePortableFit<AbortSignal>({ applicationId, settings, readFit, newSignal })
}
