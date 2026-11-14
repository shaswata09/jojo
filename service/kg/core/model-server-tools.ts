/**
 * Tool calls off the wire: the name cleaned, the arguments parsed once, and an
 * id for a call whose server did not give it one.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import { safeParse } from './model-server-protocol'

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

/**
 * The calls, with each `arguments` string parsed once.
 *
 * A model that emits invalid JSON here is common enough to be a designed-for
 * case rather than an edge one, so `args: null` is a value the loop handles by
 * telling the model what it wrote — not an exception, and not a silently
 * dropped call, which would leave the model waiting for a result forever.
 */

export function readToolCalls(message: unknown): ToolCall[] {
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
 * Ollama native's `tool_calls`, read the way `readOllamaTurn` describes: no
 * `type`, often no id, and `arguments` as an OBJECT rather than a JSON string.
 */
export function readOllamaToolCalls(raw: unknown): ToolCall[] {
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
  return toolCalls
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
export const nextCallId = (): string => {
  callSeq += 1
  return `call_${String(callSeq)}`
}
