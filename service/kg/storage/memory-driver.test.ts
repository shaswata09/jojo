/**
 * The in-memory driver has to be a stand-in for IndexedDB, not a Map.
 *
 * Every test here pins a property the real driver has that a naive Map does not.
 * They are the reason Wave 2 can be a swap: a bug that only IndexedDB's
 * structured clone or key ordering would have exposed fails here first.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryDriver } from './memory-driver'
import type { DurableOp } from './driver'

const put = (store: DurableOp['store'], key: string | number, value: object): DurableOp => ({
  kind: 'put',
  store,
  key,
  value: value as Record<string, unknown>,
})

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

describe('createMemoryDriver', () => {
  it('opens, commits and reads back', async () => {
    const driver = createMemoryDriver()
    expect(unwrap(await driver.open())).toEqual({
      version: 1,
      from: 1,
      migrated: [],
      // A Map in this process reaches no other tab, and the layer above has to
      // be told rather than assume — see `nullChannel`.
      crossTab: false,
    })

    await driver.commit([put('nodes', 'app:1', { id: 'app:1', type: 'application' })])
    const rows = unwrap(await driver.readAll())

    expect(rows.nodes).toEqual([{ id: 'app:1', type: 'application' }])
    expect(rows.edges).toEqual([])
  })

  // Handing back the caller's own object would make a snapshot that mutated a
  // stored node in place look correct in every test and fail on the first real
  // write, where IndexedDB's structured clone breaks the aliasing.
  it('clones on the way in, so a later mutation does not reach the store', async () => {
    const driver = createMemoryDriver()
    const node = { id: 'app:1', props: { role: 'CS' } }

    await driver.commit([put('nodes', 'app:1', node)])
    node.props.role = 'ECE'

    expect(unwrap(await driver.readAll()).nodes[0]).toEqual({ id: 'app:1', props: { role: 'CS' } })
  })

  it('clones on the way out, so a reader cannot edit the store by accident', async () => {
    const driver = createMemoryDriver()
    await driver.commit([put('nodes', 'app:1', { id: 'app:1', props: { role: 'CS' } })])

    const first = unwrap(await driver.readAll()).nodes[0] as { props: { role: string } }
    first.props.role = 'ECE'

    expect(unwrap(await driver.readAll()).nodes[0]).toEqual({ id: 'app:1', props: { role: 'CS' } })
  })

  // `getAll` returns ascending key order and the snapshot reads "id-ascending =
  // creation order" straight out of it. Insertion order would have given the
  // right answer for the wrong reason and changed it on the swap to IndexedDB.
  it('reads each store back in ascending key order, not insertion order', async () => {
    const driver = createMemoryDriver()
    await driver.commit([
      put('nodes', 'app:c', { id: 'app:c' }),
      put('nodes', 'app:a', { id: 'app:a' }),
      put('nodes', 'app:b', { id: 'app:b' }),
    ])

    expect(unwrap(await driver.readAll()).nodes.map((n) => n['id'])).toEqual([
      'app:a',
      'app:b',
      'app:c',
    ])
  })

  // The audit log is read as a sequence. String-comparing numeric keys puts
  // entry 10 before entry 2 and makes the history read backwards.
  it('orders numeric keys numerically', async () => {
    const driver = createMemoryDriver()
    await driver.commit([put('ops', 10, { label: 'tenth' }), put('ops', 2, { label: 'second' })])

    expect(unwrap(await driver.readAll()).ops.map((o) => o['label'])).toEqual(['second', 'tenth'])
  })

  it('applies deletes and clears inside the same commit', async () => {
    const driver = createMemoryDriver()
    await driver.commit([put('nodes', 'a', { id: 'a' }), put('nodes', 'b', { id: 'b' })])
    await driver.commit([
      { kind: 'delete', store: 'nodes', key: 'a' },
      put('edges', 'a|AT|b', { id: 'a|AT|b' }),
    ])

    const rows = unwrap(await driver.readAll())
    expect(rows.nodes.map((n) => n['id'])).toEqual(['b'])
    expect(rows.edges).toHaveLength(1)

    await driver.commit([{ kind: 'clear', store: 'edges' }])
    expect(unwrap(await driver.readAll()).edges).toEqual([])
  })

  // One transaction over all four stores means all of it lands or none of it
  // does. A half-applied batch is a state the journal has no entry for.
  it('leaves the store untouched when a commit fails', async () => {
    let armed = false
    const driver = createMemoryDriver({
      fault: (call) =>
        armed && call === 'commit' ? { code: 'storage/quota', message: 'the disk is full' } : null,
    })

    await driver.commit([put('nodes', 'a', { id: 'a' })])
    armed = true
    const result = await driver.commit([
      put('nodes', 'b', { id: 'b' }),
      { kind: 'delete', store: 'nodes', key: 'a' },
    ])

    expect(result.ok).toBe(false)
    expect(unwrap(await driver.readAll()).nodes.map((n) => n['id'])).toEqual(['a'])
  })

  /**
   * R-11, driven rather than described.
   *
   * An impatient reload during a slow first boot — or simply two tabs opened at
   * once on a fresh install — gives two seeders that both read "no meta" and
   * both write. The result is 182 nodes with every record doubled through the
   * slug minter as `rice-2`, `rice-3`, and no way to tell which of each pair the
   * user then edited. The emptiness test therefore has to happen inside the
   * transaction that does the writing, which is why `seedIfPristine` is a driver
   * method and not a `readAll` followed by a `replace`.
   *
   * Both calls are started before either is awaited, so a version that read the
   * meta store, awaited anything, and then wrote would lose the race here. In
   * this driver "the transaction" is precisely that there is no await between
   * the two — and this file is the only place that fact is checked, for the
   * driver every test in the suite runs against and the one the app falls back
   * to when storage is blocked.
   */
  it('seeds once when two seeders race, and tells the loser it lost — R-11', async () => {
    const driver = createMemoryDriver()
    const seed = (marker: string) => ({
      nodes: [{ id: `app:${marker}` }],
      edges: [],
      meta: [{ key: 'store', value: { dataSet: 'demo', seededAt: marker } }],
      ops: [],
    })

    const [first, second] = await Promise.all([
      driver.seedIfPristine(seed('one')),
      driver.seedIfPristine(seed('two')),
    ])

    // One `true`, one `false`, in either order: `false` is a normal outcome and
    // not a failure — it means somebody else got there first.
    expect([unwrap(first), unwrap(second)].sort()).toEqual([false, true])
    expect(driver.counts().nodes).toBe(1)
    expect(driver.counts().meta).toBe(1)

    // And the loser's rows are nowhere: a seed that appended instead of
    // no-opping is the doubled store, one record at a time.
    const rows = unwrap(await driver.readAll())
    const marker = (rows.meta[0]?.['value'] as { seededAt?: string } | undefined)?.seededAt
    expect(marker === 'one' || marker === 'two').toBe(true)
    // The winner's meta row and the winner's nodes, never one of each: the two
    // go in under the same `stores` swap or neither does.
    expect(rows.nodes).toEqual([{ id: `app:${marker}` }])
  })

  // D24: first run is the ABSENCE of the meta row, never "the node store is
  // empty". A driver that tested `nodes` would reseed the demo fixtures over
  // Settings → Records → Empty on every reload, which makes the button
  // impossible to use — and it would do it below `boot`, where the decision has
  // already been made correctly.
  it('reads meta, not the node store, to decide a store is pristine', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [],
        edges: [],
        meta: [{ key: 'store', value: { dataSet: 'empty' } }],
        ops: [],
      },
    })

    const seeded = await driver.seedIfPristine({
      nodes: [{ id: 'app:1' }],
      edges: [],
      meta: [{ key: 'store', value: { dataSet: 'demo' } }],
      ops: [],
    })

    expect(unwrap(seeded)).toBe(false)
    expect(driver.counts().nodes).toBe(0)
    expect(unwrap(await driver.readAll()).meta).toEqual([
      { key: 'store', value: { dataSet: 'empty' } },
    ])
  })

  it('replaces wholesale and destroys everything', async () => {
    const driver = createMemoryDriver()
    await driver.commit([put('nodes', 'a', { id: 'a' })])

    await driver.replace({
      nodes: [{ id: 'z' }],
      edges: [],
      meta: [{ key: 'store', value: 1 }],
      ops: [],
    })
    expect(driver.counts()).toEqual({ nodes: 1, edges: 0, meta: 1, ops: 0 })
    expect(unwrap(await driver.readAll()).nodes.map((n) => n['id'])).toEqual(['z'])

    await driver.destroy()
    expect(driver.counts()).toEqual({ nodes: 0, edges: 0, meta: 0, ops: 0 })
  })

  // A tab that closed its connection so another could upgrade, then carried on
  // writing, is the bug the `blocking` handler exists to catch. IndexedDB throws
  // InvalidStateError; a fallback that kept serving would be more permissive
  // than the thing it stands in for.
  it('refuses every call once closed', async () => {
    const driver = createMemoryDriver()
    driver.close()

    for (const result of [
      await driver.open(),
      await driver.readAll(),
      await driver.commit([]),
      await driver.destroy(),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('storage/unavailable')
    }
  })

  it('starts from rows it was handed, keyed by the id inside each row', async () => {
    const driver = createMemoryDriver({
      rows: {
        nodes: [{ id: 'app:2' }, { id: 'app:1' }],
        meta: [{ key: 'store', value: { a: 1 } }],
      },
    })

    const rows = unwrap(await driver.readAll())
    expect(rows.nodes.map((n) => n['id'])).toEqual(['app:1', 'app:2'])
    expect(rows.meta).toEqual([{ key: 'store', value: { a: 1 } }])
  })

  // Both unsubscribes are exercised, not just the remote one. `onBlocking`'s is
  // the half `driver-conformance.test.ts` cannot reach — provoking a blocking
  // event means a second connection upgrading a schema, and this driver has no
  // schema — so it is pinned here instead.
  it('delivers remote commits and blocking to their subscribers, and stops on unsubscribe', () => {
    const driver = createMemoryDriver()
    const seen: string[] = []

    const offRemote = driver.onRemoteCommit((e) => seen.push(`remote:${e.entryId}`))
    const offBlocking = driver.onBlocking(() => seen.push('blocking'))

    driver.emitRemoteCommit({ kind: 'commit', at: '2026-10-12T00:00:00.000Z', entryId: 'e1' })
    driver.emitBlocking()
    offRemote()
    offBlocking()
    driver.emitRemoteCommit({ kind: 'commit', at: '2026-10-12T00:00:00.000Z', entryId: 'e2' })
    driver.emitBlocking()

    expect(seen).toEqual(['remote:e1', 'blocking'])
  })
})
