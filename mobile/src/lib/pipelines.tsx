import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { PipelinesContext } from '@jojo/service/react/pipelines-context'
import { reportError } from '@/lib/report-error'
import { usePipelines } from '@jojo/service/react/use-pipelines'
import { agentTurn, isConfigured } from '@/lib/llm'
import { scanBoard } from '@/lib/board-scan'
import { useModelSettings } from '@/lib/model-settings-context'

/**
 * Runs the pipelines for as long as the app is in the foreground.
 *
 * Above the navigator rather than inside the Job Scout screen, which used to own
 * the engine — so leaving that screen cleared its interval and aborted the round
 * in flight, while its own footer promised the pipelines "run on your device,
 * while jojo is open".
 *
 * "Foreground" is the honest word on this platform and the caption says so:
 * React Native suspends JavaScript outright when the app is backgrounded, so
 * this cannot be more than the app's own lifetime. Hoisting it makes the promise
 * true up to that limit rather than false below it.
 */
export function PipelinesProvider({ children }: { children: ReactNode }) {
  const { settings } = useModelSettings()
  const llm = useCallback(
    (messages: Parameters<typeof agentTurn>[1], tools: Parameters<typeof agentTurn>[2]) =>
      agentTurn(settings, messages, tools),
    [settings],
  )
  const state = usePipelines({
    llm: isConfigured(settings) ? llm : null,
    scan: scanBoard,
    /*
     * A round that throws is caught inside the hook so the schedule is not left
     * wedged — and catching it took away the only durable record. It used to
     * escape into an unhandled rejection, which reaches the crash ring the
     * Diagnostics panel reads; the hook's own log is capped and gone on reload.
     *
     * `'agent'` because that is what a pipeline round is: "a throw underneath
     * an agent run, which has no other home".
     */
    onError: (e) => {
      reportError('agent', e)
    },
  })

  return <PipelinesContext value={state}>{children}</PipelinesContext>
}
