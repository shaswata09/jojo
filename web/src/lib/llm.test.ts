/**
 * The streamed turn, and the one check it used to switch off.
 *
 * `createStreamReader` is tested in core and `guardTruncation` is tested in
 * core. What was never tested is the JOIN between them, which lives only here:
 * `llm.ts` rebuilds an ordinary completion object out of the stream so the
 * batched readers can parse it, and a rebuilt object with no `usage` in it
 * leaves the guard with nothing to compare. The failure that motivates this
 * file is exactly that — a local server with a window too small for the request
 * dropped the tool list and the question, answered anyway, and jojo showed the
 * answer as an ordinary reply on every streamed turn. `stream_options:
 * {include_usage: true}` was being asked for, the server was sending the
 * counts, the reader was reporting them, and this file was throwing them away.
 *
 * NOTHING IS MOUNTED AND NOTHING REACHES THE NETWORK. `fetch` and `window` are
 * stubbed with the smallest things the code under test will accept, so the real
 * reader, the real reconstruction and the real guard all run — a fake at the
 * `readStream` level would have been a fake of the very code that was wrong.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentTurn, needsRelay } from '@/lib/llm'
import type { ModelSettings } from '@jojo/service/core/provider'

/** ~20,000 tokens by `estimateTokens`, which is what makes the ratio meaningful. */
const HUGE = 'x'.repeat(72_000)

const ask = (settings: ModelSettings, onDelta: (delta: string) => void = () => {}) =>
  agentTurn(settings, [{ role: 'user', content: HUGE }], [], undefined, onDelta)

const LOCAL: ModelSettings = {
  provider: 'openai-compatible',
  endpoint: 'http://127.0.0.1:8000/v1',
  model: 'test-model',
}

/** NVIDIA is cloud, so its stream goes through the extension instead of `fetch`. */
const CLOUD: ModelSettings = {
  provider: 'nvidia',
  endpoint: '',
  model: 'test-model',
  apiKey: 'nvapi-test',
}

/** An SSE body, as a server that was asked for `include_usage` actually sends it. */
const sse = (usage: string | null) =>
  [
    'data: {"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\n',
    // The usage frame arrives on its own, AFTER the finish reason, with an
    // empty `choices` array. See `createStreamReader`.
    ...(usage === null ? [] : [`data: {"usage":${usage},"choices":[]}\n\n`]),
    'data: [DONE]\n\n',
  ].join('')

/** A response whose body arrives in pieces, split mid-frame like a real one. */
function streamedResponse(body: string): Response {
  const encoder = new TextEncoder()
  const half = Math.floor(body.length / 2)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body.slice(0, half)))
      controller.enqueue(encoder.encode(body.slice(half)))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/**
 * The three message types the page and the extension's bridge agree on.
 *
 * Copied rather than imported because `capture-bridge.ts` keeps them private.
 * They are a wire protocol shared with `web/extension/bridge.js`, so they do
 * not move quietly; if they ever do, this test says so loudly rather than
 * passing on a channel nobody is listening to.
 */
const REQUEST = 'jojo:capture-request'
const REPLY = 'jojo:capture-reply'
const CHUNK = 'jojo:capture-chunk'

type Posted = { type: string; id: number; model?: unknown; stream?: boolean }
type Listener = (event: { source: unknown; origin: string; data: unknown }) => void

/**
 * An extension that answers, in as few lines as `ask` will accept.
 *
 * `chunks` empty is not an idle bridge — it is a bridge older than protocol 5,
 * which ignores the request to stream and hands back the whole body at the end.
 * Both roads have to reconstruct the same completion, so both are exercised.
 */
