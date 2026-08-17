/**
 * The one rule left in `src/lib/ids.ts`, plus the agreement that outlived it.
 *
 * This file used to characterise `parseRef`, `uniqueId` and `slugify` — "what
 * identity does TODAY, pinned before the graph layer replaces it". The graph
 * layer replaced it: `kg/core/ref.ts` owns ids now, `parseNodeId` rejects the
 * bare key that `parseRef` guessed at, and `uniqueSlug` is `uniqueId` under its
 * real name with `kg/core/ref.test.ts` running the same four cases against it.
 * The three characterisations went with the functions.
 *
 * The `slugify`/`toLabelId` agreement stayed, and is deliberately imported from
 * `kg/core/ref` rather than through `src/lib/ids`, which no longer re-exports
 * it. It is the only test `toLabelId` has, and the two are still separate
 * spellings of one rule that is read in exports and in the URL.
 */

import { describe, expect, it } from 'vitest'
import { toLabelId } from '@/data/labels'
import { slugify } from '@/kg/core/ref'
import { refKey } from '@/lib/ids'

describe('refKey', () => {
  it('joins the kind and the id with a colon', () => {
    expect(refKey('app', 'stripe')).toBe('app:stripe')
    expect(refKey('posting', 'rice')).toBe('posting:rice')
  })

  /**
   * The wrapper is redundant against a type-prefixed id and `recordKey` in
   * `kg/react/use-keywords.ts` unwraps it. Pinned because that unwrapping is
   * what the eight remaining call sites depend on: change the shape here and
   * every keyword chip on the board silently stops finding its record.
   */
  it('double-prefixes an id that already carries its type, which is what recordKey strips', () => {
    expect(refKey('app', 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33')).toBe(
      'app:app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33',
    )
  })
})

describe('slugify', () => {
  // These two are separate implementations of one rule. They stopped being
  // load-bearing for identity when `addLabel` moved to deduping on the name,
  // but they are still both read in exports and in the URL, and two spellings
  // of one rule is a question nobody should have to answer twice.
  it('agrees with toLabelId, which is the same rule written twice', () => {
    for (const name of ['UT Austin', 'Machine Learning', '  Remote  ', 'C++', 'a  b   c']) {
      expect(slugify(name)).toBe(toLabelId(name))
    }
  })
})
