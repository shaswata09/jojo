/**
 * The display order and the vocabulary, kept in step.
 *
 * A kind added to `BACKGROUND_KINDS` and forgotten in `BACKGROUND_ORDER` is
 * rendered by nothing: the entries exist in the graph, count towards the fit
 * score, and appear on no screen — so they cannot be seen, checked or deleted.
 * That is the same shape of silent loss the seven-kind vocabulary hid for as
 * long as it did, which is why this is a test and not a comment.
 *
 * `BACKGROUND_LABEL` needs no test of its own: it is an exhaustive
 * `Record<BackgroundKind, string>` and the compiler refuses a missing key.
 * Nothing checks an order at compile time, which is why only that half is here.
 */

import { describe, expect, it } from 'vitest'
import { BACKGROUND_KINDS, BACKGROUND_LABEL, BACKGROUND_ORDER } from './model'

describe('the order a background reads in', () => {
  it('covers every kind exactly once', () => {
    expect([...BACKGROUND_ORDER].sort()).toEqual([...BACKGROUND_KINDS].sort())
    expect(new Set(BACKGROUND_ORDER).size).toBe(BACKGROUND_ORDER.length)
  })

  it('opens the way a CV does, not the way the list was extended', () => {
    // Declaration order is the order kinds were added over time; this is the
    // order a reader expects. They are deliberately different, and a change
    // that accidentally made them the same would be a regression nobody sees.
    expect(BACKGROUND_ORDER.slice(0, 3)).toEqual(['education', 'employment', 'publication'])
    expect([...BACKGROUND_ORDER]).not.toEqual([...BACKGROUND_KINDS])
  })

  it('names every kind', () => {
    for (const kind of BACKGROUND_KINDS) expect(BACKGROUND_LABEL[kind].length).toBeGreaterThan(0)
  })
})
