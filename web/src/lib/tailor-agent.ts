/**
 * `useTailoring`, wired to this app's model transport, document reader, blob
 * store and settings.
 *
 * The card's state machine is `@jojo/service/react/use-tailoring` and the run
 * itself is `@jojo/service/react/use-tailor`, both shared with the phone. What
 * stays here is what cannot be shared, and this seam is NOT the phone's twin:
 * the web STREAMS a tailored document — `agentTurn`'s `onDelta` re-arms the
 * transport's idle timeout on every chunk, so a document that takes minutes on
 * the local box arrives rather than timing out at sixty seconds — and it asks
 * the blob store whether a record has bytes, because the web never writes
 * `path` on a file record (see `hasBytesOnRecord` in `core/twin.ts`).
 */
import { useCallback } from 'react'
import type { ChatMessage } from '@jojo/service/core/model-server'
import type { ModelSettings } from '@jojo/service/core/provider'
import { useTailor as usePortableTailor } from '@jojo/service/react/use-tailor'
import type { TailorOutcome, TailorStep } from '@jojo/service/react/use-tailor'
import { useTailoring as usePortableTailoring } from '@jojo/service/react/use-tailoring'
import type { TailoringView, TailoredSnippet } from '@jojo/service/react/use-tailoring'
import { agentTurn } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useReadDocument } from '@/lib/read-document'
import { useVaultBlobs } from '@/lib/vault-blobs'

export type { TailorOutcome, TailorStep, TailoringView, TailoredSnippet }

/** How long one tailored document may take on a provider that cannot stream. */
const DOCUMENT_TIMEOUT_MS = 240_000

/**
 * One long generation, streamed where the provider allows — every OpenAI-shaped
 * server does — and given a document-sized total budget where it does not
 * (Ollama, Anthropic), so it is not cut at sixty seconds. No tools: the reply
 * is the document.
 */
const turn = (
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
) => agentTurn(settings, messages, [], signal, onDelta, { timeoutMs: DOCUMENT_TIMEOUT_MS })

export function useTailoring(applicationId: string): TailoringView {
  const { settings } = useModelSettings()
  const readDocument = useReadDocument()
  const blobs = useVaultBlobs()
  const hasBytes = useCallback((file: { id: string }) => blobs.has(file.id), [blobs])
  const tailor = usePortableTailor<AbortSignal>({ turn, readDocument })
  return usePortableTailoring<AbortSignal>({
    applicationId,
    settings,
    tailor,
    hasBytes,
    documentsReady: blobs.ready,
  })
}
