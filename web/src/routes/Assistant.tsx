import { AgentPanel } from '@/components/assistant/AgentPanel'
import { ScriptedPanel } from '@/components/assistant/ScriptedPanel'
import { useTitle } from '@/lib/links'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'

export function Assistant() {
  useTitle('Assistant')
  const { settings } = useModelSettings()
  // The split is at the top because the two modes share almost nothing below it:
  // one has a transcript of messages and the other a trace of tool calls, and a
  // single component holding both was a component with two of every state.
  // The connected panel is `components/assistant/AgentPanel.tsx`; the worked
  // examples shown with no model are `ScriptedPanel.tsx` and `scripts.ts`.
  return isConfigured(settings) ? <AgentPanel /> : <ScriptedPanel />
}
