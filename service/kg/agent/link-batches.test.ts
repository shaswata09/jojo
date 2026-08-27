/**
 * That every pair really is offered, which is the whole claim.
 *
 * The module argues from two cases — same chunk, different chunks — and an
 * argument in a comment is not a guarantee. These enumerate the pairs and check
 * the batches against them, at every size and shape that has an off-by-one in
 * it: fewer records than a chunk, exactly a chunk, one over, and a remainder of
 * one, which is the shape that makes a chunk with no pair in it.
 */

import { describe, expect, it } from 'vitest'
import { LINK_CHUNK, batchCount, everyPair, pairBatches } from './link-batches'

/** Which unordered pairs of INDICES appear together in at least one batch. */
function pairsSeen(total: number, size: number): Set<string> {
  const items = Array.from({ length: total }, (_, i) => i)
  const seen = new Set<string>()
  for (const batch of pairBatches(items, size)) {
    for (let a = 0; a < batch.length; a += 1) {
      for (let b = a + 1; b < batch.length; b += 1) {
        const [lo, hi] = [batch[a]!, batch[b]!].sort((x, y) => x - y)
        seen.add(`${String(lo)}-${String(hi)}`)
      }
    }
  }
  return seen
}

describe('every pair is offered at least once', () => {
  for (const total of [2, 3, 5, 6, 7, 12, 13, 30, 31]) {
    for (const size of [2, 3, LINK_CHUNK, 10]) {
      it(`covers all ${String((total * (total - 1)) / 2)} pairs of ${String(total)} at size ${String(size)}`, () => {
        const seen = pairsSeen(total, size)
        const missing = everyPair(total)
          .map(([a, b]) => `${String(a)}-${String(b)}`)
          .filter((p) => !seen.has(p))
        expect(missing).toEqual([])
      })
    }
  }
})

describe('what is not worth a call', () => {
  it('has nothing to do with fewer than two records', () => {
    // No pair exists, so asking a model about it is a round trip for nothing.
    expect(pairBatches([], 4)).toEqual([])
    expect(pairBatches(['only'], 4)).toEqual([])
  })

  it('skips a self-paired chunk that holds a single record', () => {
    /*
     * The remainder-of-one shape: seven records at size three leaves a chunk of
     * one, whose self-pair has no pair in it. Its records still meet everything
     * else through the cross-chunk batches, so dropping the batch loses nothing
     * and saves a call.
     */
    const batches = pairBatches([0, 1, 2, 3, 4, 5, 6], 3)
    expect(batches.every((b) => b.length > 1)).toBe(true)
    // ...and coverage is unaffected, which is the point.
    expect(pairsSeen(7, 3).size).toBe(everyPair(7).length)
  })

  it('degrades to one batch rather than looping forever on a nonsense size', () => {
    expect(pairBatches([1, 2, 3], 0)).toEqual([[1, 2, 3]])
  })
})

describe('what it costs', () => {
  it('reports the number of calls without building them', () => {
    for (const total of [2, 7, 12, 30, 31]) {
      for (const size of [3, LINK_CHUNK]) {
        expect(batchCount(total, size)).toBe(pairBatches(Array.from({ length: total }, (_, i) => i), size).length)
      }
    }
  })

  it('is a handful of calls for a CV, not one and not hundreds', () => {
    /*
     * The trade, in numbers. Thirty facts is 435 pairs; asking about each would
     * be absurd and asking once — which is what this replaces — answered
     * incompletely and silently.
     */
    expect(batchCount(30)).toBeLessThanOrEqual(20)
    expect(batchCount(30)).toBeGreaterThan(1)
  })

  it('costs nothing when there is nothing to relate', () => {
    expect(batchCount(1)).toBe(0)
    expect(batchCount(0)).toBe(0)
  })
})

describe('the batches themselves', () => {
  it('keeps input order inside a batch, so numbering is stable', () => {
    // The model is shown numbered entries and answers with those numbers; a
    // batch that reordered them would map every answer onto the wrong record.
    for (const batch of pairBatches([0, 1, 2, 3, 4, 5, 6, 7], 3)) {
      expect([...batch]).toEqual([...batch].sort((a, b) => a - b))
    }
  })

  it('never puts the same record in a batch twice', () => {
    // A self-pair that concatenated a chunk with itself would ask the model
    // whether a record relates to itself, which `checkClaim` refuses anyway.
    for (const batch of pairBatches(Array.from({ length: 13 }, (_, i) => i), 4)) {
      expect(new Set(batch).size).toBe(batch.length)
    }
  })
})
