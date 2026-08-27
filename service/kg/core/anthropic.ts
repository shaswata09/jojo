/**
 * Claude, translated into the shape the rest of this app already speaks. L1 core.
 *
 * Everything else jojo talks to speaks OpenAI's chat-completions dialect — vLLM,
 * Ollama, LM Studio, OpenAI itself, OpenRouter, Groq. Anthropic does not, and
 * the differences are not cosmetic. This file is the whole of the translation,
 * both directions, and it is pure: it builds a request as data and parses a
 * response as data, so `check-platform` keeps the network out and every one of
 * the differences below is covered by a test rather than by a live call.
 *
 * ## The six differences, in the order they bite
 *
 * 1. **The system prompt is not a message.** OpenAI puts it in the array with
 *    `role: 'system'`; Anthropic takes a top-level `system` field and REJECTS a
 *    system role inside `messages`. So it is hoisted out.
 *
 * 2. **`max_tokens` is required.** Omitting it is a 400, where every other
 *    provider treats it as optional. There is no sensible way to inherit this
 *    from the caller today, so it is defaulted here and documented.
 *
 * 3. **Tools are declared differently.** `{name, description, input_schema}`
 *    with the schema at the top level, against OpenAI's
 *    `{type:'function', function:{name, description, parameters}}`. Same JSON
 *    Schema inside, different envelope.
 *
 * 4. **Tool calls come back as content blocks, and the arguments are an
 *    OBJECT.** OpenAI returns `message.tool_calls[].function.arguments` as a
 *    JSON *string*, which is where small models most often fail and which
 *    `readTurn` parses defensively. Anthropic returns `{type:'tool_use', id,
 *    name, input}` with `input` already parsed. That is strictly better, and it
 *    means `ToolCall.args` can never be null on this provider — but `raw` still
 *    has to be filled, so it is re-serialised for the one caller that quotes it
 *    back to the model on a failure.
 *
 * 5. **Tool results go back as a USER message.** OpenAI appends one message per
 *    result with `role: 'tool'`. Anthropic wants a single user message whose
 *    content is an array of `tool_result` blocks — and this is the difference
 *    that would have bitten hardest, because `loop.ts` pushes one `role:'tool'`
 *    message per call and a turn with three parallel calls therefore produces
 *    three consecutive ones. Sent as three separate user messages, Claude
 *    rejects the conversation outright. `toAnthropicMessages` merges runs of
 *    them into one.
 *
 * 6. **The stop reason is spelled differently.** `max_tokens` where every other
 *    provider says `length`, and `loop.ts` tests for `length`. See
 *    `readStopReason`.
 *
 * ## What is NOT translated
 *
 * Prompt caching, streaming, thinking blocks, and the batch API. Each is a real
 * feature and none of them is needed to make the agent loop work; adding them
 * before the loop works on Claude at all would be building on an untested seam.
 */

import type { ChatMessage, ModelRequest, ModelResponse, ToolCall, Turn, Usage } from './model-server'

/** The version header Anthropic requires on every request. */
export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * A ceiling on the answer, because the API will not accept a request without one.
 *
 * Generous rather than tight: the agent loop's answers are short, but a tool
 * call with a long argument — a snippet body, a captured posting — is counted
 * here too, and a truncated tool call is a malformed one. This is a limit on a
 * single turn, not on the run.
 */
export const ANTHROPIC_MAX_TOKENS = 8192

/** A tool as Anthropic declares it. */
type AnthropicTool = { name: string; description: string; input_schema: unknown }

/**
 * OpenAI's `{type:'function', function:{…}}` unwrapped into Anthropic's shape.
 *
 * Takes the OpenAI spec rather than the catalog entry on purpose: `catalog.ts`
 * already owns the one conversion from a tool to a wire spec, and a second path
 * from `CatalogEntry` to a provider would be a second place for the two
 * envelopes to disagree about a tool's name or schema. This translates the
 * translation, which keeps the catalog the single source.
 */
