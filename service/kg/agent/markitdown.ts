/**
 * L3.5 — reading a PDF, a Word file or a deck, through MarkItDown.
 *
 * ATTRIBUTION. MarkItDown is Microsoft's, MIT-licensed, and is not vendored
 * here — this file speaks to a copy the user installs and runs themselves. The
 * notice the licence requires is in `THIRD-PARTY-NOTICES.md` at the repository
 * root, and `MARKITDOWN` below carries the same facts to the screen, because a
 * person deciding whether to install it deserves to be told what they are
 * installing and under what terms without reading a file in a repo.
 *
 *   MarkItDown — https://github.com/microsoft/markitdown
 *   Copyright (c) Microsoft Corporation. MIT License.
 *
 * WHY A SERVICE THE USER RUNS, AND NOT A LIBRARY WE SHIP. MarkItDown is Python.
 * This app is a browser tab and a phone app with no server of its own, so there
 * is no honest way to bundle it: Pyodide would not run on React Native and would
 * cost tens of megabytes on the web, and a JavaScript reimplementation would not
 * be MarkItDown, it would be a fork with the same name and different bugs. What
 * the app already asks of the user is to run a model locally; asking them to run
 * `markitdown-mcp` beside it is the same request, and the documents never leave
 * their machine either way.
 *
 * WHY MCP. `markitdown-mcp` exposes exactly one tool, `convert_to_markdown`,
 * over the protocol this package already speaks — `mcp.ts` implements the server
 * side of it. So this is a client for the same JSON-RPC, and the shapes are
 * already defined and already tested.
 *
 * WHY `data:` URIs. That tool takes `http:`, `https:`, `file:` or `data:`. The
 * first two would make the reader fetch, which is a different trust boundary;
 * `file:` cannot work at all from a phone, whose paths mean nothing on the
 * machine running the converter. `data:` carries the bytes the app is already
 * holding, in one request, identically on both platforms. It costs a third in
 * base64 overhead, which `MAX_BYTES` is sized around.
 */

import type { ModelRequest, ModelResponse } from '../core/model-server'
import { normaliseEndpoint } from '../core/model-server'
import { MCP_PROTOCOL_VERSION } from './mcp'

/** What the app shows next to the setting, so the credit is where the choice is. */
export const MARKITDOWN = {
  name: 'MarkItDown',
  url: 'https://github.com/microsoft/markitdown',
  copyright: 'Copyright (c) Microsoft Corporation.',
  licence: 'MIT License',
  /** What to run. Quoted from the package's own README so it stays checkable. */
  install: 'pip install markitdown-mcp',
  serve: 'markitdown-mcp --http --host 127.0.0.1 --port 3001',
  defaultEndpoint: 'http://127.0.0.1:3001/mcp',
} as const

/**
 * The largest document that will be sent.
 *
 * Eight megabytes of file, which is about eleven of base64 inside a JSON string
 * — and the whole thing is built in memory on a phone before it is sent. The
 * cap exists so that the failure for an enormous file is a sentence rather than
 * an out-of-memory crash, and it is stated in that sentence so the user knows
 * what to do about it. Most CVs and postings are under one.
 */
export const MAX_BYTES = 8 * 1024 * 1024

export type ConvertResult = { ok: true; markdown: string } | { ok: false; reason: string }

/**
 * The address, with the trailing slash the server canonicalises to.
 *
 * The opposite of what `normaliseEndpoint` does for the model, and the reason is
 * a browser rule rather than a preference. `markitdown-mcp` answers `/mcp` with
 * a 307 to `/mcp/` — an ABSOLUTE url — and a browser asked to follow a redirect
 * that leaves the origin refuses, reporting the whole thing as an opaque
 * `TypeError`. Through a same-origin proxy that is exactly what happens: the
 * proxy forwards, the server redirects to its own host, and the page cannot go
 * there. Measured: `/reader/mcp` fails and `/reader/mcp/` succeeds against the
 * same server through the same proxy.
 *
 * So this adds one rather than removing one. It is not a guess — the server
 * names the canonical path in the redirect it sends — and it is the one place
 * that knows the difference, so neither app has to.
 */
const mcpUrl = (endpoint: string) => {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  return `${trimmed}/`
}

const rpc = (endpoint: string, id: number, method: string, params?: unknown): ModelRequest => ({
  url: mcpUrl(endpoint),
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Streamable HTTP answers with either, depending on whether the server
    // decides to stream. Accepting only JSON gets a 406 from the reference
    // implementation before it looks at the body.
    Accept: 'application/json, text/event-stream',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }),
})

/**
 * The handshake, which is not optional.
 *
 * MCP requires `initialize` before any `tools/call`, and a streamable-HTTP
 * server answers a cold `tools/call` with an error about the session rather than
 * about the document — which is a confusing thing to show someone who has just
 * pointed at the wrong port.
 */
export const initializeRequest = (endpoint: string): ModelRequest =>
  rpc(endpoint, 1, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'jojo', version: '1' },
  })

export const initializedNotification = (endpoint: string): ModelRequest => ({
  ...rpc(endpoint, 0, 'notifications/initialized'),
  // A notification carries no id. `rpc` always writes one, so it is removed
  // here rather than by giving `rpc` a second shape for one caller.
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
})

