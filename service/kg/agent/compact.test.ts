/**
 * The summary that replaces the part of a chat that no longer fits.
 *
 * Its dangerous direction is invention. A trim that loses turn three leaves the
 * assistant ignorant, which is recoverable — it asks again. A summary that says
 * "the person agreed to close the Baylor application" when they did not leaves
 * it CONFIDENT, and it acts. So the shape of the output is pinned here: whose
 * voice it is in, that it is labelled, and that it cannot grow without bound.
 */
import { describe, expect, it } from 'vitest'
import { SUMMARY_CHARS, asMessage, compact, compactionMessages } from './compact'
import type { ChatMessage, Turn } from '../core/model-server'

const user = (text: string): ChatMessage => ({ role: 'user', content: text })
const said = (text: string): ChatMessage => ({ role: 'assistant', content: text })
const calling = (name: string): ChatMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: '{}' } }],
})
const result = (text: string): ChatMessage => ({ role: 'tool', tool_call_id: 'c1', content: text })

const answering = (text: string) => async (): Promise<Turn> => ({
  ok: true,
  text,
  toolCalls: [],
  finishReason: 'stop',
})

describe('compactionMessages', () => {
  it('shows the summariser what was said AND what was done', () => {
    // A summary built from prose alone would lose the half that matters: which
    // tools ran and what came back is where the ids live.
    const [, input] = compactionMessages([
      user('move Rice to interview'),
      calling('application.stage.set'),
      result('Rice University — Interview'),
      said('Done.'),
    ])
    expect(input?.content).toContain('move Rice to interview')
    expect(input?.content).toContain('application.stage.set')
    expect(input?.content).toContain('Rice University — Interview')
  })

  it('tells the summariser not to invent agreement', () => {
    const [system] = compactionMessages([user('hi')])
    expect(system?.content).toContain('never write that they agreed')
    expect(system?.content).toContain('State only what is in the messages')
  })
})

describe('asMessage', () => {
  it('is a system note, not something the assistant believes it said', () => {
    // An assistant message is prior speech, and a model will defend its own
    // prior speech. A system note is context, which is what this is.
    expect(asMessage('they filed the CV').role).toBe('system')
  })

  it('labels itself as a summary, so nothing reads it as verbatim', () => {
    expect(asMessage('x').content).toContain('summarised, not verbatim')
  })

  it('cannot grow into the thing it exists to prevent', () => {
    // A summary that grew with the conversation would just move the overflow.
    const huge = asMessage('y'.repeat(SUMMARY_CHARS * 5))
    expect((huge.content ?? '').length).toBeLessThan(SUMMARY_CHARS + 100)
  })
})

describe('compact', () => {
  it('returns the summary itself, not a message', async () => {
    // The prefix belongs to `asMessage`. Returning a prefixed MESSAGE and
    // storing its content is what made a twice-compacted thread carry the
    // boilerplate twice.
    const out = await compact({ ask: answering('They moved Rice to interview.') }, [user('x')])
    expect(out).toBe('They moved Rice to interview.')
    expect(out).not.toContain('summarised, not verbatim')
  })

  it('wraps exactly once, however many times it is compacted', () => {
    const once = asMessage('they filed the CV')
    const twice = asMessage(once.content ?? '')
    const marker = /summarised, not verbatim/g
    expect((once.content ?? '').match(marker)).toHaveLength(1)
    // Wrapping an already-wrapped value is what the loop used to do every turn.
    expect((twice.content ?? '').match(marker)?.length).toBeGreaterThan(1)
  })

  it('returns null for nothing to do', async () => {
    expect(await compact({ ask: answering('anything') }, [])).toBeNull()
  })

  it('returns null on every kind of failure, so a chat still trims', async () => {
    // Compaction improves a long chat. It is never what makes one possible —
    // the caller falls back to a plain trim, which is what it would have done.
    expect(await compact({ ask: () => Promise.reject(new Error('down')) }, [user('x')])).toBeNull()
    expect(
      await compact({ ask: async (): Promise<Turn> => ({ ok: false, kind: 'refused', reason: '429' }) }, [user('x')]),
    ).toBeNull()
    expect(await compact({ ask: answering('   ') }, [user('x')])).toBeNull()
  })
})
