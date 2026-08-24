/**
 * The model servers a user has pointed this app at, and how to read one.
 *
 * Everything here is pure: URL arithmetic, response parsing, and the rules for
 * a saved list. The `fetch` that uses it lives in each app's `lib/`, because
 * `check-platform` bans the network from this layer and is right to — a domain
 * layer that can reach the network is one that can block, fail and leak.
 *
 * So the split is the usual one. The parts that can be wrong in an interesting
 * way are here and tested; the ten lines that call `fetch` are per-app and
 * boring by design.
 *
 * WHY A SAVED LIST AT ALL. A local model lives at a URL with a port, and the
 * port is the part nobody remembers — `:8000` for vLLM, `:11434` for Ollama,
 * `:1234` for LM Studio, and whatever was passed to `--port` on the day. Typing
 * it once per session is the friction that stops people connecting a model they
 * already have running.
 */

import { ANTHROPIC_VERSION, anthropicChatRequest, readAnthropicTurn } from './anthropic'
import { endpointOf, providerMeta, type ModelSettings } from './provider'

/** A server the user has connected to and kept. */
export type ModelServer = {
  /**
   * Stable across renames, which is the whole reason it is not the URL.
   *
   * The list is keyed by endpoint for *uniqueness* — pointing at the same
   * server twice is one entry, not two — but a row that lost its identity when
   * renamed would be a new row to React, and the one being edited would remount
   * under the cursor.
   */
  id: string
  /** What the user calls it. Defaults to the model the server reported. */
  name: string
  /** Base URL, OpenAI-style: '…/v1'. Normalised — no trailing slash. */
  endpoint: string
  /**
   * Which provider this is, so loading a row restores the dialect too.
   *
   * Absent on rows written before cloud providers could be saved, and read as
   * `openai-compatible` — which is what every one of those rows actually was.
   */
  provider?: string
  /**
   * The key this connection needs, when it needs one.
   *
   * HERE RATHER THAN NOWHERE, and the alternative was worse. A key lived only in
   * the current settings document, so switching from Claude to NVIDIA and back
   * meant pasting a key each time — and the saved list, whose entire purpose is
   * "do not set this up again", was useless for exactly the providers that need
   * the most setting up.
   *
   * WHAT "STORED SECURELY" CAN HONESTLY MEAN HERE. Not encrypted at rest: there
   * is no passphrase, and a cipher whose key sits in the same store as the
   * ciphertext is theatre that reads as protection. What is true, and is the
   * property that matters, is that this never leaves the device by any path the
   * app controls — `core/backup.ts` serialises nodes, edges and documents, and
   * this is none of those, so a backup file cannot carry it and neither can a
   * Transfer. It is browser storage on the user's own machine, alongside the
   * settings document that already held it.
   */
  apiKey?: string
  /** The model id requests are sent with, as the server reported it. */
  model: string
}

/**
 * Trims, drops a trailing slash, and nothing else.
 *
 * Deliberately not "helpful": it does not add a scheme, guess a port, or append
 * `/v1`. A URL the user typed and a URL this function invented fail in the same
 * place with the same message, and only one of them is their fault. The one
 * thing it does fix is the trailing slash, because `…/v1/` + `/models` is a
 * double slash that some servers 404 and others do not, which is worse than
 * either.
 */
export const normaliseEndpoint = (raw: string): string => raw.trim().replace(/\/+$/, '')

/** Where the model list lives on an OpenAI-compatible server. */
export const modelsUrl = (endpoint: string) => `${normaliseEndpoint(endpoint)}/models`

/** Where a completion is asked for. */
export const chatUrl = (endpoint: string) => `${normaliseEndpoint(endpoint)}/chat/completions`

/**
 * The model ids a `/v1/models` response advertises, in the order given.
 *
 * vLLM serves one model and lists it; Ollama and LM Studio list everything they
 * have. So the first id is the sensible default and the rest are worth keeping —
 * a caller that wants to offer a choice has one, and a caller that does not
 * takes `[0]`.
 *
 * Written against the shape rather than a type, because "OpenAI-compatible" is
 * a claim each server makes about itself. Anything that is not a list of
 * objects with string `id`s comes back empty, and the caller reports that it
 * could not read the server rather than rendering `undefined` as a model name.
 */
