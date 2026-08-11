/**
 * L1 — GraphSnapshot (read) and MutableSnapshot (write).
 *
 * Indexes are maintained INCREMENTALLY on commit and never rebuilt. `buildGraph`
 * stays as the boot-time constructor and as the oracle to diff against when a
 * mutation is suspected of having drifted.
 *
 * `epoch(id)` bumps when the node OR any incident edge changes, which is what
 * the projection cache keys on — a projection depends on its node and on its
 * edges (the org name), so a WeakMap on the node alone would go stale.
 *
 * Nothing here is async and nothing here knows about IndexedDB. A snapshot is a
 * plain in-memory reading that happens to be the source of truth; durability is
 * a separate concern one layer up, and keeping them apart is what lets the whole
 * of Wave 1 be tested without a browser.
 */

import type { EdgeId, NodeId, NodeType, Rel, StoredEdge, StoredNode } from './model'
import { edgeId, foldName } from './ref'

export interface GraphSnapshot {
  /** Bumped once per commit, not once per write. */
  readonly version: number

  node<T extends NodeType>(id: NodeId, expect?: T): StoredNode<T> | undefined
  /** Id-ascending, which for UUIDv7 is creation order. */
  ofType<T extends NodeType>(type: T): readonly StoredNode<T>[]
  bySlug<T extends NodeType>(type: T, slug: string): StoredNode<T> | undefined
  /** Folded name -> keyword. The dedupe rule `foldName` states, indexed. */
  keywordNamed(name: string): StoredNode<'keyword'> | undefined

  out(id: NodeId, rel?: Rel): readonly StoredEdge[]
  in(id: NodeId, rel?: Rel): readonly StoredEdge[]
  /** Both directions, deduped. */
  incident(id: NodeId, rel?: Rel): readonly StoredEdge[]
  edge(id: EdgeId): StoredEdge | undefined

  one<T extends NodeType>(id: NodeId, rel: Rel, expect: T): StoredNode<T> | undefined
  many<T extends NodeType>(
    id: NodeId,
    rel: Rel,
    dir: 'out' | 'in',
    expect: T,
  ): readonly StoredNode<T>[]

  /** O(1), never stored. */
  degree(id: NodeId): number
  /** Bumped when this node OR any incident edge changes. Drives the projection cache. */
  epoch(id: NodeId): number

  /** Everything, for persistence, export and the boot integrity check. */
  nodes(): readonly StoredNode[]
  edges(): readonly StoredEdge[]
}

/** `out`/`in` are Map<NodeId, Map<Rel, Set<NodeId>>>; this is the inner half. */
type RelIndex = Map<Rel, Set<NodeId>>

const EMPTY_EDGES: readonly StoredEdge[] = []

/**
 * A snapshot you can write to.
 *
 * Every mutator returns `void`. There is nothing to await and nothing to chain,
 * which is the same discipline `idb-driver.ts` applies to transactions one layer
 * down: a mutator that returned a promise would be awaited inside a transaction
 * body, end the turn, and auto-commit it half-written.
 */
export class MutableSnapshot implements GraphSnapshot {
  #version = 0
  #byId = new Map<NodeId, StoredNode>()
  #byType = new Map<NodeType, Map<NodeId, StoredNode>>()
  #slugs = new Map<string, NodeId>()
  #keywordNames = new Map<string, NodeId>()
  #edgeById = new Map<EdgeId, StoredEdge>()
  #out = new Map<NodeId, RelIndex>();
  #in = new Map<NodeId, RelIndex>()
  #degrees = new Map<NodeId, number>()
  #epochs = new Map<NodeId, number>()

  /**
   * `ofType` is asked for on every render and the answer only changes when that
   * type does, so the sorted array is kept and invalidated rather than rebuilt.
   * Without it a board with six stage columns sorts every application six times
   * per keystroke in the search box.
   */
  #sorted = new Map<NodeType, readonly StoredNode[]>()

