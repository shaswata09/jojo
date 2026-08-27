/**
 * The upgrade path, which runs on every user's only copy of their records.
 *
 * This module had no test at all — 40% of its statements and NONE of its
 * branches — while being the code that decides what happens to a store on the
 * first open after an update. Its own header sets the standard it was not held
 * to: "keep the shape a migration migrates FROM, forever, and test against it",
 * and the whole reason a step takes a `MigrationContext` rather than a live
 * database is so that the fixture is a list of rows instead of a browser.
 *
 * So this is that fixture. A recording context stands in for the upgrade
 * transaction, and each step is asked what it does to a database in the states
 * it will actually meet: empty, half-built, and already current.
 */

import { describe, expect, it } from 'vitest'
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  pendingMigrations,
  versionOf,
  type Migration,
  type MigrationContext,
} from './migrations'
import { STORE_SPECS } from './schema'
import type { IndexSpec, StoreName, StoreSpec } from './schema'

/**
 * A database as a pair of sets, plus a log of what was done to it.
 *
 * `existing` seeds the state a migration finds on disk, which is the half that
 * matters: a step meeting a store it already created must not try again.
 */
function fakeDb(existing: { stores?: StoreName[]; indexes?: [StoreName, string][] } = {}) {
  const stores = new Set<StoreName>(existing.stores ?? [])
  const indexes = new Set<string>((existing.indexes ?? []).map(([s, i]) => `${s}.${i}`))
  const created: string[] = []
  const deleted: string[] = []

  const ctx: MigrationContext = {
    from: 0,
    to: SCHEMA_VERSION,
    hasStore: (name) => stores.has(name),
    createStore: (spec: StoreSpec) => {
      // The failure this guards: `createObjectStore` on a name that exists
      // throws `ConstraintError` and rolls the whole upgrade back.
      if (stores.has(spec.name)) throw new Error(`ConstraintError: ${spec.name} already exists`)
      stores.add(spec.name)
      created.push(`store:${spec.name}`)
    },
    deleteStore: (name) => {
      stores.delete(name)
      deleted.push(`store:${name}`)
    },
    hasIndex: (store, index) => indexes.has(`${store}.${index}`),
    createIndex: (store, index: IndexSpec) => {
      if (indexes.has(`${store}.${index.name}`)) {
        throw new Error(`ConstraintError: ${store}.${index.name} already exists`)
      }
      indexes.add(`${store}.${index.name}`)
      created.push(`index:${store}.${index.name}`)
    },
    deleteIndex: (store, index) => {
      indexes.delete(`${store}.${index}`)
      deleted.push(`index:${store}.${index}`)
    },
    rewrite: async () => {
      await Promise.resolve()
    },
  }
  return { ctx, stores, indexes, created, deleted }
}

/** Every step from `from`, the way the driver runs them. */
async function upgrade(db: ReturnType<typeof fakeDb>, from: number): Promise<void> {
  for (const step of pendingMigrations(MIGRATIONS, from)) {
    // Awaited only when the step returned something — see `Migration.run`.
    const running = step.run(db.ctx)
    if (running) await running
  }
}

describe('versionOf', () => {
  it('is the highest version any step brings the database to', () => {
    expect(versionOf([{ version: 3, name: 'c', run: () => {} }, { version: 1, name: 'a', run: () => {} }])).toBe(3)
  })

  it('is 1 for an empty list, not 0', () => {
    // 0 is "no database". A store with no migrations still exists at version 1,
    // and reporting 0 would make every open look like a fresh install.
    expect(versionOf([])).toBe(1)
  })

  it('matches the shipped list, so the constant cannot drift behind it', () => {
    /*
     * The silent failure this exists to prevent: a hand-written constant one
     * behind the list means the last migration never runs, and the index it
     * creates is missing on every machine that was already open.
     */
    expect(SCHEMA_VERSION).toBe(versionOf(MIGRATIONS))
    expect(SCHEMA_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)))
  })
})

