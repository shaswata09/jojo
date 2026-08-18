/**
 * The write-path guards: what `ctx.tx` refuses, and what `ctx.memory` shows a
 * tool about its own unfinished work.
 *
 * These are the two halves of `runtime.ts` that no tool can be talked into
 * exercising, and that is the point of testing them here. Every tool declares
 * its ids as `s.id('keyword')` and its enums as closed lists, so a badly-formed
 * `tx.link` is rejected by the INPUT schema long before it reaches `EDGE_SCHEMA`
 * — `tools.test.ts`'s "rejects an edge the schema does not allow" is that, and
 * removing the `EDGE_SCHEMA` check from `runtime-tx.ts` left it green. The guard
 * exists for a tool that gets it wrong, so the test has to be one too.
 *
 * Nothing here is a stand-in. `MutableSnapshot`, `overlay`, `newBuffer` and
 * `makeTx` are the production pieces, wired the way `makeContext` wires them;
 * the only test-written function is the two-line `fail` the runtime supplies.
 *
 * Why the guards matter, in one line each: a dangling edge is a row on disk
 * pointing at a missing node, and the boot integrity check rejects the WHOLE
 * graph over one of them — *"1 record on this device could not be read"*, on
 * every launch, forever, with nothing that prunes it. And a transaction that
 * cannot see its own writes mints a second employer for the second application
 * in the same import.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import type { GraphSnapshot } from '../core/snapshot'
import type { Instant, StoredEdge, StoredNode } from '../core/model'
import { ToolFailure } from './tool'
import type { ToolContext, Tx } from './tool'
import { newBuffer } from './runtime-buffer'
import type { Buffer } from './runtime-buffer'
import { overlay } from './runtime-overlay'
import { makeTx } from './runtime-tx'

const AT: Instant = '2026-10-12T15:00:00.000Z'

const app = (id: string, slug: string): StoredNode<'application'> => ({
  id,
  type: 'application',
  props: {
    slug,
    role: 'Assistant professor',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: AT,
  },
  createdAt: AT,
  updatedAt: AT,
})

const org = (id: string, slug: string, name: string): StoredNode<'organisation'> => ({
  id,
  type: 'organisation',
  props: { slug, name },
  createdAt: AT,
  updatedAt: AT,
})

const keyword = (id: string, slug: string, name: string): StoredNode<'keyword'> => ({
  id,
  type: 'keyword',
  props: { slug, name, tone: 'teal' },
  createdAt: AT,
  updatedAt: AT,
})

/**
 * The runtime's own wiring, minus the tool call.
 *
 * `read` rebuilds the overlay on every access exactly as `makeContext` does, so
 * a write staged by one `tx` call is visible to the next — which is the property
 * half of this file is about.
 */
function transaction(...committed: readonly StoredNode[]): {
  buf: Buffer
  tx: Tx
  read: () => GraphSnapshot
  base: MutableSnapshot
} {
  const base = MutableSnapshot.from(committed)
  const buf = newBuffer()
  const read = () => overlay(base, buf)
  const fail: ToolContext['fail'] = (message, opts) => {
    throw new ToolFailure([{ message, ...opts }])
  }
  return { buf, tx: makeTx(read, buf, AT, fail), read, base }
}

/** Every edge the transaction would commit, so "staged nothing" is assertable. */
const stagedEdges = (buf: Buffer): (StoredEdge | null)[] =>
  [...buf.edges.values()].map((c) => c.after)

/* -------------------------------------------------------------------------- */

describe('tx.link refuses what would corrupt the graph', () => {
  /**
   * Both endpoints have to be there. Neither `from` nor `to` may be a guess.
   *
   * Split into two cases rather than one, because a single test that passes two
   * missing ids stays green when only ONE of the two guards is deleted — and the
   * two are separate `if`s that a refactor can drop independently.
   */
  it('refuses an edge FROM a record that is not in the graph', () => {
    const { tx, buf } = transaction(org('org:1', 'rice', 'Rice'))

    expect(() => tx.link('app:missing', 'AT', 'org:1')).toThrow(ToolFailure)
    expect(stagedEdges(buf)).toEqual([])
  })

  it('refuses an edge TO a record that is not in the graph', () => {
    const { tx, buf } = transaction(app('app:1', 'rice'))

    expect(() => tx.link('app:1', 'AT', 'org:missing')).toThrow(ToolFailure)
    expect(stagedEdges(buf)).toEqual([])
  })

  /**
   * `EDGE_SCHEMA` is checked, not assumed from the ids being well-formed.
   *
   * `AT` goes application -> organisation. Both records below exist and both ids
   * parse, so nothing above this line objects; only the schema knows that an
   * organisation is not something an organisation is at.
   */
  it('refuses a relation EDGE_SCHEMA does not allow between two real records', () => {
    const { tx, buf } = transaction(org('org:1', 'rice', 'Rice'), org('org:2', 'smu', 'SMU'))

    expect(() => tx.link('org:1', 'AT', 'org:2')).toThrow(ToolFailure)
    expect(stagedEdges(buf)).toEqual([])
  })

  it('refuses a relation whose TO end is the wrong type', () => {
    const { tx, buf } = transaction(app('app:1', 'rice'), keyword('kw:1', 'referral', 'Referral'))

    // TAGS is keyword -> record, so an application tagging a keyword is backwards.
    expect(() => tx.link('app:1', 'TAGS', 'kw:1')).toThrow(ToolFailure)
    expect(stagedEdges(buf)).toEqual([])
  })

  /** The happy path, so the four refusals above are refusals and not a broken fixture. */
  it('writes the edge when both ends exist and the schema allows it', () => {
    const { tx, buf } = transaction(app('app:1', 'rice'), org('org:1', 'rice', 'Rice'))

    const id = tx.link('app:1', 'AT', 'org:1')

    expect(id).toBe('app:1|AT|org:1')
    expect(stagedEdges(buf)).toEqual([
      { id, rel: 'AT', from: 'app:1', to: 'org:1', props: {}, createdAt: AT },
    ])
  })
})

