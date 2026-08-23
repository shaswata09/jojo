import {
  chatRequest,
  isConfigured,
  modelsRequest,
  readChatResponse,
  readModelsResponse,
  readTurn,
  unconfigured,
} from '@jojo/service/core/model-server'
import { failed, send } from '@/lib/local-service'
import type {
  ChatMessage,
  ChatResult,
  ModelsResult,
  Turn,
} from '@jojo/service/core/model-server'

/**
 * The model client.
 *
 * It used to open by calling itself the one place this app touches the network,
 * and that stopped being true when the Vault learned to read documents: the
 * transport now lives in `local-service.ts` and MarkItDown's client is beside
 * this one. What is still true is the part that matters — nothing is sent to a
 * server the user did not type in, there is no key, no telemetry and no fallback
 * host, and both default addresses are loopback.
 *
 * That sentence used to read "this build makes no network requests", and the
 * Settings panel had a permanently disabled Test button explaining as much. It
 * is still nearly true: nothing is sent to a server the user did not type in,
 * there is no key, no telemetry and no fallback host, and the default endpoint
 * is a loopback address. What changed is that pointing at a model you are
 * already running is now something the app can actually do rather than describe.
 *
 * OpenAI's shape, because vLLM, Ollama and LM Studio all speak it.
 *
 * WHAT IS LEFT IN THIS FILE, AND WHY IT IS SO LITTLE. Building the URL and the
 * body, reading a status and a payload back, and choosing the sentence for each
 * failure all live in `@jojo/service/core/model-server`, tested there without a
 * socket. They cannot live *here* only because there are two apps and this would
 * be the second copy; they cannot live in the service's own network layer
 * because `check-platform` bans `fetch` from it, and is right to — a domain
 * layer that can reach the network is one that can block, fail and leak. So the
 * protocol is shared data and this is the handful of lines that send it.
 *
 * A NOTE ON WHAT WILL BITE, WHICH IS MORE THAN IT LOOKS. Every browser failure
 * before a response arrives is the same `TypeError: Failed to fetch`, with no
 * status, no body and no reason — so this file has to supply what the exception
 * will not. `browserBlocked` below is that sentence, and it is attached in the
 * transport rather than on a screen so that every caller gets it.
 *
 * Three different things produce it, and the third is the one measured here
 * against a real vLLM rather than reasoned about:
 *
 *   1. Nothing is listening. The honest reading, and the one the phone shares.
 *   2. Mixed content — an https page may not call a plain http address, and the
 *      request is blocked before it leaves.
 *   3. THE SERVER ANSWERED AND THE BROWSER WOULD NOT SHOW US. vLLM's success
 *      responses carry `access-control-allow-origin` and its ERROR responses do
 *      not, so a 400 that curl reads in full is invisible here: preflight
 *      passes, the POST returns 400 without the header, and Chrome reports
 *      `MissingAllowOriginHeader` as a bare `Failed to fetch`. A connected model
 *      that then fails to answer therefore looks exactly like an absent one.
 *
 * That is why the wording never says "the server is not running" outright. It
 * cannot know, and case 3 is a live model that is working perfectly except for a
 * header, which is the worst thing to be confidently wrong about.
 */

export type { ChatMessage, ChatResult, ModelsResult, Turn }

/** Base URL, OpenAI-style: '…/v1'. The paths are appended by the protocol. */
export type ModelSettings = { endpoint: string; model: string }

export { isConfigured }




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
