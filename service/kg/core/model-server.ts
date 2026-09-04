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
 * Adds a model at an address, or updates the one already saved there.
 *
 * KEYED ON ENDPOINT **AND** MODEL, and the second half is what makes a hosted
 * provider usable. This was keyed on the endpoint alone, on the reasoning that
 * the model "is a fact about the server rather than a preference" — which is
 * true of a self-hosted vLLM, where one process serves one model and the URL is
 * the identity of both. It is false of every hosted provider: NVIDIA, OpenAI,
 * Anthropic, Groq and OpenRouter each answer for a whole catalogue at ONE fixed
 * address. Under the old key, connecting to a second NVIDIA model overwrote the
 * first, so the saved list could never hold more than one of them and there was
 * nothing to switch between.
 *
 * A row is therefore "a model I have reached, and how to reach it" — which is
 * what the list is for on both kinds of provider. Two models at one endpoint are
 * two rows; the same model reached twice is still one, so testing a connection
 * three times while getting the port right does not leave three rows.
 *
 * An existing entry keeps its `id` and its `name` — the name is the user's, and
 * a reconnect that renamed their "Workstation" back to `meta-llama/Llama-3.1-8B`
 * would undo an edit they made on purpose.
 *
 * THE KEY IS WRITTEN TO EVERY ROW AT THAT ENDPOINT, not only the one being
 * saved. A credential belongs to the provider, not to the model — so rotating
 * it while connecting to one NVIDIA model has to fix the other four rows too,
 * or they keep failing with a key the user already replaced and no way to see
 * why.
 */
export function saveServer(
  list: readonly ModelServer[],
  entry: { name: string; endpoint: string; model: string; provider?: string; apiKey?: string },
): ModelServer[] {
  const endpoint = normaliseEndpoint(entry.endpoint)
  const existing = list.find((s) => s.endpoint === endpoint && s.model === entry.model)
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
  /** The credential half of `extras`, which travels to every row at this address. */
  const keyExtra = entry.apiKey === undefined || entry.apiKey === '' ? {} : { apiKey: entry.apiKey }
  const withKey = (rows: readonly ModelServer[]): ModelServer[] =>
    rows.map((s) => (s.endpoint === endpoint ? { ...s, ...keyExtra } : s))

  if (!existing) {
    return [
      ...withKey(list),
      {
        id: serverId(endpoint, entry.model),
        name: entry.name || entry.model,
        endpoint,
        model: entry.model,
        ...extras,
      },
    ]
  }
  return withKey(list).map((s) =>
    s.endpoint === endpoint && s.model === entry.model ? { ...s, ...extras } : s,
  )
}

/**
 * The id for a saved row: its address and its model, prefixed.
 *
 * Derived rather than minted because there is no random source in this layer
 * and no need for one — the list is unique by (endpoint, model), so that pair
 * already *is* the key. Deriving it also means two devices that saved the same
 * model agree on the id without ever having spoken, and that a test can assert
 * one.
 *
 * THE MODEL IS IN IT because the id is a React key and a delete target. When
 * this was the endpoint alone, five NVIDIA models shared one id — React would
 * have drawn them as one row and Delete would have taken all five.
 *
 * It still is not the raw endpoint, and the prefix is why: giving an id the same
 * spelling as a user-editable URL invites code that compares one to the other
 * and gets it right until somebody types a trailing slash.
 */
export const serverId = (endpoint: string, model: string) =>
  `server:${normaliseEndpoint(endpoint)}#${model}`

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

/**
 * The saved rows belonging to one provider.
 *
 * The list is per-browser and holds every model this device has reached, across
 * every provider — so on the NVIDIA panel it would otherwise offer a vLLM box on
 * someone's desk, and picking it would swap the endpoint, the dialect and the
 * key underneath a form that still said NVIDIA. A saved row is only useful where
 * it can actually be selected, which is the panel for its own provider.
 *
 * A ROW WITH NO `provider` IS TREATED AS `openai-compatible`, and that is a
 * migration rather than a guess: `provider` was added to this record after the
 * feature shipped, so every row saved before it is a local server the user
 * configured by hand — which is exactly what `openai-compatible` is, and what
 * `DEFAULTS.provider` was set to at the time they saved it. Dropping those rows
 * from every panel would look like the list had lost them.
 */
export function serversFor(list: readonly ModelServer[], provider: string): ModelServer[] {
  return list.filter((s) => (s.provider ?? 'openai-compatible') === provider)
}