describe('pendingMigrations', () => {
  /*
   * A FACTORY, not a shared array.
   *
   * `pendingMigrations` sorts, and a shared fixture is sorted in place by
   * whichever test runs first — so the "does not mutate" case below compared an
   * already-sorted array against itself and passed against a version that did
   * mutate. A mutant that survives because of test ORDER is the least visible
   * kind there is.
   */
  const fresh = (): Migration[] => [
    { version: 2, name: 'two', run: () => {} },
    { version: 1, name: 'one', run: () => {} },
    { version: 3, name: 'three', run: () => {} },
  ]

  it('runs everything on a fresh database', () => {
    expect(pendingMigrations(fresh(), 0).map((m) => m.version)).toEqual([1, 2, 3])
  })

  it('sorts, so a list appended out of order still runs in order', () => {
    // A gap or a swap here is a store that never gets its index.
    expect(pendingMigrations(fresh(), 0).map((m) => m.name)).toEqual(['one', 'two', 'three'])
  })

  it('does NOT re-run the version the database already reports', () => {
    /*
     * `>` and not `>=`, and the off-by-one is not cosmetic: re-running the last
     * step is a `ConstraintError` for a schema step and a rewrite applied twice
     * for a data step.
     */
    expect(pendingMigrations(fresh(), 3)).toEqual([])
    expect(pendingMigrations(fresh(), 2).map((m) => m.version)).toEqual([3])
  })

  it('is empty for a database from the future', () => {
    // A user who opened a newer build and went back. Running nothing is right;
    // the driver refuses the open elsewhere.
    expect(pendingMigrations(fresh(), 99)).toEqual([])
  })

  it('does not mutate the list it was given', () => {
    // It sorts, and sorting in place would reorder the shipped MIGRATIONS array
    // for every later caller in the same session.
    const steps = fresh()
    const order = steps.map((m) => m.version)
    pendingMigrations(steps, 0)
    expect(steps.map((m) => m.version)).toEqual(order)
  })
})

describe('a fresh install', () => {
  it('creates every store and every index the schema declares', async () => {
    const db = fakeDb()
    await upgrade(db, 0)

    expect([...db.stores].sort()).toEqual(STORE_SPECS.map((s) => s.name).sort())
    for (const spec of STORE_SPECS) {
      for (const index of spec.indexes) {
        expect(db.indexes.has(`${spec.name}.${index.name}`)).toBe(true)
      }
    }
  })

  it('deletes nothing', () => {
    // Nothing shipped so far removes anything. If that changes, this test
    // should be updated deliberately rather than discovered in a bug report.
    const db = fakeDb()
    void upgrade(db, 0)
    expect(db.deleted).toEqual([])
  })
})

describe('a database that is already part-built', () => {
  /*
   * The branches that were at 0%. `createObjectStore` on an existing name
   * throws `ConstraintError`, and a throw inside a versionchange transaction
   * rolls the WHOLE upgrade back — so a step that does not check first turns a
   * half-finished upgrade into a user stuck at the old version forever.
   */
  it('skips a store it already has', async () => {
    const first = STORE_SPECS[0]!
    const db = fakeDb({ stores: [first.name] })

    await expect(upgrade(db, 0)).resolves.toBeUndefined()
    expect(db.created).not.toContain(`store:${first.name}`)
    // ...and still creates the others.
    expect(db.stores.size).toBe(STORE_SPECS.length)
  })

  it('skips an index it already has, and adds the ones it does not', async () => {
    const spec = STORE_SPECS.find((s) => s.indexes.length > 1)
    expect(spec).toBeDefined()
    const kept = spec!.indexes[0]!
    const db = fakeDb({ stores: [spec!.name], indexes: [[spec!.name, kept.name]] })

    await expect(upgrade(db, 0)).resolves.toBeUndefined()
    expect(db.created).not.toContain(`index:${spec!.name}.${kept.name}`)
    for (const index of spec!.indexes.slice(1)) {
      expect(db.indexes.has(`${spec!.name}.${index.name}`)).toBe(true)
    }
  })

  it('is safe to run twice, which is what a half-rolled-back upgrade leaves', async () => {
    const db = fakeDb()
    await upgrade(db, 0)
    const after = db.created.length

    // The same steps again, against the database they just built.
    await expect(upgrade(db, 0)).resolves.toBeUndefined()
    expect(db.created).toHaveLength(after)
  })
})

describe('the shipped list itself', () => {
  it('has strictly ascending, unique versions', () => {
    // A duplicate or a gap means a step is skipped for somebody: the runner
    // filters on `version > from`, so two steps at one version run together on
    // a fresh install and never on an upgrade from between them.
    const versions = MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('starts at 1, because 0 means no database', () => {
    expect(MIGRATIONS[0]?.version).toBe(1)
  })

  it('gives every step a name, which is what a bug report quotes', () => {
    for (const step of MIGRATIONS) expect(step.name.trim().length).toBeGreaterThan(0)
  })
})
