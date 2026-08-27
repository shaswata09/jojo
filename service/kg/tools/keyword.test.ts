/**
 * Tagging, through the store.
 *
 * `tools.test.ts` covers the round trip every tool owes; this is about the pair
 * `keyword.attach` / `keyword.detach`, which have to agree on what they refuse.
 * They did not: attach checked both ends and detach checked neither, and
 * `tx.unlink` writes nothing when the edge is not there, so the two verbs the
 * picker toggles between reported the same input differently.
 *
 * The clock is injected and fixed (D26), and the driver remembers nothing —
 * durability is not what this file is about, but the real repository is,
 * because `ok` is its bookkeeping and a hand-written fake would be testing the
 * fake.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'
import type { NodeId } from '../core/model'

const NOW = '2026-08-25T09:00:00.000Z'

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function world() {
  // A second per read, so ids stay ordered the way `ofType` assumes.
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  const runtime = createToolRuntime({ repo, now })

  const okOr = <T>(out: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] }): T => {
    if (!out.ok) throw new Error(out.errors.map((e) => e.message).join('; '))
    return out.output
  }

  const app = okOr(
    runtime.run('application.create', {
      org: 'UH',
      role: 'Researcher',
      roleTag: 'Researcher',
      stage: 'draft',
    }),
  ) as NodeId
  const keyword = okOr(runtime.run('keyword.create', { name: 'Referral' })) as NodeId

  /** Every node and every edge, order-independent. */
  const graph = () => {
    const m = repo.getSnapshot()
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
    return { nodes: [...m.nodes()].sort(byId), edges: [...m.edges()].sort(byId) }
  }

  return { runtime, repo, graph, app, keyword }
}

/** Well-formed ids that point at nothing — the shape the input schema lets through. */
const GONE_RECORD = 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'
const GONE_KEYWORD = 'kw:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d34'

describe('taking a keyword off a record', () => {
  /*
   * `keyword.detach` checked NEITHER end, and `tx.unlink` stages nothing when
   * the edge is not there — so a detach naming a record or a keyword that is
   * gone came back `ok: true`, with "Referral removed" on the toast and a
   * journal row for a write that never happened. The agent loop reads that `ok`
   * as done and moves on believing the tag was taken off, and a person reading
   * the toast has no way to tell the difference either.
   */
  it('refuses a record that is not here', () => {
    const w = world()
    const before = w.graph()
    const out = w.runtime.run('keyword.detach', { record: GONE_RECORD, keyword: w.keyword })
    expect(out.ok).toBe(false)
    expect(w.graph()).toEqual(before)
  })

  it('refuses a keyword that is not here', () => {
    const w = world()
    const before = w.graph()
    const out = w.runtime.run('keyword.detach', { record: w.app, keyword: GONE_KEYWORD })
    expect(out.ok).toBe(false)
    expect(w.graph()).toEqual(before)
  })

  /**
   * The half that must NOT change.
   *
   * Both ends real with no edge between them stays a success, because that is
   * the idempotence `attach` has and the picker leans on it: the chip is
   * toggled off from a snapshot that may already be stale. Only the ENDS are
   * checked — checking the edge too would turn a harmless double-tap into an
   * error the user has to read.
   */
  it('accepts a keyword that was not on the record, and writes nothing', () => {
    const w = world()
    const before = w.graph()
    expect(w.runtime.run('keyword.detach', { record: w.app, keyword: w.keyword }).ok).toBe(true)
    expect(w.graph()).toEqual(before)
  })

  it('removes the edge and leaves the keyword, when there is one', () => {
    const w = world()
    expect(w.runtime.run('keyword.attach', { record: w.app, keyword: w.keyword }).ok).toBe(true)
    expect(w.runtime.run('keyword.detach', { record: w.app, keyword: w.keyword }).ok).toBe(true)
    expect(w.repo.getSnapshot().out(w.keyword, 'TAGS')).toHaveLength(0)
    // D15: unlink, never cascade.
    expect(w.repo.getSnapshot().node(w.keyword)).toBeDefined()
  })
})
