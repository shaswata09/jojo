import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THINKING,
  EMPTY_RETRY_BASE_MS,
  EMPTY_TURN_ATTEMPTS,
  chatRequest,
  chatUrl,
  cleanToolName,
  estimateTokens,
  guardTruncation,
  isConfigured,
  modelsRequest,
  modelsUrl,
  normaliseEndpoint,
  readChatResponse,
  readModelIds,
  readModelsResponse,
  readOllamaTurn,
  readReply,
  readTurn,
  readTurnFor,
  emptyRetryDelayMs,
  emptyTurn,
  isEmptyTurn,
  rejectsThinking,
  removeServer,
  renameServer,
  saveServer,
  serverAt,
  serverId,
  sendTurn,
  sendsThinking,
  serversFor,
  thinkingFields,
  truncationOf,
  truncationWarning,
  unconfigured,
  unreachable,
} from './model-server'
import { ANTHROPIC_VERSION } from './anthropic'
import type { ModelResponse, Thinking, Turn } from './model-server'
import type { ModelSettings } from './provider'
import type { ModelServer } from './model-server'

const server = (over: Partial<ModelServer> = {}): ModelServer => ({
  id: 's1',
  name: 'Workstation',
  endpoint: 'http://localhost:8000/v1',
  model: 'meta-llama/Llama-3.1-8B-Instruct',
  ...over,
})

describe('endpoints', () => {
  it('drops a trailing slash so the path join cannot double it', () => {
    expect(normaliseEndpoint('  http://localhost:8000/v1/  ')).toBe('http://localhost:8000/v1')
    expect(modelsUrl('http://localhost:8000/v1/')).toBe('http://localhost:8000/v1/models')
    expect(chatUrl('http://localhost:8000/v1/')).toBe('http://localhost:8000/v1/chat/completions')
  })

  it('invents nothing — no scheme, no port, no /v1', () => {
    // A URL the user typed and one this function guessed fail in the same place
    // with the same message, and only one of those is their fault.
    expect(normaliseEndpoint('localhost:8000')).toBe('localhost:8000')
  })
})

describe('reading a server', () => {
  it('lists the model ids a vLLM /v1/models answer advertises', () => {
    const payload = {
      object: 'list',
      data: [
        { id: 'meta-llama/Llama-3.1-8B-Instruct', object: 'model' },
        { id: 'BAAI/bge-m3', object: 'model' },
      ],
    }
    expect(readModelIds(payload)).toEqual(['meta-llama/Llama-3.1-8B-Instruct', 'BAAI/bge-m3'])
  })

  it('comes back empty for anything that is not that shape', () => {
    // "OpenAI-compatible" is a claim each server makes about itself. Empty is
    // what lets the caller say it could not read the server, rather than
    // printing `undefined` as a model name.
    expect(readModelIds(null)).toEqual([])
    expect(readModelIds({ data: 'nope' })).toEqual([])
    expect(readModelIds({ data: [{ name: 'no id here' }] })).toEqual([])
    expect(readModelIds({ data: [{ id: '' }] })).toEqual([])
  })

  it('reads a reply, and refuses an empty one', () => {
    expect(readReply({ choices: [{ message: { content: 'ready' } }] })).toBe('ready')
    expect(readReply({ choices: [{ message: { content: '   ' } }] })).toBeNull()
    expect(readReply({ choices: [] })).toBeNull()
    expect(readReply({})).toBeNull()
  })
})

describe('the saved list', () => {
  it('keys on the address and the model, so connecting twice is one entry', () => {
    const once = saveServer([], server())
    const twice = saveServer(once, server({ endpoint: 'http://localhost:8000/v1/' }))
    expect(twice).toHaveLength(1)
  })

  it('derives the id from the address, so no random source is needed here', () => {
    const [saved] = saveServer([], server())
    expect(saved?.id).toBe(
      serverId('http://localhost:8000/v1/', 'meta-llama/Llama-3.1-8B-Instruct'),
    )
    expect(saved?.id).toBe('server:http://localhost:8000/v1#meta-llama/Llama-3.1-8B-Instruct')
  })

  it('names a new entry after the model when the user has not named it', () => {
    const [saved] = saveServer([], { name: '', endpoint: 'http://x/v1', model: 'Qwen/Qwen2.5-7B' })
    expect(saved?.name).toBe('Qwen/Qwen2.5-7B')
  })

  it('keeps the name the user gave when the same server reconnects', () => {
    const list = saveServer([], server({ name: 'Workstation' }))
    const after = saveServer(list, server({ name: 'meta-llama/Llama-3.1-8B-Instruct' }))
    expect(after[0]?.name).toBe('Workstation')
  })

  it('saves a second model at the same address rather than replacing the first', () => {
    /*
     * This used to assert the opposite — that a new model REPLACED the old one,
     * "because that is the server's fact and not a preference". That reasoning
     * fits a vLLM process, which serves one model and whose URL is the identity
     * of both. It does not fit a hosted catalogue, where one fixed address
     * answers for dozens of models, and under the old rule NVIDIA could never
     * hold more than one saved model to switch between.
     *
     * One rule for both, and the cost is named rather than hidden: re-pointing a
     * local vLLM at a different model now leaves the previous row behind, naming
     * a model that address no longer serves. Selecting it fails and it can be
     * deleted — which is a visible, recoverable state, unlike a saved model that
     * silently disappeared.
     */
    const list = saveServer([], server())
    const after = saveServer(list, server({ model: 'Qwen/Qwen2.5-7B' }))
    expect(after).toHaveLength(2)
    expect(after.map((s) => s.model)).toEqual([
      'meta-llama/Llama-3.1-8B-Instruct',
      'Qwen/Qwen2.5-7B',
    ])
  })

  it('renames, and falls back to the model id rather than to nothing', () => {
    const list = [server()]
    expect(renameServer(list, 's1', '  Desk  ')[0]?.name).toBe('Desk')
    expect(renameServer(list, 's1', '   ')[0]?.name).toBe('meta-llama/Llama-3.1-8B-Instruct')
  })

  it('removes by id, so a rename in flight cannot delete the wrong row', () => {
    const list = [server(), server({ id: 's2', endpoint: 'http://localhost:11434/v1' })]
    expect(removeServer(list, 's1').map((s) => s.id)).toEqual(['s2'])
  })

  it('finds the entry for a URL however it was typed', () => {
    const list = [server()]
    expect(serverAt(list, 'http://localhost:8000/v1/')?.id).toBe('s1')
    expect(serverAt(list, 'http://localhost:9999/v1')).toBeUndefined()
  })
})

