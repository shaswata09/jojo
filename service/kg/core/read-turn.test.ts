/**
 * `readTurn`, and every shape a model can answer in that is not the one it
 * should.
 *
 * This is the parser the whole agentic half of the app stands on: the
 * assistant, "Ask the graph", scout scoring and reading a posting from a link
 * all reach a model through it. `model-server.test.ts` covers the model list,
 * the plain reply and the saved-server bookkeeping; this covers the turn, which
 * is newer, has the most branches in the file, and is the one place that has to
 * be right about output nobody controls.
 *
 * EVERY CASE HERE IS A NEGATIVE. The happy path — some text, or a well-formed
 * call — is two lines and was never at risk. What is at risk is the long tail
 * of things real servers and real models actually emit: a call with no `id`, a
 * name that is not a string, `arguments` that are not JSON, a `choices` array
 * that is empty rather than absent, a message with `content: ""`. The source
 * says of one of these that it is "common enough to be a designed-for case
 * rather than an edge one", which is exactly the claim a test should hold up.
 *
 * The contract these protect, in one line: a malformed turn must be REPORTED,
 * never thrown and never silently dropped — a dropped tool call leaves the model
 * waiting for a result that will never come.
 */

import { describe, expect, it } from 'vitest'
import type { ModelResponse } from './model-server'
import { readTurn } from './model-server'

/** A 200 carrying whatever body the test wants to hand the parser. */
const answered = (body: unknown): ModelResponse => ({
  ok: true,
  status: 200,
  text: typeof body === 'string' ? body : JSON.stringify(body),
})

/** One assistant message, wrapped in the envelope a real endpoint sends. */
const message = (msg: unknown, finish?: unknown) =>
  answered({ choices: [{ message: msg, ...(finish === undefined ? {} : { finish_reason: finish }) }] })

const call = (over: Record<string, unknown> = {}) => ({
  id: 'call_abc',
  type: 'function',
  function: { name: 'application.create', arguments: '{"org":"Rice"}' },
  ...over,
})

/* ------------------------------ the envelope ------------------------------ */

describe('a body that is not a turn at all', () => {
  it('reports a non-200 as refused, quoting the server', () => {
    const turn = readTurn({ ok: false, status: 503, text: 'model is loading' })
    expect(turn.ok).toBe(false)
    if (!turn.ok) expect(turn.reason).toContain('model is loading')
  })

  it('reports a body that is not JSON', () => {
    const turn = readTurn(answered('<html>502 Bad Gateway</html>'))
    expect(turn.ok).toBe(false)
    if (!turn.ok) expect(turn.kind).toBe('malformed')
  })

  it('reports an empty body', () => {
    expect(readTurn(answered('')).ok).toBe(false)
  })

  it('reports JSON that is not an object — a bare array, string or null', () => {
    // `typeof null === 'object'` is the classic way this branch gets skipped.
    expect(readTurn(answered([])).ok).toBe(false)
    expect(readTurn(answered('"hello"')).ok).toBe(false)
    expect(readTurn(answered('null')).ok).toBe(false)
  })

  it('reports an object with no choices, and an EMPTY choices array', () => {
    // Absent and empty are different inputs down to the same answer, and an
    // implementation reading `choices[0]` without the length test throws on the
    // second rather than reporting it.
    expect(readTurn(answered({ id: 'x' })).ok).toBe(false)
    expect(readTurn(answered({ choices: [] })).ok).toBe(false)
    expect(readTurn(answered({ choices: 'nope' })).ok).toBe(false)
  })

  it('reports a choice with no message', () => {
    expect(readTurn(answered({ choices: [{}] })).ok).toBe(false)
    expect(readTurn(message(null)).ok).toBe(false)
    expect(readTurn(message('a string, not a message')).ok).toBe(false)
  })
})

/* -------------------------------- the text -------------------------------- */

describe('the assistant text', () => {
  it('reads content when there is some', () => {
    const turn = readTurn(message({ role: 'assistant', content: 'Rice is at stage submitted.' }))
    expect(turn.ok).toBe(true)
    if (turn.ok) expect(turn.text).toBe('Rice is at stage submitted.')
  })

  it('treats empty and whitespace-only content as no answer at all', () => {
    // A turn with `content: ""` and no calls is a server answering nothing. It
    // must not come back as `ok` with an empty string, which every UI would
    // render as a blank bubble.
    expect(readTurn(message({ content: '' })).ok).toBe(false)
    expect(readTurn(message({ content: '   \n\t ' })).ok).toBe(false)
  })

  it('treats non-string content as no answer', () => {
    // Some servers send `content: null` beside tool calls, and some send
    // structured content blocks. Neither is a string this can render.
    expect(readTurn(message({ content: null })).ok).toBe(false)
    expect(readTurn(message({ content: 42 })).ok).toBe(false)
    expect(readTurn(message({ content: [{ type: 'text', text: 'hi' }] })).ok).toBe(false)
  })

  it('reports an empty turn — no text and no calls — rather than looping', () => {
    const turn = readTurn(message({ role: 'assistant' }))
    expect(turn.ok).toBe(false)
    if (!turn.ok) expect(turn.reason).toContain('empty turn')
  })
})