export function readModelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return []

  /*
   * Two shapes, because Ollama's native endpoint answers differently from
   * everything else: `{models:[{model:'…'}]}` rather than `{data:[{id:'…'}]}`.
   * Both are read here rather than behind a dialect branch, because a list of
   * model names is a list of model names — and a caller that had to say which
   * spelling it expected would be one more place to get the pairing wrong.
   * Anthropic's `/v1/models` already uses the `data[].id` shape unchanged.
   */
  const data = (payload as { data?: unknown }).data
  if (Array.isArray(data)) {
    return data
      .map((entry) =>
        typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined,
      )
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }

  const models = (payload as { models?: unknown }).models
  if (Array.isArray(models)) {
    return models
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? (entry as { model?: unknown }).model
          : undefined,
      )
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }

  return []
}

/**
 * The assistant's reply out of a chat completion, or null.
 *
 * Null rather than `''` so a caller cannot print an empty bubble and call it an
 * answer. Every failure on this path has to be reportable as one.
 */
export function readReply(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.trim().length > 0 ? content : null
}

/**
 * Adds a server, or updates the one already at that URL.
 *
 * Keyed on the normalised endpoint: connecting twice to the same server is one
 * entry. Without that, testing a connection three times while getting the port
 * right leaves three rows that differ by a trailing slash.
 *
 * An existing entry keeps its `id` and its `name` — the name is the user's, and
 * a reconnect that renamed their "Workstation" back to `meta-llama/Llama-3.1-8B`
 * would undo an edit they made on purpose. The model is refreshed, because that
 * is a fact about the server rather than a preference.
 */
export function saveServer(
  list: readonly ModelServer[],
  entry: { name: string; endpoint: string; model: string; provider?: string; apiKey?: string },
): ModelServer[] {
  const endpoint = normaliseEndpoint(entry.endpoint)
  const existing = list.find((s) => s.endpoint === endpoint)
  /*
   * `provider` and `apiKey` are omitted rather than written as undefined, so a
   * row keeps its stored key when a caller that does not know about keys saves
   * it. `exactOptionalPropertyTypes` is on, which makes that the only spelling
   * that compiles — and it is also the correct behaviour.
   */
  const extras = {
    ...(entry.provider === undefined ? {} : { provider: entry.provider }),
    ...(entry.apiKey === undefined || entry.apiKey === '' ? {} : { apiKey: entry.apiKey }),
  }
  if (!existing) {
    return [
      ...list,
      {
        id: serverId(endpoint),
        name: entry.name || entry.model,
        endpoint,
        model: entry.model,
        ...extras,
      },
    ]
  }
  return list.map((s) => (s.endpoint === endpoint ? { ...s, model: entry.model, ...extras } : s))
}

/**
 * The id for a saved server: its own address, prefixed.
 *
 * Derived rather than minted because there is no random source in this layer
 * and no need for one — the list is unique by endpoint, so the endpoint already
 * *is* the key. Deriving it also means two devices that saved the same server
 * agree on the id without ever having spoken, and that a test can assert one.
 *
 * It still is not the raw endpoint, and the prefix is why: an id is a React key
 * and a delete target, and giving those the same spelling as a user-editable URL
 * invites code that compares one to the other and gets it right until somebody
 * types a trailing slash.
 */
export const serverId = (endpoint: string) => `server:${normaliseEndpoint(endpoint)}`

/** Renames one. A blank name falls back to the model id rather than vanishing. */
export function renameServer(
  list: readonly ModelServer[],
  id: string,
  name: string,
): ModelServer[] {
  return list.map((s) => (s.id === id ? { ...s, name: name.trim() || s.model } : s))
}

export function removeServer(list: readonly ModelServer[], id: string): ModelServer[] {
  return list.filter((s) => s.id !== id)
}

/** The saved entry for a URL, if this one has been connected to before. */
export const serverAt = (list: readonly ModelServer[], endpoint: string): ModelServer | undefined =>
  list.find((s) => s.endpoint === normaliseEndpoint(endpoint))

