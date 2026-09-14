/**
 * `useChecklist`, wired to this app's model transport, document reader and
 * settings.
 *
 * The card's state machine is `@jojo/service/react/use-checklist` and the run
 * itself is `@jojo/service/react/use-draft-checklist`, both shared with the web.
 *
 * This seam IS the web's twin, unlike the tailoring pair, and that is worth
 * saying because those two headers each explain at length why they are not.
 * Tailoring diverges because the phone cannot stream and a document needs a
 * longer budget; a checklist reply is a few hundred tokens of JSON, so there is
 * nothing to stream and nothing to raise. Both sides pass `agentTurn` with no
 * tools and the default timeout.
 */
import { useChecklist as usePortableChecklist } from '@jojo/service/react/use-checklist'
import type { ChecklistBlocked, ChecklistView } from '@jojo/service/react/use-checklist'
import { useDraftChecklist } from '@jojo/service/react/use-draft-checklist'
import type { ChecklistStep, DraftOutcome } from '@jojo/service/react/use-draft-checklist'
import type { ChatMessage } from '@jojo/service/core/model-server'
import type { ModelSettings } from '@jojo/service/core/provider'
import { agentTurn } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadDocument } from '@/lib/read-document'

export type { ChecklistBlocked, ChecklistStep, ChecklistView, DraftOutcome }

/** One turn, no tools: the reply is the answer, not a step towards it. */
const turn = (settings: ModelSettings, messages: readonly ChatMessage[], signal?: AbortSignal) =>
  agentTurn(settings, messages, [], signal)

export function useChecklist(applicationId: string): ChecklistView {
  const { settings } = useModelSettings()
  const readDocument = useReadDocument()
  const draft = useDraftChecklist<AbortSignal>({ turn, readDocument })
  return usePortableChecklist<AbortSignal>({ applicationId, settings, draft })
}