/* ------------------------------- tool calls ------------------------------- */

describe('tool calls', () => {
  it('reads a well-formed call, parsing its arguments once', () => {
    const turn = readTurn(message({ content: null, tool_calls: [call()] }))
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls).toHaveLength(1)
    expect(turn.toolCalls[0]?.name).toBe('application.create')
    expect(turn.toolCalls[0]?.args).toEqual({ org: 'Rice' })
    expect(turn.toolCalls[0]?.raw).toBe('{"org":"Rice"}')
  })

  it('carries text AND calls together, because a model may narrate as it acts', () => {
    const turn = readTurn(message({ content: 'Let me look that up.', tool_calls: [call()] }))
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.text).toBe('Let me look that up.')
    expect(turn.toolCalls).toHaveLength(1)
  })

  it('keeps a call whose arguments are NOT JSON, with args null and the raw text', () => {
    // The designed-for case. Dropping the call would leave the model waiting
    // for a result forever; throwing would take the whole turn down. It has to
    // survive with enough information to tell the model what it wrote.
    const bad = call({ function: { name: 'application.create', arguments: '{org: Rice' } })
    const turn = readTurn(message({ content: null, tool_calls: [bad] }))
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls).toHaveLength(1)
    expect(turn.toolCalls[0]?.args).toBeNull()
    expect(turn.toolCalls[0]?.raw).toBe('{org: Rice')
  })

  it('treats empty or absent arguments as an empty object, not as a parse failure', () => {
    // A no-argument tool is legitimate, and models send '' and omit the key.
    const blank = call({ function: { name: 'memory.overview', arguments: '' } })
    const missing = call({ function: { name: 'memory.overview' } })
    for (const entry of [blank, missing]) {
      const turn = readTurn(message({ content: null, tool_calls: [entry] }))
      expect(turn.ok).toBe(true)
      if (turn.ok) expect(turn.toolCalls[0]?.args).toEqual({})
    }
  })

  it('invents a positional id when the server omits one', () => {
    // Some servers omit `id` on a single call. A missing id is worse than a
    // poor one: the result message needs something to point at.
    const turn = readTurn(
      message({ content: null, tool_calls: [call({ id: undefined }), call({ id: '' })] }),
    )
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls.map((c) => c.id)).toEqual(['call_0', 'call_1'])
  })

  it('drops an entry that could never be executed, and keeps the ones beside it', () => {
    // A nameless call has nothing to dispatch on. Dropping just that entry —
    // rather than the turn — is what lets a partly-bad batch still do work.
    const turn = readTurn(
      message({
        content: null,
        tool_calls: [
          null,
          'not an object',
          { id: 'a' }, // no function
          { id: 'b', function: null },
          { id: 'c', function: { arguments: '{}' } }, // no name
          { id: 'd', function: { name: '', arguments: '{}' } }, // empty name
          { id: 'e', function: { name: 42, arguments: '{}' } }, // name not a string
          call({ id: 'good' }),
        ],
      }),
    )
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    expect(turn.toolCalls.map((c) => c.id)).toEqual(['good'])
  })

  it('reports an empty turn when every call was unexecutable and there was no text', () => {
    // The composition that matters: dropping all the calls must leave the turn
    // reported as empty rather than `ok` with nothing in it.
    const turn = readTurn(message({ content: null, tool_calls: [{ id: 'a' }] }))
    expect(turn.ok).toBe(false)
  })

  it('treats a non-array tool_calls as no calls rather than throwing', () => {
    expect(readTurn(message({ content: 'hi', tool_calls: 'nope' })).ok).toBe(true)
    expect(readTurn(message({ content: 'hi', tool_calls: {} })).ok).toBe(true)
    const turn = readTurn(message({ content: 'hi', tool_calls: 'nope' }))
    if (turn.ok) expect(turn.toolCalls).toEqual([])
  })
})

/* ------------------------------ finish reason ----------------------------- */

describe('the finish reason', () => {
  it('is carried through when the server states one', () => {
    const turn = readTurn(message({ content: 'done' }, 'stop'))
    expect(turn.ok).toBe(true)
    if (turn.ok) expect(turn.finishReason).toBe('stop')
  })

  it('is null — never undefined — when absent or not a string', () => {
    // Consumers compare against 'tool_calls' and 'length'; a nullable field with
    // two absent spellings is two comparisons everywhere it is read.
    for (const body of [message({ content: 'done' }), message({ content: 'done' }, 7)]) {
      const turn = readTurn(body)
      expect(turn.ok).toBe(true)
      if (turn.ok) expect(turn.finishReason).toBeNull()
    }
  })
})