describe('the protocol, as data', () => {
  it('describes a model-list request without performing one', () => {
    expect(
      modelsRequest({
        provider: 'openai-compatible',
        endpoint: 'http://localhost:8000/v1/',
        model: '',
      }),
    ).toEqual({
      url: 'http://localhost:8000/v1/models',
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
  })

  it('describes a chat request with the model the user chose', () => {
    const req = chatRequest(
      {
        provider: 'openai-compatible',
        endpoint: 'http://localhost:8000/v1',
        model: '  Qwen/Qwen2.5-7B  ',
      },
      [{ role: 'user', content: 'hi' }],
    )
    expect(req.url).toBe('http://localhost:8000/v1/chat/completions')
    expect(JSON.parse(req.body ?? '')).toEqual({
      model: 'Qwen/Qwen2.5-7B',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      // The default, and the reason it is asserted in the EXACT-body test rather
      // than only in its own: this is what every local request now carries, and
      // a change to it should have to be made here on purpose.
      chat_template_kwargs: { enable_thinking: false },
    })
  })

  it('reads a model list off a real vLLM answer', () => {
    const body = JSON.stringify({ object: 'list', data: [{ id: 'Qwen/Qwen2.5-7B' }] })
    expect(readModelsResponse({ ok: true, status: 200, text: body }, 'http://x/v1')).toEqual({
      ok: true,
      models: ['Qwen/Qwen2.5-7B'],
    })
  })

  it('quotes the server verbatim when it refuses, because that is where the fix is', () => {
    // vLLM answers a wrong model name with the list of names it does have.
    const result = readModelsResponse(
      { ok: false, status: 404, text: 'no route for /v1/models' },
      'http://x/v1',
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('refused')
    expect(result.reason).toContain('404')
    expect(result.reason).toContain('no route')
  })

  it('says what to check when a 200 comes back that is not a model list', () => {
    // The overwhelmingly likely cause is an endpoint missing its /v1, which
    // answers 200 with the server's own index page.
    const result = readModelsResponse(
      { ok: true, status: 200, text: '<html>vLLM</html>' },
      'http://x',
    )
    if (result.ok) throw new Error('should not have parsed')
    expect(result.kind).toBe('malformed')
    expect(result.reason).toContain('/v1')
  })

  it('names the missing /v1 on a 404, which is how vLLM actually answers it', () => {
    // Found against a live server, not reasoned about: typing the host without
    // its /v1 gets `{"error": "Not Found"}` and a 404, and neither of those
    // points at the three characters that are missing.
    const result = readModelsResponse(
      { ok: false, status: 404, text: 'Not Found' },
      'http://x:8000',
    )
    if (result.ok) throw new Error('x')
    expect(result.reason).toContain('404')
    expect(result.reason).toContain('ends in /v1')
  })

  it('does not lecture a user who got the path right', () => {
    const result = readModelsResponse({ ok: false, status: 500, text: 'boom' }, 'http://x:8000/v1/')
    if (result.ok) throw new Error('x')
    expect(result.reason).not.toContain('ends in /v1')
  })

  it('never turns an unparseable body into a reply', () => {
    const result = readChatResponse({ ok: true, status: 200, text: 'not json' })
    if (result.ok) throw new Error('should not have parsed')
    expect(result.kind).toBe('malformed')
  })

  it('reads a reply when there is one', () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'ready' } }] })
    expect(readChatResponse({ ok: true, status: 200, text: body })).toEqual({
      ok: true,
      text: 'ready',
    })
  })

  it('distinguishes a timeout from a closed port in words, not in kind', () => {
    // Same kind on purpose: from the user's side both are "nothing is listening
    // there", and only the waiting time differs.
    expect(unreachable('http://localhost:8000/v1/', 'x', true).reason).toContain('60 seconds')
    expect(unreachable('http://localhost:8000/v1/', 'refused', false).reason).toContain('refused')
    expect(unreachable('http://x/v1', 'y', true).kind).toBe('unreachable')
  })

  it('holds that a half-filled setting is not configured', () => {
    // `provider` is now part of the answer: the rule moved to `provider.ts`
    // when "configured" stopped meaning "a URL and a model" — a cloud provider
    // has a fixed endpoint and is unconfigured without a key. The full set of
    // cases lives beside the rule in `provider.test.ts`; these three are kept
    // here because this is where the failure they describe surfaces.
    const local = { provider: 'openai-compatible' } as const
    expect(isConfigured({ ...local, endpoint: 'http://x/v1', model: '' })).toBe(false)
    expect(isConfigured({ ...local, endpoint: '  ', model: 'm' })).toBe(false)
    expect(isConfigured({ ...local, endpoint: 'http://x/v1', model: 'm' })).toBe(true)
    expect(unconfigured().kind).toBe('unconfigured')
  })
})

describe('catching a server that silently dropped the prompt', () => {
  /**
   * The worst failure this app has, and the only one a client can detect.
   *
   * A server whose window is smaller than the request does not always refuse.
   * Ollama truncates, and what it drops is the FRONT of the prompt — which in a
   * tool-calling chat template is the tool list and the system prompt. The model
   * answers confidently having seen neither, and the person concludes the
   * assistant is stupid rather than that the server is misconfigured.
   *
   * Nothing in the response says "truncated". But the server reports how many
   * prompt tokens it evaluated, and the client knows what it sent, so the two
   * disagreeing is the signal.
   */
  const body = 'x'.repeat(72_000) // ~20,000 tokens at the documented divisor

  it('estimates a token count the divisor was calibrated for', () => {
    // 56,071 characters of tool schema measured as 15,575 tokens is where the
    // 3.6 came from; if that drifts, every threshold below drifts with it.
    expect(estimateTokens('x'.repeat(56_071))).toBe(15_575)
  })

  it('says nothing when the server reports no usage at all', () => {
    // Never accuse a server that did not speak. A zero here would do exactly
    // that, which is why the absent case is null rather than 0.
    expect(truncationOf(body, null)).toBeNull()
  })

  it('says nothing when the counts broadly agree', () => {
    expect(truncationOf(body, { promptTokens: 19_500, completionTokens: 10 })).toBeNull()
  })

  it('catches a 20k prompt evaluated as 4k, which is the real case', () => {
    // Ollama on a 4096 window, handed jojo's 82-tool catalog.
    expect(truncationOf(body, { promptTokens: 4_096, completionTokens: 10 })).toBe(4_096)
  })

  it('tolerates the noise the estimate genuinely has', () => {
    /*
     * `chars/3.6` cannot predict a chat template's control tokens or how a
     * tokeniser splits JSON punctuation, and a warm prefix cache may report
     * cached tokens differently. That noise is tens of percent; the failure
     * being caught is four-fold. A threshold inside the noise would cry wolf on
     * every healthy request, which is the way to make a warning worthless.
     */
    expect(truncationOf(body, { promptTokens: 12_000, completionTokens: 10 })).toBeNull()
  })

  it('stays quiet on a short prompt, where the ratio means nothing', () => {
    // Forty tokens of estimate against a real count is noise, not evidence.
    expect(truncationOf('hello', { promptTokens: 1, completionTokens: 1 })).toBeNull()
  })

  it('reads usage off a real OpenAI-shaped response', () => {
    const turn = readTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4096, completion_tokens: 7 },
      }),
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.usage?.promptTokens).toBe(4096)
    expect(turn.usage?.completionTokens).toBe(7)
  })

  it('reports null usage when the block is missing, rather than zeroes', () => {
    const turn = readTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.usage ?? null).toBeNull()
  })

  it('names both numbers in the warning, because the gap is the actionable part', () => {
    const said = truncationWarning(4096, 20000)
    expect(said).toContain('4,096')
    expect(said).toContain('20,000')
    expect(said).toContain('context window')
  })
})

