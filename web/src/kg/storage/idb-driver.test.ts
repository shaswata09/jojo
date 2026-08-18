/**
 * The tests that matter most in the codebase.
 *
 * Everything else here fails loudly: a wrong projection renders wrong, a broken
 * tool throws. This layer fails silently and permanently — a dropped store, a
 * skipped row, a migration that half-ran — and local-first means the user's
 * IndexedDB is the only copy. There is no server to re-fetch from and no undo
 * that reaches across a reload.
 *
 * `fake-indexeddb/auto` installs a real implementation of the whole API,
 * transactions and key ordering and `blocked` events included, so these are not
 * tests against a mock of the thing being tested.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { nullChannel } from './channel'
import type { Rows, StoreEvent } from '@jojo/service/storage/driver'
import { createIdbDriver } from './idb-driver'
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  pendingMigrations,
  versionOf,
} from '@jojo/service/storage/migrations'
import type { Migration } from '@jojo/service/storage/migrations'
import { STORE_SPECS } from '@jojo/service/storage/schema'
import type { StoredRow } from '@jojo/service/storage/schema'

/**
 * A fresh database per test.
 *
 * A counter rather than a timestamp, because `check-platform.mjs` bans the
 * wall clock in this layer and is right to: a test that reads the clock is a
 * test whose failure depends on when it ran.
 */
let sequence = 0
const nextName = () => `jojo-test-${(sequence += 1)}`

/** No BroadcastChannel unless a test asks for one — Node delivers between them. */
const driverFor = (name: string, migrations?: readonly Migration[]) =>
  createIdbDriver(
    migrations === undefined ? { name, channel: null } : { name, channel: null, migrations },
  )

const node = (id: string, slug: string, role: string): StoredRow => ({
  id,
  type: 'application',
  props: {
    slug,
    role,
    note: '',
    roleTag: 'Research',
    stage: 'Applied',
    lastAction: '',
    lastActionAt: '2026-10-12T12:00:00.000Z',
  },
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
})

const edge = (from: string, rel: string, to: string): StoredRow => ({
  id: `${from}|${rel}|${to}`,
  rel,
  from,
  to,
  props: {},
  createdAt: '2026-10-12T12:00:00.000Z',
})

const rows = (overrides: Partial<Rows> = {}): Rows => ({
  nodes: [],
  edges: [],
  meta: [],
  ops: [],
  ...overrides,
})

/* ------------------------- the contract, under duress --------------------- */

/**
 * "Never throws. Every method returns a Result." — `driver.ts`.
 *
 * That line is what every caller above this layer is written against, and it is
 * load-bearing in a way that is easy to underrate: `boot.ts` does
 * `await driver.open()` with no catch, `store.tsx` sets state from the result,
 * and `StoreGate` renders a skeleton until that state arrives. So a driver that
 * throws instead of returning does not produce an error screen — it produces a
 * grey skeleton that never resolves, under a message about other tabs holding
 * the database that is not true and that closing tabs will never fix.
 *
 * Both shapes below are what a browser does when the origin's storage is
 * blocked by policy, or when the page is a sandboxed iframe without
 * `allow-same-origin`: reading the global throws, and `open()` throws. Neither
 * is a rejected request, which is the only failure the rest of this file
 * exercises.
 */
describe('a platform that refuses IndexedDB by throwing', () => {
  /** Swaps the global, runs, and puts it back whatever happens. */
  async function withIndexedDb<T>(replacement: PropertyDescriptor, run: () => Promise<T>) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, ...replacement })
    try {
      return await run()
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original)
      else Reflect.deleteProperty(globalThis, 'indexedDB')
    }
  }

  it('reports a failure when READING the global throws', async () => {
    const result = await withIndexedDb(
      {
        get() {
          throw new DOMException('Storage is disabled by policy', 'SecurityError')
        },
      },
      // Constructed inside, because `createIdbDriver` mints a channel and the
      // driver must survive being built in this environment too.
      () => driverFor(nextName()).open(),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('storage/unavailable')
  })

  it('reports a failure when open() throws synchronously', async () => {
    const result = await withIndexedDb(
      {
        value: {
          open() {
            throw new DOMException('Storage is disabled by policy', 'SecurityError')
          },
          deleteDatabase() {
            throw new DOMException('Storage is disabled by policy', 'SecurityError')
          },
        },
      },
      () => driverFor(nextName()).open(),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    // `SecurityError` is not one of the named codes, so it takes the default —
    // which is the arm whose recovery is "run in memory and say so", not the
    // one that offers to delete the user's records.
    expect(result.error.code).toBe('storage/unavailable')
  })

  it('reports a failure from destroy() rather than throwing out of it', async () => {
    const result = await withIndexedDb(
      {
        get() {
          throw new DOMException('Storage is disabled by policy', 'SecurityError')
        },
      },
      () => driverFor(nextName()).destroy(),
    )

    expect(result.ok).toBe(false)
  })
})

