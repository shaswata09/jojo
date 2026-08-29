import {
  chatRequest,
  guardTruncation,
  isConfigured,
  modelsRequest,
  readChatResponse,
  readModelsResponse,
  readTurnFor,
  type ModelFailure,
  type WireToolCall,
  unconfigured,
} from '@jojo/service/core/model-server'
import {
  createStreamReader,
  streamingChatRequest,
  supportsStreaming,
  type StreamUsage,
} from '@jojo/service/core/model-stream'
import { endpointOf } from '@jojo/service/core/provider'
import { report } from '@/lib/analytics'
import { reportableProvider } from '@jojo/service/core/analytics'
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
/**
 * Records that a model request failed, and returns it unchanged.
 *
 * ## Why this is here rather than at each call site
 *
 * Every route into a model comes through this file, so one wrapper covers the
 * assistant, the graph box, the pipelines and Settings' Test connection. Put at
 * the call sites instead, it would be four copies that drift, and the one that
 * got forgotten would be the one nobody could explain later.
 *
 * ## Why it matters more here than in most apps
 *
 * jojo has no backend, so it has no server logs. Until this existed, every
 * event in the catalogue recorded something WORKING: a model that timed out for
 * every user of a given provider was indistinguishable from one nobody had
 * tried. The failure that started this — a local server generating slower than
 * a sixty-second budget allowed — was invisible to everything except the person
 * it happened to.
 *
 * ## What it does not send
 *
 * Not the address, not the message. `params` is typed against `EventParams`,
 * which has no `string` in it by construction, so the endpoint — frequently a
 * hostname on the person's own network — cannot travel even by accident.
 */
function reportFailure(
  failure: ModelFailure,
  provider: string,
  phase: 'connect' | 'chat' | 'models',
): ModelFailure {
  report('model_failed', {
    provider: reportableProvider(provider),
    kind: failure.why ?? failure.kind,
    phase,
  })
  return failure
}


/**
 * Whether this address needs the extension to fetch it on the page's behalf.
 *
 * True only when the page is https AND the target is plain http AND it is not
 * loopback — the exact set the browser refuses and the extension will relay.
 * Loopback is excluded because browsers treat it as potentially trustworthy, so
 * it works directly and a relay would only add a hop.
 *
 * Kept in step with `isPrivateNetwork` in `web/extension/background.js`: this
 * decides what to ASK for and that decides what is ALLOWED, and the two
 * disagreeing is what produced a refusal message telling somebody to install
 * the extension that was refusing them.
 */
export function needsRelay(url: string): boolean {
  if (globalThis.location?.protocol !== 'https:') return false
  if (!/^http:\/\//i.test(url)) return false
  return !/^http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:$|\/)/i.test(url)
}