export function toAnthropicTools(specs: readonly unknown[]): AnthropicTool[] {
  const out: AnthropicTool[] = []
  for (const spec of specs) {
    if (typeof spec !== 'object' || spec === null) continue
    const fn = (spec as { function?: unknown }).function
    if (typeof fn !== 'object' || fn === null) continue
    const name = (fn as { name?: unknown }).name
    if (typeof name !== 'string' || name.length === 0) continue
    const description = (fn as { description?: unknown }).description
    out.push({
      name,
      description: typeof description === 'string' ? description : '',
      input_schema: (fn as { parameters?: unknown }).parameters ?? {
        type: 'object',
        properties: {},
      },
    })
  }
  return out
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | Block[] }

/**
 * The conversation, minus the system prompt, in Anthropic's shape.
 *
 * Returns both halves because the caller needs them in different places: the
 * system text goes to a top-level field and the rest goes to `messages`.
 *
 * The merging in the middle is the load-bearing part. `loop.ts` emits one
 * `{role:'tool'}` message per call, so a turn with three parallel calls
 * produces three in a row; Anthropic requires all the results for one assistant
 * turn to arrive as ONE user message of `tool_result` blocks. Three separate
 * user messages is not a degraded version of that — it is rejected.
 */
export function toAnthropicMessages(messages: readonly ChatMessage[]): {
  system: string | null
  messages: AnthropicMessage[]
} {
  const system: string[] = []
  const out: AnthropicMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }

    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content })
      continue
    }

    if (message.role === 'tool') {
      const block: Block = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: message.content,
      }
      // Appended to the previous user message when that message is itself a run
      // of tool results — never to a user message carrying the person's own
      // words, which would put a result inside their sentence.
      const last = out[out.length - 1]
      if (
        last &&
        last.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.every((b) => b.type === 'tool_result')
      ) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }

    // Explicit, because the `system | user` member keeps `user` in the union
    // after the `system` check and TypeScript cannot subtract it across two
    // separate branches. This is also the honest guard: anything that is not an
    // assistant turn by here is something this function does not know about.
    if (message.role !== 'assistant') continue

    // Assistant. Text and calls both become blocks; an empty text block is
    // omitted rather than sent, because Anthropic refuses a blank one and a
    // model that only called a tool has no text to send.
    const blocks: Block[] = []
    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      blocks.push({ type: 'text', text: message.content })
    }
    for (const call of message.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        // Back to an object: OpenAI carries arguments as a JSON string and
        // Anthropic wants the value. A string that will not parse becomes `{}`
        // rather than throwing — the same policy `readToolCalls` takes, since a
        // model writing bad JSON is a designed-for case here.
        input: safeParse(call.function.arguments),
      })
    }
    if (blocks.length > 0) out.push({ role: 'assistant', content: blocks })
  }

  return { system: system.length > 0 ? system.join('\n\n') : null, messages: out }
}