/**
 * The saved row for an address, and — when one is given — a model.
 *
 * `model` is optional because two callers want different things. Naming one
 * asks "is THIS model at THIS address saved", which is what a settings form
 * needs to show the user's own name for the row it is editing. Omitting it asks
 * "has this address ever been reached", which is what a caller looking for a
 * stored credential wants: the key is the provider's, so any row at that
 * endpoint carries it.
 */
export const serverAt = (
  list: readonly ModelServer[],
  endpoint: string,
  model?: string,
): ModelServer | undefined => {
  const at = normaliseEndpoint(endpoint)
  return model === undefined
    ? list.find((s) => s.endpoint === at)
    : list.find((s) => s.endpoint === at && s.model === model)
}

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
  /**
   * A finer classification, for reporting only. Never shown to anybody.
   *
   * `kind` decides what the app DOES — retry, refuse, send them to Settings —
   * and three different causes want the same handling, so it stays coarse. This
   * says which of the three it was, because "nobody can reach NVIDIA from a
   * browser" and "one laptop went to sleep" are the same `kind` and completely
   * different problems.
   *
   * Set where the failure is CONSTRUCTED, which is the only place that knows.
   * The alternative — matching on `reason` later — reads a sentence written for
   * a human and turns the wording into an API, so the next copy edit silently
   * changes what the metrics mean.
   */
  why?: FailureKind
}

/**
 * How a model request failed, finely enough to act on.
 *
 * `timeout` and `stalled` are separate because the fixes are: nothing answered
 * at all points at an address or a firewall, while a stream that started and
 * stopped points at the model being unloaded or the machine swapping.
 *
 * `blocked` is the BROWSER refusing to make the request — mixed content, or a
 * missing CORS header. It is the failure a person cannot fix by restarting
 * anything, and the one most likely to hit everybody on a hosted copy at once.
 */
export const FAILURE_KINDS = [
  'unconfigured',
  'unreachable',
  'timeout',
  'stalled',
  'blocked',
  'refused',
  'malformed',
  /*
   * A turn with no prose and no tool call, on a 200.
   *
   * Reported as `malformed` — that is still what it IS, a shape this layer
   * cannot use — but named separately here because it is the one failure worth
   * simply asking again for, and `sendTurn` below does. Cline retries this three
   * times with backoff for the same reason: it was first seen on Ollama, and the
   * cause is the model rather than the server. Without a name of its own the only
   * way to recognise it from outside was to match on the sentence shown to the
   * user, which is exactly what the note on `why` argues against.
   */
  'empty',
] as const

/*
 * An array with a derived type, rather than a bare union, because `analytics.ts`
 * needs these at RUNTIME: its `ALLOWED_STRINGS` set is what makes "no free text
 * is ever reported" a fact rather than a convention, and a set cannot be built
 * from a type. Derived rather than written twice, so the list and the type
 * cannot disagree about what a failure can be.
 */
export type FailureKind = (typeof FAILURE_KINDS)[number]

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

/* -------------------------------------------------------------------------- */
/* Thinking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How much the model should reason to itself before it answers.
 *
 * ## Why this is a setting at all
 *
 * Because on the models jojo is built for, thinking is not free and is often a
 * loss. Aider publishes recommended settings for Qwen3 that read
 * `enable_thinking: false`, temp 0.7, top_p 0.8, top_k 20 — the thinking-ON
 * configuration scored LOWER on its benchmark — and the gpt-oss report says HIGH
 * reasoning "frequently exceeded the 128k context". Neither is a claim about
 * intelligence; both are claims about a budget being spent somewhere other than
 * the answer.
 *
 * This app feels that spend twice over. Its prompts carry a tool catalogue, so
 * the input is already large, and its answers are short — so a model that thinks
 * for a thousand tokens before speaking hits the server's reply limit MID-THOUGHT
 * and returns a turn with no content and no tool call. That is not hypothetical:
 * it is `emptyTurn` above, it is what `loop.ts`'s empty-reply guard already
 * blames by name ("Models that reason before they speak — Qwen3, GPT-OSS,
 * DeepSeek-R1 — do this when the server's reply limit is small"), and it is the
 * failure `sendTurn` below retries.
 *
 * ## The three modes
 *
 * `off` asks the server not to think. `low` is for the models that cannot be
 * asked to stop — gpt-oss always reasons, and the only thing a client can do is
 * ask for less of it. `server-default` sends nothing at all and is the honest
 * escape hatch: whatever the deployment was configured with stands.
 */