describe('the dialects', () => {
  const msgs = [{ role: 'user' as const, content: 'hi' }]
  const tools = [{ type: 'function', function: { name: 't', description: '', parameters: {} } }]

  describe('Ollama speaks its own endpoint, for two things the shim cannot express', () => {
    const ollama = { provider: 'ollama' as const, endpoint: 'http://localhost:11434', model: 'q' }

    it('posts to /api/chat, not the OpenAI shim', () => {
      expect(chatRequest(ollama, msgs).url).toBe('http://localhost:11434/api/chat')
    })

    it('strips a /v1 the user pasted, which native must not have', () => {
      const req = chatRequest({ ...ollama, endpoint: 'http://localhost:11434/v1' }, msgs)
      expect(req.url).toBe('http://localhost:11434/api/chat')
    })

    it('sends shift:false, which is the actual prize', () => {
      /*
       * Not num_ctx. By default Ollama TRUNCATES a prompt that will not fit and
       * says nothing on the wire; with this it answers 400 with a sentence, and
       * its CORS headers are global so a browser can actually read it.
       */
      expect(JSON.parse(chatRequest(ollama, msgs).body!).shift).toBe(false)
    })

    it('sends stream:false explicitly, because native defaults it to true', () => {
      expect(JSON.parse(chatRequest(ollama, msgs).body!).stream).toBe(false)
    })

    it('sends num_ctx ONLY when the user stored one', () => {
      /*
       * Sending it from a default would be worse than sending none: it disables
       * Ollama's own VRAM back-off, so asking for 32k on a laptop that cannot
       * hold it turns a degraded answer into a failed load.
       */
      expect(JSON.parse(chatRequest(ollama, msgs).body!).options).toBeUndefined()
      const asked = { ...ollama, contextWindow: 32768 }
      expect(JSON.parse(chatRequest(asked, msgs).body!).options).toEqual({ num_ctx: 32768 })
    })

    /*
     * The same OBJECT rule going the other way, and it was only enforced coming
     * back. Ollama takes the assistant turn it produced straight back in
     * `messages` on the next round, and `arguments` there is a map — so the
     * OpenAI-spelled JSON STRING `loop.ts` stores is a type error the whole
     * request is rejected for. A first tool call worked; the round after it did
     * not, which is why a single-shot test would never have seen this.
     */
    const withCall = [
      { role: 'user' as const, content: 'how many applications?' },
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'memory_count', arguments: '{"type":"application"}' },
          },
        ],
      },
      { role: 'tool' as const, tool_call_id: 'call_1', content: '6' },
    ]

    const sentMessages = (msgs: typeof withCall) =>
      JSON.parse(chatRequest(ollama, msgs).body!).messages as {
        tool_calls?: { function: { name: string; arguments: unknown } }[]
      }[]

    it('sends tool-call arguments back as an OBJECT, which is the only shape native takes', () => {
      const call = sentMessages(withCall)[1]?.tool_calls?.[0]
      expect(call?.function.arguments).toEqual({ type: 'application' })
      // Not the string the transcript holds — that is a `map[string]any` on the
      // far side, and a string there fails to unmarshal and 400s the request.
      expect(typeof call?.function.arguments).toBe('object')
      expect(call?.function.name).toBe('memory_count')
    })

    it('degrades arguments it cannot read to {} rather than stranding the turn', () => {
      /*
       * A small model that emitted invalid JSON, or a call with no arguments at
       * all. Native has nowhere to put the raw string, and dropping the whole
       * request would end the conversation over one call the model can still be
       * told about.
       */
      for (const raw of ['', 'not json at all', '[1,2]', 'null']) {
        const broken = withCall.map((m, i) =>
          i === 1
            ? {
                ...m,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: { name: 'x', arguments: raw },
                  },
                ],
              }
            : m,
        ) as typeof withCall
        expect(sentMessages(broken)[1]?.tool_calls?.[0]?.function.arguments, raw).toEqual({})
      }
    })

    it('leaves every message that has no tool calls exactly as it was', () => {
      // Only the one field needed translating. Rewriting the rest would make the
      // stored transcript and the wire disagree for no reason.
      const sent = sentMessages(withCall)
      expect(sent[0]).toEqual({ role: 'user', content: 'how many applications?' })
      expect(sent[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '6' })
    })

    it('reads a native answer, whose tool arguments are an OBJECT', () => {
      // The difference that would have gone unnoticed: read as a string it
      // would be '', and every native tool call would run with no arguments.
      const turn = readOllamaTurn({
        ok: true,
        status: 200,
        text: JSON.stringify({
          message: {
            content: '',
            tool_calls: [{ function: { name: 'memory_get', arguments: { id: 'n1' } } }],
          },
          done_reason: 'stop',
          prompt_eval_count: 4096,
        }),
      })
      expect(turn.ok).toBe(true)
      if (!turn.ok) return
      expect(turn.toolCalls[0]?.args).toEqual({ id: 'n1' })
      expect(turn.toolCalls[0]?.raw).toBe('{"id":"n1"}')
      /*
       * No id on the wire — Ollama native sends none — so the fallback is what
       * keeps the result matchable to the call. Asserted as a SHAPE rather than
       * a literal: the counter is module-scoped so that two rounds cannot both
       * mint `call_0`, which means its exact value depends on what ran before.
       */
      expect(turn.toolCalls[0]?.id).toMatch(/^call_\d+$/)
      expect(turn.usage?.promptTokens).toBe(4096)
    })

    it('routes through readTurnFor without the caller knowing the dialect', () => {
      const turn = readTurnFor(ollama, {
        ok: true,
        status: 200,
        text: JSON.stringify({ message: { content: 'hello' }, done_reason: 'stop' }),
      })
      expect(turn.ok && turn.text).toBe('hello')
    })
  })

  describe('a cloud provider authenticates, a local one does not', () => {
    it('sends a bearer token for OpenAI', () => {
      const req = chatRequest(
        { provider: 'openai', endpoint: '', model: 'gpt-x', apiKey: 'sk-1' },
        msgs,
        tools,
      )
      // The fixed endpoint wins over whatever is stored, so switching from a
      // local server does not carry localhost into a cloud request.
      expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
      expect(req.headers['Authorization']).toBe('Bearer sk-1')
    })

    it('sends no key to a local server, even if one is stored', () => {
      // A bearer header on localhost is harmless but it is a key leaving the
      // machine for no reason, and this app should not do that by accident.
      const req = chatRequest(
        {
          provider: 'openai-compatible',
          endpoint: 'http://localhost:8000/v1',
          model: 'q',
          apiKey: 'sk-1',
        },
        msgs,
      )
      expect(req.headers['Authorization']).toBeUndefined()
    })

    it('hands an Anthropic request to the Anthropic builder', () => {
      const req = chatRequest(
        { provider: 'anthropic', endpoint: '', model: 'claude-x', apiKey: 'sk-a' },
        msgs,
        tools,
        true,
      )
      expect(req.url).toBe('https://api.anthropic.com/v1/messages')
      expect(req.headers['x-api-key']).toBe('sk-a')
      expect(req.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    })
  })
})

