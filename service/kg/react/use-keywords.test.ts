/**
 * `recordKey`, and the fact whose loss silently erased people's keywords.
 *
 * A card spells an application's key `refKey('app', a.id)` — a wrapper from
 * before ids carried their own type prefix — so what arrives is
 * `'app:app:0192…'`. `recordKey` unwraps it. The consequence, and the whole
 * point of this file, is that the wrapped and bare spellings name the **same
 * node**.
 *
 * That was forgotten. `mobile/src/sheets/ApplicationSheet.tsx` wrote the
 * record's keywords with the wrapped key and then called
 * `removeRecord(record.id)` with the bare one, on the belief that the two were
 * different keys and the bare one was a stale duplicate inflating a filter
 * count. They are one node, so the sweep cleared the keywords the line above
 * had just written, and **every edit of an application dropped all of them** —
 * with a "Changes saved" toast on top. Web had fixed its copy in
 * `use-application-writes.ts`; the phone kept the dead line for two releases.
 *
 * `recordKey` had no test of any kind when that was found. This is it: the
 * identity is asserted directly, so anyone who reasons their way back to "these
 * must be two different records" meets a failing test instead of a data-loss
 * bug that reports success.
 */

import { describe, expect, it } from 'vitest'
import { recordKey } from './use-keywords'

/** What `web/src/lib/ids.ts` and `mobile/src/lib/ids.ts` both produce. */
const refKey = (kind: string, id: string) => `${kind}:${id}`

const APP = 'app:0192f3a2-1c4d-7000-8000-000000000001'

describe('recordKey', () => {
  it('resolves the wrapped and the bare spelling to the SAME node', () => {
    // The identity the erasure denied. If these ever differ, a set-then-sweep
    // pair like the one in ApplicationSheet becomes correct again — and it is
    // not, because ids carry their own type prefix now.
    expect(recordKey(refKey('app', APP))).toBe(APP)
    expect(recordKey(APP)).toBe(APP)
    expect(recordKey(refKey('app', APP))).toBe(recordKey(APP))
  })

  it('unwraps every kind a card spells, not just applications', () => {
    const file = 'file:0192f3a2-1c4d-7000-8000-000000000002'
    expect(recordKey(refKey('file', file))).toBe(file)
    expect(recordKey(refKey('anything-at-all', file))).toBe(file)
  })

  it('returns undefined rather than a wrong node for something that is not a key', () => {
    /*
     * `undefined` is the only safe answer: a caller that received a plausible
     * but wrong NodeId would write to a record the user never named. Both
     * halves are read before the guard for a typing reason the source explains.
     */
    expect(recordKey('stripe')).toBeUndefined()
    expect(recordKey('')).toBeUndefined()
    expect(recordKey('app:')).toBeUndefined()
    expect(recordKey('app:not-an-id')).toBeUndefined()
  })

  it('is idempotent, so unwrapping twice cannot reach a different node', () => {
    // Call sites vary in how many wrappers they have already stripped.
    const once = recordKey(refKey('app', APP))!
    expect(recordKey(once)).toBe(once)
  })
})
