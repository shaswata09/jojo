/**
 * The wire, as data: URL arithmetic, the request and response a caller sends
 * and reports back, and the conversation in OpenAI's spelling.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

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

/** A body as JSON, or null when it is not JSON. Never throws. */

export const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** The same, for a tool call's `arguments` string. */

export const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
