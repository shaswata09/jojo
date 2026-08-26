/**
 * Server-sent events from a chat completion, as data. L1 core.
 *
 * ## Why this exists
 *
 * `stream: false` means the whole answer has to arrive before anything does,
 * and that turned a working model into a broken app on any server slower than a
 * hosted one. Measured against a vLLM box serving a 31B model: generation runs
 * at about fourteen tokens a second, so the sixty-second request timeout is a
 * budget of roughly eight hundred and fifty tokens. Short answers landed. "Build
 * my profile from my CV" — which makes the model emit a long structured tool
 * call — did not, and the user waited a full minute to be told nothing answered,
 * while the server was working correctly the whole time.
 *
 * Streaming changes which number matters. Nothing has to finish inside a
 * deadline; tokens only have to keep arriving, which lets the caller replace a
 * total-duration timeout with an idle one. It is also the only way the thinking
 * and the tool calls can appear as they happen rather than in a batch at the
 * end.
 *
 * ## Why the parser is here and the socket is not
 *
 * Reading bytes off a response body is platform work — a browser has
 * `ReadableStream`, React Native has something else, and `check-platform` bans
 * both from this layer. What is portable is the FORMAT: how an SSE frame is
 * delimited, which lines carry JSON, what a delta looks like, and how a tool
 * call assembles itself from fragments spread across a dozen chunks. That is
 * the part with the edge cases, so that is the part that lives here and has
 * tests.
 *
 * The caller feeds bytes in and gets events out. It never has to know that
 * `data:` lines can be split mid-JSON across two network chunks, which is the
 * bug every hand-rolled SSE reader has.
 */

import type { ChatMessage, ModelRequest, WireToolCall } from './model-server'
import { chatRequest } from './model-server'
import type { ModelSettings } from './provider'
import { providerMeta } from './provider'

/** What a stream hands back, in the order it arrives. */
export type StreamEvent =
  /** More of the assistant's prose. Append it. */
  | { type: 'text'; delta: string }
  /** The model has finished. `calls` is whatever it assembled, possibly empty. */
  | {
      type: 'done'
      text: string
      calls: readonly WireToolCall[]
      finish: string | null
      /**
       * The server's own token counts, when it sent them.
       *
       * `null` when it did not, and the two are different facts: a server that
       * reports 400 prompt tokens for a 20,000-token request has told us it
       * threw the prompt away, and one that reports nothing has told us
       * nothing. `guardTruncation` must be able to tell those apart, so this
       * is passed through rather than defaulted to zero.
       */
      usage: StreamUsage | null
    }

/** What an OpenAI-compatible server reports at the end of a stream. */
export type StreamUsage = { prompt_tokens?: number; completion_tokens?: number }

/**
 * The same request, asking for a stream.
 *
 * Built from `chatRequest` rather than beside it, so the two cannot drift on the
 * dozen things that are identical — the auth header, the dialect's URL, the tool
 * envelope, the context option. Only `stream` differs, and it differs in one
 * place.
 *
 * OPENAI DIALECT ONLY, and the caller has to check. Anthropic frames its stream
 * differently (`content_block_delta` rather than `choices[].delta`) and Ollama
 * streams newline-delimited JSON with no `data:` prefix at all. Both are real
 * work and neither is this function; `supportsStreaming` is how a caller asks.
 */
export function streamingChatRequest(
  settings: ModelSettings,
  messages: readonly ChatMessage[],
  tools: readonly unknown[] | undefined,
  browser: boolean,
): ModelRequest {
  const base = chatRequest(settings, messages, tools, browser)
  const body = JSON.parse(base.body ?? '{}') as Record<string, unknown>
  body['stream'] = true
  /*
   * The prize, and the reason this line is not optional.
   *
   * A streamed reply carries no `usage` unless it is asked for: the server
   * sends deltas and stops. `guardTruncation` — the app's only defence against
   * a server that silently dropped most of the prompt — works by comparing
   * `usage.prompt_tokens` against what was sent, so without this it has nothing
   * to compare and returns the turn unexamined.
   *
   * That mattered most on exactly the servers this path is for. Streaming is
   * chosen for the OpenAI dialect on a local address — vLLM, LM Studio,
   * llama.cpp — which are the servers that truncate silently, and the check
   * was switched off for all of them.
   *
   * Harmless where it is not understood: an OpenAI-compatible server that does
   * not know `stream_options` ignores it, and the guard then behaves as it did
   * before — no worse.
   */
  body['stream_options'] = { include_usage: true }
  return { ...base, body: JSON.stringify(body) }
}