export const THINKING_MODES = ['off', 'low', 'server-default'] as const

export type Thinking = (typeof THINKING_MODES)[number]

/**
 * Off, because the measurements above all point the same way and because the
 * failure of the other choice is the worst kind: a blank reply that reads as a
 * stupid assistant rather than as a setting.
 *
 * A DEFAULT AND NOT A HARDCODE. Somebody running a reasoning model on a server
 * with a generous reply limit is entitled to the reasoning — it is exactly the
 * setup the mode exists for — so the value travels as a parameter and this is
 * only what is used when nobody said. The one thing that would be wrong is
 * having no way to say.
 */
export const DEFAULT_THINKING: Thinking = 'off'

/** What else a caller may say about a chat request. */
export type ChatOptions = {
  /** Defaults to `DEFAULT_THINKING`. See `thinkingFields` for what is sent. */
  readonly thinking?: Thinking
}

/**
 * The body fields that carry a thinking mode to THIS provider, or none.
 *
 * Every server spells it differently, which is why this is a table and not a
 * constant:
 *
 *   - **Ollama native** takes a top-level `think`, boolean or an effort word.
 *     Its OpenAI shim takes nothing — it discards keys it does not know — which
 *     is the same reason `ollamaChatRequest` exists at all.
 *   - **vLLM, SGLang, LM Studio and llama.cpp** pass `chat_template_kwargs`
 *     straight into the model's own Jinja chat template, and `enable_thinking`
 *     is the variable Qwen3's template reads. A template that does not know the
 *     name ignores it: an unused kwarg is not an error in Jinja.
 *   - **gpt-oss** has no off switch; its template reads `reasoning_effort`, so
 *     `low` sets that instead of pretending `false` will be honoured.
 *
 * ## Why nothing is sent to a cloud provider
 *
 * Not an oversight, and not laziness — it is the difference between a request
 * that works and a 400. OpenAI's API rejects an unrecognised body field outright
 * ("Unrecognized request argument supplied"), and a self-hosted server ignoring
 * one is a courtesy rather than a rule. Sending a knob that only a local
 * inference server understands to a hosted API would turn a working setup into a
 * failing one for a benefit those providers do not offer anyway: Anthropic's
 * extended thinking is opt-IN and jojo never opts in, so on that dialect
 * "thinking off" is already true, and it is why the Anthropic branch of
 * `chatRequest` passes nothing.
 *
 * The gate is `cloud`, a fact the provider table already states, rather than a
 * new list to keep in step with it.
 */
export function thinkingFields(
  provider: string,
  thinking: Thinking = DEFAULT_THINKING,
): Record<string, unknown> {
  if (thinking === 'server-default') return {}
  const meta = providerMeta(provider)

  if (meta.dialect === 'ollama') {
    /*
     * `false` rather than the string 'off': native takes a boolean here, and an
     * effort word only where the model has efforts to choose between.
     *
     * NOT VERIFIED AGAINST A LIVE OLLAMA — there is none on the machine this was
     * written on — and the failure mode if a build rejects `think` on a model
     * with no thinking capability is a 400 naming it. That is precisely what
     * `rejectsThinking` reads and what `sendTurn` recovers from by re-asking
     * without the field, so the cost of being wrong here is one round trip
     * rather than a provider that cannot be used.
     */
    return { think: thinking === 'off' ? false : 'low' }
  }

  if (meta.dialect === 'openai' && !meta.cloud) {
    return {
      chat_template_kwargs:
        thinking === 'off' ? { enable_thinking: false } : { reasoning_effort: 'low' },
    }
  }

  return {}
}

/**
 * Whether a mode actually puts anything on the wire for this provider.
 *
 * Exists for `sendTurn`, which must not "recover" by re-sending a request that
 * was identical the first time: on a cloud provider `off` and `server-default`
 * build the same body, so a refusal that happens to mention thinking is about
 * something else.
 */