function fakeBridge(options: { chunks?: readonly string[]; text?: string }) {
  const listeners = new Set<Listener>()
  const origin = 'http://localhost:5173'
  const win = {
    location: { origin, protocol: 'http:' },
    addEventListener: (_type: string, fn: Listener) => {
      listeners.add(fn)
    },
    removeEventListener: (_type: string, fn: Listener) => {
      listeners.delete(fn)
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => {
      clearTimeout(id as ReturnType<typeof setTimeout>)
    },
    postMessage: (message: Posted) => {
      if (message.type !== REQUEST) return
      const deliver = (data: unknown) => {
        // A copy, because a listener removes itself while we are iterating.
        for (const fn of [...listeners]) fn({ source: win, origin, data })
      }
      // Asynchronous, like the real one: `ask` posts before it can be answered.
      queueMicrotask(() => {
        // No `model` in the message is the cheap "are you there" probe.
        if (message.model === undefined) {
          deliver({ type: REPLY, id: message.id, protocol: 5, count: 0 })
          return
        }
        for (const chunk of options.chunks ?? []) {
          deliver({ type: CHUNK, id: message.id, text: chunk })
        }
        deliver({
          type: REPLY,
          id: message.id,
          protocol: 5,
          ok: true,
          status: 200,
          text: options.text ?? '',
          streamed: (options.chunks ?? []).length > 0,
        })
      })
    },
  }
  return win
}

/** Nothing in these tests is allowed to reach a socket, including by fallback. */
const forbiddenFetch = () => {
  throw new Error('a test reached the network')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a streamed turn, and the token counts it has to carry', () => {
  it('refuses when the server says it read a fraction of what was sent', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(streamedResponse(sse('{"prompt_tokens":4096}'))))

    const turn = await ask(LOCAL)

    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.kind).toBe('refused')
    // Both numbers, because the person can act on the gap.
    expect(turn.reason).toContain('4,096')
    expect(turn.reason).toContain('context window')
  })

  it('lets a healthy streamed turn through, counts and all', async () => {
    // The other half of the fix: carrying `usage` must not make the guard
    // accuse a server that read the whole prompt.
    vi.stubGlobal('fetch', () => Promise.resolve(streamedResponse(sse('{"prompt_tokens":19000}'))))

    const turn = await ask(LOCAL)

    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.text).toBe('Hello there')
  })

  it('never accuses a server that reported no counts at all', async () => {
    // "Reported 400 tokens for a 20,000-token request" and "reported nothing"
    // are different facts, and only the first is worth interrupting someone for.
    vi.stubGlobal('fetch', () => Promise.resolve(streamedResponse(sse(null))))

    const turn = await ask(LOCAL)

    expect(turn.ok).toBe(true)
  })

  it('refuses a truncated turn relayed through the extension in pieces', async () => {
    vi.stubGlobal('fetch', forbiddenFetch)
    const body = sse('{"prompt_tokens":4096}')
    vi.stubGlobal('window', fakeBridge({ chunks: [body.slice(0, 40), body.slice(40)] }))

    const turn = await ask(CLOUD)

    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.reason).toContain('4,096')
  })

  it('refuses it just the same when an old bridge answers in one piece', async () => {
    vi.stubGlobal('fetch', forbiddenFetch)
    vi.stubGlobal('window', fakeBridge({ text: sse('{"prompt_tokens":4096}') }))

    const turn = await ask(CLOUD)

    expect(turn.ok).toBe(false)
    if (turn.ok) return
    expect(turn.reason).toContain('4,096')
  })
})

/**
 * Which addresses the page fetches itself, and which it asks the extension for.
 *
 * This took two wrong turns worth recording, because they failed in opposite
 * directions and the second was worse than the first.
 *
 * 1. Relay for `cloud` only. A vLLM at `http://10.116.34.124:8103/v1` went
 *    straight to `fetch` and was blocked by mixed content — while the error
 *    said "install the jojo extension, which relays that one hop for you".
 * 2. Relay anything the browser refuses. Now the request reached an extension
 *    whose policy allowed loopback and five hosted providers, so the same
 *    address traded a mixed-content error for "that address is not a model
 *    provider jojo knows about": a policy refusal wearing the clothes of a typo.
 *
 * The fix had to move both halves together — `background.js` relays private
 * network addresses now, and this asks it to.
 */
describe('what the page fetches itself', () => {
  const settings = (endpoint: string) =>
    ({ provider: 'openai-compatible', endpoint, model: 'gemma_4_31b' }) as ModelSettings

  const fetched: string[] = []
  const stubFetch = () => {
    fetched.length = 0
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(String(url))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  it('fetches loopback directly, even from https — the browser allows it', async () => {
    // A relay here would be a message hop for nothing.
    vi.stubGlobal('location', { protocol: 'https:' })
    stubFetch()
    await agentTurn(settings('http://localhost:11434/v1'), [{ role: 'user', content: 'hi' }], [])
    expect(fetched.some((u) => u.includes('localhost'))).toBe(true)
  })

  it('fetches a LAN address directly when the PAGE is http', async () => {
    // http -> http is not mixed content. This is why the same setup works from
    // a dev server and not from GitHub Pages.
    vi.stubGlobal('location', { protocol: 'http:' })
    stubFetch()
    await agentTurn(settings('http://10.116.34.124:8103/v1'), [{ role: 'user', content: 'hi' }], [])
    expect(fetched.some((u) => u.includes('10.116.34.124'))).toBe(true)
  })

  it('asks the extension for a LAN address from an https page', () => {
    /*
     * The reported case: GitHub Pages over https, vLLM on the network. The
     * browser refuses this before a socket opens, so the page must not try it
     * itself — it goes to the extension, which relays private addresses.
     *
     * The DECISION is what is asserted. `sendOrRelay` falls back to a direct
     * fetch when no extension answers, which is right — it produces the honest
     * mixed-content error rather than silence — and makes the fetch itself a
     * poor witness for which route was chosen.
     */
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(needsRelay('http://10.116.34.124:8103/v1/chat/completions')).toBe(true)
    expect(needsRelay('http://192.168.1.50:8000/v1/chat/completions')).toBe(true)
  })

  it('does not ask for loopback, or for https, or from an http page', () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(needsRelay('http://localhost:11434/api/chat')).toBe(false)
    expect(needsRelay('http://127.0.0.1:8000/v1')).toBe(false)
    expect(needsRelay('https://10.116.34.124:8103/v1')).toBe(false)
    vi.stubGlobal('location', { protocol: 'http:' })
    expect(needsRelay('http://10.116.34.124:8103/v1')).toBe(false)
  })
})
