import { describe, expect, it } from 'vitest'
import {
  chatRequest,
  chatUrl,
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
      { endpoint: 'http://localhost:8000/v1', model: '  Qwen/Qwen2.5-7B  ' },
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
    expect(isConfigured({ endpoint: 'http://x/v1', model: '' })).toBe(false)
    expect(isConfigured({ endpoint: '  ', model: 'm' })).toBe(false)
    expect(isConfigured({ endpoint: 'http://x/v1', model: 'm' })).toBe(true)
    expect(unconfigured().kind).toBe('unconfigured')
  })
})