export const sendsThinking = (provider: string, thinking: Thinking): boolean =>
  Object.keys(thinkingFields(provider, thinking)).length > 0

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
  /**
   * Everything that is a preference rather than a fact about the conversation.
   *
   * An object rather than a fifth positional flag: `chatRequest(s, m, t, true,
   * 'off')` at a call site says nothing about what the last argument means, and
   * this is a parameter a reader has to be able to spot in a diff.
   */
  options: ChatOptions = {},
): ModelRequest => {
  const meta = providerMeta(settings.provider)
  const endpoint = endpointOf(settings)
  const key = (settings.apiKey ?? '').trim()
  const thinking = options.thinking ?? DEFAULT_THINKING

  if (meta.dialect === 'anthropic') {
    /*
     * No thinking field, and that is the correct translation rather than a gap.
     * Anthropic's extended thinking is opt-IN — a request without a `thinking`
     * block does not think — so `off` is already what this sends, and `low`
     * would mean inventing a budget nobody asked for. `anthropic.ts` owns this
     * request and says the same in its header under "what is NOT translated".
     */
    return anthropicChatRequest({ ...settings, endpoint }, messages, tools, browser)
  }

  if (meta.dialect === 'ollama')
    return ollamaChatRequest(settings, endpoint, messages, tools, thinking)

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
      // Sent only where it means something — see `thinkingFields`, which
      // answers with nothing for every hosted provider.
      ...thinkingFields(settings.provider, thinking),
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
 *
 * The messages need translating on the way out too — see `toOllamaMessages`.
 */
function ollamaChatRequest(
  settings: ModelSettings,
  endpoint: string,
  messages: readonly ChatMessage[],
  tools: readonly unknown[] | undefined,
  thinking: Thinking,
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
      // Not the messages as the rest of the app holds them. See below.
      messages: toOllamaMessages(messages),
      ...(tools && tools.length > 0 ? { tools } : {}),
      // Native defaults `stream` to TRUE, where the shim defaults it to false.
      stream: false,
      // Refuse rather than lie. See the header.
      shift: false,
      // Stops the model unloading between turns of one conversation.
      keep_alive: '30m',
      // A top-level `think`, which is native's spelling and the shim's nothing.
      // Absent entirely on `server-default`, so a deployment that was set up
      // deliberately is left alone.
      ...thinkingFields(settings.provider, thinking),
      ...(typeof explicit === 'number' && explicit > 0 ? { options: { num_ctx: explicit } } : {}),
    }),
  }
}

/**
 * The conversation in the shape Ollama's own endpoint accepts, which is not
 * quite the shape everything else does.
 *
 * The difference that only shows up on the SECOND round, which is why nothing
 * caught it — a fresh conversation works, and so does the first tool call in it.
 * `readOllamaTurn` already documents that native spells
 * `tool_calls[].function.arguments` as an OBJECT where OpenAI spells it as a
 * JSON string — that is the same `message` structure Ollama takes back on the
 * next request, and it is a `map[string]any` on the far side. A string in that
 * position is not a degraded argument list, it is a type error: Ollama rejects
 * the whole request, so the very first tool call in a conversation answered
 * fine and the round that followed it 400'd.
 *
 * The transcript itself is not rewritten. `loop.ts` builds one history in
 * OpenAI's spelling and every provider translates at its own edge — Anthropic
 * does exactly this in `toAnthropicMessages` — because a history that changed
 * shape per provider could not be stored, compacted or replayed by anything
 * else.
 *
 * A call whose `raw` is not a JSON OBJECT — empty, or the invalid JSON a small
 * model sometimes emits — travels as `{}`. There is no honest alternative:
 * native has nowhere to put a string, and refusing to send the turn at all
 * would strand a conversation over one bad call the model can still be told
 * about.
 */
function toOllamaMessages(messages: readonly ChatMessage[]): readonly unknown[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || message.tool_calls === undefined) return message
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => ({
        ...call,
        function: { name: call.function.name, arguments: objectArguments(call.function.arguments) },
      })),
    }
  })
}