/**
 * Whether this provider's stream is one this module can read.
 *
 * A negative answer is not a failure — it means the caller sends the ordinary
 * request and waits, which is what every caller did before this file existed.
 */
export const supportsStreaming = (settings: ModelSettings): boolean =>
  providerMeta(settings.provider).dialect === 'openai'

/* -------------------------------------------------------------------------- */
/* The parser                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A tool call assembling itself across chunks.
 *
 * The wire sends a call in fragments: the first carries an index, an id and a
 * name, and every one after it carries a slice of the JSON arguments and
 * nothing else. Keyed by INDEX rather than by id, because only the first
 * fragment has an id — matching on it would start a new call per chunk and
 * produce forty empty ones.
 */
type Building = { id: string; name: string; args: string }

/**
 * Feed it bytes, take events out.
 *
 * Stateful on purpose: an SSE frame can be split anywhere, including inside the
 * JSON of a `data:` line, so something has to hold the half-line between chunks.
 * That is this closure, and keeping it here means no caller has to remember to.
 */
export function createStreamReader() {
  let buffer = ''
  let text = ''
  const building = new Map<number, Building>()
  let finish: string | null = null
  /*
   * The usage frame arrives LAST and on its own — after `finish_reason`, in a
   * frame whose `choices` array is empty. Held here rather than read at the end
   * because by then the stream is closed and the frame is gone.
   */
  let usage: StreamUsage | null = null
  let ended = false

  /** The assembled calls, in wire order. */
  const calls = (): WireToolCall[] =>
    [...building.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.args },
      }))

  return {
    /** Whatever this chunk completed. May be empty; that is normal. */
    push(chunk: string): StreamEvent[] {
      if (ended) return []
      buffer += chunk
      const out: StreamEvent[] = []

      /*
       * Split on newlines and KEEP THE TAIL. The last element is either an
       * empty string (the chunk ended on a newline) or a partial line, and
       * treating a partial line as a whole one is how a reader parses half a
       * JSON object and throws.
       */
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trim()
        if (line === '' || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          ended = true
          out.push({ type: 'done', text, calls: calls(), finish, usage })
          return out
        }

        let frame: unknown
        try {
          frame = JSON.parse(payload)
        } catch {
          // A frame this cannot read is skipped rather than fatal: one bad
          // chunk should cost a few tokens, not the whole answer.
          continue
        }

        /*
         * Read BEFORE the `choices` guard below, and that ordering is the whole
         * fix. A server sends usage in a final frame whose `choices` array is
         * EMPTY — so `choices[0]` is undefined and the `continue` on the next
         * line skipped it, discarding the one number `guardTruncation` needs
         * even once the request asked for it.
         */
        const reported = (frame as { usage?: StreamUsage | null }).usage
        if (reported !== undefined && reported !== null) usage = reported

        const choice = (frame as { choices?: unknown[] }).choices?.[0] as
          { delta?: Record<string, unknown>; finish_reason?: string | null } | undefined
        if (!choice) continue
        if (typeof choice.finish_reason === 'string') finish = choice.finish_reason

        const delta = choice.delta
        if (!delta) continue

        if (typeof delta['content'] === 'string' && delta['content'] !== '') {
          text += delta['content']
          out.push({ type: 'text', delta: delta['content'] })
        }

        const fragments = delta['tool_calls']
        if (Array.isArray(fragments)) {
          for (const f of fragments as Record<string, unknown>[]) {
            const index = typeof f['index'] === 'number' ? f['index'] : 0
            const fn = (f['function'] ?? {}) as Record<string, unknown>
            const at = building.get(index) ?? { id: '', name: '', args: '' }
            if (typeof f['id'] === 'string' && f['id'] !== '') at.id = f['id']
            if (typeof fn['name'] === 'string' && fn['name'] !== '') at.name = fn['name']
            if (typeof fn['arguments'] === 'string') at.args += fn['arguments']
            building.set(index, at)
          }
        }
      }
      return out
    },

    /**
     * The stream closed. Returns the `done` nobody sent, if nobody did.
     *
     * A server that closes the connection without `[DONE]` is within its rights
     * and several do it on an abort. Everything generated up to that point is
     * still an answer, and throwing it away because the terminator was missing
     * would lose a complete reply to a missing full stop.
     */
    end(): StreamEvent[] {
      if (ended) return []
      ended = true
      return [{ type: 'done', text, calls: calls(), finish, usage }]
    },

    /** What has arrived so far, for a caller that wants to show it. */
    get text() {
      return text
    },
  }
}