export const listToolsRequest = (endpoint: string): ModelRequest => rpc(endpoint, 2, 'tools/list')

/** One document, as a `data:` URI. */
/**
 * `uri`, not `dataUri`, and the rename is the point.
 *
 * This took a `data:` URI for two callers and was named for them. The tool
 * itself describes what it takes as "an http:, https:, file: or data: URI", so
 * the same request reads a job posting off the web — which is how a browser
 * gets a cross-origin page it is otherwise forbidden to read.
 */
export const convertRequest = (endpoint: string, uri: string): ModelRequest =>
  rpc(endpoint, 3, 'tools/call', {
    name: 'convert_to_markdown',
    arguments: { uri },
  })

/**
 * The body, whether it arrived as JSON or as one SSE frame.
 *
 * Streamable HTTP is allowed to answer a single request with a `text/event-
 * stream` containing one `data:` line, and the reference server does exactly
 * that. Handling both here rather than at the call site keeps the two apps'
 * transports as thin as the model client's.
 */
function payloadOf(response: ModelResponse): unknown {
  const text = response.text.trim()
  if (text.startsWith('{')) return safeParse(text)
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const parsed = safeParse(line.slice(5).trim())
    if (parsed !== null) return parsed
  }
  return null
}

const safeParse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** True when the server answered a handshake at all. Used by the settings test. */
/**
 * The one mistake worth naming, and only when it was made.
 *
 * Pointing at the right port and the wrong path is the commonest way to get this
 * wrong — found by aiming the test at the dev server and reading "The reader
 * answered 404." with no advice. Conditional for the same reason the model
 * client's is: appending it to a 500 from an address that already ends in /mcp
 * would be lecturing someone who got that part right.
 */
const pathHint = (endpoint: string) =>
  /\/mcp\/?$/.test(normaliseEndpoint(endpoint))
    ? ''
    : ' Check the address ends in /mcp — that is what markitdown-mcp serves on.'

export function readHandshake(response: ModelResponse, endpoint = ''): ConvertResult {
  if (!response.ok) {
    return {
      ok: false,
      reason: `The reader answered ${String(response.status)}${response.text.trim() ? ` — ${response.text.trim().slice(0, 160)}` : ''}.${pathHint(endpoint)}`,
    }
  }
  const payload = payloadOf(response) as { result?: { serverInfo?: { name?: unknown } } } | null
  const name = payload?.result?.serverInfo?.name
  if (typeof name !== 'string') {
    return {
      ok: false,
      reason: `That address answered, but not as an MCP server.${pathHint(endpoint) || ' Check the path.'}`,
    }
  }
  return { ok: true, markdown: name }
}

/**
 * The Markdown, out of an MCP tool result.
 *
 * `isError: true` is a REFUSAL, not a transport failure — `mcp.ts` explains the
 * convention from the server side. A password-protected PDF arrives that way,
 * and the reason is the useful half.
 */
export function readConvertResponse(response: ModelResponse): ConvertResult {
  if (!response.ok) {
    return {
      ok: false,
      reason: `The reader answered ${String(response.status)}${response.text.trim() ? ` — ${response.text.trim().slice(0, 200)}` : ''}.`,
    }
  }
  const payload = payloadOf(response) as {
    error?: { message?: unknown }
    result?: { isError?: boolean; content?: unknown }
  } | null
  if (!payload) {
    return { ok: false, reason: 'The reader answered in a shape this does not recognise.' }
  }
  if (payload.error) {
    const message = typeof payload.error.message === 'string' ? payload.error.message : 'unknown'
    return { ok: false, reason: `The reader refused: ${message}` }
  }
  const text = textOf(payload.result?.content)
  if (text === null) {
    return { ok: false, reason: 'The reader returned nothing for that document.' }
  }
  if (payload.result?.isError) return { ok: false, reason: `The reader could not read it: ${text}` }
  return { ok: true, markdown: text }
}

/** MCP content is a list of parts; the text ones, joined. */
function textOf(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const parts = content
    .map((part) =>
      typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
        ? (part as { text?: unknown }).text
        : undefined,
    )
    .filter((t): t is string => typeof t === 'string')
  const joined = parts.join('\n').trim()
  return joined.length > 0 ? joined : null
}

/**
 * Bytes, as the `data:` URI the tool takes.
 *
 * The base64 is the caller's, because producing it is the one part that differs
 * by platform — `FileReader` in a browser, `ReactNativeBlobUtil.fs.readFile` on
 * a phone — and neither belongs in a layer with no platform.
 */
export const dataUri = (mime: string, base64: string) =>
  `data:${mime || 'application/octet-stream'};base64,${base64}`

/**
 * How much of a document is handed to the model.
 *
 * A hundred-page posting converts to more tokens than a small model has context
 * for, and a truncated answer that never says it was truncated is worse than a
 * refusal. The cut is announced in the text itself, so the model can say so too.
 */
export const CONTEXT_BUDGET = 12_000

export function trimForModel(markdown: string, budget = CONTEXT_BUDGET): string {
  if (markdown.length <= budget) return markdown
  return `${markdown.slice(0, budget)}\n\n[Cut off here: the document is ${String(markdown.length)} characters and only the first ${String(budget)} were read.]`
}
