import {
  MODEL_TIMEOUT_MS,
  chatRequest,
  isConfigured,
  modelsRequest,
  readChatResponse,
  readModelsResponse,
  readTurn,
  unconfigured,
  unreachable,
} from '@jojo/service/core/model-server'
import type {
  ChatMessage,
  ChatResult,
  ModelRequest,
  ModelResponse,
  ModelsResult,
  Turn,
} from '@jojo/service/core/model-server'

/**
 * The one place this app touches the network.
 *
 * OpenAI's shape, because vLLM, Ollama and LM Studio all speak it — pointing at
 * a local server is a URL, not an integration. Nothing is sent anywhere else:
 * the endpoint is whatever the user typed in Settings, and there is no key, no
 * telemetry and no fallback host.
 *
 * WHAT IS LEFT IN THIS FILE, AND WHY IT IS SO LITTLE. Building the URL and the
 * body, reading a status and a payload back, and choosing the sentence for each
 * failure all live in `@jojo/service/core/model-server`, tested there without a
 * socket. They cannot live *here* only because there are two apps and this would
 * be the second copy; they cannot live in the service's own network layer
 * because `check-platform` bans `fetch` from it, and is right to — a domain
 * layer that can reach the network is one that can block, fail and leak. So the
 * protocol is shared data and this is the six lines that send it.
 *
 * The timeout is why `send` owns an `AbortController` rather than awaiting
 * `fetch` directly. A local model on a cold start can take a long time to
 * answer, but "a long time" and "the server is not there" are the same
 * experience without one — `fetch` to a closed port on a phone can hang until
 * the OS gives up, which is far longer than anybody will sit and watch.
 */

export type { ChatMessage, ChatResult, ModelsResult, Turn }

/** Base URL, OpenAI-style: '…/v1'. The paths are appended by the protocol. */
export type ModelSettings = { endpoint: string; model: string }

/** Kept as the old name so the callers that read `.text` are unchanged. */
export type LlmResult = ChatResult

export { isConfigured }

/**
 * Sends a described request and reports what came back.
 *
 * Never throws. A thrown `fetch` is a fact about the network, and the callers
 * turn every fact about the network into the same shape of sentence.
 */
async function send(
  request: ModelRequest,
  endpoint: string,
  signal?: AbortSignal,
): Promise<ModelResponse | { failed: ReturnType<typeof unreachable> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
  // The caller's cancel and our timeout both have to reach the same request.
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    return { ok: response.ok, status: response.status, text: await response.text().catch(() => '') }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    const detail = error instanceof Error ? error.message : String(error)
    return { failed: unreachable(endpoint, detail, aborted) }
  } finally {
    clearTimeout(timer)
  }
}

const failed = (r: Awaited<ReturnType<typeof send>>): r is { failed: ReturnType<typeof unreachable> } =>
  'failed' in r

/**
 * What a server says it serves.
 *
 * This is how the Model field gets filled: the user types an address, and the
 * server names its own model rather than the user having to know the exact id.
 * For vLLM that id is the full HuggingFace path, which nobody types correctly
 * from memory.
 */
export async function listModels(endpoint: string, signal?: AbortSignal): Promise<ModelsResult> {
  if (endpoint.trim().length === 0) return unconfigured()
  const response = await send(modelsRequest(endpoint), endpoint, signal)
  return failed(response) ? response.failed : readModelsResponse(response, endpoint)
}

export async function complete(
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatResult> {
  if (!isConfigured(settings)) return unconfigured()
  const response = await send(chatRequest(settings, messages), settings.endpoint, signal)
  return failed(response) ? response.failed : readChatResponse(response)
}

/**
 * One agent turn: the conversation plus the tools, in, and what the model wants
 * to do next, out.
 *
 * Separate from `complete` rather than a flag on it because the two have
 * genuinely different contracts. `complete` promises text and treats its absence
 * as malformed; this one accepts a turn with no text at all, because "call these
 * three tools and say nothing" is the commonest correct answer an agent gives.
 *
 * The tool list is passed through as opaque `unknown[]` — it comes from
 * `@jojo/service/agent/catalog`, which builds it from the registry, and there is
 * nothing for this file to add to it or check about it.
 */
export async function agentTurn(
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  tools: readonly unknown[],
  signal?: AbortSignal,
): Promise<Turn> {
  if (!isConfigured(settings)) return unconfigured()
  const response = await send(chatRequest(settings, messages, tools), settings.endpoint, signal)
  return failed(response) ? response.failed : readTurn(response)
}