/* ------------------------------- the schema ------------------------------- */

describe('the layout on disk', () => {
  it('creates all four stores with the indexes the catalogue names', async () => {
    const name = nextName()
    const driver = driverFor(name)

    const open = await driver.open()
    expect(open.ok).toBe(true)
    if (open.ok) {
      expect(open.value.version).toBe(SCHEMA_VERSION)
      expect(open.value.from).toBe(0)
      expect(open.value.migrated).toEqual(['create-stores'])
    }
    driver.close()

    // Read back through the raw API rather than through the driver: the point
    // is what actually landed in the database, and asking the driver would be
    // asking the thing under test to grade itself.
    const raw = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
    })

    expect([...raw.objectStoreNames].sort()).toEqual(['edges', 'meta', 'nodes', 'ops'])

    const tx = raw.transaction([...raw.objectStoreNames], 'readonly')
    for (const spec of STORE_SPECS) {
      const store = tx.objectStore(spec.name)
      expect(store.keyPath).toEqual(spec.keyPath)
      expect([...store.indexNames].sort()).toEqual(spec.indexes.map((i) => i.name).sort())
    }
    raw.close()
  })

  it('leaves the profile row out of the unique [type, slug] index rather than rejecting it', async () => {
    // The sparse-index claim in schema.ts, checked. A profile has no
    // `props.slug`, so it has no key for `by-type-slug` — and if that index were
    // ever made non-sparse, the SECOND profile-shaped row would collide with the
    // first and the write would fail here instead of in production.
    const driver = driverFor(nextName())
    const written = await driver.commit([
      {
        kind: 'put',
        store: 'nodes',
        key: 'profile:1',
        value: {
          id: 'profile:1',
          type: 'profile',
          props: { matchTerms: [] },
          createdAt: 'a',
          updatedAt: 'a',
        },
      },
      {
        kind: 'put',
        store: 'nodes',
        key: 'profile:2',
        value: {
          id: 'profile:2',
          type: 'profile',
          props: { matchTerms: [] },
          createdAt: 'a',
          updatedAt: 'a',
        },
      },
    ])
    expect(written.ok).toBe(true)
    driver.close()
  })

  it('refuses two records of one type sharing a slug', async () => {
    const driver = driverFor(nextName())
    const written = await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'stripe', 'One') },
      { kind: 'put', store: 'nodes', key: 'app:2', value: node('app:2', 'stripe', 'Two') },
    ])
    expect(written.ok).toBe(false)
    if (!written.ok) expect(written.error.code).toBe('storage/corrupt')
    driver.close()
  })
})

/* ------------------------------- round trip ------------------------------- */

