import { describe, expect, it } from 'vitest'
import {
  chatRequest,
  chatUrl,
  readTurn,
  readTurnFor,
  readOllamaTurn,
  truncationOf,
  truncationWarning,
  estimateTokens,
  modelsUrl,
  normaliseEndpoint,
  isConfigured,
  modelsRequest,
  readChatResponse,
  readModelIds,
  readModelsResponse,
  readReply,
  removeServer,
  renameServer,
  saveServer,
  serverAt,
  serverId,
  unconfigured,
  unreachable,
} from './model-server'
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
  it('keys on the endpoint, so connecting twice is one entry', () => {
    const once = saveServer([], server())
    const twice = saveServer(once, server({ endpoint: 'http://localhost:8000/v1/' }))
    expect(twice).toHaveLength(1)
  })

  it('derives the id from the address, so no random source is needed here', () => {
    const [saved] = saveServer([], server())
    expect(saved?.id).toBe(serverId('http://localhost:8000/v1/'))
    expect(saved?.id).toBe('server:http://localhost:8000/v1')
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

  it('refreshes the model, because that is the server’s fact and not a preference', () => {
    const list = saveServer([], server())
    const after = saveServer(list, server({ model: 'Qwen/Qwen2.5-7B' }))
    expect(after[0]?.model).toBe('Qwen/Qwen2.5-7B')
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
    expect(modelsRequest('http://localhost:8000/v1/')).toEqual({
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
    const result = readModelsResponse({ ok: true, status: 200, text: '<html>vLLM</html>' }, 'http://x')
    if (result.ok) throw new Error('should not have parsed')
    expect(result.kind).toBe('malformed')
    expect(result.reason).toContain('/v1')
  })

  it('names the missing /v1 on a 404, which is how vLLM actually answers it', () => {
    // Found against a live server, not reasoned about: typing the host without
    // its /v1 gets `{"error": "Not Found"}` and a 404, and neither of those
    // points at the three characters that are missing.
    const result = readModelsResponse({ ok: false, status: 404, text: 'Not Found' }, 'http://x:8000')
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
      // No id on the wire — the positional fallback is what keeps the result
      // matchable to the call.
      expect(turn.toolCalls[0]?.id).toBe('call_0')
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
        { provider: 'openai-compatible', endpoint: 'http://localhost:8000/v1', model: 'q', apiKey: 'sk-1' },
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
