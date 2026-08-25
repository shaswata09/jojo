import { describe, expect, it } from 'vitest'
import { createStreamReader } from './model-stream'

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
    expect(done).toEqual([{ type: 'done', text: 'Hello', calls: [], finish: null }])
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
    expect(r.end()).toEqual([{ type: 'done', text: 'good more', calls: [], finish: null }])
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
    expect(r.end()).toEqual([{ type: 'done', text: 'hi', calls: [], finish: 'tool_calls' }])
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
      { type: 'done', text: 'most of an answer', calls: [], finish: null },
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