describe('asking a provider what it serves', () => {
  /**
   * This carried no credentials once, and the cost was not a poor error
   * message: a cloud provider could be CONFIGURED and never CONNECTED. The
   * list 401'd, the model field stayed empty and disabled, `isConfigured` never
   * turned true, and there was no way forward from the screen.
   */
  it('sends a bearer token to an OpenAI-shaped cloud provider', () => {
    const req = modelsRequest({ provider: 'openai', endpoint: '', model: '', apiKey: 'sk-1' })
    expect(req.url).toBe('https://api.openai.com/v1/models')
    expect(req.headers['Authorization']).toBe('Bearer sk-1')
  })

  it('sends Anthropic’s own headers, which are not a bearer token', () => {
    const req = modelsRequest({ provider: 'anthropic', endpoint: '', model: '', apiKey: 'sk-a' })
    expect(req.headers['x-api-key']).toBe('sk-a')
    expect(req.headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
    expect(req.headers['Authorization']).toBeUndefined()
  })

  it('sends nothing to a local server', () => {
    const req = modelsRequest({
      provider: 'openai-compatible',
      endpoint: 'http://localhost:8000/v1',
      model: '',
      apiKey: 'sk-1',
    })
    expect(req.headers['Authorization']).toBeUndefined()
  })

  it('asks Ollama at its own path, which is not /models', () => {
    const req = modelsRequest({ provider: 'ollama', endpoint: 'http://localhost:11434', model: '' })
    expect(req.url).toBe('http://localhost:11434/api/tags')
  })

  it('reads Ollama’s list shape as well as everyone else’s', () => {
    // `{models:[{model}]}` rather than `{data:[{id}]}`. A list of model names is
    // a list of model names; a caller that had to say which spelling it wanted
    // would be one more place to pair them up wrongly.
    expect(readModelIds({ models: [{ model: 'qwen3:14b' }, { model: 'llama3.1' }] })).toEqual([
      'qwen3:14b',
      'llama3.1',
    ])
    expect(readModelIds({ data: [{ id: 'gpt-4o' }] })).toEqual(['gpt-4o'])
  })
})

describe('the truncation guard, which is what the apps actually call', () => {
  /**
   * `truncationOf` was tested from the day it was written and never called by
   * anything — the detection existed and no user could ever have seen it. This
   * is the function that closes that gap, so it is the one that needs holding.
   */
  const big = 'x'.repeat(72_000) // ~20,000 tokens
  const good: Turn = { ok: true, text: 'hello', toolCalls: [], finishReason: 'stop' }

  it('passes a healthy turn straight through', () => {
    const turn = { ...good, usage: { promptTokens: 19_000, completionTokens: 5 } }
    expect(guardTruncation(big, turn)).toBe(turn)
  })

  it('passes a turn through when the server said nothing about usage', () => {
    // Never accuse a server that did not speak.
    expect(guardTruncation(big, good)).toBe(good)
  })

  it('turns a truncated turn into a refusal, not a warning on a good answer', () => {
    /*
     * The judgement this encodes. An answer built on a prompt the model never
     * fully read is not degraded, it is wrong — and passing it through with a
     * note attached is how the failure stays invisible.
     */
    const turn = { ...good, usage: { promptTokens: 4_096, completionTokens: 5 } }
    const out = guardTruncation(big, turn)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.kind).toBe('refused')
    expect(out.reason).toContain('4,096')
    expect(out.reason).toContain('context window')
  })

  it('leaves an already-failed turn alone', () => {
    // A refusal must not be relabelled as a truncation.
    const failure: Turn = { ok: false, kind: 'unreachable', reason: 'nothing answered' }
    expect(guardTruncation(big, failure)).toBe(failure)
  })

  it('says nothing on a small prompt, where the estimate is noise', () => {
    const turn = { ...good, usage: { promptTokens: 1, completionTokens: 1 } }
    expect(guardTruncation('hello', turn)).toBe(turn)
  })
})

describe('a rate limit, which the free tier makes routine', () => {
  /*
   * NVIDIA's free tier is in the provider table precisely so somebody without a
   * card can run the agent, and meeting its limit is not a misconfiguration —
   * it is Tuesday. A run that stops with a quoted status reads as broken; one
   * that says "rate limited, ask again" reads as throttled, which is what it is.
   */
  const askWith = (status: number, text: string, retryAfter?: string | null) =>
    readChatResponse({
      ok: false,
      status,
      text,
      ...(retryAfter === undefined ? {} : { retryAfter }),
    })

  it('names a 429 instead of quoting it', () => {
    const out = askWith(429, '{"detail":"Too Many Requests"}')
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toMatch(/rate limited/i)
      expect(out.reason).toMatch(/ask again/i)
      // The body is what it does NOT say: restating the number spends the whole
      // sentence on something the reader cannot act on.
      expect(out.reason).not.toContain('Too Many Requests')
      expect(out.reason).not.toContain('429')
    }
  })

  it('passes on how long to wait when the server said', () => {
    const out = askWith(429, '', '30')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('30 seconds')
  })

  it('falls back to a usable guess when it did not', () => {
    for (const header of [null, undefined, '', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      const out = askWith(429, '', header)
      expect(out.ok).toBe(false)
      // An HTTP-date is legal in `Retry-After` and is not a number of seconds;
      // printing it raw would read as gibberish, so it takes the fallback.
      if (!out.ok)
        expect(out.reason, String(header)).toMatch(/a minute is usually enough|\d+ seconds/)
    }
  })

  it('leaves every other status quoting the server, which is where the detail is', () => {
    const out = askWith(404, '{"error":"model not found: llama-3.3"}')
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toContain('404')
      expect(out.reason).toContain('model not found')
    }
  })
})