describe('tx.unlink', () => {
  /**
   * An edge that is not there stages nothing at all.
   *
   * Staging it anyway would write a `before: null -> after: null` delta, and
   * `repository.opsFor` turns every edge delta into a durable op — a DELETE for
   * a row that never existed, in a journal entry the audit log renders as a
   * change. `deltas` in `runtime.ts` drops null-to-null pairs, so the phantom
   * would be invisible in the changed set and visible on disk.
   */
  it('stages nothing when the edge is not there', () => {
    const { tx, buf } = transaction(app('app:1', 'rice'), org('org:1', 'rice', 'Rice'))

    tx.unlink('app:1', 'AT', 'org:1')

    expect(buf.edges.size).toBe(0)
  })

  it('stages a removal when the edge is there', () => {
    const { tx, buf } = transaction(app('app:1', 'rice'), org('org:1', 'rice', 'Rice'))
    tx.link('app:1', 'AT', 'org:1')

    tx.unlink('app:1', 'AT', 'org:1')

    expect(stagedEdges(buf)).toEqual([null])
  })
})

describe('the overlay shows a transaction its own writes', () => {
  /**
   * `bySlug` reads the buffer BEFORE the committed store.
   *
   * No tool reaches this today — `org.ensure` matches on the folded name over
   * `ofType`, which is the sibling case below — but `runtime-overlay.ts` states
   * the rule for every lookup, and route resolution by slug is the one read that
   * `validate.ts`'s unique `[type, slug]` index depends on being single-valued.
   */
  it('answers bySlug with a node created in this transaction', () => {
    const { tx, read } = transaction()
    tx.put(org('org:new', 'rice', 'Rice'))

    expect(read().bySlug('organisation', 'rice')?.id).toBe('org:new')
  })

  it('answers bySlug with the rename, not the committed slug', () => {
    const { tx, read } = transaction(org('org:1', 'rice', 'Rice'))
    tx.patch<'organisation'>('org:1', { slug: 'rice-university' })

    expect(read().bySlug('organisation', 'rice-university')?.id).toBe('org:1')
    // The old slug is free again, or a rename followed by a create in one
    // transaction would find the renamed record under a name it no longer has.
    expect(read().bySlug('organisation', 'rice')).toBeUndefined()
  })

  it('does not answer bySlug with a record this transaction deleted', () => {
    const { tx, read } = transaction(org('org:1', 'rice', 'Rice'))
    tx.del('org:1')

    expect(read().bySlug('organisation', 'rice')).toBeUndefined()
  })

  /**
   * `ofType` includes staged nodes, and this is the one the app depends on.
   *
   * `memory.reset` links every application to `ctx.call('org.ensure', …)` inside
   * ONE transaction, and `org.ensure` looks for an existing employer by folding
   * the names it finds in `ofType('organisation')`. Without the staged half,
   * importing a backup with two jobs at one employer produces two Rices — and
   * the recovery path is the last place a silent duplicate should appear.
   */
  it('includes staged nodes in ofType, so a second lookup finds the first write', () => {
    const { tx, read } = transaction(org('org:1', 'smu', 'SMU'))
    tx.put(org('org:new', 'rice', 'Rice'))

    expect(
      read()
        .ofType('organisation')
        .map((n) => n.props.name),
    ).toEqual(['SMU', 'Rice'])
    expect(read().keywordNamed('Referral')).toBeUndefined()
  })

  /**
   * Id-ascending, which under UUIDv7 is creation order (D4).
   *
   * The property that let `application/restore` drop its hand-kept `at` index:
   * a restored record lands back where it was because its id says when it was
   * made. A staged node appended in write order is right by accident on a fresh
   * store and wrong the moment two writes interleave.
   */
  it('sorts ofType id-ascending across committed and staged nodes alike', () => {
    const { tx, read } = transaction(org('org:2', 'b', 'B'), org('org:4', 'd', 'D'))
    tx.put(org('org:3', 'c', 'C'))
    tx.put(org('org:1', 'a', 'A'))

    expect(
      read()
        .ofType('organisation')
        .map((n) => n.id),
    ).toEqual(['org:1', 'org:2', 'org:3', 'org:4'])
  })

  it('finds a keyword staged in this transaction by its folded name', () => {
    const { tx, read } = transaction()
    tx.put(keyword('kw:new', 'referral', 'Referral'))

    expect(read().keywordNamed('  REFERRAL ')?.id).toBe('kw:new')
  })
})