describe('the round trip', () => {
  it('seeds, writes, closes, reopens, and hands back exactly what went in', async () => {
    const name = nextName()

    const first = driverFor(name)
    const seeded = await first.seedIfPristine(
      rows({
        nodes: [node('app:1', 'rice', 'Assistant Professor'), node('app:2', 'stripe', 'Engineer')],
        edges: [edge('kw:1', 'TAGS', 'app:1')],
        meta: [{ key: 'store', value: { dataSet: 'demo', schemaVersion: 1 } }],
      }),
    )
    expect(seeded.ok && seeded.value).toBe(true)

    // A write after the seed, because "it survives a reload" has to mean the
    // user's OWN edit survives, not just the fixtures the app shipped with.
    const written = await first.commit([
      { kind: 'put', store: 'nodes', key: 'app:3', value: node('app:3', 'figma', 'Designer') },
      { kind: 'put', store: 'edges', key: 'kw:1|TAGS|app:3', value: edge('kw:1', 'TAGS', 'app:3') },
      { kind: 'delete', store: 'nodes', key: 'app:2' },
      {
        kind: 'put',
        store: 'ops',
        key: 1,
        value: { id: 'entry-1', at: 'b', tool: 't', label: 'l', calls: [], nodes: [], edges: [] },
      },
    ])
    expect(written.ok).toBe(true)

    const before = await first.readAll()
    first.close()

    const second = driverFor(name)
    const after = await second.readAll()
    second.close()

    expect(after.ok).toBe(true)
    if (!before.ok || !after.ok) return

    expect(after.value).toEqual(before.value)
    expect(after.value.nodes.map((r) => r['id'])).toEqual(['app:1', 'app:3'])
    expect(after.value.edges).toHaveLength(2)
    expect(after.value.ops).toHaveLength(1)
  })

  it('returns each store in ascending key order, which is what the snapshot reads as creation order', async () => {
    const driver = driverFor(nextName())
    await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:c', value: node('app:c', 'c', 'C') },
      { kind: 'put', store: 'nodes', key: 'app:a', value: node('app:a', 'a', 'A') },
      { kind: 'put', store: 'nodes', key: 'app:b', value: node('app:b', 'b', 'B') },
    ])
    const read = await driver.readAll()
    driver.close()

    expect(read.ok && read.value.nodes.map((r) => r['id'])).toEqual(['app:a', 'app:b', 'app:c'])
  })

  it('commits all four stores or none of them', async () => {
    const driver = driverFor(nextName())
    await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'one', 'One') },
    ])

    // The second put in this batch violates the unique slug index, so the whole
    // transaction aborts — including the edge and the meta row, which are
    // perfectly valid on their own. That is the atomicity the journal depends
    // on: a delta that half-lands is a state no entry describes.
    const written = await driver.commit([
      { kind: 'put', store: 'edges', key: 'kw:1|TAGS|app:1', value: edge('kw:1', 'TAGS', 'app:1') },
      { kind: 'put', store: 'nodes', key: 'app:2', value: node('app:2', 'one', 'Two') },
      {
        kind: 'put',
        store: 'meta',
        key: 'store',
        value: { key: 'store', value: { dataSet: 'user' } },
      },
    ])
    expect(written.ok).toBe(false)

    const read = await driver.readAll()
    driver.close()
    expect(read.ok && read.value.edges).toEqual([])
    expect(read.ok && read.value.meta).toEqual([])
    expect(read.ok && read.value.nodes).toHaveLength(1)
  })

  it('replaces wholesale in one transaction', async () => {
    const name = nextName()
    const first = driverFor(name)
    await first.commit([
      { kind: 'put', store: 'nodes', key: 'app:old', value: node('app:old', 'old', 'Old') },
    ])
    await first.replace(
      rows({
        nodes: [node('app:new', 'new', 'New')],
        meta: [{ key: 'store', value: { dataSet: 'demo' } }],
      }),
    )
    first.close()

    const second = driverFor(name)
    const read = await second.readAll()
    second.close()
    expect(read.ok && read.value.nodes.map((r) => r['id'])).toEqual(['app:new'])
    expect(read.ok && read.value.meta).toHaveLength(1)
  })
})

/* -------------------------------- the audit ------------------------------- */

/**
 * The `ops` store's key allocation, which is the whole of D2's audit-log loss.
 *
 * The repository used to number journal rows from a counter it kept itself. A
 * counter is per tab; the store is not. Two tabs open on the same database both
 * believed the next free key was the same integer, `put` overwrote rather than
 * appended, and about half of a concurrent burst's history was destroyed —
 * silently, with the records themselves intact, so nothing on screen said so.
 *
 * `fake-indexeddb` implements the real key generator, including the part that
 * makes the fix safe: `clear()` does not rewind it.
 */