/* -------------------------------------------------------------------------- */
/* The protocol, as data                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A request described rather than performed.
 *
 * This is what lets the interesting half of an HTTP client live in a layer that
 * `check-platform` forbids the network from. Building the URL, the headers and
 * the body is arithmetic; reading a status code and a body back is parsing; both
 * are things that can be wrong in ways a test should catch. Only the six lines
 * that hand this to `fetch` are per-app, and there is nothing in them to get
 * wrong that a type would not catch.
 */
export type ModelRequest = {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

/** What a caller must report back after sending one. */
export type ModelResponse = {
  ok: boolean
  status: number
  /** The raw body. Parsed here, so a malformed body is this layer's problem. */
  text: string
  /**
   * `Retry-After`, when the server sent one. Optional, and absent is normal.
   *
   * The only response header this layer has any use for, and it is here rather
   * than a whole headers map on purpose: a map would invite this layer to start
   * reading things that differ per provider, which is how a core module ends up
   * knowing which vendor it is talking to.
   */
  retryAfter?: string | null
}

/**
 * A tool call as the wire spells it.
 *
 * `arguments` is a JSON STRING, not an object — that is OpenAI's shape and every
 * compatible server copies it. It is also where small models fail most often, so
 * it is parsed in one place with the failure reported rather than thrown.
 */
export type WireToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * One turn of the conversation.
 *
 * The `tool` role and `tool_calls` are what make an agent loop possible: the
 * model's request to call something, and the answer coming back tied to it by
 * `tool_call_id`. A server that gets those two out of step answers about the
 * wrong call, which is why the id is carried rather than positions being
 * assumed.
 */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: readonly WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * How a request failed, in the four ways a caller has to tell apart.
 *
 * `unconfigured` is not an error the user made, `unreachable` means nothing
 * answered, `refused` means something did and said no, and `malformed` means
 * something answered in a shape this does not recognise. The screen phrases each
 * differently because the fix for each is different.
 */
export type ModelFailure = {
  ok: false
  kind: 'unconfigured' | 'unreachable' | 'refused' | 'malformed'
  reason: string
}

/** Long enough for a cold local model, short enough to not read as a hang. */
export const MODEL_TIMEOUT_MS = 60_000

/*
 * `isConfigured` used to live here and asked two questions: is there an
 * endpoint, and is there a model. That was the whole of "configured" while
 * every provider was a URL the user typed. It is not any more — a cloud
 * provider has a fixed endpoint and needs a key — so the rule moved to
 * `provider.ts` next to the table it has to consult, and is re-exported here so
 * that callers importing it from the module that always had it keep working.
 *
 * Re-exported rather than reimplemented. Two functions with this name answering
 * slightly different questions is exactly the drift `check-no-copies` exists to
 * prevent and cannot see, because it compares files rather than exported names.
 */
export { isConfigured } from './provider'

/**
 * Ask a provider what it serves.
 *
 * This took a whole `ModelSettings` rather than an endpoint because a cloud
 * provider will not answer an unauthenticated request — and the consequence of
 * getting that wrong was not a bad error message, it was that Claude and OpenAI
 * could be CONFIGURED and never CONNECTED. "Test connection" 401'd, the model
 * field stayed empty and disabled, `isConfigured` never turned true, and there
 * was no way forward from the screen.
 *
 * Ollama's native path lists somewhere else again — `/api/tags`, in a different
 * shape — so the dialect decides the URL as well as the headers.
 */
export const modelsRequest = (settings: ModelSettings): ModelRequest => {
  const meta = providerMeta(settings.provider)
  const endpoint = endpointOf(settings)
  const key = (settings.apiKey ?? '').trim()

  if (meta.dialect === 'ollama') {
    return {
      url: `${normaliseEndpoint(endpoint).replace(/\/v\d+$/, '')}/api/tags`,
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  }

  return {
    url: modelsUrl(endpoint),
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(meta.dialect === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
        : meta.needsKey && key
          ? { Authorization: `Bearer ${key}` }
          : {}),
    },
  }
}

/**
 * A request to whichever provider is configured.
 *
 * Three dialects behind one signature. The caller — nine lines of `fetch` in
 * each app — posts `url`, `method`, `headers` and `body` without knowing which
 * of them it is talking to, which is what kept adding Claude to a change in
 * this file rather than a change in both apps.
 *
 * `browser` is passed rather than detected because this layer has no globals to
 * detect with, and because the answer differs per app rather than per call:
 * Anthropic blocks browser origins unless the caller opts in by name, and there
 * is no origin to opt in for on a phone.
 */
export const chatRequest = (
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  /**
   * The tools the model may call this turn, in OpenAI's `tools` shape.
   *
   * Omitted entirely rather than sent empty when there are none. `tools: []` is
   * not the same as no tools to every server — some treat the key's presence as
   * a request to use the tool-calling code path, which on a model without a tool
   * template is a 400 rather than a plain answer.
   */
  tools?: readonly unknown[],
  browser = false,
): ModelRequest => {
  const meta = providerMeta(settings.provider)
  const endpoint = endpointOf(settings)
  const key = (settings.apiKey ?? '').trim()

  if (meta.dialect === 'anthropic') {
    return anthropicChatRequest({ ...settings, endpoint }, messages, tools, browser)
  }

  if (meta.dialect === 'ollama') return ollamaChatRequest(settings, endpoint, messages, tools)

  return {
    url: chatUrl(endpoint),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Only when the provider actually wants one. A bearer header sent to a
      // local server is harmless but it is also a key leaving the machine for
      // no reason, and this app should not do that by accident.
      ...(meta.needsKey && key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model.trim(),
      messages,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      // Streaming would be nicer and is a bigger change: it needs a reader on a
      // platform whose fetch does not give one without a polyfill. A local model
      // answers fast enough that the wait is tolerable, and a partial answer that
      // stops mid-sentence on a dropped socket is its own problem.
      stream: false,
    }),
  }
}

