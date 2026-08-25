import {
  chatRequest,
  guardTruncation,
  isConfigured,
  modelsRequest,
  readChatResponse,
  readModelsResponse,
  readTurnFor,
  type WireToolCall,
  unconfigured,
} from '@jojo/service/core/model-server'
import {
  createStreamReader,
  streamingChatRequest,
  supportsStreaming,
} from '@jojo/service/core/model-stream'
import { endpointOf } from '@jojo/service/core/provider'
import { failed, send, sendStream } from '@/lib/local-service'
import type { Sent } from '@/lib/local-service'
import { callModel } from '@/lib/capture-bridge'
import { providerMeta } from '@jojo/service/core/provider'

/**
 * The model's transport, chosen by who is answering.
 *
 * A LOCAL server goes direct and always has: it is on this machine, and the
 * page can reach it.
 *
 * A CLOUD provider goes through the extension when one is installed, because
 * several of them cannot be called from a page at all. Measured against
 * `integrate.api.nvidia.com`: the preflight answers 200 with `vary: Origin` and
 * no `access-control-allow-origin`, so the browser blocks the real request and
 * the page gets a bare "Failed to fetch" naming nothing. The extension fetches
 * under its own permissions and is not subject to that; the worker will only
 * relay to hosts in its transcribed provider list.
 *
 * FALLS BACK TO DIRECT, and this one is a deliberate exception to the rule that
 * `markitdown.ts` states. There the direct path provably cannot work, so trying
 * it would be a doomed request every time. Here it is genuinely unknown: some
 * providers do send the headers, people are using them today, and silently
 * routing everyone through an extension they may not have installed would break
 * a setup that works. So: relay if the extension is there, direct if it is not.
 */
async function sendToModel(
  request: Parameters<typeof send>[0],
  endpoint: string,
  provider: string,
  signal?: AbortSignal,
): Promise<Sent> {
  if (!providerMeta(provider).cloud) return send(request, endpoint, signal)

  const relayed = await callModel({
    url: request.url,
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  })
  if (!('failed' in relayed)) return relayed

  // Only "no extension" falls through. A provider that answered badly is an
  // answer, and retrying it directly would just ask the same question twice.
  const noExtension = /extension did not answer|too old/i.test(relayed.failed.reason)
  if (!noExtension)
    return { failed: { ok: false, kind: 'unreachable', reason: relayed.failed.reason } }
  return send(request, endpoint, signal)
}
import type { ChatMessage, ChatResult, ModelsResult, Turn } from '@jojo/service/core/model-server'

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
/*
 * Re-exported, not redeclared. This was a two-field local copy that quietly
 * stopped matching the real one when providers gained a key and a context
 * window — and nothing would have caught it, because a structural type that is
 * a SUBSET still assigns cleanly. The app would simply have dropped the key on
 * the floor.
 */
import type { ModelSettings } from '@jojo/service/core/provider'

export type { ModelSettings }

export { isConfigured }

/**
 * What a server says it serves.
 *
 * This is how the Model field gets filled: the user types an address, and the
 * server names its own model rather than the user having to know the exact id.
 * For vLLM that id is the full HuggingFace path, which nobody types correctly
 * from memory.
 */
export async function listModels(
  /*
   * The whole settings object, not just an address.
   *
   * A cloud provider will not answer an unauthenticated request, and the cost
   * of that was not a poor error message — it was that Claude and OpenAI could
   * be configured and never connected. The list 401'd, the Model field stayed
   * empty and disabled, and there was no way forward from the screen.
   */
  settings: ModelSettings,
  signal?: AbortSignal,
): Promise<ModelsResult> {
  const endpoint = endpointOf(settings)
  if (endpoint.trim().length === 0) return unconfigured()
  const response = await sendToModel(modelsRequest(settings), endpoint, settings.provider, signal)
  return failed(response) ? response.failed : readModelsResponse(response, endpoint)
}