const safeParse = (text: string): unknown => {
  if (typeof text !== 'string' || text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

/**
 * A request to Claude, described rather than sent.
 *
 * `browser` adds the one header that makes a direct call from a web page legal.
 * Anthropic blocks browser origins by default — a sensible protection against
 * keys ending up in a public page — and requires the caller to opt in by name.
 * jojo is a local-first app with no backend to proxy through, so opting in is
 * the only way this works at all on web; the Settings copy says plainly what
 * that means for the key.
 */
export function anthropicChatRequest(
  settings: { endpoint: string; model: string; apiKey?: string },
  messages: readonly ChatMessage[],
  tools: readonly unknown[] | undefined,
  browser: boolean,
): ModelRequest {
  const { system, messages: converted } = toAnthropicMessages(messages)
  const declared = tools && tools.length > 0 ? toAnthropicTools(tools) : []

  return {
    url: `${settings.endpoint.replace(/\/+$/, '')}/messages`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': (settings.apiKey ?? '').trim(),
      'anthropic-version': ANTHROPIC_VERSION,
      ...(browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
    },
    body: JSON.stringify({
      model: settings.model.trim(),
      max_tokens: ANTHROPIC_MAX_TOKENS,
      ...(system === null ? {} : { system }),
      messages: converted,
      ...(declared.length > 0 ? { tools: declared, tool_choice: { type: 'auto' } } : {}),
    }),
  }
}

/**
 * Claude's answer, in the same `Turn` the loop already consumes.
 *
 * The error branch quotes the API's own sentence. Anthropic says useful things
 * — an invalid key, a model name that does not exist, a rate limit — and
 * paraphrasing them would replace a fact with a guess.
 */
export function readAnthropicTurn(response: ModelResponse): Turn {
  if (!response.ok) {
    return {
      ok: false,
      kind: 'refused',
      reason: `The server answered ${String(response.status)}${
        response.text.trim() ? ` — ${anthropicError(response.text)}` : ''
      }.`,
    }
  }

  const payload = parse(response.text)
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, kind: 'malformed', reason: 'The server answered, but not in JSON.' }
  }

  const content = (payload as { content?: unknown }).content
  if (!Array.isArray(content)) {
    return {
      ok: false,
      kind: 'malformed',
      reason: 'The server answered, but not in the shape the Anthropic Messages API uses.',
    }
  }

  const text: string[] = []
  const toolCalls: ToolCall[] = []
  for (const [index, block] of content.entries()) {
    if (typeof block !== 'object' || block === null) continue
    const kind = (block as { type?: unknown }).type
    if (kind === 'text') {
      const value = (block as { text?: unknown }).text
      if (typeof value === 'string' && value.trim().length > 0) text.push(value)
      continue
    }
    if (kind !== 'tool_use') continue
    const name = (block as { name?: unknown }).name
    if (typeof name !== 'string' || name.length === 0) continue
    const id = (block as { id?: unknown }).id
    const input = (block as { input?: unknown }).input ?? {}
    toolCalls.push({
      id: typeof id === 'string' && id.length > 0 ? id : `call_${String(index)}`,
      name,
      // Already an object on this provider, so `args` is never null here — the
      // JSON-string failure mode simply does not exist. `raw` is re-serialised
      // for the one caller that quotes a bad call back to the model.
      args: input,
      raw: JSON.stringify(input),
    })
  }

  if (text.length === 0 && toolCalls.length === 0) {
    return {
      ok: false,
      kind: 'malformed',
      reason: 'The model returned an empty turn — no answer and no tool call.',
    }
  }

  const stop = (payload as { stop_reason?: unknown }).stop_reason
  return {
    ok: true,
    text: text.length > 0 ? text.join('\n') : null,
    toolCalls,
    finishReason: readStopReason(stop),
    usage: readAnthropicUsage(payload),
  }
}

/**
 * `stop_reason`, in the spelling the one consumer of it actually tests for.
 *
 * The sixth difference, and it was passed through raw. `loop.ts` asks
 * `turn.finishReason === 'length'` — OpenAI's word for "I hit the output cap" —
 * and warns the user that the reply is cut off. Anthropic's word for the same
 * fact is `max_tokens`, so that branch never fired on Claude and a truncated
 * answer was shown as a finished one.
 *
 * It bites hardest HERE of all the providers, because Anthropic is the only one
 * whose cap jojo sets itself: `ANTHROPIC_MAX_TOKENS` is 8192 because the API
 * refuses a request without a limit, so every long Claude answer meets a ceiling
 * this app chose and nobody else's default. A truncated `tool_use` input is the
 * worse half — it reaches the loop as a call with missing arguments and the
 * model is told it got the arguments wrong.
 *
 * Only that one word is translated. The rest — `end_turn`, `tool_use`,
 * `stop_sequence`, `refusal`, `pause_turn` — have no OpenAI equivalent anybody
 * reads, and inventing one would replace a fact with a guess.
 */
const readStopReason = (stop: unknown): string | null =>
  typeof stop !== 'string' ? null : stop === 'max_tokens' ? 'length' : stop

/** `usage.input_tokens`, under Anthropic's spelling of the same idea. */
function readAnthropicUsage(payload: unknown): Usage | null {
  if (typeof payload !== 'object' || payload === null) return null
  const usage = (payload as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
  const input = num((usage as { input_tokens?: unknown }).input_tokens)
  const output = num((usage as { output_tokens?: unknown }).output_tokens)
  if (input === null && output === null) return null
  return { promptTokens: input, completionTokens: output }
}

/** The `error.message` field, or the raw body when it is not shaped that way. */
function anthropicError(text: string): string {
  const payload = parse(text)
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message.slice(0, 200)
    }
  }
  return text.trim().slice(0, 200)
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
