/**
 * The shared `Driver` contract, over this app's driver.
 *
 * The contract is `@jojo/service/storage/driver-conformance` and names no
 * driver; this file is the half that does, and after the fork was deleted it is
 * the only test in this package that covers code no other package has. That is
 * the whole argument for it existing in this commit rather than the next one:
 * `rn-driver.ts` is now the single platform-specific file in `mobile/src/kg`,
 * and the file that used to cover it went out with the other 78.
 *
 * It replaces a copy of the contract that lived here and was one generation
 * behind — it had never run web's "stores a row by value, keeping an absent key
 * absent and a null null", which was written FOR an AsyncStorage driver and
 * which this driver passes. Getting that case is the point of inverting the
 * subject list rather than maintaining a third copy of it.
 *
 * AsyncStorage is mocked rather than stubbed to a no-op — but that buys less
 * than this comment used to claim, which is why the second half of this file
 * exists. The contract builds one driver per case, uses it and drops it, and
 * `rn-driver` answers every read out of the `MemoryDriver` it wraps, so the
 * disk is never on the answer path: stubbing both `setItem` and `getItem` out
 * entirely still passed all seventeen of the contract's assertions. A driver
 * that persisted nothing and read nothing back was conformant.
 *
 * So the cases below the contract are the ones it has no vocabulary for. They
 * need two driver instances over one store — a relaunch — and the contract may
 * not name a driver, let alone build a second one. Web keeps the same case in
 * the same place, `idb-driver.test.ts`'s "seeds, writes, closes, reopens", for
 * the same reason. This is the one thing `rn-driver.ts` says in its own header
 * that it owns: "getting the rows onto the disk and back".
 *
 * They live in this file rather than a `rn-driver.test.ts` beside it because
 * `check-no-copies.mjs` allows `mobile/src/kg` exactly two files, and the
 * driver plus its test is the right shape for that allowlist to keep enforcing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeDriverConformance } from '@jojo/service/storage/driver-conformance'
import type { DurableOp, Rows } from '@jojo/service/storage/driver'
import { emptyRows } from '@jojo/service/storage/driver'
import type { StoredRow } from '@jojo/service/storage/schema'
import { createRnDriver } from './rn-driver'

/** One string per key, which is all AsyncStorage is. */
const disk = new Map<string, string>()

/**
 * What the next write does instead of writing.
 *
 * A seam rather than a second mock, because `vi.mock` is hoisted and shared by
 * the whole file: the only way to make one call fail is to let the mock ask.
 */
let refuseWrite: Error | null = null

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(disk.get(k) ?? null),
    setItem: (k: string, v: string) => {
      if (refuseWrite) return Promise.reject(refuseWrite)
      disk.set(k, v)
      return Promise.resolve()
    },
    removeItem: (k: string) => {
      disk.delete(k)
      return Promise.resolve()
    },
  },
}))

// The RN driver writes to one fixed key, so two cases in one run would
// otherwise inherit each other's rows.
beforeEach(() => {
  disk.clear()
  refuseWrite = null
})

describeDriverConformance({
  label: 'rn-driver',
  /*
   * There is no second instance of a phone app reading this store — the driver
   * reports `crossTab: false` from `open()` for the same reason — so the
   * contract runs its unsubscribe half here rather than its delivery half. See
   * `DriverSubject.crossTab`.
   */
  crossTab: false,
  make: () => ({
    driver: createRnDriver(),
    remoteCommit: () => {
      throw new Error('rn-driver has no second writer; crossTab is false.')
    },
  }),
})

/* ------------------ what the contract cannot see: a relaunch ---------------- */

const node = (id: string, slug: string): StoredRow => ({
  id,
  type: 'application',
  props: { slug, role: 'Assistant Professor' },
})

const edge = (from: string, rel: string, to: string): StoredRow => ({
  id: `${from}|${rel}|${to}`,
  rel,
  from,
  to,
  props: {},
})

const rowsWith = (overrides: Partial<Rows> = {}): Rows => ({ ...emptyRows(), ...overrides })

/** A journal row as the repository enqueues one: no key, the store allocates. */
const journal = (id: string): DurableOp => ({ kind: 'put', store: 'ops', key: null, value: { id } })

/** Open a driver and fail the test loudly rather than returning a broken one. */
async function opened() {
  const driver = createRnDriver()
  const info = await driver.open()
  expect(info.ok).toBe(true)
  return { driver, info }
}