  static from(
    nodes: readonly StoredNode[] = [],
    edges: readonly StoredEdge[] = [],
  ): MutableSnapshot {
    const snapshot = new MutableSnapshot()
    for (const node of nodes) snapshot.putNode(node)
    for (const edge of edges) snapshot.putEdge(edge)
    return snapshot
  }

  get version(): number {
    return this.#version
  }

  /* -------------------------------- reads -------------------------------- */

  node<T extends NodeType>(id: NodeId, expect?: T): StoredNode<T> | undefined {
    const found = this.#byId.get(id)
    if (!found) return undefined
    if (expect !== undefined && found.type !== expect) return undefined
    return found as StoredNode<T>
  }

  /**
   * The bucket is keyed by the very type being asked for, so every member of it
   * is a `StoredNode<T>` — but `StoredNode` is a union over all eleven types and
   * TypeScript cannot narrow a container by the key it was fetched with. The
   * two casts below are that gap and nothing more; the indexes are written in
   * `putNode`, three lines above, where the type is concrete.
   */
  ofType<T extends NodeType>(type: T): readonly StoredNode<T>[] {
    const cached = this.#sorted.get(type)
    if (cached) return cached as readonly StoredNode<T>[]

    const bucket = this.#byType.get(type)
    // Sorted by id, which for UUIDv7 is creation order. Insertion order would
    // agree until the first undo of a delete, which re-adds the record at the
    // end and would make a restored row jump to the bottom of the board.
    const list: readonly StoredNode[] = bucket ? [...bucket.values()].sort(compareById) : []
    this.#sorted.set(type, list)
    return list as readonly StoredNode<T>[]
  }

  bySlug<T extends NodeType>(type: T, slug: string): StoredNode<T> | undefined {
    const id = this.#slugs.get(slugKey(type, slug))
    return id === undefined ? undefined : this.node(id, type)
  }

  keywordNamed(name: string): StoredNode<'keyword'> | undefined {
    const id = this.#keywordNames.get(foldName(name))
    return id === undefined ? undefined : this.node(id, 'keyword')
  }

  edge(id: EdgeId): StoredEdge | undefined {
    return this.#edgeById.get(id)
  }

  out(id: NodeId, rel?: Rel): readonly StoredEdge[] {
    return this.#edgesFrom(this.#out, id, rel, (other, r) => edgeId(id, r, other))
  }

  in(id: NodeId, rel?: Rel): readonly StoredEdge[] {
    return this.#edgesFrom(this.#in, id, rel, (other, r) => edgeId(other, r, id))
  }

  incident(id: NodeId, rel?: Rel): readonly StoredEdge[] {
    const out = this.out(id, rel)
    const into = this.in(id, rel)
    if (out.length === 0) return into
    if (into.length === 0) return out

    // Deduped by id rather than concatenated: a self-edge would otherwise be
    // returned twice and counted twice by everything downstream.
    const seen = new Set<EdgeId>(out.map((e) => e.id))
    return [...out, ...into.filter((e) => !seen.has(e.id))]
  }

  one<T extends NodeType>(id: NodeId, rel: Rel, expect: T): StoredNode<T> | undefined {
    for (const edge of this.out(id, rel)) {
      const found = this.node(edge.to, expect)
      if (found) return found
    }
    return undefined
  }

  many<T extends NodeType>(
    id: NodeId,
    rel: Rel,
    dir: 'out' | 'in',
    expect: T,
  ): readonly StoredNode<T>[] {
    const edges = dir === 'out' ? this.out(id, rel) : this.in(id, rel)
    const found: StoredNode<T>[] = []
    for (const edge of edges) {
      const node = this.node(dir === 'out' ? edge.to : edge.from, expect)
      if (node) found.push(node)
    }
    return found
  }

  degree(id: NodeId): number {
    return this.#degrees.get(id) ?? 0
  }

  epoch(id: NodeId): number {
    return this.#epochs.get(id) ?? 0
  }

