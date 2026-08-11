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

  it('delivers remote commits and blocking to their subscribers', () => {
    const driver = createMemoryDriver()
    const seen: string[] = []

    const offRemote = driver.onRemoteCommit((e) => seen.push(`remote:${e.entryId}`))
    driver.onBlocking(() => seen.push('blocking'))

    driver.emitRemoteCommit({ kind: 'commit', at: '2026-10-12T00:00:00.000Z', entryId: 'e1' })
    driver.emitBlocking()
    offRemote()
    driver.emitRemoteCommit({ kind: 'commit', at: '2026-10-12T00:00:00.000Z', entryId: 'e2' })

    expect(seen).toEqual(['remote:e1', 'blocking'])
  })
})
