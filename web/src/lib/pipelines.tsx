import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { PipelinesContext } from '@jojo/service/react/pipelines-context'
import { usePipelines } from '@jojo/service/react/use-pipelines'
import { agentTurn, isConfigured } from '@/lib/llm'
import { scanBoard } from '@/lib/capture-bridge'
import { useModelSettings } from '@/lib/model-settings-context'

/**
 * Runs the pipelines for as long as this tab is open.
 *
 * Mounted above the router, which is the whole point: the Job Scout page used to
 * call `usePipelines` itself, so leaving that page cleared the interval and
 * aborted the round in flight. The panel's own caption promises "they work while
 * this tab is open", and it is this component that makes that true.
 *
 * It lives in the app rather than in the package because both things it injects
 * are platform work the shared layer may not do: `agentTurn` is a fetch, and
 * `scanBoard` drives a browser extension.
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
  })

  return <PipelinesContext value={state}>{children}</PipelinesContext>
}