describe('a status of zero, which is the browser and not the server', () => {
  /*
   * A server cannot reply 0 — it is what a browser puts on a response it refused
   * to let the page read. The wording has said so for a while; the REPORTING did
   * not, and that is the half that mattered. `why` exists so that "nobody on
   * this origin can reach NVIDIA" and "one laptop went to sleep" stop arriving
   * as the same number, and without it here `blocked` was a FailureKind nothing
   * could ever produce.
   */
  it('reports a zero as blocked, not as one more unreachable server', () => {
    const out = readChatResponse({ ok: false, status: 0, text: '' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.why).toBe('blocked')
    // `kind` stays coarse on purpose: there is no answer to read either way, so
    // the app does the same thing. Only the reporting needed to tell them apart.
    expect(out.kind).toBe('unreachable')
  })

  it('keeps the classification when a models call decorates the sentence', () => {
    // `readModelsResponse` appends its /v1 hint by spreading the failure, which
    // is exactly the kind of rebuild that drops a field nobody asserted on.
    const out = readModelsResponse({ ok: false, status: 0, text: '' }, 'http://localhost:8000')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.why).toBe('blocked')
  })

  it('does not call an ordinary refusal blocked', () => {
    const out = readChatResponse({ ok: false, status: 404, text: 'nope' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.why).toBeUndefined()
  })
})

describe('a saved connection, whole', () => {
  /*
   * The point of the list is "do not set this up again", and for a cloud
   * provider that means four things, not two: the address, the model, WHICH
   * provider it is, and the key. It used to keep the first two, so a saved
   * NVIDIA row loaded back as an anonymous OpenAI-compatible server with no
   * credentials — useless for exactly the providers that take the most setting
   * up, while working fine for vLLM, which needs neither.
   */
  const nvidia = {
    name: 'NVIDIA',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    provider: 'nvidia',
    apiKey: 'nvapi-secret',
  }

  it('keeps the provider and the key alongside the address and model', () => {
    const [saved] = saveServer([], nvidia)
    expect(saved).toMatchObject({
      endpoint: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
      provider: 'nvidia',
      apiKey: 'nvapi-secret',
    })
  })

  it('behaves the same for a local server, which simply has neither', () => {
    // The vLLM case must not change: same call, same shape, no key invented.
    const [saved] = saveServer([], {
      name: 'Workstation',
      endpoint: 'http://localhost:8000/v1',
      model: 'meta-llama/Llama-3.1-8B',
    })
    expect(saved?.provider).toBeUndefined()
    expect(saved?.apiKey).toBeUndefined()
    expect(saved?.endpoint).toBe('http://localhost:8000/v1')
  })

  it('keeps the user’s name when the same model is reached again', () => {
    const first = saveServer([], { ...nvidia, name: 'My NVIDIA' })
    const again = saveServer(first, { ...nvidia, name: 'ignored', apiKey: 'nvapi-rotated' })
    expect(again).toHaveLength(1)
    expect(again[0]?.name).toBe('My NVIDIA')
    // A rotated key must replace the old one, or the row keeps failing.
    expect(again[0]?.apiKey).toBe('nvapi-rotated')
  })

  it('saves every model reached at one address, so they can be switched between', () => {
    /*
     * The whole point of the (endpoint, model) key. NVIDIA serves a catalogue
     * from ONE address, so keying on the endpoint alone meant the second model
     * overwrote the first and the saved list could never offer a choice.
     */
    const models = [
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'meta/llama-3.3-70b-instruct',
      'qwen/qwen3-coder-480b',
    ]
    const list = models.reduce(
      (acc, model) => saveServer(acc, { ...nvidia, name: model, model }),
      [] as ReturnType<typeof saveServer>,
    )
    expect(list).toHaveLength(3)
    expect(list.map((s) => s.model)).toEqual(models)
    // Distinct ids, or React draws one row and Delete takes all three.
    expect(new Set(list.map((s) => s.id)).size).toBe(3)
    // All at the one address, all carrying the provider's key.
    expect(list.every((s) => s.endpoint === nvidia.endpoint)).toBe(true)
    expect(list.every((s) => s.apiKey === 'nvapi-secret')).toBe(true)
  })

  it('rotates the key on every row at that address, not just the one saved', () => {
    /*
     * A credential belongs to the provider, not the model. Writing it to only
     * the row being saved would leave the other four failing with a key the
     * person had already replaced, and nothing on screen to explain it.
     */
    const first = saveServer([], nvidia)
    const second = saveServer(first, { ...nvidia, model: 'meta/llama-3.3-70b-instruct' })
    const rotated = saveServer(second, {
      ...nvidia,
      model: 'qwen/qwen3-coder-480b',
      apiKey: 'nvapi-new',
    })
    expect(rotated).toHaveLength(3)
    expect(rotated.every((s) => s.apiKey === 'nvapi-new')).toBe(true)
  })

  it('does not touch rows at a different address when a key rotates', () => {
    const mixed = saveServer(saveServer([], nvidia), {
      name: 'Workstation',
      endpoint: 'http://localhost:8000/v1',
      model: 'meta-llama/Llama-3.1-8B',
    })
    const after = saveServer(mixed, { ...nvidia, model: 'other/model', apiKey: 'nvapi-new' })
    expect(after.find((s) => s.endpoint === 'http://localhost:8000/v1')?.apiKey).toBeUndefined()
  })

  it('does not wipe a stored key when a caller saves without one', () => {
    // `exactOptionalPropertyTypes` makes omitting the only spelling that
    // compiles, and it is also the behaviour that does not lose a credential.
    const first = saveServer([], nvidia)
    const again = saveServer(first, { name: 'NVIDIA', endpoint: nvidia.endpoint, model: 'x' })
    expect(again[0]?.apiKey).toBe('nvapi-secret')
  })

  it('is one row per model, even when a trailing slash differs', () => {
    /*
     * This used to read "one row per provider, because their endpoints are
     * fixed" — which is exactly why a hosted catalogue could only ever hold one
     * model. What must still hold is the narrower claim: the SAME model reached
     * twice at the same address is one row, whatever the trailing slash.
     */
    const claude = {
      name: 'Claude',
      endpoint: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      apiKey: 'sk-ant-1',
    }
    const same = saveServer(saveServer([], claude), {
      ...claude,
      endpoint: 'https://api.anthropic.com/v1/',
    })
    expect(same).toHaveLength(1)

    const alsoOpus = saveServer(same, { ...claude, model: 'claude-opus-4-1' })
    expect(alsoOpus).toHaveLength(2)
  })
})

describe('the saved list, per provider', () => {
  const row = (over: Partial<ModelServer>): ModelServer => ({
    id: 'x',
    name: 'n',
    endpoint: 'http://localhost:8000/v1',
    model: 'm',
    ...over,
  })

  const list = [
    row({
      id: 'a',
      endpoint: 'http://localhost:8000/v1',
      model: 'llama',
      provider: 'openai-compatible',
    }),
    row({ id: 'b', endpoint: 'http://localhost:11434/v1', model: 'qwen', provider: 'ollama' }),
    row({
      id: 'c',
      endpoint: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/a',
      provider: 'nvidia',
    }),
    row({
      id: 'd',
      endpoint: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/b',
      provider: 'nvidia',
    }),
    // Saved before `provider` was carried on this record.
    row({ id: 'legacy', endpoint: 'http://localhost:1234/v1', model: 'old' }),
  ]

  it('shows only the selected provider’s rows', () => {
    expect(serversFor(list, 'nvidia').map((s) => s.id)).toEqual(['c', 'd'])
    expect(serversFor(list, 'ollama').map((s) => s.id)).toEqual(['b'])
  })

  it('does not offer a local server on a cloud provider’s panel', () => {
    // Picking one would swap the endpoint, the dialect and the key underneath a
    // form that still said NVIDIA.
    expect(serversFor(list, 'nvidia').some((s) => s.endpoint.includes('localhost'))).toBe(false)
  })

  it('keeps every NVIDIA model, which is the point of the list', () => {
    expect(serversFor(list, 'nvidia')).toHaveLength(2)
  })

  it('treats a row saved before `provider` existed as the local one', () => {
    expect(serversFor(list, 'openai-compatible').map((s) => s.id)).toEqual(['a', 'legacy'])
  })

  it('is empty for a provider nothing has been saved under', () => {
    expect(serversFor(list, 'anthropic')).toEqual([])
  })
})

describe('arguments an OpenAI-compatible server sends as an object', () => {
  it('reads them, instead of running the tool with nothing', () => {
    /*
     * `readOllamaTurn` has handled this since it was written; `readTurn` — the
     * path every vLLM, LM Studio and llama.cpp call takes — did not, and failed
     * two ways, both silent. The four write tools with no required fields RAN
     * with defaults; the rest failed validation complaining about a field the
     * model had actually supplied.
     */
    const turn = readTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'application_create', arguments: { org: 'Rice', role: 'PI' } },
                },
              ],
            },
          },
        ],
      }),
    })
    expect(turn.ok && turn.toolCalls[0]?.raw).toBe('{"org":"Rice","role":"PI"}')
    // Parsed too, because `raw` alone would still reach the tool as nothing.
    expect(turn.ok && turn.toolCalls[0]?.args).toEqual({ org: 'Rice', role: 'PI' })
  })

  it('still reads a plain string unchanged', () => {
    // The ordinary case, and it must not be re-encoded: `JSON.stringify` of an
    // already-serialised string would double-escape every quote in it.
    const turn = readTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'x', arguments: '{"a":1}' } },
              ],
            },
          },
        ],
      }),
    })
    expect(turn.ok && turn.toolCalls[0]?.raw).toBe('{"a":1}')
  })
})