/** The arguments as an object, whatever the wire string turned out to hold. */
function objectArguments(raw: string): Record<string, unknown> {
  const parsed = safeParse(raw)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
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
  /*
   * The one place in the app that KNOWS it was the browser, and it said nothing.
   *
   * `kind` stays `unreachable` because the app's next move is the same — there
   * is no answer to read — but `why` is the whole reason this field exists: a
   * status of zero is not a server that went to sleep, it is a provider nobody
   * on this origin can reach at all, and reported as plain `unreachable` it was
   * indistinguishable from one laptop being off. Left unset, `blocked` was a
   * FailureKind no code path could ever produce.
   */
  why: 'blocked',
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

/**
 * A turn with nothing in it: no prose, no tool call, and a 200 in front of it.
 *
 * ONE CONSTRUCTOR FOR BOTH READERS, and `why` is why it exists. This sentence
 * was written out twice — once in `readTurn`, once in `readOllamaTurn` — so the
 * only way for a caller to recognise the case was to match the copy, and this
 * file already argues on `ModelFailure.why` that turning a sentence written for
 * a human into an API means the next edit to the wording silently changes what
 * the code does. Here it would silently switch the retry off.
 *
 * MEASURED CAUSE, and it is not a broken server. A model that reasons before it
 * speaks spends its whole reply budget thinking, the server stops it at the
 * limit, and what arrives is an assistant message with an empty `content` and no
 * calls — jojo's own Qwen3 14B benchmark runs did this, which is what the loop's
 * empty-reply guard already blames. Cline ships a three-attempt retry for the
 * same failure on Ollama. Asking again very often works, which is the whole
 * argument for tagging it rather than merely reporting it.
 */
export const emptyTurn = (): ModelFailure => ({
  ok: false,
  // Unchanged: `malformed` is what every existing caller branches on, and a turn
  // that says nothing genuinely is a shape this layer cannot use. Only the
  // finer `why` is new, so nothing downstream behaves differently by accident.
  kind: 'malformed',
  why: 'empty',
  reason: 'The model returned an empty turn — no answer and no tool call.',
})

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
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const fn = (entry as { function?: unknown }).function
      if (typeof fn !== 'object' || fn === null) continue
      const wireName = (fn as { name?: unknown }).name
      if (typeof wireName !== 'string' || wireName.length === 0) continue
      /*
       * Cleaned here too, and it was not. `readTurn` has stripped harmony
       * control tokens off a tool name since a real reply named the tool
       * `memory_get<|channel|>commentary`; this reader — the one gpt-oss under
       * Ollama actually goes through — did not, so on native the call was
       * refused with "No tool is called memory_get<|channel|>commentary" and
       * the model spent a whole round trip recovering from it.
       *
       * With the same empty-name drop the OpenAI path has: a name that was
       * nothing but a marker cleans to `''`, and a call to a tool with no name
       * is not a call.
       */
      const name = cleanToolName(wireName)
      if (name === '') continue
      // An object here, not a string. Read as a string it would be `''`, and
      // every native tool call would run with no arguments.
      const args = (fn as { arguments?: unknown }).arguments ?? {}
      const id = (entry as { id?: unknown }).id
      toolCalls.push({
        id: typeof id === 'string' && id.length > 0 ? id : nextCallId(),
        name,
        args,
        raw: JSON.stringify(args),
      })
    }
  }

  if (content === null && toolCalls.length === 0) {
    return emptyTurn()
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
    return emptyTurn()
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
/**
 * A tool name with the model's own control tokens taken off the end.
 *
 * GPT-OSS speaks the harmony format, and when it puts a tool call on a channel
 * the channel marker can arrive INSIDE the function name — a real reply, from
 * the multi-turn benchmark, named the tool `memory_get<|channel|>commentary`.
 * The name is right up to the marker; everything after it is the model
 * describing where it is speaking from, and no server has stripped it.
 *
 * Without this the call is refused with "No tool is called
 * memory_get<|channel|>commentary", which is true, useless, and costs a round
 * trip on a local model to recover from.
 *
 * Cutting at the FIRST `<|`, not stripping every `<|…|>` pair: a name is one
 * token and anything after a control marker is not part of it, including a
 * marker that arrives unterminated. A name that never had one is untouched.
 */
export function cleanToolName(raw: string): string {
  const marker = raw.indexOf('<|')
  return (marker === -1 ? raw : raw.slice(0, marker)).trim()
}

function readToolCalls(message: unknown): ToolCall[] {
  if (typeof message !== 'object' || message === null) return []
  const calls = (message as { tool_calls?: unknown }).tool_calls
  if (!Array.isArray(calls)) return []
  return calls
    .map((entry): ToolCall | null => {
      if (typeof entry !== 'object' || entry === null) return null
      const fn = (entry as { function?: unknown }).function
      if (typeof fn !== 'object' || fn === null) return null
      const raw_name = (fn as { name?: unknown }).name
      if (typeof raw_name !== 'string' || raw_name.length === 0) return null
      const name = cleanToolName(raw_name)
      if (name === '') return null
      const raw = (fn as { arguments?: unknown }).arguments
      /*
       * An OBJECT here, not a string, and several OpenAI-compatible servers
       * send one. `readOllamaTurn` has handled this since it was written — with
       * a test saying "read as a string it would be `''`, and every native tool
       * call would run with no arguments" — and this path, which every vLLM,
       * LM Studio and llama.cpp call takes, did not.
       *
       * The failure was silent and split two ways: the four write tools with no
       * required fields RAN with defaults, and the rest failed validation
       * complaining about a field the model had in fact supplied.
       */
      const text =
        typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : JSON.stringify(raw)
      const id = (entry as { id?: unknown }).id
      return {
        /*
         * Some servers omit the id on a single call. Positional is a poor id
         * but a missing one is worse: the result message needs something to
         * point at or the model cannot match the answer to the question.
         *
         * The fallback is seeded from a MODULE counter rather than the index
         * within this turn. Ollama native sends no ids at all and several small
         * models' tool parsers omit them, so a model calling one tool per round
         * produced `call_0` in every round — and the transcript then held
         * several assistant turns and several `tool` messages all keyed the
         * same, which is exactly the ambiguity an id exists to remove.
         */
        id: typeof id === 'string' && id.length > 0 ? id : nextCallId(),
        name,
        args: text.trim() === '' ? {} : safeParse(text),
        raw: text,
      }
    })
    .filter((c): c is ToolCall => c !== null)
}

/**
 * A unique id for a tool call whose server did not give it one.
 *
 * Module scope on purpose. A per-turn index restarts at zero every round, so a
 * model calling one tool per round produces `call_0` forever — and the
 * transcript ends up with several distinct tool results keyed identically,
 * which is the one thing a `tool_call_id` exists to prevent.
 *
 * Not random: a counter is reproducible, which matters because these ids end up
 * in stored transcripts that tests read back.
 */
let callSeq = 0
const nextCallId = (): string => {
  callSeq += 1
  return `call_${String(callSeq)}`
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
  why: timedOut ? 'timeout' : 'unreachable',
  reason: timedOut
    ? `Nothing answered ${normaliseEndpoint(endpoint)} within ${String(MODEL_TIMEOUT_MS / 1000)} seconds.`
    : `Could not reach ${normaliseEndpoint(endpoint)} — ${detail}.`,
})

