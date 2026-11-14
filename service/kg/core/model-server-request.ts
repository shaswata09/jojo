/**
 * The requests themselves: the model list, and a chat turn in each dialect.
 *
 * Split out of `model-server.ts`, which re-exports every public name here.
 */

import { ANTHROPIC_VERSION, anthropicChatRequest } from './anthropic'
import type { ChatMessage, ModelRequest } from './model-server-protocol'
import { chatUrl, modelsUrl, normaliseEndpoint, safeParse } from './model-server-protocol'
import type { ChatOptions, Thinking } from './model-server-thinking'
import { DEFAULT_THINKING, thinkingFields } from './model-server-thinking'
import type { ModelSettings } from './provider'
import { endpointOf, providerMeta } from './provider'

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
  // The call's own say first (the benchmark's), then the person's setting.
  const thinking = options.thinking ?? settings.thinking ?? DEFAULT_THINKING

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