describe('the audit log under concurrent writers', () => {
  const entry = (id: string): StoredRow => ({
    id,
    at: '2026-10-12T12:00:00.000Z',
    tool: 't',
    label: id,
    calls: [],
    nodes: [],
    edges: [],
  })

  const append = (id: string) =>
    ({ kind: 'put', store: 'ops', key: null, value: entry(id) }) as const

  it('appends rather than overwrites when the key is left to the store', async () => {
    const driver = driverFor(nextName())
    await driver.commit([append('a')])
    await driver.commit([append('b')])
    await driver.commit([append('c')])

    const read = await driver.readAll()
    driver.close()
    expect(read.ok && read.value.ops.map((r) => r['id'])).toEqual(['a', 'b', 'c'])
  })

  it('keeps every entry when two connections write at once', async () => {
    const name = nextName()
    const tabA = driverFor(name)
    const tabB = driverFor(name)

    // Interleaved and overlapping, which is what a burst across two tabs is.
    // Neither driver has any idea what the other has written.
    await Promise.all([
      ...Array.from({ length: 12 }, (_, i) => tabA.commit([append(`a${i}`)])),
      ...Array.from({ length: 12 }, (_, i) => tabB.commit([append(`b${i}`)])),
    ])

    const read = await tabA.readAll()
    tabA.close()
    tabB.close()

    if (!read.ok) throw new Error('could not read the store back')
    const ids = read.value.ops.map((r) => r['id'])
    expect(ids).toHaveLength(24)
    expect(new Set(ids).size).toBe(24)
  })

  /**
   * The prune on open renumbers the survivors from 1 in a transaction that has
   * just cleared the store. That is only safe because a key generator is never
   * rewound by `clear()` — if it were, the next appended entry would land on
   * key 1 and overwrite the oldest row it had just kept.
   */
  it('appends above a renumbered audit after a prune', async () => {
    const driver = driverFor(nextName())
    for (const id of ['old-1', 'old-2', 'old-3']) await driver.commit([append(id)])

    await driver.commit([
      { kind: 'clear', store: 'ops' },
      { kind: 'put', store: 'ops', key: 1, value: entry('kept-1') },
      { kind: 'put', store: 'ops', key: 2, value: entry('kept-2') },
    ])
    await driver.commit([append('fresh')])

    const read = await driver.readAll()
    driver.close()
    expect(read.ok && read.value.ops.map((r) => r['id'])).toEqual(['kept-1', 'kept-2', 'fresh'])
  })

  /**
   * `replace` is the only write that carries the audit as ROWS rather than
   * appending to it, and it is the whole-store path — switching demo data,
   * restoring an export. Deleting the `ops` line from `rowsIntoBatch` passed
   * every test in this workspace: the records arrive, the store reopens, the
   * history is simply gone, and nothing anywhere says so.
   *
   * Both halves are asserted because the second is what makes the first safe.
   * The keys written here are ours, into a store the same batch has just
   * cleared, and it is IndexedDB's own rule — a key generator is not rewound by
   * `clear()`, and an explicit numeric key pushes it past itself — that keeps
   * the next `key: null` append above the imported history instead of on top of
   * its first row.
   */
  it('carries the audit through a wholesale replace, in order, and appends above it', async () => {
    const name = nextName()
    const first = driverFor(name)
    await first.commit([append('before')])

    await first.replace(
      rows({
        meta: [{ key: 'store', value: { dataSet: 'demo' } }],
        ops: [entry('kept-1'), entry('kept-2'), entry('kept-3')],
      }),
    )
    await first.commit([append('after')])
    first.close()

    const second = driverFor(name)
    const read = await second.readAll()
    second.close()
    expect(read.ok && read.value.ops.map((r) => r['id'])).toEqual([
      'kept-1',
      'kept-2',
      'kept-3',
      'after',
    ])
  })
})

/* --------------------------------- seeding -------------------------------- */