/**
 * A stream that started and then stopped.
 *
 * Distinct wording from `unreachable`, because the facts are different and the
 * user's next move is different. "Nothing answered within sixty seconds" is
 * about a server that never spoke; this is about one that spoke, produced part
 * of an answer, and went quiet — which happens when a model is unloaded
 * mid-generation, when a proxy closes an idle connection, or when the machine
 * is swapping. Telling somebody nothing answered when they watched half a reply
 * appear is the kind of error message that makes people distrust the rest.
 *
 * `sofar` is included when there is any, because a partial answer is evidence
 * about what went wrong and the user has already seen it on screen.
 */
export const stalled = (endpoint: string, sofar: number): ModelFailure => ({
  ok: false,
  kind: 'unreachable',
  why: sofar > 0 ? 'stalled' : 'timeout',
  reason:
    sofar > 0
      ? `${normaliseEndpoint(endpoint)} stopped sending part-way through the answer, after ${String(MODEL_TIMEOUT_MS / 1000)} seconds with nothing further.`
      : `Nothing answered ${normaliseEndpoint(endpoint)} within ${String(MODEL_TIMEOUT_MS / 1000)} seconds.`,
})

export const unconfigured = (): ModelFailure => ({
  ok: false,
  kind: 'unconfigured',
  why: 'unconfigured',
  reason: 'No model is connected. Settings is where the endpoint goes.',
})

/* -------------------------------------------------------------------------- */
/* Asking again when the model said nothing                                    */
/* -------------------------------------------------------------------------- */

/**
 * A pause, injected.
 *
 * D26, and the same rule as `now`: `check-platform` bans `setTimeout` from core
 * and tools because a module that can schedule is a module whose tests have to
 * wait. The app passes `(ms) => new Promise((r) => setTimeout(r, ms))`; a test
 * passes a function that records the number and returns immediately, which is
 * how the backoff below is asserted in microseconds rather than seconds.
 */
export type Delay = (ms: number) => Promise<void>

