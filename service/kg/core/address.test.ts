/**
 * The URL segment, which is the one identifier the user gets to keep.
 *
 * Everything else in the model can be re-minted between sessions. A bookmark
 * cannot, so the tests below pin the two directions of the round trip and the
 * two ways it is allowed to fail: a key naming nothing, and a key naming the
 * wrong kind of record.
 */

import { describe, expect, it } from 'vitest'
import { addressOf, resolveAddress } from './address'
import type { NodePropsByType, NodeType, StoredNode } from './model'
import { newNodeId } from './ref'
import { MutableSnapshot } from './snapshot'

const NOW = '2026-10-12T09:14:22.311Z'
let clock = Date.UTC(2026, 9, 12)

function node<T extends NodeType>(type: T, props: NodePropsByType[T]): StoredNode<T> {
  clock += 1
  return {
    id: newNodeId(type, clock),
    type,
    props,
    createdAt: NOW,
    updatedAt: NOW,
  } as StoredNode<T>
}

const application = (slug: string) =>
  node('application', {
    slug,
    role: 'CS',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: NOW,
  })

const posting = (slug: string) =>
  node('posting', {
    slug,
    title: slug,
    url: 'https://example.com',
    savedOn: '2026-10-01',
    size: '—',
  })

describe('addressOf', () => {
  it('prefers the slug, which is what a builder puts in a path', () => {
    const app = application('rice')
    expect(addressOf({ id: app.id, slug: app.props.slug })).toBe('rice')
  })

  /**
   * The `src/data` fixtures type as `Application` and carry no `slug` — their
   * `id` field is the slug, which is exactly what `repo/seed.ts` compiles it
   * into. So the fallback is a true statement about those rows rather than a
   * degraded one, and a fixture addressed by its id is addressed by its slug.
   */
  it('falls back to the id for a record with no slug of its own', () => {
    expect(addressOf({ id: 'baylor' })).toBe('baylor')
  })
})

describe('resolveAddress', () => {
  it('resolves the slug a link was built from', () => {
    const app = application('rice')
    const g = MutableSnapshot.from([app])

    expect(resolveAddress(g, 'application', 'rice')).toBe(app)
  })

  /**
   * The whole reason the id branch survives: someone has one of these open in a
   * tab right now, and it still resolves for as long as the session that minted
   * it is alive.
   */
  it('still resolves a NodeId, so links built before the slug landed do not 404', () => {
    const app = application('rice')
    const g = MutableSnapshot.from([app])

    expect(resolveAddress(g, 'application', app.id)).toBe(app)
  })

  /**
   * Six seeded records answer to 'stripe'. A resolver that guessed between them
   * is the bug the type prefix and the unique [type, slug] index exist to make
   * impossible — so it is asserted here rather than assumed.
   */
  it('refuses a slug and an id that belong to another type', () => {
    const app = application('stripe')
    const saved = posting('stripe')
    const g = MutableSnapshot.from([app, saved])

    expect(resolveAddress(g, 'application', 'stripe')).toBe(app)
    expect(resolveAddress(g, 'posting', 'stripe')).toBe(saved)
    expect(resolveAddress(g, 'application', saved.id)).toBeUndefined()
  })

  // A bookmark to a deleted record. `undefined` is what the detail route renders
  // its empty state from, so the distinction has to survive.
  it('returns undefined for a key that names nothing', () => {
    const g = MutableSnapshot.from([application('rice')])

    expect(resolveAddress(g, 'application', 'nonesuch')).toBeUndefined()
    expect(resolveAddress(g, 'application', 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33')).toBe(
      undefined,
    )
  })

  // The round trip, stated as one line, because it is the property everything
  // above is really about.
  it('round-trips every application in a store', () => {
    const nodes = [application('rice'), application('baylor'), application('unt-2')]
    const g = MutableSnapshot.from(nodes)

    for (const n of nodes) {
      const key = addressOf({ id: n.id, slug: n.props.slug })
      expect(resolveAddress(g, 'application', key)).toBe(n)
    }
  })
})
