/**
 * The linking pass, driven by a fake model.
 *
 * What matters here is not that a model can spot a relation — that is the
 * model's business — but that this asks about every pair, maps the answers back
 * onto the right records, and SAYS SO when batches fail. The version this
 * replaces did none of the three: one request for all thirty entries, inside a
 * catch its own comment called "deliberately silent", producing a graph with no
 * edges and no explanation.
 */

import { describe, expect, it } from 'vitest'
import { linkProfile } from './link-profile'
import type { BackgroundDraft } from './read-cv'
import type { ChatMessage, Turn } from '../core/model-server'

const entry = (title: string): BackgroundDraft => ({ kind: 'skill', title })
const entries = (n: number) => Array.from({ length: n }, (_, i) => entry(`fact ${String(i)}`))

const answering = (text: string): Turn => ({ ok: true, text, toolCalls: [], finishReason: 'stop' })

/** Reads the numbered list back out of the prompt the batch was built from. */
const shownIn = (messages: readonly ChatMessage[]): string[] => {
  const user = messages.find((m) => m.role === 'user')?.content ?? ''
  return [...String(user).matchAll(/^\d+\. skill: (fact \d+)/gm)].map((m) => m[1]!)
}

describe('what the model is shown', () => {
  it('never shows a batch bigger than two chunks', async () => {
    const sizes: number[] = []
    await linkProfile(
      {
        ask: async (messages) => {
          sizes.push(shownIn(messages).length)
          return answering('{"relations":[]}')
        },
      },
      'CV.pdf',
      'text',
      entries(30),
      { size: 6 },
    )
    // Small enough to answer completely, which is the whole reason for batching.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(12)
    expect(sizes.length).toBeGreaterThan(1)
  })

  it('puts every pair of facts in front of it at least once', async () => {
    const seen = new Set<string>()
    await linkProfile(
      {
        ask: async (messages) => {
          const shown = shownIn(messages)
          for (let a = 0; a < shown.length; a += 1) {
            for (let b = a + 1; b < shown.length; b += 1) {
              seen.add([shown[a]!, shown[b]!].sort().join('|'))
            }
          }
          return answering('{"relations":[]}')
        },
      },
      'CV.pdf',
      'text',
      entries(13),
      { size: 4 },
    )
    expect(seen.size).toBe((13 * 12) / 2)
  })
})

describe('mapping an answer back onto the right record', () => {
  it('translates batch-local numbers into original positions', async () => {
    /*
     * The failure this prevents: a model shown facts 12 and 13 answers
     * "1 relates to 2", and a caller that took those numbers literally would
     * record a relation between facts 0 and 1 — a confident edge between two
     * records the model never looked at.
     */
    const all = entries(8)
    const result = await linkProfile(
      {
        ask: async (messages) => {
          const shown = shownIn(messages)
          // Only answer for the batch that holds the last two facts.
          if (!shown.includes('fact 6') || !shown.includes('fact 7')) return answering('{"relations":[]}')
          const s = shown.indexOf('fact 6') + 1
          const o = shown.indexOf('fact 7') + 1
          return answering(`{"relations":[{"subject":${String(s)},"predicate":"is evidence of","object":${String(o)}}]}`)
        },
      },
      'CV.pdf',
      'text',
      all,
      { size: 4 },
    )
    expect(result.relations).toEqual([{ subject: 6, predicate: 'is evidence of', object: 7 }])
  })

  it('records one edge when two batches find the same one', async () => {
    // Pairs can appear in more than one batch; the graph should not gain a
    // duplicate claim because of how the batching happened to fall.
    const result = await linkProfile(
      {
        ask: async (messages) => {
          const shown = shownIn(messages)
          const s = shown.indexOf('fact 0')
          const o = shown.indexOf('fact 1')
          if (s === -1 || o === -1) return answering('{"relations":[]}')
          return answering(
            `{"relations":[{"subject":${String(s + 1)},"predicate":"Built","object":${String(o + 1)}}]}`,
          )
        },
      },
      'CV.pdf',
      'text',
      entries(4),
      { size: 2 },
    )
    expect(result.relations).toHaveLength(1)
  })
})

describe('failures are counted, not swallowed', () => {
  it('keeps going when a batch throws, and says how many did', async () => {
    let n = 0
    const result = await linkProfile(
      {
        ask: async () => {
          n += 1
          if (n % 2 === 0) throw new Error('the model went away')
          return answering('{"relations":[]}')
        },
      },
      'CV.pdf',
      'text',
      entries(9),
      { size: 3 },
    )
    expect(result.failed).toBeGreaterThan(0)
    expect(result.asked).toBeGreaterThan(result.failed)
  })

  it('counts a refusal as a failed batch', async () => {
    const result = await linkProfile(
      { ask: async () => ({ ok: false, kind: 'unreachable', reason: 'no' }) as Turn },
      'CV.pdf',
      'text',
      entries(4),
      { size: 2 },
    )
    expect(result.asked).toBe(result.failed)
    expect(result.relations).toEqual([])
  })

  it('reports a clean run honestly too', async () => {
    const result = await linkProfile(
      { ask: async () => answering('{"relations":[]}') },
      'CV.pdf',
      'text',
      entries(4),
      { size: 2 },
    )
    expect(result.failed).toBe(0)
    expect(result.asked).toBeGreaterThan(0)
  })
})

describe('when there is nothing to do', () => {
  it('asks nothing about a single fact', async () => {
    let asked = 0
    const result = await linkProfile(
      {
        ask: async () => {
          asked += 1
          return answering('{"relations":[]}')
        },
      },
      'CV.pdf',
      'text',
      entries(1),
    )
    expect({ asked, reported: result.asked }).toEqual({ asked: 0, reported: 0 })
  })

  it('stops between batches when cancelled', async () => {
    let asked = 0
    const signal = { aborted: false }
    const result = await linkProfile(
      {
        ask: async () => {
          asked += 1
          signal.aborted = true
          return answering('{"relations":[]}')
        },
      },
      'CV.pdf',
      'text',
      entries(12),
      { size: 3, signal },
    )
    // One call made, then it stopped rather than running the other nine.
    expect(asked).toBe(1)
    expect(result.asked).toBe(1)
  })
})