describe('seedIfPristine', () => {
  it('writes onto an empty store and refuses a store that already has a meta row', async () => {
    const name = nextName()
    const driver = driverFor(name)

    const first = await driver.seedIfPristine(
      rows({
        nodes: [node('app:1', 'rice', 'One')],
        meta: [{ key: 'store', value: { dataSet: 'demo' } }],
      }),
    )
    expect(first.ok && first.value).toBe(true)

    const second = await driver.seedIfPristine(
      rows({
        nodes: [node('app:2', 'stripe', 'Two')],
        meta: [{ key: 'store', value: { dataSet: 'demo' } }],
      }),
    )
    expect(second.ok && second.value).toBe(false)

    const read = await driver.readAll()
    driver.close()
    expect(read.ok && read.value.nodes.map((r) => r['id'])).toEqual(['app:1'])
  })

  it('lets exactly one of two simultaneous first-run seeds win', async () => {
    // R-11 with the two tabs actually racing rather than described. Two drivers,
    // two connections, both seeding in the same tick — which is what StrictMode
    // plus an impatient reload produces on a fresh install, and what would
    // otherwise leave the user with every record twice.
    const name = nextName()
    const a = driverFor(name)
    const b = driverFor(name)

    const [first, second] = await Promise.all([
      a.seedIfPristine(
        rows({
          nodes: [node('app:a', 'rice', 'A')],
          meta: [{ key: 'store', value: { dataSet: 'demo' } }],
        }),
      ),
      b.seedIfPristine(
        rows({
          nodes: [node('app:b', 'rice', 'B')],
          meta: [{ key: 'store', value: { dataSet: 'demo' } }],
        }),
      ),
    ])

    expect(first.ok && second.ok).toBe(true)
    expect([first.ok && first.value, second.ok && second.value].filter(Boolean)).toHaveLength(1)

    const read = await a.readAll()
    a.close()
    b.close()
    expect(read.ok && read.value.nodes).toHaveLength(1)
    expect(read.ok && read.value.meta).toHaveLength(1)
  })
})

/* ------------------------------- migrations ------------------------------- */

describe('migrations', () => {
  const V1 = MIGRATIONS

  it('derives the version from the list rather than a constant beside it', () => {
    expect(versionOf(MIGRATIONS)).toBe(SCHEMA_VERSION)
    expect(pendingMigrations(MIGRATIONS, SCHEMA_VERSION)).toEqual([])
    expect(pendingMigrations(MIGRATIONS, 0)).toHaveLength(MIGRATIONS.length)
  })

  it('carries every row from v1 to v2, adds the new index, and reports the step', async () => {
    const name = nextName()

    const v1 = driverFor(name, V1)
    await v1.seedIfPristine(
      rows({
        nodes: [node('app:1', 'rice', 'One'), node('app:2', 'stripe', 'Two')],
        edges: [edge('kw:1', 'TAGS', 'app:1')],
        meta: [{ key: 'store', value: { dataSet: 'demo', schemaVersion: 1 } }],
        ops: [{ id: 'entry-1', at: 'a', tool: 't', label: 'l', calls: [], nodes: [], edges: [] }],
      }),
    )
    const before = await v1.readAll()
    v1.close()

    const addedIndex: Migration = {
      version: 2,
      name: 'stamp-and-index',
      run: (ctx) => {
        ctx.createIndex('nodes', {
          name: 'by-stage',
          keyPath: 'props.stage',
          serves: 'a test, and nothing in the app',
        })
        // A data rewrite as well as a schema change, because the two fail
        // differently: a schema step that half-runs throws, and a data step that
        // half-runs just leaves some rows in the old shape.
        return ctx.rewrite('nodes', (row) => ({ ...row, migratedAt: 'v2' }))
      },
    }

    const v2 = driverFor(name, [...V1, addedIndex])
    const open = await v2.open()
    expect(open.ok).toBe(true)
    if (open.ok) {
      expect(open.value.from).toBe(1)
      expect(open.value.version).toBe(2)
      expect(open.value.migrated).toEqual(['stamp-and-index'])
    }

    const after = await v2.readAll()
    v2.close()

    if (!before.ok || !after.ok) throw new Error('both reads should have succeeded')

    // Nothing lost, in any store.
    expect(after.value.nodes).toHaveLength(before.value.nodes.length)
    expect(after.value.edges).toEqual(before.value.edges)
    expect(after.value.meta).toEqual(before.value.meta)
    expect(after.value.ops).toEqual(before.value.ops)
    // The rewrite reached every row, not just the first.
    expect(after.value.nodes.map((r) => r['migratedAt'])).toEqual(['v2', 'v2'])
    // …and left the rest of each row exactly as it was.
    expect(after.value.nodes[0]?.['props']).toEqual(before.value.nodes[0]?.['props'])
  })

  it('runs a second synchronous step, which an awaited loop would not', async () => {
    // The `drive` loop's whole reason for existing. Awaiting a synchronous step
    // yields a microtask, the versionchange transaction deactivates, and the
    // NEXT step's createObjectStore throws — a failure with exactly one step
    // shipped is a failure nobody sees until the day there are two.
    const name = nextName()
    const steps: Migration[] = [
      ...MIGRATIONS,
      {
        version: 2,
        name: 'second',
        run: (ctx) => {
          ctx.createIndex('edges', { name: 'by-created', keyPath: 'createdAt', serves: 'a test' })
        },
      },
      {
        version: 3,
        name: 'third',
        run: (ctx) => {
          ctx.createIndex('nodes', { name: 'by-created', keyPath: 'createdAt', serves: 'a test' })
        },
      },
    ]

    const driver = driverFor(name, steps)
    const open = await driver.open()
    driver.close()

    expect(open.ok).toBe(true)
    if (open.ok) expect(open.value.migrated).toEqual(['create-stores', 'second', 'third'])
  })

  it('rolls the whole upgrade back when a step throws, leaving the old version intact', async () => {
    const name = nextName()

    const v1 = driverFor(name, MIGRATIONS)
    await v1.seedIfPristine(
      rows({
        nodes: [node('app:1', 'rice', 'One')],
        meta: [{ key: 'store', value: { dataSet: 'demo' } }],
      }),
    )
    v1.close()

    const broken: Migration = {
      version: 2,
      name: 'drops-everything',
      run: (ctx) => {
        // Half a migration: an index is created, and then the step fails. Both
        // halves have to be undone or the database's version says it has
        // something it does not.
        ctx.createIndex('nodes', { name: 'by-role', keyPath: 'props.role', serves: 'a test' })
        throw new Error('the migration could not finish')
      },
    }

    const v2 = driverFor(name, [...MIGRATIONS, broken])
    const open = await v2.open()
    expect(open.ok).toBe(false)
    if (!open.ok) expect(open.error.message).toContain('could not finish')
    v2.close()

    // The user is cleanly at v1 with their records — the recoverable failure.
    const again = driverFor(name, MIGRATIONS)
    const reopened = await again.open()
    const read = await again.readAll()
    again.close()

    expect(reopened.ok && reopened.value.version).toBe(1)
    expect(read.ok && read.value.nodes).toHaveLength(1)
  })
})

