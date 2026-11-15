/**
 * Q089: the membership rule the application page reads through. The records
 * themselves, written by the tools and carried across a reopen, are
 * `kg/react/use-vault.requests.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { filedUnder } from './filed-under'

describe('filedUnder', () => {
  it('finds a record by any of its application tags, not just the first', () => {
    const rows = [
      { id: 'one', applicationIds: ['app-2', 'app-1'] },
      { id: 'two', applicationIds: ['app-2'] },
      { id: 'three', applicationIds: [] },
    ]
    expect(filedUnder(rows, 'app-1').map((r) => r.id)).toEqual(['one'])
    expect(filedUnder(rows, 'app-2').map((r) => r.id)).toEqual(['one', 'two'])
    expect(filedUnder(rows, 'app-3')).toEqual([])
  })
})