export async function complete(
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatResult> {
  if (!isConfigured(settings)) return unconfigured()
  const response = await sendToModel(
    chatRequest(settings, messages, undefined, true),
    endpointOf(settings),
    settings.provider,
    signal,
  )
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
/**
 * Streams a turn, and hands back the ordinary non-streaming shape.
 *
 * The whole point of the conversion: `readTurnFor` and `guardTruncation` below
 * are the tested paths, and they read a completion object. Rebuilding one from
 * the assembled stream means streaming adds a transport, not a second parser —
 * so a bug in the streaming path cannot produce a DIFFERENT answer from the
 * batched one, only a missing one.
 */
async function readStream(
  request: ReturnType<typeof chatRequest>,
  endpoint: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<Sent> {
  const reader = createStreamReader()
  let assembled: { text: string; calls: readonly WireToolCall[]; finish: string | null } | null =
    null

  const drain = (events: ReturnType<typeof reader.push>) => {
    for (const event of events) {
      if (event.type === 'text') onDelta(event.delta)
      else assembled = { text: event.text, calls: event.calls, finish: event.finish }
    }
  }

  const out = await sendStream(
    request,
    endpoint,
    (chunk) => {
      drain(reader.push(chunk))
    },
    signal,
  )
  if (failed(out)) return out
  // A body that never produced a `[DONE]`; `end` returns what did arrive.
  if (assembled === null) drain(reader.end())

  const done = assembled ?? { text: '', calls: [], finish: null }
  /*
   * Shaped as one `choices[0]` completion, which is what the non-streaming
   * readers expect. `tool_calls` is omitted rather than sent empty: an empty
   * array is a claim that the model chose to call nothing, and some readers
   * treat the two differently.
   */
  return {
    ok: true,
    status: out.status,
    text: JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: done.text,
            ...(done.calls.length > 0 ? { tool_calls: done.calls } : {}),
          },
          finish_reason: done.finish,
        },
      ],
    }),
  }
}

export async function agentTurn(
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  tools: readonly unknown[],
  signal?: AbortSignal,
  /**
   * Called with each fragment of prose as it arrives, when the provider streams.
   *
   * Absent, or a provider whose stream this app cannot read, and the request is
   * the ordinary one — same answer, arriving all at once. Nothing downstream has
   * to know which route was taken, which is the property that lets streaming be
   * added without a second code path through the agent loop.
   */
  onDelta?: (delta: string) => void,
): Promise<Turn> {
  if (!isConfigured(settings)) return unconfigured()
  /*
   * `browser` is passed rather than detected, because core has no globals to
   * detect with — and because the answer is a property of the app rather than
   * of the call. Anthropic blocks browser origins unless the caller opts in by
   * name; there is no origin to opt in for on a phone.
   */
  /*
   * Streamed only when the request goes DIRECT. A cloud provider is relayed
   * through the extension, which answers with a whole body and cannot stream —
   * so the condition is "not cloud" rather than "supports streaming", and the
   * local servers this matters most for are exactly the ones that qualify.
   */
  const streaming =
    onDelta !== undefined && supportsStreaming(settings) && !providerMeta(settings.provider).cloud
  const request = streaming
    ? streamingChatRequest(settings, messages, tools, true)
    : chatRequest(settings, messages, tools, true)

  const response = streaming
    ? await readStream(request, endpointOf(settings), onDelta, signal)
    : await sendToModel(request, endpointOf(settings), settings.provider, signal)
  if (failed(response)) return response.failed

  const turn = readTurnFor(settings, response)

  /*
   * The check for a server that quietly threw most of the prompt away.
   *
   * The worst failure this app can have and the only one a client can detect: a
   * window smaller than the request does not always produce an error, and the
   * model then answers confidently having never seen the tools or the question.
   *
   * The decision lives in `guardTruncation` rather than here, because it was
   * written twice — once in each app — and because a `fetch` sits between this
   * function and anything a test can reach.
   */
  return guardTruncation(request.body ?? '', turn)
}