/**
 * Three sends in total — one ask and two retries.
 *
 * Cline's number, and it retries the identical failure for the identical reason.
 * It is a ceiling rather than a target: the second attempt is the one that
 * usually works, because what went wrong the first time was a reply budget spent
 * on reasoning rather than anything about the request.
 *
 * Not higher, because each attempt is a whole prompt through a local model —
 * seconds, not milliseconds — and a fourth try that fails the same way costs a
 * user more waiting to reach the same sentence.
 */
export const EMPTY_TURN_ATTEMPTS = 3

/** The first wait. Doubles per retry — see `emptyRetryDelayMs`. */
export const EMPTY_RETRY_BASE_MS = 500

/**
 * How long to wait before asking again, after `attempt` empty turns.
 *
 * 500ms then 1s. Deliberately short: this is not a rate limit, it is a model
 * that produced nothing, and there is nothing to wait FOR — the pause exists so
 * that a server which is genuinely unwell (a model mid-unload, a machine
 * swapping) is not hit three times inside a millisecond, and so that the retries
 * are visibly a retry rather than a spin.
 *
 * No jitter, and none is wanted. Jitter spreads a herd of clients off one clock;
 * jojo is one client talking to one server on the same desk, and `kg/` has no
 * randomness to spread it with (D26).
 */
export const emptyRetryDelayMs = (attempt: number): number =>
  EMPTY_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)

/**
 * Whether this failure is the model having said nothing at all.
 *
 * Reads the tag `emptyTurn` sets, never the sentence. NOTE for whoever owns
 * `anthropic.ts`: its reader builds the same sentence by hand without the tag,
 * so an empty turn from Claude is not retried. That is the safe direction to be
 * wrong in — a hosted model with a large reply budget is not the one this failure
 * was measured on — but it is a real gap, and one line of `why: 'empty'` there
 * closes it.
 */
export const isEmptyTurn = (turn: Turn): boolean => !turn.ok && turn.why === 'empty'

/**
 * A server complaining about the thinking field itself.
 *
 * Matching on the server's own words, which is a different thing from matching
 * on ours: this reads a body jojo quoted rather than a sentence jojo wrote, and
 * the shape of an API's error is that API's contract. `refused` puts up to 200
 * characters of it in `reason`, which is where the name lands.
 *
 * WHY IT IS NEEDED AT ALL. `think` on Ollama is rejected by some builds for a
 * model with no thinking capability — Gemma 3 is exactly such a model and is one
 * of the three jojo is built for — and no client can know a model's capabilities
 * before it asks. Without this, a default of `off` would break the commonest
 * local setup there is; with it, the cost of guessing wrong is one extra round
 * trip and a request that then succeeds.
 *
 * Deliberately loose. A false positive costs one repeated request without the
 * field, which is the same request jojo would have sent a week ago; a false
 * negative costs the user a provider that will not answer at all.
 */
export const rejectsThinking = (turn: Turn): boolean =>
  !turn.ok &&
  turn.kind === 'refused' &&
  /think|reasoning_effort|chat_template_kwargs/i.test(turn.reason)

/**
 * One whole send-and-parse, supplied by the app.
 *
 * A callback rather than a request, because everything between the two lives in
 * the app: the relay decision, the abort signal, streaming, `readTurnFor` and
 * `guardTruncation`. Handing this layer a `fetch` would put the network in core;
 * handing it a prebuilt `ModelRequest` would leave it unable to rebuild one with
 * a different thinking mode, which is half of what `sendTurn` does.
 *
 * `thinking` is passed IN so the caller builds the request with it — see
 * `chatRequest`'s `options`. `attempt` is 1-based and is there for the caller to
 * report with, nothing here reads it back.
 */
export type TurnAttempt = (plan: {
  readonly attempt: number
  readonly thinking: Thinking
}) => Promise<Turn>

export type SendTurnOptions = {
  /** Required, and injected. See `Delay`. */
  readonly delay: Delay
  /** Defaults to `DEFAULT_THINKING`. */
  readonly thinking?: Thinking
  /** Total sends before giving up. Defaults to `EMPTY_TURN_ATTEMPTS`. */
  readonly attempts?: number
  /**
   * The provider, when the caller knows it — and it always does.
   *
   * Optional only so that a test can drive this with a bare thunk. With it, the
   * thinking downgrade fires only when a thinking field was actually sent; with
   * it absent the check falls back to the mode alone, which is right more often
   * than not and never unsafe.
   */
  readonly provider?: string
}