/* --------------------------------- lifecycle ------------------------------ */

describe('the connection lifecycle', () => {
  it('closes on `blocking` so another tab can upgrade, and refuses to write afterwards', async () => {
    // R-4, both halves. A tab that ignores `versionchange` holds every other tab
    // in the browser hostage — no error, no timeout, just an app that never
    // boots — and it is invisible in development because you only ever run one
    // build.
    const name = nextName()

    const held = driverFor(name, MIGRATIONS)
    await held.open()

    let told = 0
    held.onBlocking(() => {
      told += 1
    })

    const upgrading = driverFor(name, [...MIGRATIONS, { version: 2, name: 'v2', run: () => {} }])
    const open = await upgrading.open()

    // The upgrade got through, which it could only do because the first tab let
    // go of its connection.
    expect(open.ok).toBe(true)
    expect(told).toBe(1)

    const written = await held.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice', 'One') },
    ])
    expect(written.ok).toBe(false)
    if (!written.ok) expect(written.error.code).toBe('storage/blocked')

    upgrading.close()
    held.close()
  })

  /**
   * The `onBlocking` unsubscribe, which `driver-conformance.test.ts` cannot ask
   * for: provoking a blocking event needs a second connection at a higher
   * version, and a version number is not on the `Driver` interface.
   *
   * A listener that cannot be removed is a `close()` handler from a torn-down
   * boot still firing on the next upgrade, closing a connection the current boot
   * is using.
   */
  it('stops telling a listener about `blocking` once its unsubscribe is called', async () => {
    const name = nextName()

    const held = driverFor(name, MIGRATIONS)
    await held.open()

    const told: string[] = []
    held.onBlocking(() => told.push('kept'))
    const off = held.onBlocking(() => told.push('dropped'))
    off()
    off()

    const upgrading = driverFor(name, [...MIGRATIONS, { version: 2, name: 'v2', run: () => {} }])
    await upgrading.open()

    expect(told).toEqual(['kept'])

    upgrading.close()
    held.close()
  })

  it('gives up on a blocked upgrade instead of hanging forever', async () => {
    // The other side of the same failure: `openDB` never rejects while another
    // connection holds an older version, so without the grace period the boot
    // gate would sit on a skeleton screen with nothing to escalate to.
    const name = nextName()

    // A raw connection that does NOT listen for versionchange — the tab running
    // an older build, which is the realistic version of this.
    const stubborn = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('nodes', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
    })

    const driver = createIdbDriver({
      name,
      channel: null,
      migrations: [...MIGRATIONS, { version: 2, name: 'v2', run: () => {} }],
      blockedGraceMs: 20,
    })
    const open = await driver.open()

    expect(open.ok).toBe(false)
    if (!open.ok) expect(open.error.code).toBe('storage/blocked')

    stubborn.close()
    driver.close()
  })

  it('refuses everything after close rather than silently reopening', async () => {
    const driver = driverFor(nextName())
    await driver.open()
    driver.close()

    const written = await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice', 'One') },
    ])
    expect(written.ok).toBe(false)
    const read = await driver.readAll()
    expect(read.ok).toBe(false)
  })

  it('deletes the database and comes back as a first run', async () => {
    const name = nextName()
    const driver = driverFor(name)
    await driver.seedIfPristine(
      rows({
        nodes: [node('app:1', 'rice', 'One')],
        meta: [{ key: 'store', value: { dataSet: 'demo' } }],
      }),
    )
    const destroyed = await driver.destroy()
    expect(destroyed.ok).toBe(true)
    driver.close()

    const again = driverFor(name)
    const read = await again.readAll()
    again.close()
    // No meta row is what "first run" means (D24), and destroying the database
    // has to produce it — that is what makes Settings' "clear browser storage"
    // legitimately bring the demo data back.
    expect(read.ok && read.value.meta).toEqual([])
  })
})

