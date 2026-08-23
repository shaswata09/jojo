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
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data
    .map((entry) =>
      typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined,
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
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
  entry: { name: string; endpoint: string; model: string },
): ModelServer[] {
  const endpoint = normaliseEndpoint(entry.endpoint)
  const existing = list.find((s) => s.endpoint === endpoint)
  if (!existing) {
    return [...list, { id: serverId(endpoint), name: entry.name || entry.model, endpoint, model: entry.model }]
  }
  return list.map((s) => (s.endpoint === endpoint ? { ...s, model: entry.model } : s))
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

export const isConfigured = (settings: { endpoint: string; model: string }): boolean =>
  settings.endpoint.trim().length > 0 && settings.model.trim().length > 0

/** Ask a server what it serves. */
export const modelsRequest = (endpoint: string): ModelRequest => ({
  url: modelsUrl(endpoint),
  method: 'GET',
  headers: { Accept: 'application/json' },
})

export const chatRequest = (
  settings: { endpoint: string; model: string },
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
): ModelRequest => ({
  url: chatUrl(settings.endpoint),
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
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
})

/**
 * Turns a non-200 into a sentence, quoting the server rather than paraphrasing.
 *
 * The body is where a local server says the useful thing — vLLM answers a wrong
 * model name with the list of names it does have. Truncated, because some of
 * them answer with an HTML error page.
 */
const refused = (status: number, body: string): ModelFailure => ({
  ok: false,
  kind: 'refused',
  reason: `The server answered ${String(status)}${body.trim() ? ` — ${body.trim().slice(0, 200)}` : ''}.`,
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
    const fail = refused(response.status, response.text)
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
export type Turn =
  | { ok: true; text: string | null; toolCalls: readonly ToolCall[]; finishReason: string | null }
  | ModelFailure

export function readTurn(response: ModelResponse): Turn {
  if (!response.ok) return refused(response.status, response.text)
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
  }
}

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
