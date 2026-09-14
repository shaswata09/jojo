/**
 * `useChecklist`, wired to this app's model transport, document reader and
 * settings.
 *
 * The card's state machine is `@jojo/service/react/use-checklist` and the run
 * itself is `@jojo/service/react/use-draft-checklist`, both shared with the
 * phone. What stays here is the two `@/`-aliased platform functions.
 *
 * Unlike the tailoring pair, this file and its mobile twin ARE twins: no
 * streaming and no raised timeout, because the reply is a few hundred tokens of
 * JSON rather than a rewritten document. `agentTurn` is handed straight through
 * exactly as `fit-agent.ts` hands it through, and for the same reason.
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

/**
 * One turn, no tools, default timeout.
 *
 * No tools because the REPLY is the answer — there is nothing for the model to
 * go and look up that the brief has not already handed it. Default timeout
 * because a few hundred tokens of JSON is not a document: the queue runs one
 * job at a time, so a longer budget here would let a hung server hold the fit
 * read and the tailoring behind it.
 */
const turn = (settings: ModelSettings, messages: readonly ChatMessage[], signal?: AbortSignal) =>
  agentTurn(settings, messages, [], signal)

export function useChecklist(applicationId: string): ChecklistView {
  const { settings } = useModelSettings()
  const readDocument = useReadDocument()
  const draft = useDraftChecklist<AbortSignal>({ turn, readDocument })
  return usePortableChecklist<AbortSignal>({ applicationId, settings, draft })
}