/**
 * Ollama's own endpoint, for the two things its OpenAI shim cannot express.
 *
 * `/v1/chat/completions` on Ollama silently discards any key it does not
 * recognise, and it recognises no context control at all — so a setting offered
 * through it would appear to work and do nothing, which is worse than not
 * offering one. The native path takes both of the fields that matter:
 *
 * **`shift: false`** is the prize, and it is not `num_ctx`. By default Ollama
 * TRUNCATES a prompt that will not fit — dropping whole messages from the front
 * and, when even the last one is too big, sending it anyway. Nothing on the wire
 * says so. With `shift:false` it answers 400 with a sentence a person can act
 * on, and Ollama's CORS headers are global, so unlike vLLM that sentence is
 * actually readable from a browser.
 *
 * **`options.num_ctx`**, and only when the user stored a number themselves.
 * Sending one from a default would be worse than sending none: it disables
 * Ollama's own VRAM back-off, and asking for 32k on a laptop that cannot hold
 * it turns a degraded answer into a failed load. `contextOf` is the number jojo
 * PLANS against; `settings.contextWindow` is the number it INSTRUCTS with, and
 * they are deliberately different reads.
 */
function ollamaChatRequest(
  settings: ModelSettings,
  endpoint: string,
  messages: readonly ChatMessage[],
  tools?: readonly unknown[],
): ModelRequest {
  // A stored endpoint may carry the `/v1` the shim wanted; native must not.
  const base = normaliseEndpoint(endpoint).replace(/\/v\d+$/, '')
  const explicit = settings.contextWindow
  return {
    url: `${base}/api/chat`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model.trim(),
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      // Native defaults `stream` to TRUE, where the shim defaults it to false.
      stream: false,
      // Refuse rather than lie. See the header.
      shift: false,
      // Stops the model unloading between turns of one conversation.
      keep_alive: '30m',
      ...(typeof explicit === 'number' && explicit > 0 ? { options: { num_ctx: explicit } } : {}),
    }),
  }
}

/**
 * Turns a non-200 into a sentence, quoting the server rather than paraphrasing.
 *
 * The body is where a local server says the useful thing — vLLM answers a wrong
 * model name with the list of names it does have. Truncated, because some of
 * them answer with an HTML error page.
 */
/**
 * A rate limit, named rather than quoted.
 *
 * 429 is the one status where the body is reliably useless — providers answer it
 * with `{"detail":"Too Many Requests"}` or an HTML page or nothing at all — and
 * the one where the reader's next move is completely determined: wait. Quoting
 * the server here produced "The server answered 429 — Too Many Requests.",
 * which spends its whole length restating the number.
 *
 * It matters more than it looks because of NVIDIA's free tier, which is in the
 * provider list precisely so somebody without a card can run the agent. Meeting
 * the limit there is not a misconfiguration, it is Tuesday, and an agent run
 * that stops with a puzzling error reads as broken rather than as throttled.
 *
 * `retry-after` is passed through when the server sent one, because the only
 * thing better than "wait" is knowing how long.
 */