  nodes(): readonly StoredNode[] {
    return [...this.#byId.values()]
  }

  edges(): readonly StoredEdge[] {
    return [...this.#edgeById.values()]
  }

  /* ------------------------------- writes -------------------------------- */

  /**
   * Whole-node put. There is no field-level write.
   *
   * Last-write-wins at node granularity is the durability contract (D11), and a
   * partial write here would be a second one — a patch applied to memory but
   * queued as a whole node is how the two copies drift apart.
   */
  putNode(node: StoredNode): void {
    const previous = this.#byId.get(node.id)
    if (previous) this.#unindexNode(previous)

    this.#byId.set(node.id, node)
    bucketOf(this.#byType, node.type).set(node.id, node)
    this.#sorted.delete(node.type)

    if (node.type !== 'profile') this.#slugs.set(slugKey(node.type, node.props.slug), node.id)
    if (node.type === 'keyword') this.#keywordNames.set(foldName(node.props.name), node.id)

    this.#bump(node.id)
  }

  /**
   * Unlinks, never cascades — verbatim from the removed `store-context.ts`.
   *
   * Deleting an application drops its edges and leaves the timeline items,
   * links, files and snippets exactly where they were. Cascading would delete
   * the user's own writing because it happened to be filed somewhere, and no
   * undo of that reads as reversible.
   */
  removeNode(id: NodeId): StoredNode | undefined {
    const node = this.#byId.get(id)
    if (!node) return undefined

    for (const edge of this.incident(id)) this.removeEdge(edge.id)

    this.#unindexNode(node)
    this.#byId.delete(id)
    this.#byType.get(node.type)?.delete(id)
    this.#sorted.delete(node.type)
    this.#degrees.delete(id)
    this.#bump(id)
    return node
  }

  putEdge(edge: StoredEdge): void {
    if (this.#edgeById.has(edge.id)) return

    this.#edgeById.set(edge.id, edge)
    relSet(bucketOf(this.#out, edge.from), edge.rel).add(edge.to)
    relSet(bucketOf(this.#in, edge.to), edge.rel).add(edge.from)
    this.#degrees.set(edge.from, this.degree(edge.from) + 1)
    if (edge.to !== edge.from) this.#degrees.set(edge.to, this.degree(edge.to) + 1)

    this.#bump(edge.from)
    this.#bump(edge.to)
  }

  removeEdge(id: EdgeId): StoredEdge | undefined {
    const edge = this.#edgeById.get(id)
    if (!edge) return undefined

    this.#edgeById.delete(id)
    this.#out.get(edge.from)?.get(edge.rel)?.delete(edge.to)
    this.#in.get(edge.to)?.get(edge.rel)?.delete(edge.from)
    this.#degrees.set(edge.from, Math.max(0, this.degree(edge.from) - 1))
    if (edge.to !== edge.from) this.#degrees.set(edge.to, Math.max(0, this.degree(edge.to) - 1))

    this.#bump(edge.from)
    this.#bump(edge.to)
    return edge
  }

  /**
   * One bump per commit, not one per write.
   *
   * `version` is what `useSyncExternalStore` compares, so a tool that touched
   * six records would otherwise publish six versions and re-render the tree six
   * times for one user action.
   */
  commit(): number {
    this.#version += 1
    return this.#version
  }

  /**
   * Swaps the entire contents in place, keeping `version` and the per-node
   * epochs running.
   *
   * Rebuilding with `MutableSnapshot.from` here — which is what `replaceAll` and
   * `rehydrate` used to do — was the bug behind every list in the app surviving
   * a wholesale replace. A fresh snapshot counts from version 0, and
   * `createProjection` reads an equal version as "same commit, same answer"
   * (`createProjection` in `kg/core/project.ts`); a tab that had not committed
   * anything since boot sat at
   * version 0, so the replacement arrived at 0 as well and the board went on
   * rendering the twelve demo applications the user had just pressed *Start
   * empty* to be rid of. The same screenful contradicted itself, because
   * `useStoreAdmin().isEmpty` reads the graph directly and was correct: Settings
   * said "every list is empty" with *Clear records* disabled while
   * `/applications` said "12 shown · 12 total".
   *
   * Mutating in place makes `version` strictly monotonic per repository, which
   * is what the cache assumed all along. It keeps `epoch(id)` monotonic too, and
   * that half matters just as much: `createOneProjection` keys on the epoch and
   * nothing else, so a record whose id survived a replace into a fresh snapshot
   * — where the counters restart — could serve the detail route a projection of
   * the record it used to be.
   */
  reset(nodes: readonly StoredNode[] = [], edges: readonly StoredEdge[] = []): void {
    for (const id of [...this.#byId.keys()]) this.removeNode(id)
    // `removeNode` only reaches edges incident to a node it can see, so an edge
    // whose endpoints were never in `#byId` would outlive the store it belonged
    // to and show up as a connection to a record the graph does not have.
    for (const id of [...this.#edgeById.keys()]) this.removeEdge(id)

    for (const node of nodes) this.putNode(node)
    for (const edge of edges) this.putEdge(edge)
  }

  /**
   * A copy the transaction buffer can be thrown away.
   *
   * Nodes and edges are treated as immutable, so only the index containers are
   * copied. At the scale this app reaches — low thousands of nodes — that is
   * well under a millisecond, and it buys a discard path that cannot half-apply
   * a failed tool.
   */
  clone(): MutableSnapshot {
    const copy = new MutableSnapshot()
    copy.#version = this.#version
    copy.#byId = new Map(this.#byId)
    copy.#byType = new Map([...this.#byType].map(([type, bucket]) => [type, new Map(bucket)]))
    copy.#slugs = new Map(this.#slugs)
    copy.#keywordNames = new Map(this.#keywordNames)
    copy.#edgeById = new Map(this.#edgeById)
    copy.#out = cloneRelIndex(this.#out)
    copy.#in = cloneRelIndex(this.#in)
    copy.#degrees = new Map(this.#degrees)
    copy.#epochs = new Map(this.#epochs)
    return copy
  }

  /* ------------------------------ internals ------------------------------ */

  #bump(id: NodeId): void {
    this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1)
  }

  /**
   * Slug and keyword-name entries are removed only when they still point at
   * this node. A rename writes the new key before the old one is swept, and an
   * unconditional delete would take the new entry out with it.
   */
  #unindexNode(node: StoredNode): void {
    if (node.type !== 'profile') {
      const key = slugKey(node.type, node.props.slug)
      if (this.#slugs.get(key) === node.id) this.#slugs.delete(key)
    }
    if (node.type === 'keyword') {
      const key = foldName(node.props.name)
      if (this.#keywordNames.get(key) === node.id) this.#keywordNames.delete(key)
    }
  }

  #edgesFrom(
    index: Map<NodeId, RelIndex>,
    id: NodeId,
    rel: Rel | undefined,
    keyOf: (other: NodeId, rel: Rel) => EdgeId,
  ): readonly StoredEdge[] {
    const rels = index.get(id)
    if (!rels) return EMPTY_EDGES

    const found: StoredEdge[] = []
    for (const [candidate, others] of rels) {
      if (rel !== undefined && candidate !== rel) continue
      for (const other of others) {
        const edge = this.#edgeById.get(keyOf(other, candidate))
        if (edge) found.push(edge)
      }
    }
    return found
  }
}

const compareById = (a: StoredNode, b: StoredNode) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** `\0` because it cannot appear in a type name or in a slug. */
const slugKey = (type: NodeType, slug: string) => `${type}\0${slug}`

function bucketOf<K, V, T>(index: Map<K, Map<V, T>>, key: K): Map<V, T> {
  const found = index.get(key)
  if (found) return found
  const fresh = new Map<V, T>()
  index.set(key, fresh)
  return fresh
}

function relSet(index: RelIndex, rel: Rel): Set<NodeId> {
  const found = index.get(rel)
  if (found) return found
  const fresh = new Set<NodeId>()
  index.set(rel, fresh)
  return fresh
}

function cloneRelIndex(index: Map<NodeId, RelIndex>): Map<NodeId, RelIndex> {
  const copy = new Map<NodeId, RelIndex>()
  for (const [id, rels] of index) {
    const inner: RelIndex = new Map()
    for (const [rel, others] of rels) inner.set(rel, new Set(others))
    copy.set(id, inner)
  }
  return copy
}
