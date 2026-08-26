import { describe, expect, it } from 'vitest'
import { createStreamReader, streamingChatRequest } from './model-stream'

/**
 * The cases a hand-rolled SSE reader gets wrong.
 *
 * Every one of these is a real shape a server sends. The chunk boundaries are
 * the point: a network chunk is whatever arrived, not whatever is meaningful,
 * so a reader that assumes a chunk is a whole line — or a whole frame — works
 * against a fast local server and fails against a slow remote one.
 */

const frame = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`

describe('reading a text stream', () => {
  it('emits each delta and accumulates the whole', () => {
    const r = createStreamReader()
    expect(r.push(frame({ content: 'Hel' }))).toEqual([{ type: 'text', delta: 'Hel' }])
    expect(r.push(frame({ content: 'lo' }))).toEqual([{ type: 'text', delta: 'lo' }])
    const done = r.push('data: [DONE]\n\n')
    expect(done).toEqual([{ type: 'done', text: 'Hello', calls: [], finish: null , usage: null}])
  })

  it('survives a frame split across two chunks', () => {
    // The single most common real failure: the chunk boundary lands inside the
    // JSON, and a reader that parses per chunk throws on half an object.
    const r = createStreamReader()
    const whole = frame({ content: 'split' })
    const at = Math.floor(whole.length / 2)
    expect(r.push(whole.slice(0, at))).toEqual([])
    expect(r.push(whole.slice(at))).toEqual([{ type: 'text', delta: 'split' }])
  })

  it('survives several frames arriving in one chunk', () => {
    const r = createStreamReader()
    const out = r.push(frame({ content: 'a' }) + frame({ content: 'b' }) + frame({ content: 'c' }))
    expect(out).toEqual([
      { type: 'text', delta: 'a' },
      { type: 'text', delta: 'b' },
      { type: 'text', delta: 'c' },
    ])
  })

  it('ignores keep-alive comments and blank lines', () => {
    const r = createStreamReader()
    expect(r.push(': ping\n\n\n')).toEqual([])
    expect(r.push(frame({ content: 'x' }))).toEqual([{ type: 'text', delta: 'x' }])
  })

  it('skips a frame it cannot parse rather than failing the answer', () => {
    const r = createStreamReader()
    r.push(frame({ content: 'good' }))
    expect(r.push('data: {not json\n\n')).toEqual([])
    expect(r.push(frame({ content: ' more' }))).toEqual([{ type: 'text', delta: ' more' }])
    expect(r.end()).toEqual([{ type: 'done', text: 'good more', calls: [], finish: null , usage: null}])
  })
})

describe('assembling a tool call from fragments', () => {
  it('joins a name and its arguments across many frames', () => {
    /*
     * The wire shape: the first fragment carries index, id and name, and every
     * one after it carries a slice of the arguments and nothing else.
     */
    const r = createStreamReader()
    r.push(frame({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'profile_set' } }] }))
    r.push(frame({ tool_calls: [{ index: 0, function: { arguments: '{"full' } }] }))
    r.push(frame({ tool_calls: [{ index: 0, function: { arguments: 'Name":"Sha' } }] }))
    r.push(frame({ tool_calls: [{ index: 0, function: { arguments: 'swata"}' } }] }))
    const [done] = r.push('data: [DONE]\n\n')

    expect(done).toEqual({
      type: 'done',
      text: '',
      finish: null,
      calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'profile_set', arguments: '{"fullName":"Shaswata"}' },
        },
      ],
      usage: null,
    })
  })

  it('keeps two calls apart by index, not by id', () => {
    // Only the first fragment of each call carries an id. Keying on it would
    // start a fresh call for every fragment and produce a pile of empty ones.
    const r = createStreamReader()
    r.push(
      frame({
        tool_calls: [
          { index: 0, id: 'a', function: { name: 'one', arguments: '{"x"' } },
          { index: 1, id: 'b', function: { name: 'two', arguments: '{"y"' } },
        ],
      }),
    )
    r.push(
      frame({
        tool_calls: [
          { index: 1, function: { arguments: ':2}' } },
          { index: 0, function: { arguments: ':1}' } },
        ],
      }),
    )
    const [done] = r.end()
    expect(done).toMatchObject({
      calls: [
        { id: 'a', function: { name: 'one', arguments: '{"x":1}' } },
        { id: 'b', function: { name: 'two', arguments: '{"y":2}' } },
      ],
    })
  })

  it('returns calls in wire order however the fragments interleave', () => {
    const r = createStreamReader()
    r.push(frame({ tool_calls: [{ index: 2, id: 'c', function: { name: 'third' } }] }))
    r.push(frame({ tool_calls: [{ index: 0, id: 'a', function: { name: 'first' } }] }))
    r.push(frame({ tool_calls: [{ index: 1, id: 'b', function: { name: 'second' } }] }))
    const [done] = r.end()
    expect((done as { calls: readonly { id: string }[] }).calls.map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('the ways a stream ends', () => {
  it('carries the finish reason through', () => {
    const r = createStreamReader()
    r.push(frame({ content: 'hi' }, 'tool_calls'))
    expect(r.end()).toEqual([{ type: 'done', text: 'hi', calls: [], finish: 'tool_calls' , usage: null}])
  })

  it('keeps what arrived when the server closes without [DONE]', () => {
    /*
     * A server that drops the connection without a terminator is within its
     * rights and several do it on an abort. Discarding a complete answer over a
     * missing full stop is the wrong trade.
     */
    const r = createStreamReader()
    r.push(frame({ content: 'most of an answer' }))
    expect(r.end()).toEqual([
      { type: 'done', text: 'most of an answer', calls: [], finish: null , usage: null},
    ])
  })

  it('emits done exactly once', () => {
    const r = createStreamReader()
    r.push(frame({ content: 'x' }))
    expect(r.push('data: [DONE]\n\n')).toHaveLength(1)
    expect(r.push(frame({ content: 'ignored' }))).toEqual([])
    expect(r.end()).toEqual([])
  })

  it('exposes what has arrived so far, for the caller to draw', () => {
    const r = createStreamReader()
    r.push(frame({ content: 'partial' }))
    expect(r.text).toBe('partial')
  })
})

describe('the token counts a truncation check needs', () => {
  it('asks the server for them', () => {
    /*
     * A streamed reply carries no `usage` unless it is asked for. Without this
     * the app's only defence against a server that silently threw the prompt
     * away has nothing to compare against — and it was switched off on exactly
     * the servers that do it, because streaming is chosen for local
     * OpenAI-compatible endpoints: vLLM, LM Studio, llama.cpp.
     */
    const request = streamingChatRequest(
      { provider: 'vllm', endpoint: 'http://localhost:8000/v1', model: 'x' } as never,
      [{ role: 'user', content: 'hello' }],
      undefined,
      false,
    )
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>
    expect(body['stream']).toBe(true)
    expect(body['stream_options']).toEqual({ include_usage: true })
  })

  it('reads the usage frame, which carries no choices', () => {
    /*
     * THE bug. A server sends usage in a final frame whose `choices` array is
     * EMPTY, and the reader skipped any frame without `choices[0]` — so even
     * once the request asked for the numbers, they were discarded on arrival.
     */
    const reader = createStreamReader()
    reader.push('data: {"choices":[{"delta":{"content":"hi"}}]}\n')
    reader.push('data: {"choices":[],"usage":{"prompt_tokens":412,"completion_tokens":9}}\n')
    const [done] = reader.push('data: [DONE]\n')
    expect(done?.type === 'done' && done.usage).toEqual({
      prompt_tokens: 412,
      completion_tokens: 9,
    })
  })

  it('reports nothing rather than zero when the server sent none', () => {
    /*
     * Different facts. "Reported 400 prompt tokens for a 20,000-token request"
     * means the prompt was thrown away; "reported nothing" means we do not
     * know. A zero here would make the guard accuse every silent server.
     */
    const reader = createStreamReader()
    reader.push('data: {"choices":[{"delta":{"content":"hi"}}]}\n')
    const [done] = reader.push('data: [DONE]\n')
    expect(done?.type === 'done' && done.usage).toBeNull()
  })

  it('keeps the usage that arrived even when the stream just stops', () => {
    // Servers do not always send [DONE]. The counts must survive `end()`.
    const reader = createStreamReader()
    reader.push('data: {"choices":[],"usage":{"prompt_tokens":7}}\n')
    const [done] = reader.end()
    expect(done?.type === 'done' && done.usage).toEqual({ prompt_tokens: 7 })
  })
})

describe('the same body, arriving in one piece or in many', () => {
  /*
   * The property the EXTENSION RELAY rests on.
   *
   * A cloud provider is fetched by the extension, not by the page, and whether
   * its body arrives in fragments depends on how old the user's extension is:
   * protocol 5 forwards it as it comes, anything earlier hands over one finished
   * string at the end. Both are pushed through this reader, so an answer must
   * not depend on which happened — otherwise a person on an old extension would
   * get a subtly different reply from the same model and the same question, and
   * nothing on screen would say why.
   */
  const FRAMES = [
    'data: {"choices":[{"delta":{"content":"Reading "},"index":0}]}\n\n',
    'data: {"choices":[{"delta":{"content":"your applications"},"index":0}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function",' +
      '"function":{"name":"applications.list","arguments":"{\\"stage\\""}}]},"index":0}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,' +
      '"function":{"arguments":":\\"interview\\"}"}}]},"index":0}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}\n\n',
    'data: [DONE]\n\n',
  ]

  /** Drives the reader and returns everything it produced. */
  const run = (pushes: readonly string[]) => {
    const reader = createStreamReader()
    let text = ''
    let done: { text: string; calls: readonly unknown[]; finish: string | null } | null = null
    for (const push of pushes) {
      for (const event of reader.push(push)) {
        if (event.type === 'text') text += event.delta
        else done = { text: event.text, calls: event.calls, finish: event.finish }
      }
    }
    return { deltas: text, done }
  }

  it('assembles identically either way', () => {
    const streamed = run(FRAMES)
    const whole = run([FRAMES.join('')])

    expect(whole.done).toEqual(streamed.done)
    // The prose is the same whether it was delivered word by word or at once.
    expect(whole.deltas).toBe(streamed.deltas)
    expect(streamed.done?.text).toBe('Reading your applications')
  })

  it('reassembles a tool call split across frames, in both deliveries', () => {
    // The arguments arrive as two fragments of one JSON object. A reader that
    // keyed on id rather than index, or that parsed each fragment, would produce
    // two broken calls instead of one good one.
    for (const [label, pushes] of [
      ['streamed', FRAMES],
      ['whole', [FRAMES.join('')]],
    ] as const) {
      const { done } = run(pushes)
      expect(done?.calls.length, label).toBe(1)
      expect(done?.calls[0], label).toEqual({
        id: 'c1',
        type: 'function',
        function: { name: 'applications.list', arguments: '{"stage":"interview"}' },
      })
      expect(done?.finish, label).toBe('tool_calls')
    }
  })

  it('is unmoved by where the byte boundaries fall', () => {
    // The extension forwards whatever the network gave it, so a frame can be cut
    // anywhere — including inside the JSON. Every single-character split must
    // still produce the one right answer.
    const all = FRAMES.join('')
    const byChar = run([...all])
    expect(byChar.done).toEqual(run(FRAMES).done)
    expect(byChar.deltas).toBe('Reading your applications')
  })
})