const rateLimited = (retryAfter: string | null): ModelFailure => ({
  ok: false,
  kind: 'refused',
  reason:
    'That model is rate limited right now, so this request was refused rather than answered. ' +
    (retryAfter && /^\d+$/.test(retryAfter.trim())
      ? `The server asked for ${retryAfter.trim()} seconds before the next one. `
      : 'Free tiers refill on a timer — a minute is usually enough. ') +
    'Nothing was lost; ask again when it clears.',
})

/**
 * Status 0 is not an answer, and must never be reported as one.
 *
 * A server cannot reply 0. It is what a browser puts on a response it refused to
 * let the page read — an opaque or CORS-blocked one — and the old wording turned
 * that into "The server answered 0.", which reads as a broken server and sent
 * people to check a provider that was working perfectly. Confirmed against
 * NVIDIA: Chrome reports `PreflightMissingAllowOriginHeader` and the page is
 * handed a zero.
 */
const blockedByBrowser = (): ModelFailure => ({
  ok: false,
  kind: 'unreachable',
  reason:
    'The browser blocked the reply, so nothing here ever saw it — that is not the server failing. ' +
    'It happens when a provider answers without the CORS headers a page needs, which several do. ' +
    'Install the jojo browser extension and it will make the call instead; Settings has it.',
})

const refused = (status: number, body: string, retryAfter: string | null = null): ModelFailure =>
  status === 0
    ? blockedByBrowser()
    : status === 429
      ? rateLimited(retryAfter)
      : {
          ok: false,
          kind: 'refused',
          reason: `The server answered ${String(status)}${body.trim() ? ` — ${body.trim().slice(0, 200)}` : ''}.`,
        }

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** What a `/v1/models` call came back with. */
export type ModelsResult = { ok: true; models: string[] } | ModelFailure

/**
 * The one mistake worth naming, because the server cannot name it for you.
 *
 * Typing the host without its `/v1` is by far the commonest way to get this
 * wrong, and every server answers it unhelpfully: vLLM 404s `/models` with
 * `{"error": "Not Found"}`, and a server behind a proxy answers 200 with an
 * index page. Both are true reports of what happened and neither points at the
 * missing three characters. Measured against a live vLLM stub — the 404 case is
 * what sent this back for a second pass.
 *
 * Only appended when the address really is missing it, so it never contradicts a
 * user who got that part right.
 */
const pathHint = (endpoint: string) =>
  /\/v\d+$/.test(normaliseEndpoint(endpoint))
    ? ''
    : ' Check the address ends in /v1 — that is the path an OpenAI-compatible server serves on.'

export function readModelsResponse(response: ModelResponse, endpoint: string): ModelsResult {
  if (!response.ok) {
    const fail = refused(response.status, response.text, response.retryAfter ?? null)
    return { ...fail, reason: fail.reason + pathHint(endpoint) }
  }
  const models = readModelIds(parse(response.text))
  if (models.length === 0) {
    return {
      ok: false,
      kind: 'malformed',
      reason: `That address answered, but not with a model list.${pathHint(endpoint)}`,
    }
  }
  return { ok: true, models }
}

export type ChatResult = { ok: true; text: string } | ModelFailure

export function readChatResponse(response: ModelResponse): ChatResult {
  const turn = readTurn(response)
  if (!turn.ok) return turn
  if (turn.text === null) {
    return {
      ok: false,
      kind: 'malformed',
      // Reached when a model answers a plain question with a tool call it was
      // never offered. Naming that is more useful than "not in the expected
      // shape", which is what this said and which sent a reader to the wrong
      // half of the problem.
      reason:
        turn.toolCalls.length > 0
          ? 'The model tried to call a tool on a page that offers none.'
          : 'The server answered, but not in the shape an OpenAI-compatible endpoint uses.',
    }
  }
  return { ok: true, text: turn.text }
}

/* -------------------------------------------------------------------------- */
/* Tool-calling                                                                */
/* -------------------------------------------------------------------------- */