/* -------------------------------- cross-tab ------------------------------- */

describe('the cross-tab channel', () => {
  it('posts a commit event carrying the journal entry, after the write lands', async () => {
    const posted: StoreEvent[] = []
    const listeners = new Set<(e: StoreEvent) => void>()
    const spy = {
      crossTab: true,
      post: (event: StoreEvent) => {
        posted.push(event)
        for (const fn of listeners) fn(event)
      },
      subscribe: (fn: (e: StoreEvent) => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      close: () => listeners.clear(),
    }

    const driver = createIdbDriver({ name: nextName(), channel: spy })
    const seen: StoreEvent[] = []
    driver.onRemoteCommit((event) => seen.push(event))

    await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice', 'One') },
      {
        kind: 'put',
        store: 'ops',
        key: 1,
        value: { id: 'entry-7', at: '2026-10-12T13:00:00.000Z', tool: 't', label: 'l' },
      },
    ])

    expect(posted).toEqual([{ kind: 'commit', at: '2026-10-12T13:00:00.000Z', entryId: 'entry-7' }])
    expect(seen).toHaveLength(1)
    driver.close()
  })

  it('says nothing when a commit carries no journal row, and nothing when it fails', async () => {
    const posted: StoreEvent[] = []
    const driver = createIdbDriver({
      name: nextName(),
      channel: { ...nullChannel, post: (e) => posted.push(e) },
    })

    // A boot-time chore: the meta stamp, with no journal entry behind it. Other
    // tabs have nothing to rehydrate for.
    await driver.commit([
      { kind: 'put', store: 'meta', key: 'store', value: { key: 'store', value: {} } },
    ])
    expect(posted).toEqual([])

    // A failed write must not announce itself either — a tab that rehydrated on
    // it would read the state we did NOT manage to write.
    await driver.commit([
      { kind: 'put', store: 'nodes', key: 'app:1', value: node('app:1', 'rice', 'One') },
      { kind: 'put', store: 'nodes', key: 'app:2', value: node('app:2', 'rice', 'Two') },
      { kind: 'put', store: 'ops', key: 1, value: { id: 'entry-1', at: 'a' } },
    ])
    expect(posted).toEqual([])
    driver.close()
  })
})