async function sendToModel(
  request: Parameters<typeof send>[0],
  endpoint: string,
  provider: string,
  signal?: AbortSignal,
  /**
   * Set when the caller wants the relayed body IN PIECES.
   *
   * Only reaches the extension, because only a relayed request has one — a
   * cloud provider, or the private-network http address the branch below adds.
   * A bridge older than protocol 5 ignores it and answers whole, which is fine
   * and is why nothing downstream may assume a chunk ever arrives.
   */
  onChunk?: (text: string) => void,
): Promise<Sent> {
  /*
   * Cloud providers, AND a private-network address an https page cannot reach.
   *
   * ## The two ways this was wrong before
   *
   * First it was `cloud` alone, so a vLLM at `http://10.116.34.124:8103/v1`
   * went straight to `fetch` and was blocked by mixed content — while the error
   * text said "install the jojo extension, which relays that one hop for you".
   *
   * Then it was widened to relay ANYTHING the browser would refuse, which was
   * worse: the extension's own policy allowed loopback and five hosted
   * providers, so a LAN address traded a mixed-content error for "that address
   * is not a model provider jojo knows about" — a policy refusal wearing the
   * clothes of a typo.
   *
   * Both halves are fixed now, and they had to move together: `background.js`
   * relays private-network addresses over http (RFC 1918, link-local, `.local`
   * — never a public address), and this asks it to.
   *
   * LOOPBACK IS DELIBERATELY NOT HERE. The browser permits an https page to
   * call `http://localhost`, so a local Ollama keeps its direct path and does
   * not pay a message hop for nothing.
   */
  if (!providerMeta(provider).cloud && !needsRelay(request.url)) {
    return send(request, endpoint, signal)
  }

  const relayed = await callModel(
    {
      url: request.url,
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    },
    ...(onChunk ? ([onChunk] as const) : ([] as const)),
  )
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
  if (failed(response)) return reportFailure(response.failed, settings.provider, 'models')
  const read = readModelsResponse(response, endpoint)
  return read.ok ? read : reportFailure(read, settings.provider, 'models')
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
 * The `done` event, held until the stream is over and can be reshaped.
 *
 * ## Why `usage` is in here, having once been left out
 *
 * It is the whole reason `streamingChatRequest` sends `stream_options:
 * {include_usage: true}`, and this type is the only place it can be dropped
 * between the reader and `guardTruncation`. It WAS dropped: the field was
 * missing from the object literal in both drains below, so `done.usage` read
 * `undefined`, `done.usage === null` was false, `{usage: undefined}` was spread
 * into the completion and `JSON.stringify` removed the key on its way out. The
 * guard then saw a body with no counts, which it correctly treats as "the
 * server said nothing" — so it returned every turn unexamined and the app's
 * only defence against a silently truncated prompt was off for every streamed
 * turn on both roads. Nothing failed, which is what made it survive: a local
 * server that threw the tool list and the question away still answered, and the
 * answer arrived looking like any other.
 *
 * Declared once and shared by both readers rather than written inline twice,
 * because a field missing from one copy is exactly the bug this comment is
 * about.
 */
type Assembled = {
  text: string
  calls: readonly WireToolCall[]
  finish: string | null
  usage: StreamUsage | null
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
  let assembled: Assembled | null = null

  const drain = (events: ReturnType<typeof reader.push>) => {
    for (const event of events) {
      if (event.type === 'text') onDelta(event.delta)
      else
        assembled = {
          text: event.text,
          calls: event.calls,
          finish: event.finish,
          usage: event.usage,
        }
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

  const done = assembled ?? { text: '', calls: [], finish: null, usage: null }
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
      /*
       * Carried through, because `guardTruncation` reads it off the parsed body
       * and a reconstructed completion without it silently disables the check.
       * Omitted rather than zeroed when the server sent none: "reported 400
       * prompt tokens for a 20,000-token request" and "reported nothing" are
       * different facts and the guard distinguishes them.
       */
      ...(done.usage === null ? {} : { usage: done.usage }),
    }),
  }
}

/**
 * The same stream, arriving through the extension instead of over `fetch`.
 *
 * Used for a cloud provider AND for a private-network http address an https page
 * is not allowed to fetch — the two cases `sendToModel` relays. It does not
 * decide that itself: it hands the request to `sendToModel`, which asks
 * `needsRelay`, so the streamed road and the batched one cannot disagree about
 * where a request goes.
 *
 * ## Why the body can be fed to the same reader
 *
 * The request already carries `stream: true`, so what the provider sends back
 * is SSE either way — the extension is a pipe, not a parser. That means one
 * `createStreamReader` handles both roads, and the completion this returns is
 * built by the same code as the direct one. A bug in streaming can therefore
 * cost a missing answer, never a DIFFERENT answer from the batched path.
 *
 * ## An extension that cannot stream is not an error
 *
 * A bridge older than protocol 5 ignores the request to stream and hands back
 * the whole body at the end. That body is still SSE, so it goes through the
 * same reader in one push and the caller gets a correct answer that simply
 * never grew on screen. Users on an old extension are exactly the people who
 * cannot be asked to reload it before their next question, so this path has to
 * work rather than complain.
 */