/** A tool call with its arguments already off the wire and parsed. */
export type ToolCall = {
  id: string
  name: string
  /** `null` when the model sent `arguments` that were not JSON. */
  args: unknown
  /** The raw string, kept so a failure can quote what the model actually wrote. */
  raw: string
}

/**
 * One assistant turn: something to say, something to call, or both.
 *
 * Both is legal and does happen — a model narrating "let me look that up" while
 * also calling the read. Neither is not: a turn with no text and no calls is a
 * server answering nothing, and is reported as malformed rather than looping.
 */
/**
 * What the server says it actually read, when it says anything.
 *
 * `prompt_tokens` is the number that matters and it is the only way a client
 * can catch the worst failure this app has. A server whose context window is
 * smaller than the request does not always refuse: Ollama TRUNCATES, and what
 * gets dropped is the front of the prompt — which, in a tool-calling chat
 * template, is the tool list and the system prompt. The model then answers
 * confidently, having never seen the question or the tools, and the person
 * reads that as a stupid assistant rather than a misconfigured server.
 *
 * Nothing in the response says "I truncated". But `usage.prompt_tokens` is the
 * server's own count of what it evaluated, and the client knows what it sent —
 * so the two disagreeing IS the signal. See `readTurn` and `truncationOf`.
 */
export type Usage = {
  /** Tokens the server says it evaluated of the prompt. */
  readonly promptTokens: number | null
  readonly completionTokens: number | null
}

export type Turn =
  | {
      ok: true
      text: string | null
      toolCalls: readonly ToolCall[]
      finishReason: string | null
      /**
       * Absent on servers that do not report it, and never invented.
       *
       * Optional rather than `Usage | null` so that every existing way of
       * building a Turn — the tests' scripted models, the pipelines' fakes —
       * stays valid. A turn that says nothing about usage is a legitimate
       * turn; only a turn that CLAIMS a small prompt count is evidence.
       */
      usage?: Usage | null
    }
  | ModelFailure

/**
 * The answer, whichever dialect it came back in.
 *
 * Dispatches on the same fact `chatRequest` did. Passing the settings rather
 * than remembering what was sent keeps the two halves impossible to mismatch —
 * a response parsed as the wrong dialect reports "not in the expected shape",
 * which sends a reader to entirely the wrong problem.
 */
export function readTurnFor(settings: ModelSettings, response: ModelResponse): Turn {
  const meta = providerMeta(settings.provider)
  if (meta.dialect === 'anthropic') return readAnthropicTurn(response)
  if (meta.dialect === 'ollama') return readOllamaTurn(response)
  return readTurn(response)
}

/**
 * Ollama's native answer, which is its OpenAI shim's answer with the wrapping off.
 *
 * Four differences, and the second is the one that would have gone unnoticed:
 * there is no `choices` array; `tool_calls[].function.arguments` is an OBJECT
 * rather than a JSON string, so the existing parser would have read every call
 * as having no arguments at all; there is no `type: 'function'` and often no
 * id; and the finish reason is `done_reason`, which says "stop" even when the
 * model called something.
 */
export function readOllamaTurn(response: ModelResponse): Turn {
  if (!response.ok) return refused(response.status, response.text, response.retryAfter ?? null)
  const payload = parse(response.text)
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, kind: 'malformed', reason: 'The server answered, but not in JSON.' }
  }
  const message = (payload as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) {
    return {
      ok: false,
      kind: 'malformed',
      reason: 'The server answered, but not in the shape Ollama uses.',
    }
  }

  const content = readContent(message)
  const raw = (message as { tool_calls?: unknown }).tool_calls
  const toolCalls: ToolCall[] = []
  if (Array.isArray(raw)) {
    for (const [index, entry] of raw.entries()) {
      if (typeof entry !== 'object' || entry === null) continue
      const fn = (entry as { function?: unknown }).function
      if (typeof fn !== 'object' || fn === null) continue
      const name = (fn as { name?: unknown }).name
      if (typeof name !== 'string' || name.length === 0) continue
      // An object here, not a string. Read as a string it would be `''`, and
      // every native tool call would run with no arguments.
      const args = (fn as { arguments?: unknown }).arguments ?? {}
      const id = (entry as { id?: unknown }).id
      toolCalls.push({
        id: typeof id === 'string' && id.length > 0 ? id : `call_${String(index)}`,
        name,
        args,
        raw: JSON.stringify(args),
      })
    }
  }

  if (content === null && toolCalls.length === 0) {
    return {
      ok: false,
      kind: 'malformed',
      reason: 'The model returned an empty turn — no answer and no tool call.',
    }
  }

  const done = (payload as { done_reason?: unknown }).done_reason
  const prompt = (payload as { prompt_eval_count?: unknown }).prompt_eval_count
  const completion = (payload as { eval_count?: unknown }).eval_count
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  return {
    ok: true,
    text: content,
    toolCalls,
    // `done_reason` says "stop" even with calls present — the shim rewrites it
    // and native does not — so the calls above are the honest signal, not this.
    finishReason: typeof done === 'string' ? done : null,
    usage:
      num(prompt) === null && num(completion) === null
        ? null
        : { promptTokens: num(prompt), completionTokens: num(completion) },
  }
}