describe('the round trip through AsyncStorage', () => {
  it('seeds, writes, closes, reopens, and hands back exactly what went in', async () => {
    const { driver: first, info: firstOpen } = await opened()
    // Nothing on disk yet, which is the signal `boot` reads to decide whether
    // this launch is a first run.
    expect(firstOpen.ok && firstOpen.value.from).toBe(0)

    const seeded = await first.seedIfPristine(
      rowsWith({
        nodes: [node('app:1', 'rice'), node('app:2', 'stripe')],
        edges: [edge('kw:1', 'TAGS', 'app:1')],
        meta: [{ key: 'store', value: { dataSet: 'demo', schemaVersion: 1 } }],
      }),
    )
    expect(seeded.ok && seeded.value).toBe(true)
    // The seed is on disk BEFORE anything else is written. Asserted separately
    // because every later commit rewrites the whole document, so a seed that
    // never persisted would be indistinguishable from one that did by the end
    // of this case — and the launch it loses is the one where somebody opens
    // the app, reads it and closes it again.
    expect(disk.size).toBe(1)

    // A write after the seed, because "it survives a relaunch" has to mean the
    // user's OWN edit survives, not just the fixtures the app shipped with.
    const written = await first.commit([
      { kind: 'put', store: 'nodes', key: 'app:3', value: node('app:3', 'figma') },
      { kind: 'put', store: 'edges', key: 'kw:1|TAGS|app:3', value: edge('kw:1', 'TAGS', 'app:3') },
      { kind: 'delete', store: 'nodes', key: 'app:2' },
      journal('entry-1'),
    ])
    expect(written.ok).toBe(true)

    const before = await first.readAll()
    first.close()

    const { driver: second, info: secondOpen } = await opened()
    expect(secondOpen.ok && secondOpen.value.from).toBe(1)
    const after = await second.readAll()
    second.close()

    expect(after.ok).toBe(true)
    if (!before.ok || !after.ok) return

    expect(after.value).toEqual(before.value)
    expect(after.value.nodes.map((r) => r['id'])).toEqual(['app:1', 'app:3'])
    expect(after.value.edges).toHaveLength(2)
    expect(after.value.meta).toHaveLength(1)
    expect(after.value.ops).toHaveLength(1)
  })

  it('keeps the journal key sequence running across a relaunch', async () => {
    const { driver: first } = await opened()
    expect((await first.commit([journal('entry-1'), journal('entry-2')])).ok).toBe(true)
    first.close()

    const { driver: second } = await opened()
    expect((await second.commit([journal('entry-3')])).ok).toBe(true)
    const rows = await second.readAll()
    second.close()

    // An allocator that restarted at 1 on the second launch would overwrite
    // entry 1 and leave the audit log two entries long with a hole in it.
    expect(rows.ok && rows.value.ops.map((r) => r['id'])).toEqual(['entry-1', 'entry-2', 'entry-3'])
  })

  it('empties the disk on destroy, so the next launch is a first run', async () => {
    const { driver } = await opened()
    expect(
      (
        await driver.commit([
          { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice') },
        ])
      ).ok,
    ).toBe(true)
    expect(disk.size).toBe(1)
    expect((await driver.destroy()).ok).toBe(true)
    expect(disk.size).toBe(0)
    driver.close()

    const { info } = await opened()
    expect(info.ok && info.value.from).toBe(0)
  })
})

describe('what it does with a disk that will not cooperate', () => {
  /**
   * The queue's whole degraded path — retry, back off, the persistent banner —
   * keys off the code on this failure. A driver that swallowed the rejection and
   * reported success would leave every one of those mechanisms unreachable on
   * both phone platforms, and the write would be gone with no banner.
   */
  it('reports a refused write as a failure, classified', async () => {
    const { driver } = await opened()
    refuseWrite = Object.assign(new Error('database or disk is full'), {
      name: 'QuotaExceededError',
    })

    const written = await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice') },
    ])
    driver.close()

    expect(written.ok).toBe(false)
    // Not `storage/unavailable`: that is the one code the queue retries, and a
    // full disk retried forever is a spinner instead of a message.
    if (!written.ok) expect(written.error.code).toBe('storage/quota')
  })

  it('treats an unreadable document as nothing yet rather than throwing', async () => {
    // The key is the driver's own, taken from a real write rather than spelled
    // again here: a copy of it would go stale silently and leave this case
    // asserting that an empty store is empty.
    const { driver: seedRun } = await opened()
    await seedRun.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice') },
    ])
    seedRun.close()
    const key = [...disk.keys()][0]
    expect(key).toBeDefined()
    disk.set(key ?? '', '{ this is not JSON')

    const { driver, info } = await opened()
    const rows = await driver.readAll()
    driver.close()

    expect(info.ok && info.value.from).toBe(0)
    expect(rows.ok && rows.value.nodes).toEqual([])
  })
})
