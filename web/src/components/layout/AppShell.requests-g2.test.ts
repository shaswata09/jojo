/**
 * Q248 and Q275: opening an application from the board or the table and
 * closing it again keeps the list where it was — the board's scroll, and the
 * table's filter, search and scroll.
 *
 * Opening and closing a record is a navigation ('/applications' ⇄
 * '/applications/rice'). The rules that say it is NOT a new page are pure and
 * held by `lib/links.test.ts` ("gives the list and an open record the same key,
 * so nothing is rebuilt", "keeps the page when a record opens over the list,
 * and when it closes", "keeps every filter the list reads"). What only exists
 * in the shell is that it obeys them — so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import shell from './AppShell.tsx?raw'

describe('Q248 / Q275 — closing a record leaves the list where it was', () => {
  it('does not scroll to the top when the record opened or closed over the same page', () => {
    expect(shell).toMatch(
      /if \(isDesktop && isSamePage\(from, pathname\)\) return\s*window\.scrollTo\(0, 0\)/,
    )
  })

  it('does not rebuild the page under the record, so the columns keep their own scroll', () => {
    expect(shell).toContain('<ErrorBoundary key={pageKey(pathname)}')
  })
})