/**
 * Ask, and ask again if the model said nothing.
 *
 * ## The failure
 *
 * A turn with no content and no tool call, on a 200. Measured on Ollama by
 * Cline, which ships a three-attempt retry for it, and reproduced here on Qwen3
 * 14B: the model reasons until the reply limit stops it and returns an empty
 * message. jojo errored on the first one, which turned a transient into a dead
 * end for the user.
 *
 * ## What it deliberately does not retry
 *
 * Anything else. A refusal, a rate limit, a truncated prompt, an unreachable
 * server and a malformed body are all left exactly as they were: they are facts
 * about the request or the server, and asking again produces the same fact more
 * slowly. NVIDIA's entry in the provider table makes the point in writing — "a
 * silent retry against a rate limit is how one slow answer becomes four" — and
 * this retries a strictly narrower thing than that warning forbids.
 *
 * ## Exhaustion is still an empty turn
 *
 * The failure that comes back after the last attempt keeps `why: 'empty'` and
 * `kind: 'malformed'`, so nothing downstream mistakes it for the server refusing
 * — it is the same failure jojo would have reported immediately before, with the
 * count added and the cause named. The loop's own empty-reply guard therefore
 * still fires, on a turn that has now genuinely been asked for three times.
 *
 * ## The one thing it changes about the request
 *
 * A server that rejects the thinking field is re-asked without it, once, with no
 * delay — the server answered straight away and the fix is deterministic, so a
 * pause would only be latency. That send does not count against the retry
 * budget, because nothing was asked of the model: the request never reached one.
 */
export async function sendTurn(attempt: TurnAttempt, options: SendTurnOptions): Promise<Turn> {
  const total = Math.max(1, options.attempts ?? EMPTY_TURN_ATTEMPTS)
  /*
   * Every send, including the one downgrade, which does not count as an attempt.
   *
   * A SECOND COUNTER AND NOT A BOOLEAN, and the reason is a measurement rather
   * than taste. The first version reasoned its way out of a `for(;;)`: the
   * downgrade sets `thinking` to the one mode that puts nothing on the wire, so
   * `carried` is false on the next pass and the branch is unreachable. That is
   * true, and it was still the wrong thing to rely on. Mutation-testing this
   * function with the assignment changed to a no-op did not fail a test — it
   * HUNG, and no test timeout fired: an `await` over a delay that resolves
   * immediately never yields to the macrotask queue, so vitest's own timer
   * cannot run and the whole suite stops dead. In an app that is a frozen tab.
   *
   * A counter cannot be reasoned wrong. It bounds the loop by arithmetic no
   * matter what the branches below do.
   *
   * NOTHING REACHES IT, and that is the point rather than a hole in the tests.
   * Deleting `calls < ceiling` and `calls >= ceiling` is the one mutant of this
   * function that survives the suite: no input can get there while the branches
   * are correct. It is a bound, not a behaviour — the case for keeping it is the
   * mutant above, which is not a wrong answer but a stopped process.
   */
  const ceiling = total + 1
  let thinking = options.thinking ?? DEFAULT_THINKING
  let sends = 0

  for (let calls = 1; ; calls += 1) {
    const turn = await attempt({ attempt: sends + 1, thinking })
    if (turn.ok) return turn

    const carried =
      options.provider === undefined
        ? thinking !== 'server-default'
        : sendsThinking(options.provider, thinking)
    if (carried && rejectsThinking(turn) && calls < ceiling) {
      thinking = 'server-default'
      continue
    }

    sends += 1
    if (!isEmptyTurn(turn)) return turn
    if (sends >= total || calls >= ceiling) return exhaustedEmptyTurn(total)
    await options.delay(emptyRetryDelayMs(sends))
  }
}

/**
 * The sentence for a model that said nothing however often it was asked.
 *
 * Names the count, because "it returned nothing" and "it returned nothing three
 * times" are different facts and only the second one tells the reader that jojo
 * already tried the obvious thing. The rest is the loop's own wording for this
 * cause, which was written against the same measurement and should not be said
 * two different ways in one app.
 */
export const exhaustedEmptyTurn = (attempts: number): ModelFailure => ({
  ok: false,
  kind: 'malformed',
  why: 'empty',
  reason:
    `The model returned an empty turn — no answer and no tool call — ${String(attempts)} times running. ` +
    'Models that reason before they speak — Qwen3, GPT-OSS, DeepSeek-R1 — do this when the server’s ' +
    'reply limit is small: raise it, or run the model with thinking turned off. Nothing was changed.',
})
