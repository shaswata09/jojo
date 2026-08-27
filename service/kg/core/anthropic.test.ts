/**
 * The translation to Claude, both directions.
 *
 * Every case here is a difference between Anthropic's Messages API and the
 * OpenAI dialect the rest of this app speaks. None of them is cosmetic: each
 * one, left untranslated, is a 400 or a silently wrong conversation rather than
 * a degraded answer.
 *
 * There is no live call anywhere in this file, and there should not be. The
 * request is built as data and the response is parsed as data — that split is
 * what lets the interesting half be tested at all, and it is the same shape
 * `model-server.test.ts` uses for the OpenAI side.
 */

import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_VERSION,
  anthropicChatRequest,
  readAnthropicTurn,
  toAnthropicMessages,
  toAnthropicTools,
} from './anthropic'
import type { ChatMessage } from './model-server'

const settings = { endpoint: 'https://api.anthropic.com/v1', model: 'claude-x', apiKey: 'sk-test' }
const body = (messages: readonly ChatMessage[], tools?: readonly unknown[]) =>
  JSON.parse(anthropicChatRequest(settings, messages, tools, false).body!) as Record<string, unknown>

describe('the system prompt is not a message', () => {
  it('hoists it to a top-level field', () => {
    // Anthropic REJECTS role:'system' inside messages, where OpenAI requires it
    // there. This is the first thing that would 400.
    const out = body([
      { role: 'system', content: 'You are jojo.' },
      { role: 'user', content: 'hi' },
    ])
    expect(out['system']).toBe('You are jojo.')
    expect(out['messages']).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('omits the field entirely when there is no system message', () => {
    // `system: null` is not the same as absent to this API.
    expect('system' in body([{ role: 'user', content: 'hi' }])).toBe(false)
  })
})

describe('tool results come back as one user message', () => {
  /**
   * The difference that would have bitten hardest.
   *
   * `loop.ts` pushes one `{role:'tool'}` message PER CALL, so a turn with three
   * parallel calls produces three consecutive ones. Anthropic wants all the
   * results for one assistant turn as a single user message of `tool_result`
   * blocks — three separate user messages is not a degraded version of that,
   * it is rejected outright.
   */
  const threeCalls: ChatMessage[] = [
    { role: 'user', content: 'do it' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'memory_search', arguments: '{"query":"x"}' } },
        { id: 'b', type: 'function', function: { name: 'memory_list', arguments: '{"type":"link"}' } },
        { id: 'c', type: 'function', function: { name: 'memory_overview', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: 'ra' },
    { role: 'tool', tool_call_id: 'b', content: 'rb' },
    { role: 'tool', tool_call_id: 'c', content: 'rc' },
  ]

  it('merges a run of three results into one message, not three', () => {
    const { messages } = toAnthropicMessages(threeCalls)
    const results = messages.filter(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
    )
    expect(results).toHaveLength(1)
    expect((results[0]!.content as { type: string }[]).map((b) => b.type)).toEqual([
      'tool_result',
      'tool_result',
      'tool_result',
    ])
  })

  it('keeps each result tied to the call it answers', () => {
    const { messages } = toAnthropicMessages(threeCalls)
    const blocks = messages.at(-1)!.content as { tool_use_id: string; content: string }[]
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['a', 'b', 'c'])
    expect(blocks.map((b) => b.content)).toEqual(['ra', 'rb', 'rc'])
  })

  it('does not append a result onto a message carrying the person’s own words', () => {
    // Merging into any preceding user message would put a tool result inside
    // somebody's sentence. Only a run of results absorbs another.
    const { messages } = toAnthropicMessages([
      { role: 'user', content: 'a real question' },
      { role: 'tool', tool_call_id: 'x', content: 'r' },
    ])
    expect(messages[0]).toEqual({ role: 'user', content: 'a real question' })
    expect(messages).toHaveLength(2)
  })

  it('starts a fresh block after the conversation moves on', () => {
    const { messages } = toAnthropicMessages([
      { role: 'tool', tool_call_id: 'a', content: 'r1' },
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', tool_call_id: 'b', content: 'r2' },
    ])
    const runs = messages.filter((m) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
    expect(runs).toHaveLength(2)
  })
})

describe('tool calls become content blocks', () => {
  it('turns an assistant tool_call into a tool_use block with an OBJECT input', () => {
    // OpenAI carries `arguments` as a JSON STRING; Anthropic wants the value.
    const { messages } = toAnthropicMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'memory_get', arguments: '{"id":"n1"}' } },
        ],
      },
    ])
    expect(messages[0]!.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'memory_get', input: { id: 'n1' } },
    ])
  })

  it('sends {} rather than throwing when the model wrote bad JSON', () => {
    // A model writing invalid arguments is a designed-for case here, exactly as
    // it is in `readToolCalls` on the OpenAI side.
    const { messages } = toAnthropicMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{not json' } }],
      },
    ])
    expect((messages[0]!.content as { input: unknown }[])[0]!.input).toEqual({})
  })

  it('omits an empty text block, which the API refuses', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
    ])
    expect((messages[0]!.content as { type: string }[]).map((b) => b.type)).toEqual(['tool_use'])
  })

  it('carries text and a call together, which a narrating model sends', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'assistant',
        content: 'let me look',
        tool_calls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
    ])
    expect((messages[0]!.content as { type: string }[]).map((b) => b.type)).toEqual([
      'text',
      'tool_use',
    ])
  })
})

