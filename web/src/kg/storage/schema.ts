/**
 * L0 — DB name, and the store and index definitions.
 *
 * Four stores (nodes, edges, meta, ops) with in-line keys. A node id is directly
 * an edge endpoint, so traversal is a primary-key `get`; per-type stores would
 * destroy that and force a version bump on every new node type.
 *
 * Layer rule: nothing in `kg/storage` may import from `kg/core`. This layer
 * moves opaque JSON blobs plus a primary key. If storage learns what an
 * application is, the boundary has already failed.
 *
 * Which is why `NodeId`, `EdgeId` and `Instant` are declared here AND in
 * `core/ref.ts` rather than shared. They are `string` either side, so the two
 * declarations are structurally identical and nothing has to convert — but the
 * import that would have made them one is the import the boundary forbids. Read
 * the duplication as the boundary doing its job, not as drift waiting to happen.
 *
 *
 * THE CATALOGUE IS DATA, AND `idb` IS NOT NAMED HERE
 *
 * §3.1 of the architecture writes the layout as `interface JojoDB extends
 * DBSchema`, which would put an `idb` type in the file that `repo` and, through
 * it, `react` import for `StoreName` and `StoredRow`. D1 says `idb` is imported
 * only inside `src/kg/storage/` and never re-exported "not even as a type",
 * because a re-exported type is a module edge, and a module edge is what drags a
 * browser-only package into a React Native bundle's graph. §2 settles it in the
 * same words the module list uses: `idb-driver.ts` is "the ONLY file importing
 * `idb`".
 *
 * So the layout is plain data here and `idb-driver.ts` interprets it. That buys
 * two things beyond the boundary: `migrations.ts` can create stores without
 * naming a database library, so a migration is testable as a pure function; and
 * `memory-driver.ts` reads the same catalogue the real driver does, instead of
 * hard-coding a second copy of the store list that would drift on the first
 * schema change.
 */

export type StoreName = 'nodes' | 'edges' | 'meta' | 'ops'

export const STORE_NAMES = ['nodes', 'edges', 'meta', 'ops'] as const satisfies readonly StoreName[]

/** 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33' */
export type NodeId = string

/** 'kw:0192…|TAGS|app:0192…' */
export type EdgeId = string

/** RFC3339 UTC. */
export type Instant = string

/**
 * A row as storage sees it: JSON, and nothing else.
 *
 * `props` is binary-free as an invariant. The moment a Blob lands in one,
 * `getAll('nodes')` stops being a 5 ms operation and the hydrate path — which
 * every route waits behind — starts paying for bytes no query ever reads.
 */
export type StoredRow = { readonly [k: string]: unknown }

/** The one row shape storage knows the inside of, because the key is the value. */
export type MetaRow = { key: string; value: unknown }

/** The database. One per origin; `destroy()` deletes exactly this. */
export const DB_NAME = 'jojo'

export type IndexSpec = {
  readonly name: string
  /** An array is a compound key. Dots reach into the row: 'props.slug'. */
  readonly keyPath: string | readonly string[]
  readonly unique?: boolean
  /**
   * The query this index exists to serve.
   *
   * Required, and not decoration. Every index costs write time on every commit
   * and a migration step the day it changes, so an index nobody can name a query
   * for is pure cost — which is why §1 lists a `by-rel` edge index, `props`
   * indexes and name-sort indexes as deliberately absent rather than forgotten.
   */
  readonly serves: string
}

export type StoreSpec = {
  readonly name: StoreName
  /** null means out-of-line keys: the caller supplies the key with the value. */
  readonly keyPath: string | null
  readonly autoIncrement?: boolean
  readonly indexes: readonly IndexSpec[]
}

/**
 * The layout, in one place, read by the driver and by v1 of the migration list.
 *
 * In-line keys everywhere except `ops`, so a `put` carries its key inside the
 * value and the two cannot disagree — a row whose key argument and `id` field
 * had drifted would be written under one name and looked up under the other, and
 * the record would come back missing on the next boot rather than at the write.
 */
export const STORE_SPECS: readonly StoreSpec[] = [
  {
    name: 'nodes',
    keyPath: 'id',
    indexes: [
      {
        name: 'by-type',
        keyPath: 'type',
        serves: "Diagnostics' per-type counts, and any future per-type hydrate",
      },
      {
        name: 'by-type-slug',
        keyPath: ['type', 'props.slug'],
        unique: true,
        // Sparse by construction: `profile` has no slug, so a profile row has no
        // key for this index and is simply not in it. That is what makes the
        // unique constraint safe — a non-sparse version would see every profile
        // as a duplicate of the last one and reject the second write.
        serves: 'route resolution by slug, and the [type, slug] uniqueness D4 moved off the id',
      },
      {
        name: 'by-updated',
        keyPath: 'updatedAt',
        serves: "Diagnostics' 'last write' line",
      },
    ],
  },
  {
    name: 'edges',
    keyPath: 'id',
    indexes: [
      { name: 'by-from', keyPath: 'from', serves: 'everything out of a record' },
      { name: 'by-to', keyPath: 'to', serves: 'everything into a record' },
      { name: 'by-from-rel', keyPath: ['from', 'rel'], serves: 'records tagged with keyword K' },
      { name: 'by-to-rel', keyPath: ['to', 'rel'], serves: 'keywords on record R' },
    ],
  },
  { name: 'meta', keyPath: 'key', indexes: [] },
  {
    name: 'ops',
    // The one store with out-of-line keys. A journal entry has no natural
    // numeric key and the audit is read as a sequence, so the sequence number is
    // the key — and `autoIncrement` is what mints it. That is not a backstop any
    // more, it is the mechanism: the repository puts journal rows with no key at
    // all (`repository.ts`'s `opsFor`) precisely because the store's generator is
    // the only allocator two tabs share. A counter kept per tab had them both
    // writing key 41 and silently overwriting each other's history.
    //
    // The two callers that DO pass explicit keys — `replace`, and the audit prune
    // on open — both renumber from 1 inside a transaction that has just cleared
    // the store. That is safe because a generator is never rewound by `clear()`,
    // only by deleting the store, so what they append next still lands above.
    keyPath: null,
    autoIncrement: true,
    indexes: [
      {
        name: 'by-at',
        keyPath: 'at',
        serves: 'pruning the audit to the newest 200 on open',
      },
    ],
  },
]
