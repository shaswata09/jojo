/**
 * Reading a chat turn back, whichever dialect it came in.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import { readAnthropicTurn } from './anthropic'
import type { ModelFailure } from './model-server-errors'
import { emptyTurn, refused } from './model-server-errors'
import type { ModelResponse } from './model-server-protocol'
import { parse } from './model-server-protocol'
import type { ToolCall } from './model-server-tools'
import { readOllamaToolCalls, readToolCalls } from './model-server-tools'
import type { ModelSettings } from './provider'
import { providerMeta } from './provider'

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

/**
 * One assistant turn: something to say, something to call, or both.
 *
 * Both is legal and does happen — a model narrating "let me look that up" while
 * also calling the read. Neither is not: a turn with no text and no calls is a
 * server answering nothing, and is reported as malformed rather than looping.
 */

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
      /**
       * What the model thought before answering, when the server separates it
       * (vLLM's `reasoning`, Ollama's `thinking`). Absent when it did not think
       * or the server does not say. For the person to read — never sent back to
       * the model, and never part of the answer.
       */
      reasoning?: string
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
  const thinking = readReasoning(message, 'thinking')
  const toolCalls = readOllamaToolCalls((message as { tool_calls?: unknown }).tool_calls)

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
    ...(thinking === null ? {} : { reasoning: thinking }),
  }
}

/**
 * The model's thinking off a reply message, under whichever name this server
 * uses. `null` when there is none — an empty string is not a thought.
 */
function readReasoning(message: unknown, ...names: string[]): string | null {
  if (typeof message !== 'object' || message === null) return null
  for (const name of names) {
    const value = (message as Record<string, unknown>)[name]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
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
  const reasoning = readReasoning(message, 'reasoning', 'reasoning_content')
  return {
    ok: true,
    text: content,
    toolCalls,
    finishReason: typeof finish === 'string' ? finish : null,
    usage: readUsage(payload),
    ...(reasoning === null ? {} : { reasoning }),
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
