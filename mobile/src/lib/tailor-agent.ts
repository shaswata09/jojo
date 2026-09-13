/**
 * `useTailoring`, wired to this app's model transport, document reader and
 * settings.
 *
 * The card's state machine is `@jojo/service/react/use-tailoring` and the run
 * itself is `@jojo/service/react/use-tailor`, both shared with the web. What
 * stays here is what cannot be shared, and this seam is NOT the web's twin:
 * the phone cannot stream — its fetch gives no reader — so a tailored document
 * gets a longer TOTAL budget instead of a re-armed idle one. Four minutes is
 * ~3,300 tokens at the local box's ~14 a second, which covers a cover letter
 * or a statement whole and a long CV's changed sections; a document past that
 * is cut and reported, not saved half-written. Bytes are answered by the file
 * record itself, because the picker writes `uri`.
 */
import type { ChatMessage } from '@jojo/service/core/model-server'
import type { ModelSettings } from '@jojo/service/core/provider'
import { useTailor as usePortableTailor } from '@jojo/service/react/use-tailor'
import type { TailorOutcome, TailorStep } from '@jojo/service/react/use-tailor'
import { useTailoring as usePortableTailoring } from '@jojo/service/react/use-tailoring'
import type { TailoringView, TailoredSnippet } from '@jojo/service/react/use-tailoring'
import { agentTurn } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadDocument } from '@/lib/read-document'

export type { TailorOutcome, TailorStep, TailoringView, TailoredSnippet }

/** How long one tailored document may take on a transport that cannot stream. */
const DOCUMENT_TIMEOUT_MS = 240_000

/** One long generation, whole. No tools: the reply is the document. */
const turn = (settings: ModelSettings, messages: readonly ChatMessage[], signal?: AbortSignal) =>
  agentTurn(settings, messages, [], signal, { timeoutMs: DOCUMENT_TIMEOUT_MS })

export function useTailoring(applicationId: string): TailoringView {
  const { settings } = useModelSettings()
  const readDocument = useReadDocument()
  const tailor = usePortableTailor<AbortSignal>({ turn, readDocument })
  return usePortableTailoring<AbortSignal>({ applicationId, settings, tailor })
}