/**
 * A model's own control tokens arriving inside the name of the tool it wants.
 *
 * Not hypothetical: GPT-OSS 120B named a tool `memory_get<|channel|>commentary`
 * during a multi-turn benchmark run, and the call was refused with "No tool is
 * called memory_get<|channel|>commentary" — true, useless, and a wasted round
 * trip on a local model.
 */
describe('tool names with harmony control tokens', () => {
  it('reads the tool GPT-OSS meant', () => {
    const turn = readTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  function: {
                    name: 'memory_get<|channel|>commentary',
                    arguments: '{"id":"app:1"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls[0]?.name).toBe('memory_get')
    // The arguments are untouched — only the name carried the marker.
    expect(turn.toolCalls[0]?.args).toEqual({ id: 'app:1' })
  })

  it('leaves an ordinary name exactly as it is', () => {
    expect(cleanToolName('memory_get')).toBe('memory_get')
    expect(cleanToolName('memory.get')).toBe('memory.get')
  })

  it('cuts at the first marker, terminated or not', () => {
    expect(cleanToolName('memory_get<|channel|>commentary<|end|>')).toBe('memory_get')
    // Unterminated: the name is still over at the marker, and guessing that the
    // rest might be name would put the failure back.
    expect(cleanToolName('memory_get<|chan')).toBe('memory_get')
    expect(cleanToolName('memory_get <|channel|>x')).toBe('memory_get')
  })

  it('drops a call whose name was ONLY a marker rather than inventing one', () => {
    expect(cleanToolName('<|channel|>commentary')).toBe('')

    // And the call goes with it. An empty name reaching the executor is refused
    // as "No tool is called " — a sentence with a hole in it, and one the model
    // cannot act on. Nothing was named, so there is nothing to call.
    const turn = readTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        choices: [
          {
            message: {
              content: 'thinking out loud',
              tool_calls: [
                { id: 'c1', function: { name: '<|channel|>commentary', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls).toEqual([])
    // The prose survives, so the turn is an answer rather than an empty reply.
    expect(turn.text).toBe('thinking out loud')
  })

  /*
   * The reader gpt-oss under Ollama actually goes through, and the one this did
   * not cover. `readTurn` above is the OpenAI shim's path; a user who picked the
   * `ollama` provider posts to `/api/chat` and comes back through
   * `readOllamaTurn`, which stripped nothing — so the exact failure the cleaner
   * exists for was still live on the provider most likely to be running gpt-oss.
   */
  it('reads the tool GPT-OSS meant on Ollama native too', () => {
    const turn = readOllamaTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        message: {
          content: '',
          tool_calls: [
            { function: { name: 'memory_get<|channel|>commentary', arguments: { id: 'app:1' } } },
          ],
        },
        done_reason: 'stop',
      }),
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls[0]?.name).toBe('memory_get')
    // Native arguments are an OBJECT, and the cleaning does not disturb them.
    expect(turn.toolCalls[0]?.args).toEqual({ id: 'app:1' })
  })

  it('drops an Ollama call whose name was ONLY a marker', () => {
    const turn = readOllamaTurn({
      ok: true,
      status: 200,
      text: JSON.stringify({
        message: {
          content: 'thinking out loud',
          tool_calls: [{ function: { name: '<|channel|>commentary', arguments: {} } }],
        },
        done_reason: 'stop',
      }),
    })
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls).toEqual([])
    expect(turn.text).toBe('thinking out loud')
  })
})

/* -------------------------------------------------------------------------- */
/* Thinking                                                                    */
/* -------------------------------------------------------------------------- */

const local = (over: Partial<ModelSettings> = {}): ModelSettings => ({
  provider: 'openai-compatible',
  endpoint: 'http://localhost:8000/v1',
  model: 'Qwen/Qwen3-14B',
  ...over,
})

/** The request body, parsed, for a one-line assertion about one field. */
const bodyOf = (settings: ModelSettings, thinking?: Thinking): Record<string, unknown> =>
  JSON.parse(
    chatRequest(
      settings,
      [{ role: 'user', content: 'hi' }],
      undefined,
      false,
      thinking === undefined ? {} : { thinking },
    ).body ?? '{}',
  ) as Record<string, unknown>

describe('thinking control', () => {
  /*
   * The gap this closes, measured before it was written: no dialect sent any
   * thinking parameter at all, so the one setting Aider publishes for Qwen3 —
   * and the one the loop's empty-reply guard already blames by name — could not
   * be expressed by this app in any provider.
   */
  it('asks a local OpenAI-compatible server not to think, by default', () => {
    expect(bodyOf(local())['chat_template_kwargs']).toEqual({ enable_thinking: false })
    // The default is the setting's value, not a second opinion about it.
    expect(bodyOf(local(), DEFAULT_THINKING)).toEqual(bodyOf(local()))
  })

  it('spells the same thing Ollama-native way, and disturbs nothing else', () => {
    const body = bodyOf(local({ provider: 'ollama', endpoint: 'http://localhost:11434' }))
    expect(body['think']).toBe(false)
    /*
     * The hard-won fields, asserted here because this test is the one that
     * changed the Ollama body. `shift:false` is what makes a too-large prompt a
     * readable 400 instead of a silent truncation, and `keep_alive` is what
     * stops the model unloading between turns; a thinking field that arrived at
     * the cost of either would be a bad trade made invisibly.
     */
    expect(body['shift']).toBe(false)
    expect(body['keep_alive']).toBe('30m')
    expect(body['stream']).toBe(false)
  })

  it('keeps num_ctx exactly as it was — sent only when the user typed one', () => {
    const off = local({ provider: 'ollama', endpoint: 'http://localhost:11434' })
    expect(bodyOf(off)['options']).toBeUndefined()
    expect(bodyOf({ ...off, contextWindow: 32768 })['options']).toEqual({ num_ctx: 32768 })
  })

  it('asks for LESS thinking where it cannot ask for none — gpt-oss', () => {
    // gpt-oss always reasons; `enable_thinking:false` is not a thing its template
    // reads, and `reasoning_effort` is. HIGH is what the gpt-oss report says
    // "frequently exceeded the 128k context", so the only useful ask is low.
    expect(bodyOf(local(), 'low')['chat_template_kwargs']).toEqual({ reasoning_effort: 'low' })
    expect(bodyOf(local({ provider: 'ollama' }), 'low')['think']).toBe('low')
  })

  it('sends nothing at all on server-default, on either local dialect', () => {
    expect(bodyOf(local(), 'server-default')['chat_template_kwargs']).toBeUndefined()
    expect(bodyOf(local({ provider: 'ollama' }), 'server-default')['think']).toBeUndefined()
    // And says so through the predicate `sendTurn` asks.
    expect(sendsThinking('openai-compatible', 'server-default')).toBe(false)
    expect(sendsThinking('openai-compatible', 'off')).toBe(true)
  })

  /*
   * THE ONE THAT WOULD COST A WORKING SETUP. `chat_template_kwargs` is a knob a
   * local inference server passes into a Jinja template; OpenAI's API answers an
   * unrecognised body field with a 400 rather than ignoring it. Sending it to a
   * hosted provider would turn every request from a working configuration into a
   * failure, for a feature those providers do not expose this way anyway.
   */
  it('sends nothing to a hosted provider, whatever the mode', () => {
    for (const provider of ['openai', 'groq', 'openrouter', 'nvidia'] as const) {
      for (const mode of ['off', 'low'] as const) {
        expect(thinkingFields(provider, mode)).toEqual({})
        const body = bodyOf(local({ provider, model: 'gpt-4o', apiKey: 'k' }), mode)
        expect(body['chat_template_kwargs']).toBeUndefined()
        expect(body['think']).toBeUndefined()
        expect(body['reasoning_effort']).toBeUndefined()
      }
    }
  })

  it('sends nothing to Anthropic, whose thinking is opt-in already', () => {
    const body = bodyOf(local({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'k' }))
    expect(body['thinking']).toBeUndefined()
    expect(body['chat_template_kwargs']).toBeUndefined()
    // The request is otherwise the one anthropic.ts already built.
    expect(body['max_tokens']).toBe(8192)
  })

  it('reads an unknown provider as the open-ended one rather than throwing', () => {
    // `providerMeta` falls back to `openai-compatible`, which is local, so a
    // settings document from a newer build still gets the knob.
    expect(thinkingFields('something-new', 'off')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Asking again when the model said nothing                                    */
/* -------------------------------------------------------------------------- */

/** A recorded pause. No clock in `kg/` (D26), so the delay is injected. */
const recorder = () => {
  const waits: number[] = []
  return { waits, delay: (ms: number) => (waits.push(ms), Promise.resolve()) }
}

const okTurn = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

/** An empty turn as it comes off the wire, rather than hand-built. */
const emptyFromWire = (): Turn =>
  readTurn({
    ok: true,
    status: 200,
    text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' } }] }),
  })

describe('retrying a turn that said nothing', () => {
  it('tags an empty turn from both readers, so the retry can recognise one', () => {
    expect(isEmptyTurn(emptyFromWire())).toBe(true)
    expect(
      isEmptyTurn(
        readOllamaTurn({
          ok: true,
          status: 200,
          text: JSON.stringify({ message: { role: 'assistant', content: '' } }),
        }),
      ),
    ).toBe(true)
    // The tag, not the sentence. `why` is what code reads; `reason` is copy.
    const turn = emptyFromWire()
    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.why).toBe('empty')
    expect(turn.kind).toBe('malformed')
  })

  it('does not call a refusal empty', () => {
    expect(isEmptyTurn(refusedTurn(500, 'boom'))).toBe(false)
    expect(isEmptyTurn(okTurn('hello'))).toBe(false)
    // A body that is not JSON is malformed but not empty: the model said
    // nothing THIS layer could read, which is a different fact.
    expect(isEmptyTurn(readTurn({ ok: true, status: 200, text: 'not json' }))).toBe(false)
  })

  it('asks three times, waiting longer each time, then reports the empty turn', async () => {
    const { waits, delay } = recorder()
    const seen: number[] = []
    const turn = await sendTurn(
      ({ attempt }) => {
        seen.push(attempt)
        return Promise.resolve(emptyFromWire())
      },
      { delay },
    )
    expect(seen).toEqual([1, 2, 3])
    expect(EMPTY_TURN_ATTEMPTS).toBe(3)
    // 500 then 1000. Short on purpose: nothing is being waited FOR.
    expect(waits).toEqual([EMPTY_RETRY_BASE_MS, EMPTY_RETRY_BASE_MS * 2])
    expect(waits).toEqual([emptyRetryDelayMs(1), emptyRetryDelayMs(2)])

    expect(turn.ok).toBe(false)
    if (turn.ok) return
    /*
     * STILL AN EMPTY TURN, and this is the assertion the loop depends on.
     * Exhausting the retries must not promote the failure into a refusal — the
     * loop's empty-reply guard and everything that reads `why` would then be
     * looking at the wrong thing, and the user would be told the server said no
     * when the server said nothing.
     */
    expect(turn.why).toBe('empty')
    expect(turn.kind).toBe('malformed')
    // And it says how many times, because "three times running" is the fact
    // that tells a reader jojo already tried the obvious thing.
    expect(turn.reason).toContain('3 times')
  })

  it('stops as soon as the model says something', async () => {
    const { waits, delay } = recorder()
    let n = 0
    const turn = await sendTurn(
      () => {
        n += 1
        return Promise.resolve(n === 1 ? emptyFromWire() : okTurn('here it is'))
      },
      { delay },
    )
    expect(n).toBe(2)
    expect(waits).toEqual([EMPTY_RETRY_BASE_MS])
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.text).toBe('here it is')
  })

  /*
   * The narrow scope, asserted. NVIDIA's entry in the provider table warns in
   * writing that "a silent retry against a rate limit is how one slow answer
   * becomes four", and every failure below is a FACT about the request or the
   * server: asking again produces the same fact more slowly.
   */
  it('retries nothing else — not a refusal, a rate limit, or an unreadable body', async () => {
    for (const failure of [
      refusedTurn(500, 'boom'),
      refusedTurn(429, 'Too Many Requests'),
      refusedTurn(401, 'invalid api key'),
      readTurn({ ok: true, status: 200, text: 'not json' }),
      unreachable('http://x/v1', 'connection refused', false),
    ]) {
      const { waits, delay } = recorder()
      let n = 0
      const turn = await sendTurn(
        () => {
          n += 1
          return Promise.resolve(failure)
        },
        { delay },
      )
      expect(n).toBe(1)
      expect(waits).toEqual([])
      expect(turn).toEqual(failure)
    }
  })

  it('takes the caller at its word about how many attempts', async () => {
    const { waits, delay } = recorder()
    let n = 0
    await sendTurn(
      () => {
        n += 1
        return Promise.resolve(emptyFromWire())
      },
      { delay, attempts: 1 },
    )
    // One send, no wait: a caller that asked for one ask gets one ask.
    expect(n).toBe(1)
    expect(waits).toEqual([])
  })

  it('re-asks without the thinking field when the server rejects it', async () => {
    /*
     * WHY THIS EXISTS AT ALL. Some Ollama builds refuse `think` on a model with
     * no thinking capability — Gemma 3 is exactly such a model and is one of the
     * three jojo is built for — and no client can know a model's capabilities
     * before it asks. Without this recovery a default of `off` would break the
     * commonest local setup there is.
     */
    const { waits, delay } = recorder()
    const asked: Thinking[] = []
    const turn = await sendTurn(
      ({ thinking }) => {
        asked.push(thinking)
        return Promise.resolve(
          thinking === 'server-default'
            ? okTurn('fine without it')
            : refusedTurn(400, '"think" option is not supported by this model'),
        )
      },
      { delay, provider: 'ollama' },
    )
    expect(asked).toEqual(['off', 'server-default'])
    // No pause: the server answered at once and the fix is deterministic.
    expect(waits).toEqual([])
    expect(turn.ok).toBe(true)
  })

  it('does not spend the retry budget on the downgrade', async () => {
    // The downgraded send asked nothing of the model — the request never
    // reached one — so the three attempts must still be three.
    const { delay } = recorder()
    const asked: Thinking[] = []
    await sendTurn(
      ({ thinking }) => {
        asked.push(thinking)
        return Promise.resolve(
          thinking === 'off' ? refusedTurn(400, 'unknown field think') : emptyFromWire(),
        )
      },
      { delay, provider: 'ollama' },
    )
    expect(asked).toEqual(['off', 'server-default', 'server-default', 'server-default'])
  })

  it('downgrades once and then gives up, rather than looping', async () => {
    const { delay } = recorder()
    let n = 0
    const turn = await sendTurn(
      () => {
        n += 1
        return Promise.resolve(refusedTurn(400, 'thinking is not supported'))
      },
      { delay, provider: 'ollama' },
    )
    // Two sends: the original and the one downgrade. A server that refuses both
    // is refusing for another reason, and the refusal is reported as itself.
    expect(n).toBe(2)
    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.kind).toBe('refused')
  })

  it('does not re-send when the request carried no thinking field anyway', async () => {
    /*
     * A hosted provider is sent nothing, so `off` and `server-default` build the
     * same body — a second identical request could only waste a round trip on a
     * paid API. The refusal below mentions thinking and is still not acted on.
     */
    const { delay } = recorder()
    let n = 0
    await sendTurn(
      () => {
        n += 1
        return Promise.resolve(refusedTurn(400, 'thinking blocks are not supported here'))
      },
      { delay, provider: 'openai' },
    )
    expect(n).toBe(1)
  })

  it('reads a rejection off the server’s words, not jojo’s', () => {
    expect(rejectsThinking(refusedTurn(400, '"think" option is not supported'))).toBe(true)
    expect(rejectsThinking(refusedTurn(400, 'unknown kwarg chat_template_kwargs'))).toBe(true)
    expect(rejectsThinking(refusedTurn(400, 'reasoning_effort must be one of low, medium'))).toBe(
      true,
    )
    // Not every refusal, and not a failure that never reached the server.
    expect(rejectsThinking(refusedTurn(400, 'model not found'))).toBe(false)
    expect(rejectsThinking(refusedTurn(429, 'Too Many Requests'))).toBe(false)
    expect(rejectsThinking(unreachable('http://x/v1', 'no route', true))).toBe(false)
    expect(rejectsThinking(okTurn('thinking about it'))).toBe(false)
  })

  it('builds the same empty failure from one place', () => {
    // `emptyTurn` is shared by both readers so the tag cannot be set in one and
    // forgotten in the other, which is how it was before: the sentence was
    // written twice and nothing but the sentence identified the case.
    expect(emptyFromWire()).toEqual(emptyTurn())
  })
})

/** A refusal as `readTurn` builds one, so the tests never hand-roll a reason. */
function refusedTurn(status: number, body: string): Turn {
  const response: ModelResponse = { ok: false, status, text: body }
  return readTurn(response)
}
