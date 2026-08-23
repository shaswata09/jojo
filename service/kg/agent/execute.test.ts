/**
 * Turning a tool's outcome back into something a person can read.
 *
 * `renderOutcome` writes one string that carries two completely different
 * things depending on the tool's effect, and `readStepDetail` is what tells
 * them apart again for the trace. The tests that matter here are the ones about
 * the boundary between them, and about the truncated case — which is where a
 * naive "try JSON.parse and see" gets it exactly backwards.
 */

import { describe, expect, it } from 'vitest'
import { readStepDetail, renderOutcome } from './execute'

describe('reading a step’s result back', () => {
  /*
   * `detail` is one string carrying two different things, because
   * `renderOutcome` branches on effect. The trace was rendering both as the
   * same wall of monospace, which for a read of forty records is one
   * 6000-character line.
   */
  it('parses a read’s result, which is machine data', () => {
    const out = readStepDetail({ effect: 'read', status: 'done', detail: '[{"id":"app:1"}]' })
    expect(out).toEqual({ kind: 'json', value: [{ id: 'app:1' }], truncated: false })
  })

  it('leaves a write’s result as the sentence it is', () => {
    const said = 'Added Rice — Senior Engineer (id: app:1)'
    expect(readStepDetail({ effect: 'create', status: 'done', detail: said })).toEqual({
      kind: 'text',
      value: said,
    })
  })

  /*
   * The trap a try/catch sniffer falls into: the banner is appended OUTSIDE the
   * JSON, so the longest results — the only ones anybody needs help reading —
   * are exactly the ones that will not parse.
   */
  it('does not choke on a truncated read', () => {
    const long = renderOutcome(
      { ok: true, entry: { effect: 'read' } as never, result: Array.from({ length: 400 }, (_, i) => ({ n: i })) },
      200,
    )
    const out = readStepDetail({ effect: 'read', status: 'done', detail: long })
    expect(out?.kind).toBe('text')
    expect((out as { value: string }).value).toContain('[Truncated at 200 characters')
  })

  it('never parses a failed or declined step, whatever it starts with', () => {
    expect(readStepDetail({ effect: 'read', status: 'failed', detail: '{"a":1}' })).toEqual({
      kind: 'text',
      value: '{"a":1}',
    })
    expect(readStepDetail({ effect: 'read', status: 'declined', detail: '{}' })?.kind).toBe('text')
  })

  it('has nothing to say about a step with no detail', () => {
    expect(readStepDetail({ effect: 'read', status: 'done' })).toBeNull()
    expect(readStepDetail({ effect: 'read', status: 'done', detail: '' })).toBeNull()
  })
})