describe('tools are declared in Anthropic’s envelope', () => {
  const spec = [
    {
      type: 'function',
      function: {
        name: 'memory_search',
        description: 'Find records.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    },
  ]

  it('unwraps function.parameters to a top-level input_schema', () => {
    expect(toAnthropicTools(spec)).toEqual([
      {
        name: 'memory_search',
        description: 'Find records.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    ])
  })

  it('keeps the catalog as the single source, by translating the translation', () => {
    // It takes the OpenAI spec rather than a CatalogEntry deliberately — a
    // second path from the catalog to a provider is a second chance for the two
    // envelopes to disagree about a tool's name or schema.
    const out = body([{ role: 'user', content: 'x' }], spec)
    expect((out['tools'] as { name: string }[])[0]!.name).toBe('memory_search')
    expect(out['tool_choice']).toEqual({ type: 'auto' })
  })

  it('omits tools entirely when there are none', () => {
    // `tools: []` is not the same as absent — the same rule the OpenAI builder
    // follows, and for the same reason.
    const out = body([{ role: 'user', content: 'x' }])
    expect('tools' in out).toBe(false)
    expect('tool_choice' in out).toBe(false)
  })
})

describe('the request envelope', () => {
  it('always sends max_tokens, which the API requires', () => {
    expect(body([{ role: 'user', content: 'x' }])['max_tokens']).toBe(ANTHROPIC_MAX_TOKENS)
  })

  it('authenticates with x-api-key and a version, not a bearer token', () => {
    const request = anthropicChatRequest(settings, [{ role: 'user', content: 'x' }], undefined, false)
    expect(request.headers['x-api-key']).toBe('sk-test')
    expect(request.headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
    expect(request.headers['Authorization']).toBeUndefined()
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
  })

  it('opts in to browser access only when it is a browser', () => {
    /*
     * Anthropic blocks browser origins unless the caller names the header — a
     * sensible protection against keys ending up in a public page. jojo is
     * local-first with no backend to proxy through, so opting in is the only
     * way this works on web at all; on native there is no origin and no reason
     * to ask.
     */
    const header = 'anthropic-dangerous-direct-browser-access'
    expect(anthropicChatRequest(settings, [], undefined, true).headers[header]).toBe('true')
    expect(anthropicChatRequest(settings, [], undefined, false).headers[header]).toBeUndefined()
  })

  it('trims a key pasted with a trailing newline', () => {
    // A key copied from a web page often arrives with whitespace, and the
    // resulting header is rejected with a message about the HEADER.
    const request = anthropicChatRequest(
      { ...settings, apiKey: 'sk-test\n' },
      [],
      undefined,
      false,
    )
    expect(request.headers['x-api-key']).toBe('sk-test')
  })
})

describe('reading Claude’s answer', () => {
  const ok = (payload: unknown) =>
    readAnthropicTurn({ ok: true, status: 200, text: JSON.stringify(payload) })

  it('reads text out of content blocks', () => {
    const turn = ok({ content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.text).toBe('hello')
    expect(turn.finishReason).toBe('end_turn')
  })

  it('reads a tool_use block as a call whose args are already parsed', () => {
    const turn = ok({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'memory_get', input: { id: 'n1' } }],
      stop_reason: 'tool_use',
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls).toEqual([
      { id: 'tu_1', name: 'memory_get', args: { id: 'n1' }, raw: '{"id":"n1"}' },
    ])
  })

  it('joins several text blocks rather than keeping only the first', () => {
    const turn = ok({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })
    expect(turn.ok && turn.text).toBe('a\nb')
  })

  it('reports an empty turn as malformed rather than looping', () => {
    // The same rule the OpenAI parser follows: no text and no calls is a server
    // answering nothing, and a loop that treated it as an answer would spin.
    const turn = ok({ content: [], stop_reason: 'end_turn' })
    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.kind).toBe('malformed')
  })

  it('maps max_tokens to “length”, which is the word the loop tests for', () => {
    /*
     * The only provider whose output cap jojo picks itself — the API refuses a
     * request without `max_tokens`, so ANTHROPIC_MAX_TOKENS is 8192 — and the
     * only one whose word for meeting it was not the word `loop.ts` reads. Left
     * raw, a Claude answer cut off at the ceiling reached the screen with no
     * note saying so, and a `tool_use` block cut off mid-input reached the model
     * as arguments it had supposedly got wrong.
     */
    const turn = ok({ content: [{ type: 'text', text: 'half a sen' }], stop_reason: 'max_tokens' })
    expect(turn.ok && turn.finishReason).toBe('length')
  })

  it('leaves every other stop reason exactly as Anthropic spelled it', () => {
    // Only the one word with a consumer is translated. Inventing an OpenAI
    // equivalent for the rest would replace a fact with a guess.
    for (const stop of ['end_turn', 'tool_use', 'stop_sequence', 'refusal', 'pause_turn']) {
      const turn = ok({ content: [{ type: 'text', text: 'x' }], stop_reason: stop })
      expect(turn.ok && turn.finishReason).toBe(stop)
    }
    // A server that sends no stop reason is not given one.
    const silent = ok({ content: [{ type: 'text', text: 'x' }] })
    expect(silent.ok && silent.finishReason).toBeNull()
  })

  it('reads usage under Anthropic’s spelling', () => {
    // input_tokens/output_tokens, where OpenAI says prompt_tokens/completion_tokens.
    // The loop compares this against what it sent to catch a truncating server.
    const turn = ok({
      content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: 1234, output_tokens: 7 },
    })
    expect(turn.ok && turn.usage?.promptTokens).toBe(1234)
    expect(turn.ok && turn.usage?.completionTokens).toBe(7)
  })

  it('quotes the API’s own sentence on a refusal', () => {
    // Anthropic says useful things — a bad key, a model that does not exist, a
    // rate limit. Paraphrasing replaces a fact with a guess.
    const turn = readAnthropicTurn({
      ok: false,
      status: 401,
      text: JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
    })
    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.kind).toBe('refused')
    expect(turn.reason).toContain('invalid x-api-key')
    expect(turn.reason).toContain('401')
  })

  it('survives a body that is not JSON at all', () => {
    const turn = readAnthropicTurn({ ok: true, status: 200, text: '<html>502</html>' })
    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.kind).toBe('malformed')
  })
})

describe('a whole round trip, in the shape the loop actually produces', () => {
  it('survives conversation → call → result → follow-up', () => {
    /*
     * The sequence `loop.ts` builds: system, user, assistant-with-calls, one
     * tool message per call, then the next round. If any single translation
     * above is wrong this is where it shows, because the API validates the
     * whole conversation rather than the last message.
     */
    const conversation: ChatMessage[] = [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'what do I have' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'x', type: 'function', function: { name: 'memory_overview', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'x', content: '{"applications":3}' },
    ]
    const out = body(conversation)
    expect(out['system']).toBe('be brief')
    expect((out['messages'] as { role: string }[]).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    // Alternating roles, which the API requires and which the merge is what
    // preserves once more than one call is in flight.
    const roles = (out['messages'] as { role: string }[]).map((m) => m.role)
    expect(roles.every((r, i) => i === 0 || r !== roles[i - 1])).toBe(true)
  })
})