export function readTurn(response: ModelResponse): Turn {
  if (!response.ok) return refused(response.status, response.text, response.retryAfter ?? null)
  const payload = parse(response.text)
  const choice = firstChoice(payload)
  if (!choice) {
    return {
      ok: false,
      kind: 'malformed',
      reason: 'The server answered, but not in the shape an OpenAI-compatible endpoint uses.',
    }
  }
  const message = (choice as { message?: unknown }).message
  const content = readContent(message)
  const toolCalls = readToolCalls(message)
  if (content === null && toolCalls.length === 0) {
    return {
      ok: false,
      kind: 'malformed',
      reason: 'The model returned an empty turn — no answer and no tool call.',
    }
  }
  const finish = (choice as { finish_reason?: unknown }).finish_reason
  return {
    ok: true,
    text: content,
    toolCalls,
    finishReason: typeof finish === 'string' ? finish : null,
    usage: readUsage(payload),
  }
}

/**
 * `usage`, when the server sends it. Null rather than zeroes when it does not.
 *
 * The distinction is the whole point: a server that reports nothing must not be
 * accused of truncating, and a zero would do exactly that. vLLM, Ollama and LM
 * Studio all send this block; the null branch exists for anything that does not.
 */
function readUsage(payload: unknown): Usage | null {
  if (typeof payload !== 'object' || payload === null) return null
  const usage = (payload as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
  const prompt = num((usage as { prompt_tokens?: unknown }).prompt_tokens)
  const completion = num((usage as { completion_tokens?: unknown }).completion_tokens)
  if (prompt === null && completion === null) return null
  return { promptTokens: prompt, completionTokens: completion }
}

/**
 * Roughly how many tokens a request body is, without a tokeniser.
 *
 * `chars / 3.6`, which is deliberately crude and deliberately documented as
 * such. A real tokeniser would be a dependency per model family, and this
 * number is never used to make a decision that needs to be exact — only to
 * notice a server that evaluated a small FRACTION of what it was sent. The
 * divisor was calibrated against this app's own catalog: 56,071 characters of
 * tool schema measured as 15,575 tokens.
 */
export const estimateTokens = (body: string): number => Math.round(body.length / 3.6)

/**
 * How much of the prompt the server appears to have thrown away.
 *
 * Returns null when there is nothing to say — no usage reported, or the counts
 * broadly agree. A number is only produced when the server evaluated
 * materially less than was sent, which is the case worth interrupting someone
 * over.
 *
 * ## Why the threshold is generous
 *
 * Because the estimate is crude and the two numbers are counting slightly
 * different things. A chat template adds control tokens the client never sees;
 * a tokeniser splits JSON punctuation in ways `chars/3.6` cannot predict; and
 * a server with a warm prefix cache may report cached tokens differently. All
 * of that is noise in the tens of percent, and none of it is the failure being
 * looked for — truncation to a 4k window from a 19k prompt is a FOUR-FOLD
 * disagreement. Half is comfortably outside the noise and comfortably inside
 * the thing worth catching.
 */
export const TRUNCATION_RATIO = 0.5

export function truncationOf(sentBody: string, usage: Usage | null): number | null {
  if (usage?.promptTokens == null) return null
  const sent = estimateTokens(sentBody)
  // A tiny prompt has too little signal; the ratio is meaningless on 40 tokens.
  if (sent < 1000) return null
  return usage.promptTokens < sent * TRUNCATION_RATIO ? usage.promptTokens : null
}

/**
 * The sentence for a server that quietly dropped most of the prompt.
 *
 * It names both numbers, because the person can act on the gap and cannot act
 * on "something went wrong". And it gives the two fixes in the order of
 * likelihood: raise the window, or ask for less.
 */
/**
 * A turn, unless the server quietly read only part of what it was sent.
 *
 * The decision and the sentence in one place, called by both apps, because the
 * first version of this was twelve lines written twice — once in each app's
 * `llm.ts` — which is the copy this repo has a lint rule against. It was also
 * untestable there: `agentTurn` does a real `fetch`, so nothing held the wiring
 * and removing it broke no test.
 *
 * Reported as a REFUSAL rather than passed through with a warning attached. An
 * answer built on a prompt the model never fully read is not a degraded answer,
 * it is a wrong one delivered confidently, and letting it reach the screen is
 * how this failure stays invisible.
 */
export function guardTruncation(sentBody: string, turn: Turn): Turn {
  if (!turn.ok) return turn
  const evaluated = truncationOf(sentBody, turn.usage ?? null)
  if (evaluated === null) return turn
  return {
    ok: false,
    kind: 'refused',
    reason: truncationWarning(evaluated, estimateTokens(sentBody)),
  }
}

export const truncationWarning = (evaluated: number, sent: number): string =>
  `The server read about ${String(evaluated).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} tokens of the roughly ` +
  `${String(sent).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} jojo sent, so it silently dropped the rest — ` +
  `including, most likely, the tool list and your question. Raise the model's context window, or ask from a page that offers fewer tools.`

function firstChoice(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined
  const choices = (payload as { choices?: unknown }).choices
  return Array.isArray(choices) && choices.length > 0 ? choices[0] : undefined
}

const readContent = (message: unknown): string | null => {
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.trim().length > 0 ? content : null
}

/**
 * The calls, with each `arguments` string parsed once.
 *
 * A model that emits invalid JSON here is common enough to be a designed-for
 * case rather than an edge one, so `args: null` is a value the loop handles by
 * telling the model what it wrote — not an exception, and not a silently
 * dropped call, which would leave the model waiting for a result forever.
 */
function readToolCalls(message: unknown): ToolCall[] {
  if (typeof message !== 'object' || message === null) return []
  const calls = (message as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(calls)) return []
  return calls
    .map((entry, index): ToolCall | null => {
      if (typeof entry !== 'object' || entry === null) return null
      const fn = (entry as { function?: unknown }).function
      if (typeof fn !== 'object' || fn === null) return null
      const name = (fn as { name?: unknown }).name
      if (typeof name !== 'string' || name.length === 0) return null
      const raw = (fn as { arguments?: unknown }).arguments
      const text = typeof raw === 'string' ? raw : ''
      const id = (entry as { id?: unknown }).id
      return {
        // Some servers omit the id on a single call. Positional is a poor id but
        // a missing one is worse: the result message needs something to point at
        // or the model cannot match the answer to the question.
        id: typeof id === 'string' && id.length > 0 ? id : `call_${String(index)}`,
        name,
        args: text.trim() === '' ? {} : safeParse(text),
        raw: text,
      }
    })
    .filter((c): c is ToolCall => c !== null)
}

const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * The sentence for a request that never got an answer.
 *
 * Shared so both apps blame the same thing in the same words. A timeout and a
 * closed port are one kind here on purpose — from the user's side they are the
 * same fact, "nothing is listening at that address", and the only actionable
 * difference is how long they waited to learn it.
 */
export const unreachable = (endpoint: string, detail: string, timedOut: boolean): ModelFailure => ({
  ok: false,
  kind: 'unreachable',
  reason: timedOut
    ? `Nothing answered ${normaliseEndpoint(endpoint)} within ${String(MODEL_TIMEOUT_MS / 1000)} seconds.`
    : `Could not reach ${normaliseEndpoint(endpoint)} — ${detail}.`,
})

export const unconfigured = (): ModelFailure => ({
  ok: false,
  kind: 'unconfigured',
  reason: 'No model is connected. Settings is where the endpoint goes.',
})
