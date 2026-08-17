/**
 * One overflow-menu item class, spelled once.
 *
 * Six copies of this string existed across the app and two of them had lost
 * `cursor-pointer` — so the applications table and the application detail page,
 * the two longest-lived lists in the product, were the places where a ⋯ item
 * did not look clickable. Nothing caught it because every copy was *plausible*:
 * a class list is prose to a compiler.
 *
 * So this asserts the thing the type system cannot: the token appears in
 * exactly one file, and it carries the cursor. Extend it with `cn()`; a second
 * literal fails here.
 */

import { describe, expect, it } from 'vitest'
import { menuItemClass } from './RowMenu'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * The middle of the class list, without the leading and trailing utilities.
 *
 * Matching on a fragment rather than on the whole string is the point: the two
 * broken copies differed from the good one by a single token, so a whole-string
 * search would have reported them as different strings and found nothing.
 */
const FINGERPRINT = 'rounded-sm px-1.5 py-1.5 text-xs text-text-2 transition-colors'

describe('the popover item class', () => {
  it('is declared in exactly one file', () => {
    const declaring = Object.keys(sources)
      .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .filter((path) => sources[path]!.includes(FINGERPRINT))
      .sort()

    expect(declaring).toEqual(['/src/components/common/RowMenu.tsx'])
  })

  it('is scanning the whole of src, not one folder', () => {
    // The glob is absolute for this reason: written relative to this file it
    // covered `components/` only, and the two copies that had drifted were the
    // ones a components-only scan would have found by luck rather than by
    // construction.
    expect(Object.keys(sources).length).toBeGreaterThan(300)
  })

  it('carries the cursor, which is what two of the six copies had lost', () => {
    expect(menuItemClass).toContain('cursor-pointer')
  })

  it('is looking for a fingerprint that is actually in the class', () => {
    // Guards the guard: a fingerprint that matched nothing would make the
    // first assertion pass against any number of copies.
    expect(menuItemClass).toContain(FINGERPRINT)
  })
})
