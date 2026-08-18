# jojo — Knowledge-Graph Architecture and Build Plan

*Synthesis of R1–R5. Written against the tree as it stood BEFORE any of this was built (`tsconfig.app.json` has no `strict`; `package.json` has 30 deps, no test runner; `store-context.ts` 962 lines; `graph.ts` 859; `labels.tsx` 275; `ids.ts` 89) — every one of those measurements is now historical.*

> **Status — waves 0 to 4 are built.** §1's decisions are settled and implemented; §5 is a record rather than a plan, with each wave's "as built" notes where the delivered shape differs; §5.5 lists the little that is not built. Line references throughout point at the pre-Wave-1 tree and are kept as evidence for the decisions they support, not as directions to a file — `store-context.ts` in particular no longer exists (Wave 4 deleted it).

---

## 1. Decisions

| # | Question | Decision | Reason (one line) |
|---|---|---|---|
| D1 | IDB dependency or hand-rolled | **`idb`, pinned, imported only inside `src/kg/storage/`** | The easy 40 lines is the promise wrapper; the hard part is `tx.done` wiring, cursor iterators and `blocked`/`blocking`/`terminated` — buy that, don't re-derive it. Repo already buys fiddly (three, dnd-kit, radix, cmdk). |
| D2 | Object-store layout | **Four stores: `nodes`, `edges`, `meta`, `ops`.** In-line keys, no autoIncrement except `ops`. | Mirrors the model `graph.ts` already states; a node id is directly an edge endpoint, so traversal is a primary-key `get`. Per-type stores destroy that and version-bump on every new type. Seven JSON blobs keeps the graph a derivation forever. |
| D3 | Node props typing | **Generic at the store boundary (`StoredNode<T>`), typed via one `NodePropsByType` map at the domain boundary** | Keeps L0/L1 domain-agnostic and reusable without giving up the inference 30k lines already rely on. |
| D4 | Identity scheme | **Type-prefixed UUIDv7 — `app:0192f4c1-7b3e-7a41-…`. `slug` demoted to a prop with a unique `[type, slug]` index.** | Six seed records answer to `stripe` (`ids.ts:5-11`); slug-as-identity is why `parseRef` has a bare-key branch and why `remove` sweeps two keyword spellings. Time-ordered ids also make "restore to its old position" free — deleting `ApplicationEdges`'s `at` index. |
| D5 | Node type set | **11 persisted: application, organisation, timelineItem, keyword, link, file, snippet, posting, match, pipeline, profile.** `role` and `source` stay **props**, synthesised as view-only nodes by `buildGraph`. | Rule: a value is a node iff the user can rename or annotate it. Organisation passes; `RoleTag`/`Source` are closed unions driving a fixed filter and a fixed legend order (`store-context.ts:424-428`) — promoting them adds a join to every projection and buys nothing. |
| D6 | Relation set | **7 persisted: `AT ABOUT FILED_UNDER TAGS FROM BECAME COPY_OF`.** `IS` and `application→source` become view-only edges. `FROM` persisted means `match\|posting → pipeline` only. | Matches `GRAPH_RELS` minus the value-node edges, plus `COPY_OF` so `duplicate()` stops producing untracked copies. Stage history is *not* an edge — it's a timelineItem. |
| D7 | Edge identity | **`` `${from}\|${rel}\|${to}` `` — exactly what `graph.ts:186` mints** | Create and delete are idempotent with no read-before-write. Cost: no parallel edges. Accepted — the case for a parallel edge here is always a timelineItem or a reified node. |
| D8 | Edge direction | **Stored directed; traversed `'both'` by default** | Direction is free and makes `applicationOf(file)` one lookup; `graph.ts:46-52` already argues the undirected-traversal half. |
| D9 | Edge props | **Yes, `{}` by default. No derived values, ever.** | One key per edge buys freedom from the first attribute migration (`BECAME.promotedAt`). |
| D10 | Reads: sync cache or async | **Sync cache. Whole graph in memory, hydrated once at boot behind a gate; IDB is a durability mechanism, not a query mechanism.** | 91 seeded records / 45 KB of source; a heavy two-year user is low single-digit MB. Async reads would touch 34 files, ~30 empty-state branches and 12 synchronous read-after-write sites — two of which gate a `navigate()`. |
| D11 | Writes | **Optimistic in memory, write-behind queue, never awaited by a handler.** Whole-node `put`, last-write-wins at node granularity. | Awaiting means a route transition gated on a disk write (`JobScout.tsx:268`, `ApplicationDetail.tsx:299`). LWW is safe because memory is authoritative and the remote-change path flushes before rehydrating. |
| D12 | Undo model | **Change journal at record granularity — before/after images captured by the transaction. Not inverse commands, not snapshots.** | An inverse `create` mints a new id and orphans every edge; `application/remove` unlinks six collections, which no inverse command knows about. `revertOf` (`ApplicationDetail.tsx:759`) is already a hand-rolled before-image. 42 hand-written undo closures collapse to zero. |
| D13 | Undo durability | **Journal persisted (capped 200, pruned on open) for audit; undo *stack* resets each session, depth 50.** | An undo stack surviving reload invites "undo last Tuesday", which needs conflict rules this app doesn't have. Persisting the rows is free and is the debugging tool you'll want. |
| D14 | Keywords | **Merged: keyword is a node, tagging is a `TAGS` edge. `LabelsProvider` keeps only the filter *selection* (UI state).** | Kills the audit bug documented at `store-context.ts:930-936` structurally, deletes 5 API methods, 15 stash sites, the dual-spelling sweep and `parseRef`'s bare-key branch, and makes export a real backup. |
| D15 | Delete semantics | **Hard delete + transactional inverse. Unlink, never cascade — verbatim from `store-context.ts:152-176`.** No `deletedAt`. | Soft delete puts a must-never-forget filter on every read path, count, projection and export; one missed filter is a ghost record that *renders*. |
| D16 | Command surface | **Every mutation is a `Tool`: named, schema-validated, defined outside React, run synchronously inside one transaction.** Nested `ctx.call` joins the caller's transaction. | The brief's "each card is a tool". Synchronous is possible precisely because of D10/D11 — and it means one commit, one journal row, one Undo per user action. |
| D17 | Tool location | **`src/kg/tools/**`, never inside a `.tsx`.** A card *binds* to a tool. | Otherwise the registry imports React and no operation is testable or replayable without mounting a tree. |
| D18 | Input validation | **Hand-rolled combinator library (~130 lines) in `kg/core/schema.ts`. No zod.** | The app has written this twice already (`ApplicationDialog.tsx:107-127`, `LinksTool.tsx:51-69`); `FieldMeta` must stay introspectable to generate palette forms today and a tool manifest later. |
| D19 | Effects mapping | **Deleted before it is written.** The transaction's delta log *is* the durable op list; there is no `effectsOf(action, before, after)`. | R4's mapper only exists if the reducer survives. It doesn't (D16), so the mapper is pure duplication. |
| D20 | Test runner | **Vitest + `fake-indexeddb`, dev-only. Non-negotiable for `src/kg/**`.** | This is the first code here whose failure is silent and permanent — a dropped store, a skipped node — and local-first means there is no backup. Vitest reads `vite.config.ts`, so `@/` works with zero config. **No component tests, no jsdom, no testing-library.** |
| D21 | Strictness | **`"strict": true` + `"noImplicitOverride": true` in `tsconfig.app.json` now** (measured: 0 and 3 errors). Plus **`tsconfig.kg.json`** adding `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` over `src/kg` only. | Free, and `exactOptionalPropertyTypes` in the KG layer prevents a real bug: `Partial<T>` patches persisting explicit `undefined` that then fail `in`-checks after reload. |
| D22 | Code location | **One new root, `src/kg/`, six layers.** Not folded into `src/lib` (a flat 32-file grab-bag). | The boundary must be readable in the import line, greppable in review, and targetable by a second tsconfig project. |
| D23 | Multi-tab | **`BroadcastChannel` + full re-hydrate (debounced 50 ms), plus mandatory `blocking`/`blocked` handling.** On a remote change: flush → rehydrate → **clear the undo stack**. | Re-hydrate at 100 nodes is ~5 ms; a delta path is a second code path with its own bugs. Ignoring `blocking` deadlocks every other tab in the browser, and it is the failure you will not see in development. |
| D24 | Seed / first-run | **First run = the `meta` row is absent, not "the node store is empty".** Seed and meta written in one transaction. | Otherwise Settings → Records → *Empty* (`Settings.tsx:133`) reseeds on every reload and is impossible to actually use. |
| D25 | Derived fields | **`daysAgo`, `linked`, `allDay`, `displayName`, `degree` leave storage.** Store `lastActionAt: Instant`, derive the rest in projections. | `daysAgo` is zeroed on every edit (`store-context.ts:328`) and has only ever been right because a reload wipes it. After IDB it lies on the second launch. `linked` needs four write sites to stay honest — that is the rot in miniature. |
| D26 | Clock | **No module under `src/kg/` reads a clock or imports one. Time enters through `ToolContext.now`.** *(Wave 4: the constant is now `SEED_TODAY` — when the fixtures were written — and the app's today is `src/lib/today.ts`, the single wall-clock read. `check-platform.mjs` enforces both halves over `src/kg` and `src/data`.)* | A completion stamped `2026-10-12` in 2027 is a lie the user will see — and injection makes every time-dependent tool test deterministic for free. |
| D27 | Binary | **`props` is binary-free, as an invariant stated in the schema doc.** A `blobs` store arrives with the server, keyed by node id, never on the hydrate path. | The moment a Blob lands in `props`, `getAll('nodes')` stops being a 5 ms operation. |
| D28 | Where the graph lives, now that there are two apps | **Its own package, `@jojo/service` — `service/kg/**` plus `service/data/**`. Every path below that reads `src/kg` is now `service/kg`.** Reached only as `@jojo/service/<layer>/<name>`; no root export, no barrel, no build step. The apps keep exactly the platform: `web/src/kg/storage/idb-*`, `mobile/src/kg/storage/rn-driver.ts`, and the two `lib/` adapters. Enforced by `service/scripts/{check-layers,check-platform,check-no-copies}.mjs`, which **both** apps invoke through `npm -w @jojo/service run lint`. | The alternative was measured, because it is what happened: mobile got the graph by `cp -R` and drifted **813 lines in four months**, silently — mobile's `buildMonth` lost a parameter and every call site still compiled. The copy was not carelessness, it was the cheap option, and it was cheap because Metro could not resolve a package outside the project root and no workspace existed. Both of those are fixed, so the copy is now the expensive option. The rule the boundary is drawn on: **the package owns state a platform event has to act on; the app owns everything a platform does.** A filter chip fails that test and stays in the app; a driver passes it as a *port* and its implementation stays in the app. |

---

## 2. Layers

### The rule

**Imports point strictly downward. L5 → L4 → L3 → L2 → L1 → L0. Never upward, ever. Enforced by `service/scripts/check-layers.mjs` in `npm run lint`, not by good intentions.**

*(D28: these layers are `@jojo/service` now. Read `src/kg` below as `service/kg` and `src/data` as `service/data`. The guard runs from the package and is invoked by both apps, and it reaches one file outside it — `mobile/src/kg/storage/rn-driver.ts`, the RN adapter, which gets L0's rules plus the one package prefix that is the point of its existing.)*

- `kg/core/**` imports nothing outside `kg/core` — not React, not `idb`, not `@/data`, not `@/components`.
- `kg/storage/**` imports nothing from `core`. It moves opaque JSON blobs plus a primary key. If storage learns what an application is, the boundary has already failed.
- `kg/repo/**` may import `core` and `storage`. **It is the only layer allowed to be `async`.**
- `kg/tools/**` may import `core` and the `Repository` *interface* — never a driver, never a singleton.
- `kg/react/**` is the only layer that imports React.
- `src/data/*` becomes **fixtures below the model**: the domain types move to `kg/core/model.ts`, and `src/data/seed.ts` imports them. It is imported by exactly one tool (`memory.reset`).

**The one existing violation to fix on the way:** `store-context.ts:3` imports `draftFromText, draftFromUrl` from `@/components/applications/draft-from` — a domain write reaching up into a component folder for URL parsing. That parser moves down to `kg/core/parse-posting.ts` (it is already pure) and the dialog imports it from there. Write the reason into `tools/scout.ts`'s module doc or someone tidies it back.

### The modules

```
src/kg/
  storage/                        L0 — IndexedDB mechanics. Knows records, not jobs.
    schema.ts        DB name, version, store + index definitions, JojoDB type
    migrations.ts    MIGRATIONS[], SCHEMA_VERSION; append-only, never edited
    idb-driver.ts    the `idb` implementation of Driver; the ONLY file importing `idb`
    memory-driver.ts in-RAM Driver — tests, and the storage-blocked fallback
    channel.ts       BroadcastChannel wrapper; StoreEvent
    probe.ts         isGraphStorageAvailable(); the IDB sibling of storage.ts:13
  core/                           L1 — pure algebra. No async, no IDB, no React.
    model.ts         NODE_TYPES, RELS, StoredNode, StoredEdge, NodePropsByType, EDGE_SCHEMA
    ref.ts           NodeId minting/parsing (UUIDv7), slugify, uniqueSlug
    result.ts        KgError, KgErrorCode, Result<T>
    schema.ts        s.* combinators, Schema<T>, FieldMeta, Parsed<T>
    validate.ts      unknown -> StoredNode | Diagnostic[]. THE single trust boundary cast.
    snapshot.ts      GraphSnapshot + MutableSnapshot (incremental indexes, epochs)
    project.ts       createProjection(); the epoch cache
    algebra.ts       neighbours, shortestPath, subgraphOf, filterGraph  (from graph.ts)
    parse-posting.ts draftFromText/draftFromUrl, moved down
  repo/                           L2 — transactional state + durability. Async lives here.
    repository.ts    Repository interface + implementation over a Driver
    journal.ts       RecordDelta, JournalEntry, apply(entry, dir), the ring
    queue.ts         write-behind drain, coalescing, backoff, PersistenceHealth
    boot.ts          open -> migrate -> read -> validate -> build snapshot -> seed
    meta.ts          StoreMeta, first-run detection, schemaVersion
    seed.ts          seedToGraph(): src/data fixtures -> nodes + edges
  tools/                          L3 — named memory operations.
    tool.ts          Tool, ToolContext, ToolResult, Tx, defineTool
    runtime.ts       run / check / undo / redo / can; the only `catch`
    index.ts         TOOLS registry + InputOf/OutputOf
    application.ts timeline.ts vault.ts keyword.ts scout.ts profile.ts memory.ts
  react/                          L4 — the binding. Thin by construction.
    kg-context.ts    context, KgContextValue, useKg() guard
    kg.tsx           KgProvider (~40 lines)
    status-context.ts / status.tsx   boot phase + persistence health, SEPARATE provider
    use-tool.ts      useTool(name) -> run + toast + Undo wiring
    use-applications.ts use-timeline.ts use-vault.ts use-scout.ts use-profile.ts use-admin.ts
  log.ts             kgLog / kgWarn / kgError — the console is the telemetry
src/components/common/StoreGate.tsx  BootSkeleton / StoreRecovery / StorageBlocked
src/lib/store-context.ts             was a re-export façade in waves 1-3; DELETED in Wave 4
src/lib/today.ts                     the app's today and clock — the one wall-clock read (Wave 4)
```

Two view-layer files that **stay where they are**: `src/lib/graph.ts` is demoted from "a reading of seven arrays" to "a reading of the snapshot plus synthesised value-nodes (role, source)" — its pattern queries (`:574`, `:741-859`) are unchanged; and `src/lib/labels.tsx` shrinks to the filter selection only.

---

## 3. Public API

### 3.1 L0 — the storage driver

```ts
/* kg/storage/schema.ts */
export type StoreName = 'nodes' | 'edges' | 'meta' | 'ops'

/** 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33' */
export type NodeId = string
/** 'kw:0192…|TAGS|app:0192…' */
export type EdgeId = string
/** RFC3339 UTC. */
export type Instant = string

export type StoredRow = { readonly [k: string]: unknown }

export interface JojoDB extends DBSchema {
  nodes: {
    key: NodeId
    value: StoredRow
    indexes: {
      'by-type': string
      'by-type-slug': [string, string]   // unique, sparse: profile has no slug
      'by-updated': string
    }
  }
  edges: {
    key: EdgeId
    value: StoredRow
    indexes: {
      'by-from': NodeId
      'by-to': NodeId
      'by-from-rel': [NodeId, string]    // records tagged with keyword K
      'by-to-rel': [NodeId, string]      // keywords on record R
    }
  }
  meta: { key: string; value: { key: string; value: unknown } }
  ops:  { key: number; value: StoredRow; indexes: { 'by-at': number } }
}
```

*Deliberately absent:* a `by-rel` index (a 300-row JS filter is sub-millisecond), any index into `props` other than `slug` (the board renders all stages at once, so there is no query to serve), and name-sort indexes.

```ts
/* kg/storage/driver.ts */
export type DurableOp =
  | { kind: 'put';    store: StoreName; key: string | number; value: StoredRow }
  | { kind: 'delete'; store: StoreName; key: string | number }
  | { kind: 'clear';  store: StoreName }

export type Rows = {
  nodes: readonly StoredRow[]
  edges: readonly StoredRow[]
  meta: readonly { key: string; value: unknown }[]
  ops: readonly StoredRow[]
}

export type OpenInfo = { version: number; from: number; migrated: readonly string[] }

/**
 * Never throws. Every method returns a Result; expected failures are codes.
 * Implementations: idb-driver.ts (real) and memory-driver.ts (tests, blocked storage).
 */
export interface Driver {
  open(): Promise<Result<OpenInfo>>
  readAll(): Promise<Result<Rows>>
  /** All ops in ONE readwrite transaction over all four stores. Atomic. */
  commit(ops: readonly DurableOp[]): Promise<Result<void>>
  /** Wholesale replace in one transaction: demo / empty / import. */
  replace(rows: Rows): Promise<Result<void>>
  /** deleteDatabase. Backs Settings' "clear browser storage". */
  destroy(): Promise<Result<void>>
  /** Remote commits from other tabs. Returns an unsubscribe. */
  onRemoteCommit(fn: (e: StoreEvent) => void): () => void
  /** Another tab is upgrading: we must close or we deadlock it. */
  onBlocking(fn: () => void): () => void
  close(): void
}
```

**Transaction discipline, stated as a rule and made unrepresentable:** no transaction handle escapes `idb-driver.ts`; inside a transaction body the only permitted `await` is on that transaction's own IDB requests. `commit` opens all four stores every time — you cannot add a store to a live transaction, and at this scale the extra locks cost nothing. Default (relaxed) durability; `strict` turns a 2 ms write into 20–50 ms and nothing in a job tracker warrants it.

### 3.2 L1 — the model and the snapshot

```ts
/* kg/core/model.ts */
export const NODE_TYPES = [
  'application','organisation','timelineItem','keyword',
  'link','file','snippet','posting','match','pipeline','profile',
] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const RELS = ['AT','ABOUT','FILED_UNDER','TAGS','FROM','BECAME','COPY_OF'] as const
export type Rel = (typeof RELS)[number]

export type StoredNode<T extends NodeType = NodeType> = {
  id: NodeId
  type: T
  props: NodePropsByType[T]      // never contains binary; never contains a derived value
  createdAt: Instant
  updatedAt: Instant
}

export type StoredEdge<R extends Rel = Rel> = {
  id: EdgeId                     // `${from}|${rel}|${to}`
  rel: R
  from: NodeId
  to: NodeId
  props: Props                   // {} by default
  createdAt: Instant
}

type EdgeSpec = {
  from: readonly NodeType[]
  to: readonly NodeType[]
  /** 'one' => at most one outgoing edge of this rel per node; link() replaces. */
  fromCardinality: 'one' | 'many'
  label: string                  // 'is filed under' — reused by /graph's sentence builder
}
export const EDGE_SCHEMA: { readonly [R in Rel]: EdgeSpec } = {
  AT:          { from: ['application'], to: ['organisation'], fromCardinality: 'one',  label: 'is at' },
  ABOUT:       { from: ['timelineItem'], to: ['application'], fromCardinality: 'one',  label: 'is about' },
  FILED_UNDER: { from: ['link','file','snippet'], to: ['application'], fromCardinality: 'one', label: 'is filed under' },
  TAGS:        { from: ['keyword'], to: [...TAGGABLE], fromCardinality: 'many', label: 'tags' },
  FROM:        { from: ['match','posting'], to: ['pipeline'], fromCardinality: 'one', label: 'came from' },
  BECAME:      { from: ['posting','match'], to: ['application'], fromCardinality: 'one', label: 'became' },
  COPY_OF:     { from: ['application'], to: ['application'], fromCardinality: 'one', label: 'is a copy of' },
}
```

`fromCardinality: 'one'` is what preserves the old `applicationId?: string` semantics: `tx.link` on a `'one'` relation drops the node's existing outgoing edge of that rel in the same commit. That invariant currently lives nowhere — it is *implied* by the field being a scalar.

```ts
/* kg/core/snapshot.ts */
export interface GraphSnapshot {
  readonly version: number                     // bumped once per commit

  node<T extends NodeType>(id: NodeId, expect?: T): StoredNode<T> | undefined
  ofType<T extends NodeType>(type: T): readonly StoredNode<T>[]      // id-ascending = creation order
  bySlug<T extends NodeType>(type: T, slug: string): StoredNode<T> | undefined

  out(id: NodeId, rel?: Rel): readonly StoredEdge[]
  in(id: NodeId, rel?: Rel): readonly StoredEdge[]
  incident(id: NodeId, rel?: Rel): readonly StoredEdge[]             // both, deduped
  one<T extends NodeType>(id: NodeId, rel: Rel, expect: T): StoredNode<T> | undefined
  many<T extends NodeType>(id: NodeId, rel: Rel, dir: 'out'|'in', expect: T): readonly StoredNode<T>[]

  degree(id: NodeId): number                   // O(1), never stored
  /** Bumped when this node OR any incident edge changes. Drives the projection cache. */
  epoch(id: NodeId): number
}
```

Backing indexes, all maintained **incrementally** on commit (never rebuilt): `byId`, `byType`, `slugIndex`, `keywordNameIndex` (folded name → id, preserving the dedupe reasoning at `labels.tsx:41-53`), `out`/`in` as `Map<NodeId, Map<Rel, Set<NodeId>>>`, `edgeById`, `epochs`.

```ts
/* kg/core/project.ts */
export type Projector<T extends NodeType, R> = (n: StoredNode<T>, g: GraphSnapshot) => R
export function createProjection<T extends NodeType, R>(
  type: T, project: Projector<T, R>,
): (g: GraphSnapshot) => readonly R[]
```

Keyed on `epoch(id)`, not on snapshot version — because a projection depends on the node **and** its incident edges (the org name), a `WeakMap<StoredNode, R>` is not enough. Result: one edit re-projects one row; every other row keeps referential identity and `React.memo` holds.

```ts
/* kg/core/result.ts */
export type KgErrorCode =
  | 'storage/unavailable' | 'storage/quota' | 'storage/blocked' | 'storage/corrupt'
  | 'graph/not-found' | 'graph/conflict' | 'graph/invariant' | 'tool/refused'

export class KgError extends Error {
  readonly code: KgErrorCode
  /** Toast copy. Plain sentence, no jargon, no ids. */
  readonly userMessage: string
  /** Logged, never shown. */
  readonly context?: Record<string, unknown>
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: KgError }
```

### 3.3 L2 — the repository

```ts
/* kg/repo/journal.ts */
export type RecordDelta<T> = { id: string; before: T | null; after: T | null }

export type JournalEntry = {
  id: string
  at: Instant
  tool: ToolName
  input: unknown
  label: string                       // 'Rice — Assistant Professor added'
  calls: readonly ToolName[]          // nested tools, for the inspector
  nodes: readonly RecordDelta<StoredNode>[]
  edges: readonly RecordDelta<StoredEdge>[]
}

/** Undo and redo are the same function with a direction. ~20 lines. */
export function applyJournal(s: MutableSnapshot, e: JournalEntry, dir: 'undo' | 'redo'): void
```

```ts
/* kg/repo/repository.ts */
export type PersistenceHealth =
  | { state: 'idle' }
  | { state: 'writing'; pending: number }
  | { state: 'degraded'; pending: number; attempts: number; lastError: string }
  | { state: 'off'; reason: 'blocked' | 'quota' }

export interface Repository {
  getSnapshot(): GraphSnapshot
  subscribe(onChange: () => void): () => void

  /**
   * Synchronous. Applies the entry's `after` images to the snapshot, appends the
   * journal row, and enqueues the durable ops. Returns the committed entry.
   * The delta log IS the durable op list — there is no separate effects mapper.
   */
  commit(entry: Omit<JournalEntry, 'id' | 'at'>): JournalEntry
  /** Replays an entry backwards. Itself a commit, so redo is free. */
  revert(entryId: string): JournalEntry

  readonly undoable: readonly JournalEntry[]   // ring of 50, session-scoped
  readonly redoable: readonly JournalEntry[]
  readonly audit: readonly JournalEntry[]      // persisted, capped 200
  /** Cleared on a remote commit — another tab's writes invalidate our stack. */
  clearHistory(): void

  readonly health: PersistenceHealth
  subscribeHealth(fn: (h: PersistenceHealth) => void): () => void
  /** Awaited by export, by Settings' three data ops, and by pagehide. */
  flush(): Promise<void>
  /** Wholesale replace in one driver transaction: demo / empty / import. */
  replaceAll(rows: Rows, meta: StoreMeta): Promise<Result<void>>
}
```

```ts
/* kg/repo/boot.ts */
export type BootResult =
  | { outcome: 'ready';       repo: Repository; meta: StoreMeta; skipped: Diagnostic[] }
  | { outcome: 'first-run';   repo: Repository; meta: StoreMeta }   // seeded in one tx
  | { outcome: 'unavailable'; reason: 'blocked' | 'unsupported' }
  | { outcome: 'corrupt';     detail: string; rescued: Rows | null }

/** Module-level in-flight promise: StrictMode's second mount awaits the first. */
export function boot(driver?: Driver): Promise<BootResult>
```

```ts
/* kg/repo/meta.ts */
export type StoreMeta = {
  schemaVersion: number
  createdAt: Instant
  lastOpenedAt: Instant
  /** 'demo' as shipped, 'empty' if the user cleared, 'user' once they write. */
  dataSet: 'demo' | 'empty' | 'user'
  /** null when the user explicitly chose an empty store. */
  seededAt: Instant | null
}
```

### 3.4 L3 — the tool contract

```ts
/* kg/tools/tool.ts */
export type Announcement = { title: string; description?: string; tone?: 'default' | 'danger' }
export type Availability  = { ok: true } | { ok: false; reason: string }
export type ToolError     = { message: string; field?: string; code?: KgErrorCode }

export type Tx = {
  put<T extends NodeType>(node: StoredNode<T>): StoredNode<T>
  patch<T extends NodeType>(id: NodeId, patch: Partial<NodePropsByType[T]>): StoredNode<T>
  del(id: NodeId): void
  link(from: NodeId, rel: Rel, to: NodeId, props?: Props): EdgeId
  unlink(from: NodeId, rel: Rel, to: NodeId): void
  /** Drops every edge with this end. The graph spelling of store-context.ts:162-176 —
   *  delete UNLINKS; the records at the other end are never touched. */
  unlinkAll(id: NodeId, opts?: { rel?: Rel }): void
}

export type ToolContext = {
  /** Snapshot at transaction start, PLUS this transaction's writes so far. */
  readonly memory: GraphSnapshot
  readonly tx: Tx
  /** Runs another tool inside THIS transaction. No new commit, no second toast. */
  call<N extends ToolName>(name: N, input: InputOf<N>): OutputOf<N>
  /** The one sanctioned throw inside a tool. Returns never, so it narrows. */
  fail(message: string, opts?: { field?: string; code?: KgErrorCode }): never
  /** memory.node + fail, with a consistent message. */
  require<T extends NodeType>(type: T, id: NodeId): StoredNode<T>
  /** Unique against stored nodes AND nodes this transaction already created —
   *  the bug FilesTool.tsx:198-221 works around by hand. */
  mintSlug(type: NodeType, base: string): string
  newId(type: NodeType): NodeId
  /** Injected. No module in kg/ may import TODAY. */
  readonly now: Instant
}

export type Tool<I, O = void> = {
  readonly name: ToolName             // 'application.create'
  readonly title: string              // 'Add application' — menus, palette, undo label
  readonly summary: string            // one line; palette, inspector, future manifest
  readonly effect: 'create' | 'update' | 'delete' | 'move' | 'admin'
  readonly touches: readonly NodeType[]
  /** Hidden from palette and inspector: org.ensure and friends. */
  readonly internal?: boolean
  /** Excluded from the journal. Exactly three tools. */
  readonly undoable?: false
  readonly input: Schema<I>
  readonly available?: (m: GraphSnapshot, input?: Partial<I>) => Availability
  readonly run: (ctx: ToolContext, input: I) => O
  readonly describe: (input: I, output: O, m: GraphSnapshot) => Announcement
}

export function defineTool<I, O>(t: Tool<I, O>): Tool<I, O>
```

```ts
/* kg/tools/runtime.ts */
export type ChangeSet = { created: NodeId[]; updated: NodeId[]; deleted: NodeId[]; edges: EdgeId[] }

export type ToolResult<O> =
  | { ok: true; output: O; announcement: Announcement; changed: ChangeSet
      journalId: string; undo: (() => void) | null }
  | { ok: false; errors: readonly ToolError[] }

export interface ToolRuntime {
  run<N extends ToolName>(name: N, input: InputOf<N>): ToolResult<OutputOf<N>>
  /** Parse only. Lets a form validate on blur without touching memory. */
  check<N extends ToolName>(name: N, input: unknown): Parsed<InputOf<N>>
  can<N extends ToolName>(name: N, input?: Partial<InputOf<N>>): Availability
  /** Throws on failure. Seeding and imports only, where a failure is a bug. */
  runOrThrow<N extends ToolName>(name: N, input: InputOf<N>): OutputOf<N>
  undo(): ToolResult<void>
  redo(): ToolResult<void>
  /** Tools whose `touches` includes this node's type and whose `available` says yes. */
  forNode(id: NodeId): readonly AnyTool[]
}
```

Rules the runtime enforces, in `run()`, in about 40 readable lines: parse → `available` → open transaction → `run` → commit + journal + describe, or discard the buffer entirely. Nested `ctx.call` joins the transaction, does not announce, aborts the whole thing on failure, is depth-limited to 8 and cycle-checked. Any exception that is *not* a `ToolFailure` is a programmer error: the buffer is discarded and it is **re-thrown** to the `ErrorBoundary` rather than laundered into a user-facing message.

```ts
/* kg/tools/index.ts */
export const TOOLS = {
  'application.create': applicationCreate,
  /* … */
} as const satisfies Record<string, AnyTool>

export type ToolName   = keyof typeof TOOLS
export type InputOf<N extends ToolName>  = (typeof TOOLS)[N] extends Tool<infer I, any> ? I : never
export type OutputOf<N extends ToolName> = (typeof TOOLS)[N] extends Tool<any, infer O> ? O : never
```

A const object, not a `Map` populated by side effect: `run('application.creat', …)` must be a compile error, and the registry must be tree-shakeable.

### 3.5 L4 — the React bindings

```ts
/* kg/react/kg-context.ts */
export type KgContextValue = { repo: Repository; runtime: ToolRuntime; now: () => Instant }
export function useKg(): KgContextValue          // throws outside <KgProvider>

/* kg/react/kg.tsx — ~40 lines */
export function KgProvider({ repo, children }: { repo: Repository; children: ReactNode })
// useSyncExternalStore(repo.subscribe, repo.getSnapshot) is the ONLY subscription.

/* kg/react/status-context.ts — a SEPARATE provider, mounted OUTSIDE KgProvider,
   so a health tick does not re-render 34 consumers. */
export type StorePhase =
  | { phase: 'loading' } | { phase: 'seeding' }
  | { phase: 'ready'; dataSet: StoreMeta['dataSet']; hydratedAt: number }
  | { phase: 'unavailable'; reason: 'blocked' | 'unsupported' }
  | { phase: 'corrupt'; detail: string; rescued: boolean }
export function useStoreStatus(): { boot: StorePhase; health: PersistenceHealth }

/* kg/react/use-tool.ts */
export function useTool<N extends ToolName>(
  name: N,
): (input: InputOf<N>, say?: (a: Announcement) => Announcement) => ToolResult<OutputOf<N>>
```

`useTool` runs the tool, fires the toast from `describe`, and wires `Undo` to `result.undo`. The optional `say` exists for genuinely card-local knowledge — *"hidden while the keyword filter is on"* (`LinksTool.tsx:419-425`) — and should be rare enough to read as a smell.

**The six compatibility hooks keep their exact signatures.** `src/lib/store-context.ts` becomes a re-export façade so the 36 importing files do not change in Wave 1. Three deliberate breaks, all small and all listed here so they are not discovered:

1. `Application.id` is opaque; routes take `slug`. **19 `appPath(...)` call sites** change from `appPath(a.id)` to `appPath(a)`; route resolution goes `bySlug('application', param)` with a fallback that also accepts an id so old links do not 404.
2. `useStoreAdmin().reset` / `.clearAll` become `async` (two call sites, both already in handlers, one already has a `setClearing` spinner).
3. `exportJSON` gains keywords and a version envelope — and the comment at `store-context.ts:947` ("*not yet a full backup*") is deleted because it stops being true.

```tsx
/* components/common/StoreGate.tsx — the boot invariant, enforced structurally */
export function StoreGate({ children }: { children: ReactNode }) {
  const { boot } = useStoreStatus()
  switch (boot.phase) {
    case 'loading': case 'seeding': return <BootSkeleton phase={boot.phase} />
    case 'corrupt':                 return <StoreRecovery detail={boot.detail} rescued={boot.rescued} />
    case 'unavailable':             return <StorageBlocked reason={boot.reason} />
    case 'ready':                   return <>{children}</>
  }
}
```

**Hard invariant: `phase !== 'ready'` ⇒ no consumer of the graph is mounted.** One gate around `<Outlet/>` in `AppShell.tsx`, not thirty individual guards — a guard you can forget is not an invariant. This matters because an empty array in this codebase is not a neutral value: `ApplicationDetail.tsx:112-127` renders *"This application no longer exists"*, and `Settings.tsx:87` would read "Empty" and offer to load demo data over the user's real records.

Three shell components live outside the gate and need small guards: `Sidebar` (badge counts → skeleton pills, ~10 lines), `SpotlightSearch` (⌘K before hydration says "Loading your records…", ~5 lines), `AppShell` itself (~3 lines). `RoleFilter` is mounted inside the gate already — no change.

**First paint:** 0–600 ms shows real chrome (sidebar, topbar, route title from the URL, theme from localStorage) plus skeleton panels — no counts, no zeros, no empty states, no spinner. Past 600 ms, one line: *"Opening your local database…"*. Past 5 s, or on `blocked`/`corrupt`, the recovery panel. Do not escalate at 200 ms; an escalating UI creates the anxiety it is meant to relieve.

---

## 4. Tool catalogue

Naming: **`domain.noun.verb`**, lowercase, dotted, singular nouns, verb last, from a closed verb set — `create update delete duplicate set add remove move attach detach promote ensure`. **No `toggle`**: `toggleDone` and `toggleOn` become two tools each, because by the time an undo fires the item may have been unticked elsewhere and toggling again would re-tick it — a fact this codebase already writes down three times (`PriorityActions.tsx:69-71`, `RemindersTool.tsx:497-499`, `OwedThisWeek.tsx:177`).

**Not a tool:** any card action that writes nothing to memory — "copy snippet to clipboard", "open link". Keeping that line sharp is what stops the registry becoming a list of every `onClick`.

### Applications

| Tool | Input (abbrev.) | Card / surface | Status |
|---|---|---|---|
| `application.create` | `{org, role, roleTag, stage, source?, url?, location?, comp?, note?, deadline?: ISODate, keywords?: NodeId[]}` → `Application` | `ApplicationDialog` (`:334`) | exists — **composite**, gains atomicity + undo it has never had |
| `application.update` | `{id, patch, keywords?, deadline?: ISODate \| null}` | `ApplicationDialog` (`:357`) | exists — composite (app + keyword set + deadline add/update/delete) |
| `application.delete` | `{id}` | `ApplicationDetail` (`:317`) | exists |
| `application.duplicate` | `{id}` → `Application` | `ApplicationDetail` (`:298`) | exists — **now writes a `COPY_OF` edge** |
| `application.note.set` | `{id, note}` | `ApplicationDetail` (`:234`) | exists |
| `application.flag.set` | `{id, flagged: boolean}` | `ApplicationDetail` (`:427`) | exists (was a toggle) |
| `application.stage.set` | `{id, stage}` | board drag, `ApplicationDetail` (`:275`) | exists |
| `application.stage.advance` | `{id, stage, appliedOn?, firstReplyOn?, outcome?, offer?, mint?: TimelineDraft}` | `StageTransitionDialog` (`:203-304`) | exists — composite, up to 5 field writes + a minted item |
| `application.offer.decide` | `{id, outcome: 'accepted'\|'declined'}` | `OfferBlock` (`:120`) | exists |
| `application.offer.clear` | `{id}` | `StageTransitionDialog` (`:205`) | exists |
| `org.ensure` | `{name}` → `NodeId` | — | **new**, `internal: true` |

### Timeline

`timeline.item.create` · `timeline.item.update` · `timeline.item.delete` · `timeline.item.duplicate` · `timeline.item.complete {id}` · `timeline.item.reopen {id}` · `timeline.item.snooze {id, days}` · `timeline.item.reschedule {id, date, startMins?}` · `timeline.item.remind.set {id, remind}`

Cards: `TimelineItemDialog`, `Calendar` (`:636`, `:649` — drag-to-reschedule), `RemindersTool` (`:482-585`), `PriorityActions` (`:65-83`), `OwedThisWeek` (`:172-189`), `DraftDialog` (`:284-291`). All exist; `complete`/`reopen` are the split of `toggleDone`.

### Vault

`vault.link.save` · `vault.link.update` · `vault.link.delete` · `vault.link.duplicate` · `vault.link.recategorise`
`vault.file.add` (bulk, `{files: FileDraft[]}` — slug-deduped inside one transaction) · `vault.file.update` · `vault.file.delete` · `vault.file.move {id, bucket}` · `vault.file.note.set`
`vault.snippet.create` · `vault.snippet.update` · `vault.snippet.delete` · `vault.snippet.duplicate` · `vault.snippet.retag`

Cards: `LinksTool` (`:402-487`), `FilesTool` (`:198-327`), `SnippetsTool` (`:210-360`), `FileViewer` (`:66`), `Assistant` (`:160`). All exist.

### Keywords

`keyword.create {name, tone}` · `keyword.rename {id, name}` · `keyword.delete {id}` · `keyword.tone.set` · `keyword.attach {record, keyword}` · `keyword.detach` · `keyword.record.set {record, keywords: NodeId[]}` (bulk, for dialog save)

Cards: `LabelFilter` (`:115-177`, `:463-472`), `KeywordManager` (`:28-171`), `KeywordPicker` (`:44`). All exist — but `removeLabel`'s hand-rolled three-part undo (`labels.tsx:86-146`) becomes the same generic undo as everything else.

### Scout

`scout.posting.save` · `scout.posting.delete` · `scout.posting.promote {id}` → `Application` (composite: parse + create + `BECAME`)
`scout.match.promote {id}` → `Application` · `scout.match.dismiss {id}`
`scout.pipeline.create` · `scout.pipeline.update` · `scout.pipeline.delete` · `scout.pipeline.enable.set {id, enabled}`

Cards: `JobScout` (`:229-305`). All exist. Note the two `store-context` composites (`:790-813`, `:830-857`) that today do `addApplication` then `updateMatch/updatePosting` in one tick with no atomicity.

### Profile

`profile.text.set {field, value}` · `profile.matchTerm.add` · `profile.matchTerm.remove` · `profile.preference.set {key, value}` · `profile.document.add` (thin composite over `vault.file.add` with `bucket: 'Documents'`). Card: `Profile` (`:79`, `:114`, `:242`, `:302-312`). All exist.

### Memory / admin

| Tool | Notes |
|---|---|
| `memory.reset` | loads demo fixtures; `undoable: false` |
| `memory.clear` | empties records, keeps meta and keywords; `undoable: false` |
| `memory.import {json}` | **new** — replays a validated export through tools rather than assigning a parsed blob; `undoable: false` |
| `memory.undo` / `memory.redo` | **new as user-facing** — bound in the palette and ⌘Z / ⇧⌘Z |

`memory.export` and `graph.query` (`graph.ts:574`) are **queries**, not tools: read side, no journal row. The three `undoable: false` tools already go through a confirmation dialog rather than an undo toast, deliberately (`Settings.tsx:78-85`) — keeping them out of the journal preserves that contract and avoids a 3,000-delta entry.

### What the registry buys the moment it exists

`SpotlightSearch` currently only navigates (`:206`). With `TOOLS` it lists every tool where `available(memory).ok`, generates a form from `input.meta`, and runs it — and the "+ New" menu plus `DialogsContext`'s three hard-coded names become two views over one list. `/graph`'s `GraphDetail` gains a generated verb list per node via `runtime.forNode(id)` — the most literal expression of "each card is a tool operating on the memory". And Settings gains a real audit log from `repo.audit`, sitting next to Export.

---

## 5. Build order

**Status: waves 0–4 are BUILT.** This section is a record of what was done, not a
plan for what to do. Everything below has landed in `web/src`, and where the
delivered shape differs from what was written here the difference is noted
against the wave. Anything still outstanding is in §5.5.

Each wave left `npm run build` green and the app fully usable.

### ✅ Wave 0 — the net (small, no behaviour change)

- `"strict": true`, `"noImplicitOverride": true` in `tsconfig.app.json`. Own commit. *(Measured: 0 and 3 errors.)*
- `vitest` + `fake-indexeddb` devDeps; `"test": "vitest run"`; a `test` block in `vite.config.ts` (`environment: 'node'`).
- **Characterisation tests before touching anything**: `ids.ts` (`parseRef`'s four documented cases, `uniqueId` counting from 2), `graph.ts` traversal (`shortestPath` on disconnected / self / diamond; `filterGraph` preserving full-graph `degree` — `graph.ts:462-468` says that is intentional and a test is what stops someone "fixing" it), and `storeReducer`'s `application/remove` + `restore`. ~150 lines. These are the spec the new layer must preserve.
- `src/kg/` skeleton, `tsconfig.kg.json` (+ `references` + `tsc -b`), `scripts/check-layers.mjs` wired into `npm run lint`.
- Fix `ErrorBoundary.tsx:47` (`bg-input-bg` names no token; `grep -c input-bg dist/assets/*.css` → 0) and revisit its *"Your data is untouched"* copy, which is about to become false.

**Demoable:** identical app, now compiling strict, with a test command and a lint that enforces layering.

### ✅ Wave 1 — the graph becomes the source of truth (in memory)

Core model, ref/UUIDv7, validate, snapshot with incremental indexes, epoch-cached projections, journal, `MemoryDriver`, repository, tool kernel, and the first tool modules. `seedToGraph()` compiles the existing `src/data/*` fixtures (kept verbatim — readable and diffable) into nodes and edges, resolving `applicationId`/`org`/`labelsByRecord` through a slug→id table.

**Keywords merge in this wave, first.** It removes 15 stash sites, validates that edges journal correctly, and it is what makes the next wave's atomic persistence possible at all.

The six hooks are reimplemented over `useSyncExternalStore` + projections + tools, signatures byte-identical; `src/lib/store-context.ts` becomes a façade. `storeReducer`, `ApplicationEdges`, `idsPointingAt`, `inserted`, `relinked`, `unlinked` and the `at` index are **deleted** — UUIDv7 makes position a function of the id, and the journal makes the edge capture automatic. `src/lib/graph.ts` is rewired to read the snapshot and synthesise role/source nodes; `src/lib/labels.tsx` shrinks to the filter selection. `draftFromText`/`draftFromUrl` move down to `kg/core/parse-posting.ts`.

**Demoable:** the app behaves exactly as before, still resets on reload — but every delete has a real undo, ⌘Z works globally, the 42 hand-written undo closures are gone, and Settings' keyword count can no longer disagree with the Applications filter. `npm test` covers the model, the traversal, the projection round trip (`seedState()` → nodes+edges → projections deep-equal the input — the whole "collections are projections" claim, mechanically checked), and the unlink-never-cascade rule.

### ✅ Wave 2 — durability

`idb-driver.ts`, `schema.ts`, `migrations.ts` (v1 creates all four stores), `queue.ts` (FIFO, one transaction per drain, coalescing, 250 ms→1 s→4 s backoff), `boot.ts`, `meta.ts`, `probe.ts`, `channel.ts`, `StoreGate` + `BootSkeleton` + `StoreRecovery` + `StorageBlocked` + the degraded banner, `pagehide`/`visibilitychange` flush, `navigator.storage.persist()` requested **after the user's first real record** (not at boot — an unprompted request is likelier to be denied).

Settings gets honest: *Empty* now survives a reload (meta persists, `seededAt: null`), *Demo data* writes seed + meta in one transaction, *Clear browser storage* already deletes every IDB database (`storage.ts:121-151`) so meta goes with it and demo data legitimately returns. Delete the paragraph at `Settings.tsx:450` — *"a reload puts the demo data back and takes your changes with it"* — which is the sentence this project exists to remove. Export becomes a versioned full backup.

Multi-tab: `blocking` → close immediately and show *"jojo was updated in another tab. Reload to continue."*; `blocked` → *"Another jojo tab is open with an older version."*; remote commit → flush, rehydrate, clear the undo stack.

**Demoable:** close the tab, reopen, everything is there. Private-browsing shows an honest banner and still runs. A corrupt database offers *Download what we could read* / *Start fresh* / *Try again* and never silently reseeds.

### ✅ Wave 3 — the tools become visible

The remaining tool modules; `runtime.forNode`; the command palette runs tools with generated forms from `FieldMeta`; `/graph`'s `GraphDetail` gains per-node verbs; Settings gains the audit log (`repo.audit`) and a Diagnostics panel (DB version, node/edge counts by type, last write, records skipped as corrupt, `navigator.storage.estimate()`); `memory.import` replaces blind JSON assignment. Migrate the remaining cards from the compat hooks to `useTool` directly.

**Demoable:** ⌘K creates an application. Selecting a node on `/graph` offers every operation that node supports. Settings shows what happened and can undo the top row.

### ✅ Wave 4 — cleanup and honesty

Delete the `store-context.ts` façade (codemod the 36 imports to `@/kg/react/*`). Rebase the demo fixtures against `now` by a whole-day offset so a demo loaded in 2027 does not look abandoned — a constant shift preserves every authored relationship exactly. Fill in the five module docs named below. Consider a per-type `by-type-updated` index only if measurement asks for it.

**The five module docs that must exist**, each pinning a decision that will otherwise be re-litigated wrongly: `storage/idb-driver.ts` (the transaction-lifetime trap, and why `versionchange` must close the connection); `core/ref.ts` (the `ids.ts:1-11` paragraph verbatim, plus "a bare id is never a valid key"); `core/project.ts` (derived-vs-stored, naming `daysAgo`, `linked` and `allDay` and why each was removed); `tools/tool.ts` (what a tool is, the undo contract, the no-`TODAY` rule); `react/kg.tsx` (what the provider does not do — and that a reload is no longer the reset button). House style: **a comment states the bug that would exist without the code below it, in the past tense, with the observed symptom** — `Panel.tsx:69-77` and `storage.ts:78-87` are the template.

**As built.** The façade is gone; 34 files (35 import statements — `ApplicationDetail.tsx` had two) now import `@/kg/react/use-*` directly. All five module docs are in place.

The rebase turned out to be bigger than a shift inside the seed compiler, because with `now` still pinned the shift was provably always zero. The clock moved too:

- `data/timeline.ts`'s `TODAY` is renamed **`SEED_TODAY`** — a fact about when the fixtures were written, with exactly one reader (`repo/seed.ts`). `seedOffset(today)` is the offset.
- Today itself is **`src/lib/today.ts`**, the one wall-clock read in the app, read once per page load. `src/lib` is the web adapter layer; `src/data` and `src/kg` remain clock-free and `check-platform.mjs` still proves it.
- `seedToGraph` shifts nine authored date fields by that one offset — `appliedOn`, `submittedOn`, `firstReplyOn`, `offer.respondBy`, `date`, `completedOn` and three `savedOn`s — named per call site rather than sniffed out of `props`, so a `size` of '184 KB' cannot be mistaken for a date. `lastActionAt` takes no shift: it was already relative to the seeding instant.
- Three `src/data` functions that closed over the pinned day now take it as an argument: `agoLabel`, `followUpsOf`, `offerDaysLeft`, plus `searchHealthFor`'s input and `buildMonth`'s today-marker.
- `dayOf` moved from `tools/support.ts` down to `core/project.ts` (re-exported, so no call site changed) because `repo` needed it and cannot import `tools`.
- `kg.tsx` derives `today` with `dayOf(now())` instead of `.slice(0, 10)`: the slice is the UTC day, which was harmless under a local-noon pin and a day out every evening under a real clock.
- Three pieces of copy that said the timestamps were pinned — Diagnostics' footnote, `OfferBlock`, `TimelineItemDialog` — were corrected or deleted.

`seed.test.ts` covers both halves: the round trip still runs at offset zero (its `NOW` is built from `SEED_TODAY` in local time so the offset is zero on every machine, which the old UTC literal was not), and a second block seeds 512 days out and asserts every date moved by exactly that, every gap between dates is unchanged, no non-date moved, and no optional date became a present-and-undefined key.

The `by-type-updated` index was **not** added. Nothing measured asked for it.

---

## 5.5 What is not built

- **`mobile/`** — the Expo app is not wired to the store. Deferred by the owner: its UI is not ready. The portability work (D26, the `Host`/`Driver`/toast ports, `check-platform.mjs`) is what makes it a wiring job when it happens.
- **A per-type `by-type-updated` index** (Wave 4, above). Revisit only if a measurement asks.
- Everything in §6, permanently.

---

## 6. Out of scope

**The owner's boundaries, restated:**

- **No server.** Nothing in `src/kg/**` may `fetch`. The driver interface has no remote implementation and no place for one.
- **No physical file bytes.** File *records* are graph data; `props` stays binary-free as a documented invariant. No `blobs` store, no `File` in the graph. `data/files.ts:12-13` — *"Nothing here reads file CONTENT"* — is the existing statement of this and it holds.
- **No cross-device transfer.** Multi-*tab* is in scope (same origin, same disk, real deadlock risk). Cross-device is not: no sync protocol, no merge, no CRDT, no vector clocks. The persisted `ops` log is left as the correct seam and nothing more.
- **No AI.** No manifest generation, no tool-calling adapter, no embeddings, no vLLM client. The three properties that keep the seam free — `run` never imports React, `input` stays introspectable, failures are structured `ToolError[]` — are things you want anyway.

**Gold-plating I am cutting, with reasons:**

| Cut | Why |
|---|---|
| Dexie (31 kB gz) | Buys a query DSL you won't use — every query here is an index scan over 300 rows — and `liveQuery` competes head-on with the React context 36 files depend on. |
| Event sourcing as the source of truth | Buys audit (the journal gives that cheaply), time travel (not needed beyond undo) and sync (explicitly deferred), and costs a replay on every cold start plus a migration story for every event shape ever shipped. |
| A command bus with middleware | Validate → authorize → execute → publish as pluggable decorators is enterprise ceremony; the five stages are ~40 readable lines inline in `run()`. |
| Per-entity repositories / command classes | `useCollectionActions` (`store-context.ts:618-660`) already proves one generic serves six collections. |
| Soft delete / a "recently deleted" bin | A must-never-forget filter on every read path, to deliver a feature the app does not promise. |
| Incremental cross-tab delta sync | Saves 4 ms over a full rehydrate and costs a second code path with subtle bugs (a delete arriving as an id you then fail to find). |
| Lazy / per-type hydration | The whole dataset is ~45 KB of source today and low single-digit MB at the realistic ceiling. Revisit past ~50k nodes; nothing above `boot()` changes when it happens. |
| zod | 60 kB to replace a function the app has written twice, and `FieldMeta` → JSON Schema is a 30-line mapper either way. |
| Component tests, jsdom, Playwright | Value-per-line is low and maintenance is high; the binding layer is ~40 lines by construction. |
| Chasing `noUncheckedIndexedAccess` app-wide | 94 errors, 47 of them in `components/graph/force.ts`, a hot physics loop where the flag is noise. Apply it to `src/kg` only. |
| A `by-rel` edge index, `props` indexes, sort indexes | No query wants them at this scale, and every index costs write time and migration surface. |

---

## 7. Risks, ranked

**R-1 — Silent data loss on migration or validation. (Highest: local-first means the user's IndexedDB is the only copy.)**
A migration that drops a store, or a validator that rejects a node and skips it quietly, loses work with no server backup and no undo. *Mitigations:* (a) migrations are **append-only and never edited once shipped** — fix forward with a new step, enforced in review; (b) any step that throws rolls the whole upgrade back, leaving the user cleanly at the old version — the recoverable failure; (c) **keep a v1 fixture file forever** and test every migration against the shape it migrates from; (d) validation rejections never drop silently — they are logged with the offending record id (`kgWarn`), counted in Settings' Diagnostics, and the corrupt path offers *Download what we could read* before anything else; (e) a corrupt database **never** auto-reseeds — reseeding to make the app look healthy is the single worst outcome here.

**R-2 — The UUID migration breaks routes, deep links and the seed's cross-references.**
Identity change is the most invasive decision in this plan. *Mitigations:* `bySlug` route resolution with an id fallback so old links do not 404; the 19 `appPath` sites change in one mechanical commit; the seed compiler resolves slug references in a single pass and the projection round-trip test (Wave 0/1) is the mechanical proof; a dev-only integrity check on boot asserts every edge's endpoints exist, every edge satisfies `EDGE_SCHEMA`, every `'one'` relation has ≤1 outgoing edge, and every slug is unique within type.

**R-3 — Transaction-lifetime bugs leaving half-writes.**
An `await` on anything not an IDB request of *this* transaction ends the turn, auto-commits, and the next call throws `TransactionInactiveError` — sometimes after writes have landed. *Mitigations:* no transaction handle escapes `idb-driver.ts` (the trap is made unrepresentable, not merely documented); every `commit` is one transaction over all four stores; mutators return `void` so there is nothing to `await`; the rule is in the module doc with the symptom.

**R-4 — Blocked upgrade deadlocks every tab, and you will not see it in development.**
Tab A holds v2; tab B loads v3 and waits indefinitely. *Mitigation:* both halves are mandatory — every tab implements `blocking` and calls `db.close()` immediately, and the upgrading tab implements `blocked` and tells the user which tab to close. Test it manually with two tabs before shipping Wave 2; there is no other way to catch it.

**R-5 — Write-behind loses the last batch on an abrupt close, or persistence fails after the UI has already moved on.**
*Mitigations:* drain is scheduled on a microtask, so exposure is at most one un-drained batch; `pagehide` + `visibilitychange: hidden` flush; on failure **do not roll back** (rollback would mean un-navigating and un-writing to a different provider) — retry with backoff, then a **persistent banner**, not a toast: *"Changes since 14:32 are not being saved. [Export a copy] [Retry]"*. The queue retains its ops and drains in order if a later retry succeeds. A probe write at boot moves the honest failure to before the user does work.

**R-6 — Safari evicts the origin after seven days without a visit.**
*Mitigations:* request `navigator.storage.persist()` after the first real record; show `persisted()` honestly in Settings (*"Persistent storage: no. This browser may delete jojo's data after 7 days without a visit."*); make Export prominent and say plainly that it is the only real backup. Do not imply durability the platform does not give.

**R-7 — Multi-tab last-write-wins clobbers a field edited in another tab.**
Whole-node `put` from an authoritative memory copy is LWW at node granularity. *Mitigations:* flush **before** rehydrating on a remote commit; clear the undo stack on remote change (an entry whose before-image predates another tab's write is not a safe undo); accept and document node-granularity LWW — there is no server, and the realistic simultaneous-edit scenario is two tabs the same person opened.

**R-8 — Wave 1 is a big-bang rewrite of the store.**
Deleting `storeReducer` and the labels provider in one wave is the largest single diff in the plan. *Mitigations:* the compat façade means 26 of the 36 consumer files are never opened; the characterisation tests from Wave 0 are the acceptance criteria; keywords go first as the smallest end-to-end proof that edges journal correctly; the `MemoryDriver` means the whole of Wave 1 is reviewable and testable before a line of IndexedDB exists.

**R-9 — Derived values rot the moment data outlives the tab.**
`daysAgo` is the live example — stored, zeroed on every edit, and correct today only because a reload wipes it. `TODAY = '2026-10-12'` is the same class. *Mitigations:* D25/D26 are enforced by the layering rule (`src/kg/**` cannot import `TODAY`) and by the `core/project.ts` doc; the projection round-trip test catches a derived value that sneaks into `props`.

**R-10 — Performance regressions from full rebuilds.**
`Graph.tsx:38-42` already rebuilds ~400 nodes and edges on any record *or* keyword change, and `countFor`/`countWithin` (`labels.tsx:219-229`) is O(labels × records) per render. *Mitigations:* the snapshot is mutated incrementally, never rebuilt, with `buildGraph` kept as the boot-time constructor and the oracle you can diff against when a mutation is suspected of drifting; `countFor` becomes a set-size read. Measure cold boot against a synthetic 2,000-application store before finalising the skeleton timings; if it exceeds ~300 ms the fix is a two-phase `ready`, which the gate can already express.

**R-11 — Double-seeding on a slow first boot.**
An impatient reload during seeding collides every id through `uniqueId` into `rice-2`, `rice-3`. *Mitigation:* seed and meta in one transaction; a module-level in-flight `boot()` promise so StrictMode's second mount awaits rather than races; the seed transaction re-reads `meta` **inside** the transaction and no-ops if present.

**R-12 — Tailwind classes naming nonexistent tokens emit no CSS, silently.**
Live today at `ErrorBoundary.tsx:47`. *Mitigation:* new card/tool surfaces take colour from a typed `Record<NodeType, TokenName>` map — the pattern `NODE_TYPE_LABEL` (`graph.ts:96-108`) already uses — so a wrong token is a type error; optionally a `scripts/check-tokens.mjs` in `npm run lint`.