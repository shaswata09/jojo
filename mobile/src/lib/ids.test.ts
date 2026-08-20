/**
 * The one rule left in `src/lib/ids.ts`, and the seam it has to meet.
 *
 * This file has no ancestor: mobile's `ids.ts` had never been tested, and it
 * carried three functions with no caller — `parseRef`, `uniqueId` and a
 * `slugify` — each a second spelling of one in `@jojo/service/core/ref`. They
 * are deleted; what is left is `refKey`, and what is worth pinning about it is
 * not its own arithmetic but the fact that the thing on the far side of the
 * seam still unwraps what it produces.
 *
 * `recordKey` is imported here on purpose rather than reimplemented. The pair
 * is one contract written in two packages, and the failure mode is silent: get
 * it wrong and every keyword chip on the board stops finding its record while
 * everything still compiles and renders.
 */

import { describe, expect, it } from 'vitest'
import { recordKey } from '@jojo/service/react/use-keywords'
import { refKey } from './ids'

describe('refKey', () => {
  it('joins the kind and the id with a colon', () => {
    expect(refKey('app', 'stripe')).toBe('app:stripe')
    expect(refKey('posting', 'rice')).toBe('posting:rice')
  })

  /**
   * The wrapper is redundant against a type-prefixed id (D4) and `recordKey`
   * exists to strip it — 'app:' + 'app:0192…' is what actually arrives there.
   * This is the round trip five call sites in `screens/` and `sheets/` depend
   * on, asserted across the package boundary rather than described on each side
   * of it.
   */
  it('produces a key recordKey unwraps back to the id it was given', () => {
    const id = 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'

    expect(refKey('app', id)).toBe(`app:${id}`)
    expect(recordKey(refKey('app', id))).toBe(id)
    // And a bare id that was never wrapped goes through untouched, which is the
    // spelling every non-application record uses.
    expect(recordKey(id)).toBe(id)
  })
})