async function readRelayedStream(
  request: ReturnType<typeof chatRequest>,
  endpoint: string,
  provider: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<Sent> {
  const reader = createStreamReader()
  let assembled: Assembled | null = null
  let streamed = false

  const drain = (events: ReturnType<typeof reader.push>) => {
    for (const event of events) {
      if (event.type === 'text') onDelta(event.delta)
      // `usage` included, for the reason set out on `Assembled`: without it the
      // truncation guard is silently switched off for this road too.
      else
        assembled = {
          text: event.text,
          calls: event.calls,
          finish: event.finish,
          usage: event.usage,
        }
    }
  }

  const out = await sendToModel(request, endpoint, provider, signal, (chunk) => {
    streamed = true
    drain(reader.push(chunk))
  })
  if (failed(out)) return out

  /*
   * The whole body, pushed through the SAME reader, when nothing arrived in
   * pieces. `onDelta` still fires for every fragment the reader finds — all at
   * once rather than over time, which is the honest representation of what
   * happened and keeps the transcript's assembled text identical either way.
   */
  if (!streamed) drain(reader.push(out.text))
  if (assembled === null) drain(reader.end())

  const done = assembled ?? { text: '', calls: [], finish: null, usage: null }
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
      ...(done.usage === null ? {} : { usage: done.usage }),
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
   * Streamed on BOTH roads now, which it was not before.
   *
   * A direct request reads the response body here in the page. A cloud one
   * cannot be made from the page at all — NVIDIA, OpenAI and Anthropic send no
   * `access-control-allow-origin` to a browser origin — so it goes through the
   * extension, which used to hand back one finished string. The result was that
   * exactly the slowest models showed nothing at all until they were done,
   * while a local one wrote itself out word by word.
   *
   * The extension now forwards the body as it arrives, so the same reader parses
   * the same frames on either road; only the transport differs. An extension
   * older than protocol 5 ignores the request and answers whole, and that path
   * still works — `readRelayedStream` treats "no chunks, then a full body" as an
   * ordinary outcome, because for those users it is the only one.
   */
  const cloud = providerMeta(settings.provider).cloud
  const streaming = onDelta !== undefined && supportsStreaming(settings)
  const request = streaming
    ? streamingChatRequest(settings, messages, tools, true)
    : chatRequest(settings, messages, tools, true)

  /*
   * THE STREAMED ROAD ASKS THE SAME QUESTION THE BATCHED ONE DOES, and it used
   * to ask a narrower one.
   *
   * The condition here was `cloud` alone. That is the transport decision, and
   * the transport decision belongs to `sendToModel` — which relays a cloud
   * provider AND a private-network http address an https page may not fetch.
   * `readStream` goes to `sendStream`, which goes straight to `fetch`, so on the
   * streamed branch the second half of that rule did not exist: measured from a
   * stubbed https page, a turn to `http://10.116.34.124:8103/v1` with an
   * `onDelta` fetched the address directly and never asked the extension. In a
   * browser that fetch never leaves — it is blocked as mixed content — so the
   * one setup the relay was built for (GitHub Pages over https, vLLM on the LAN)
   * failed with an error telling the user to install the extension that was
   * sitting there unasked. Turning streaming ON silently disabled the relay.
   *
   * This is exactly the shape `llm.test.ts` warned about and did not cover: the
   * old test asserted `needsRelay` in isolation, which is the guard, not the
   * join — and the guard was right the whole time.
   *
   * `needsRelay` rather than a second copy of the rule, so the two roads cannot
   * drift; `readRelayedStream` then re-asks `sendToModel`, which is the one
   * place the decision is actually made.
   */
  const relay = cloud || needsRelay(request.url)

  const response = !streaming
    ? await sendToModel(request, endpointOf(settings), settings.provider, signal)
    : relay
      ? await readRelayedStream(request, endpointOf(settings), settings.provider, onDelta, signal)
      : await readStream(request, endpointOf(settings), onDelta, signal)
  if (failed(response)) return reportFailure(response.failed, settings.provider, 'chat')

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
