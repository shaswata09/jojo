/**
 * The demo fixtures, as `memory.reset` actually compiles them.
 *
 * `repo/seed.ts` has its own compiler and its own test, and that one resolves
 * every reference through a slug table it builds itself. This file covers the
 * OTHER path — the tool — which builds no table: it asks the transaction for an
 * employer (`org.ensure`) and for a slug (`ctx.mintSlug`) once per application,
 * inside ONE transaction, and both answers depend on a read seeing what that
 * same transaction has already staged and not yet committed.
 *
 * These assertions live here rather than beside the tools because they are
 * unobservable unless two fixtures share an employer, and that is a fact about
 * `src/data/seed.ts`. Before the second Rice row existed, all twelve employers
 * in the seed were distinct, so the twelve-iteration loop that `memory.reset`
 * runs on every demo load never once exercised the repeat case — the whole
 * suite could not tell a working overlay from a broken one.
 *
 * Verified by mutation, so that the protection is a measurement and not a
 * claim. Against `runtime-overlay.ofType` with `const added = []` — the line
 * that makes a staged node visible to the rest of its own transaction — the
 * employer count fails: twelve organisations for eleven employers. Against
 * that AND `runtime.mintSlug` dropping `buf.minted` from `taken`, the slug
 * assertion fails too: two applications named 'rice'. Neither of those two
 * lines is pinned by anything else in the suite; the second is only reachable
 * in combination, which is why both assertions are here rather than one.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '@/kg/core/snapshot'
import type { StoredNode } from '@/kg/core/model'
import { createRepository } from '@/kg/repo/repository'
import { TOOLS } from '@/kg/tools/index'
import { createToolRuntime } from '@/kg/tools/runtime'
import { applications } from './seed'

type Options = Parameters<typeof createRepository>[0]

/** Accepts everything, remembers nothing — durability is not what this asserts. */
const nullDriver = (): Options['driver'] => ({
  open: async () => ({ ok: true, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true, value: undefined }),
  replace: async () => ({ ok: true, value: undefined }),
  seedIfPristine: async () => ({ ok: true, value: true }),
  destroy: async () => ({ ok: true, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

const START = Date.parse('2026-10-12T15:00:00.000Z')

function reset() {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver(),
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
    },
    now,
  })
  const result = createToolRuntime({ repo, now }).run('memory.reset', {})
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return repo.getSnapshot()
}

const slugsOf = (nodes: readonly StoredNode[]) =>
  nodes.map((n) => (n.props as { slug?: string }).slug ?? '')

const employers = new Set(applications.map((a) => a.org))

describe('the demo fixtures', () => {
  it('put two applications at one employer', () => {
    // The premise of both assertions below, stated on its own so that deleting
    // the duplicate fails HERE — with a sentence saying why it mattered —
    // instead of quietly turning the two tests that follow into no-ops.
    expect(employers.size).toBeLessThan(applications.length)
  })

  it('is registered under a name the runtime knows', () => {
    // `run` returns a typed failure for an unknown tool rather than throwing,
    // and `reset()` below turns any failure into the same thrown Error — so a
    // renamed tool would read as a broken overlay. Separated so it cannot.
    expect(Object.keys(TOOLS)).toContain('memory.reset')
  })
})

describe('memory.reset', () => {
  it('mints one organisation per employer, not one per application', () => {
    // `org.ensure` scans `ctx.memory.ofType('organisation')` for the folded
    // name. The first Rice organisation is staged, not committed, when the
    // second Rice application asks for it — so this passes only while the
    // overlay's `ofType` returns staged nodes alongside committed ones.
    const g = reset()
    expect(g.ofType('organisation')).toHaveLength(employers.size)
    expect(g.ofType('application')).toHaveLength(applications.length)
  })

  it('gives the two applications at one employer distinct slugs', () => {
    // Application slugs are minted from the EMPLOYER name, so the shared
    // employer is the only row pair in the seed that can collide. Asserted as
    // a prefix rather than as 'rice'/'rice-2' because `buf.minted` is shared
    // across node types — the organisation named Rice takes a number out of the
    // same sequence, and pinning the exact suffix would pin that accident.
    const g = reset()
    const slugs = slugsOf(g.ofType('application') as StoredNode[])
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs.filter((s) => s === 'rice' || s.startsWith('rice-'))).toHaveLength(2)
  })
})
