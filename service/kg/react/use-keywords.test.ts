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
import type { NodePropsByType, NodeType, StoredEdge, StoredNode } from '../core/model'
import { edgeId, newNodeId } from '../core/ref'
import { MutableSnapshot } from '../core/snapshot'
import { recordKey, sameTagging, tagIndexOf } from './use-keywords'
import { removalOf } from './use-vault'

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

/*
 * The tagging index, and the identity it lends `useKeywords`' helpers.
 *
 * The helpers used to depend on `graph`, a new object on every commit, so the
 * labels context changed on every commit and twenty consumers re-rendered for
 * a sticky note. The index keeps its identity exactly while the tags are the
 * same, which is what has to hold in both directions: a stale index after a
 * re-tag would show the wrong chips, and that is worse than the re-render.
 */
describe('tagIndexOf and sameTagging', () => {
  const NOW = '2026-11-14T09:00:00.000Z'
  let clock = Date.UTC(2026, 10, 14)
  const node = <T extends NodeType>(type: T, props: NodePropsByType[T]): StoredNode<T> => {
    clock += 1
    return { id: newNodeId(type, clock), type, props, createdAt: NOW, updatedAt: NOW } as StoredNode<T>
  }
  const tag = (from: StoredNode, to: StoredNode): StoredEdge => ({
    id: edgeId(from.id, 'TAGS', to.id),
    rel: 'TAGS',
    from: from.id,
    to: to.id,
    props: {},
    createdAt: NOW,
  })
  const keyword = (name: string) => node('keyword', { slug: name, name, tone: 'teal' })
  const note = () => node('stickyNote', { text: 'call Rice' } as NodePropsByType['stickyNote'])

  const referral = keyword('referral')
  const remote = keyword('remote')
  const rice = node('organisation', { slug: 'rice', name: 'Rice' })
  const baylor = node('organisation', { slug: 'baylor', name: 'Baylor' })

  it('answers who carries what', () => {
    const g = MutableSnapshot.from([referral, remote, rice, baylor], [tag(referral, rice), tag(remote, rice)])
    const index = tagIndexOf(g)
    expect([...(index.onRecord.get(rice.id) ?? [])].sort()).toEqual([referral.id, remote.id].sort())
    expect(index.onRecord.get(baylor.id)).toBeUndefined()
    expect(index.count.get(referral.id)).toBe(1)
  })

  it('keeps the held index across a commit that touched no tag', () => {
    const g = MutableSnapshot.from([referral, rice], [tag(referral, rice)])
    const held = tagIndexOf(g)
    g.putNode(note())
    expect(sameTagging(held, tagIndexOf(g))).toBe(held)
  })

  it('lets a re-tag through, even one that keeps every count the same', () => {
    const g = MutableSnapshot.from([referral, rice, baylor], [tag(referral, rice)])
    const held = tagIndexOf(g)
    g.removeEdge(edgeId(referral.id, 'TAGS', rice.id))
    g.putEdge(tag(referral, baylor))
    const next = sameTagging(held, tagIndexOf(g))
    expect(next).not.toBe(held)
    expect(next.onRecord.get(baylor.id)?.has(referral.id)).toBe(true)
    expect(next.onRecord.get(rice.id)).toBeUndefined()
  })

  it('tells a tag moved between keywords from the same tag left alone', () => {
    const g = MutableSnapshot.from([referral, remote, rice], [tag(referral, rice)])
    const held = tagIndexOf(g)
    g.removeEdge(edgeId(referral.id, 'TAGS', rice.id))
    g.putEdge(tag(remote, rice))
    expect(sameTagging(held, tagIndexOf(g))).not.toBe(held)
  })
})

/*
 * The one shape every delete returns — `removeLabel` here and every `remove*`
 * in `use-vault.ts`. Most of them returned only `{ restore }`, so a refused
 * delete still toasted "deleted" with an Undo that did nothing.
 */
describe('removalOf', () => {
  it('carries the refusal, and an undo that does nothing, when the tool said no', () => {
    const removal = removalOf({ ok: false, errors: [{ path: 'id', message: 'No such keyword.' }] } as never)
    expect(removal.ok).toBe(false)
    expect(removal.refusal).toBe('No such keyword.')
    expect(() => removal.restore()).not.toThrow()
  })

  it("hands back the tool's own undo when it ran", () => {
    let undone = false
    const undo = () => {
      undone = true
      return 'undone' as const
    }
    const removal = removalOf({ ok: true, undo } as never)
    expect(removal.ok).toBe(true)
    expect(removal.refusal).toBeUndefined()
    removal.restore()
    expect(undone).toBe(true)
  })
})
