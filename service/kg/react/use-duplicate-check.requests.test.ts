/**
 * Q249: on add, a duplicate is found by the posting's ID first, then by its
 * URL, then by title and organisation — by arithmetic where it can, and by the
 * model judge only when the arithmetic finds nothing and the same employer has
 * something to compare against.
 *
 * Each rule on its own is held by `core/duplicates.test.ts` and
 * `agent/judge-duplicate.test.ts`. What is held here is the ORDER they compose
 * in, which neither of those files can see: `duplicateCheckWith` is the check
 * both create forms run at Save. The confirm dialog that shows the original is
 * held by `web/src/components/applications/ApplicationDialog.requests.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ModelSettings } from '../core/provider'
import type { Turn } from '../core/model-server-turn'
import { duplicateCheckWith } from './use-duplicate-check'

const MODEL: ModelSettings = {
  provider: 'openai-compatible',
  endpoint: 'http://model.test',
  model: 'gemma',
}
const NO_MODEL: ModelSettings = { ...MODEL, model: '' }

const answer = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

/** A model turn that records it was asked, and answers with `text`. */
function judge(text: string) {
  return vi.fn(async () => answer(text))
}

const saved = [
  {
    id: 'byUrl',
    org: 'Somewhere else',
    role: 'Lecturer',
    url: 'https://jobs.example.edu/view?id=77',
  },
  { id: 'byId', org: 'UTK', role: 'Assistant Professor', postingId: 'JobCode 179545452' },
  { id: 'byName', org: 'Rice University', role: 'Statistics' },
  {
    id: 'sameEmployer',
    org: 'University of Tennessee, Knoxville',
    role: 'Assistant Professor of Computer Science',
  },
]

describe('Q249 — the order a duplicate is looked for in', () => {
  it('takes the posting ID over a URL that matches a different record', async () => {
    const turn = judge('{"duplicateOf":null,"confidence":"certain"}')
    const found = await duplicateCheckWith(turn)({
      existing: saved,
      candidate: {
        org: 'UTK',
        role: 'Faculty',
        postingId: '179545452',
        url: 'https://jobs.example.edu/view?id=77',
      },
      settings: MODEL,
    })
    expect(found?.record.id).toBe('byId')
    expect(found?.reason).toBe('id')
    expect(found?.how).toBe('static')
    expect(turn).not.toHaveBeenCalled()
  })

  it('takes the URL next, and then the title and organisation, without asking the model', async () => {
    const turn = judge('{"duplicateOf":1,"confidence":"certain"}')
    const check = duplicateCheckWith(turn)

    const byUrl = await check({
      existing: saved,
      candidate: {
        org: 'Rice University',
        role: 'Statistics',
        url: 'https://jobs.example.edu/view?id=77',
      },
      settings: MODEL,
    })
    expect([byUrl?.record.id, byUrl?.reason, byUrl?.how]).toEqual(['byUrl', 'url', 'static'])

    const byName = await check({
      existing: saved,
      candidate: { org: 'rice university', role: '  STATISTICS ' },
      settings: MODEL,
    })
    expect([byName?.record.id, byName?.reason, byName?.how]).toEqual(['byName', 'name', 'static'])

    expect(turn).not.toHaveBeenCalled()
  })

  it('asks the model judge only when the arithmetic found nothing, about the same employer', async () => {
    const turn = judge('{"duplicateOf":1,"confidence":"likely","reason":"Same post, reworded."}')
    const found = await duplicateCheckWith(turn)({
      existing: saved,
      candidate: { org: 'UT Knoxville', role: 'Asst. Professor, Computer Science' },
      settings: MODEL,
    })
    expect(turn).toHaveBeenCalledTimes(1)
    expect(found?.how).toBe('model')
    expect(found?.reason).toBe('name')
    expect(found?.because).toBe('Same post, reworded.')
    expect(['byId', 'sameEmployer']).toContain(found?.record.id)
  })

  it('saves without asking when no model is connected or nobody at that employer is on file', async () => {
    const turn = judge('{"duplicateOf":1,"confidence":"certain"}')
    const check = duplicateCheckWith(turn)
    expect(
      await check({
        existing: saved,
        candidate: { org: 'UT Knoxville', role: 'Asst. Professor, Computer Science' },
        settings: NO_MODEL,
      }),
    ).toBeNull()
    expect(
      await check({
        existing: saved,
        candidate: { org: 'Stripe', role: 'ML engineer' },
        settings: MODEL,
      }),
    ).toBeNull()
    expect(turn).not.toHaveBeenCalled()
  })

  it('reads a model that says no, or fails, as not a duplicate', async () => {
    const candidate = { org: 'UT Knoxville', role: 'Asst. Professor, Computer Science' }
    expect(
      await duplicateCheckWith(judge('{"duplicateOf":null,"confidence":"certain"}'))({
        existing: saved,
        candidate,
        settings: MODEL,
      }),
    ).toBeNull()
    const down = vi.fn(async (): Promise<Turn> => ({
      ok: false,
      kind: 'unreachable',
      reason: 'The model is down.',
    }))
    expect(
      await duplicateCheckWith(down)({ existing: saved, candidate, settings: MODEL }),
    ).toBeNull()
  })
})
