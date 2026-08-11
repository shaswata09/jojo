/**
 * L3 — the committed snapshot with the open transaction layered over it.
 *
 * This is what `ctx.memory` actually is, and the reason a composite tool works
 * at all: `application.create` mints an organisation and then links to it, and
 * against the committed snapshot alone that link would point at a node that does
 * not exist yet and fail EDGE_SCHEMA.
 */

import type { EdgeId, NodeId, NodeType, Rel, StoredEdge, StoredNode } from '@/kg/core/model'
import { foldName } from '@/kg/core/ref'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import { slugOf } from './runtime-buffer'
import type { Buffer } from './runtime-buffer'

/**
 * The committed snapshot plus the buffer, read-only, satisfying GraphSnapshot.
 *
 * Written here rather than borrowed from `core/snapshot.ts` because a
 * MutableSnapshot is the committed graph, and a tool that fails must leave no
 * trace in it — the whole point of discarding the buffer is that memory never
 * saw the failed transaction. This overlay is a view; nothing it does can leak.
 */
export function overlay(base: GraphSnapshot, buf: Buffer): GraphSnapshot {
  const nodeAt = (id: NodeId): StoredNode | undefined => {
    const cell = buf.nodes.get(id)
    return cell ? (cell.after ?? undefined) : base.node(id)
  }

  const typed = <T extends NodeType>(n: StoredNode | undefined, expect?: T) =>
    n && (expect === undefined || n.type === expect) ? (n as StoredNode<T>) : undefined

  const staged = (type?: NodeType): StoredNode[] => {
    const out: StoredNode[] = []
    for (const cell of buf.nodes.values()) {
      if (cell.after && (type === undefined || cell.after.type === type)) out.push(cell.after)
    }
    return out
  }

  const edgesAt = (id: NodeId, rel: Rel | undefined, dir: 'out' | 'in'): StoredEdge[] => {
    const endOf = (e: StoredEdge) => (dir === 'out' ? e.from : e.to)
    const kept = (dir === 'out' ? base.out(id, rel) : base.in(id, rel)).filter(
      (e) => !buf.edges.has(e.id),
    )
    const added: StoredEdge[] = []
    for (const cell of buf.edges.values()) {
      const e = cell.after
      if (e && endOf(e) === id && (rel === undefined || e.rel === rel)) added.push(e)
    }
    return [...kept, ...added]
  }

  const incidentAt = (id: NodeId, rel?: Rel): StoredEdge[] => {
    const seen = new Set<EdgeId>()
    const all: StoredEdge[] = []
    for (const e of [...edgesAt(id, rel, 'out'), ...edgesAt(id, rel, 'in')]) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      all.push(e)
    }
    return all
  }

  return {
    get version() {
      return base.version
    },

    node: <T extends NodeType>(id: NodeId, expect?: T) => typed(nodeAt(id), expect),

    ofType<T extends NodeType>(type: T) {
      const kept = base.ofType(type).filter((n) => !buf.nodes.has(n.id))
      const added = staged(type) as StoredNode<T>[]
      // Id-ascending, which under UUIDv7 is creation order — the property that
      // deleted the hand-kept `at` index `application/restore` used to need (D4).
      return [...kept, ...added].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    },

    bySlug<T extends NodeType>(type: T, slug: string) {
      // The buffer first: a node created or renamed in this transaction has to
      // win over the committed row, or `org.ensure` mints a second Rice for the
      // second application in the same import.
      for (const n of staged(type)) {
        if (slugOf(n) === slug) return n as StoredNode<T>
      }
      const found = base.bySlug(type, slug)
      // Shadowed: the committed row is deleted, or this transaction has already
      // rewritten it and the rewrite did not answer to this slug above.
      return found && !buf.nodes.has(found.id) ? found : undefined
    },

    out: (id: NodeId, rel?: Rel) => edgesAt(id, rel, 'out'),
    in: (id: NodeId, rel?: Rel) => edgesAt(id, rel, 'in'),
    incident: incidentAt,

    one<T extends NodeType>(id: NodeId, rel: Rel, expect: T) {
      const edge = edgesAt(id, rel, 'out')[0]
      return edge ? typed(nodeAt(edge.to), expect) : undefined
    },

    many<T extends NodeType>(id: NodeId, rel: Rel, dir: 'out' | 'in', expect: T) {
      const out: StoredNode<T>[] = []
      for (const e of edgesAt(id, rel, dir)) {
        const n = typed(nodeAt(dir === 'out' ? e.to : e.from), expect)
        if (n) out.push(n)
      }
      return out
    },

    keywordNamed(name: string) {
      for (const n of staged('keyword')) {
        if (foldName((n.props as { name: string }).name) === foldName(name)) {
          return n as StoredNode<'keyword'>
        }
      }
      const found = base.keywordNamed(name)
      return found && !buf.nodes.has(found.id) ? found : undefined
    },

    edge(id: EdgeId) {
      const cell = buf.edges.get(id)
      return cell ? (cell.after ?? undefined) : base.edge(id)
    },

    nodes: () => [...base.nodes().filter((n) => !buf.nodes.has(n.id)), ...staged()],

    edges() {
      const added: StoredEdge[] = []
      for (const cell of buf.edges.values()) if (cell.after) added.push(cell.after)
      return [...base.edges().filter((e) => !buf.edges.has(e.id)), ...added]
    },

    degree: (id: NodeId) => incidentAt(id).length,

    // Delegated: an epoch is what the projection cache compares AFTER a commit,
    // and there is no projection of a transaction that has not committed yet.
    epoch: (id: NodeId) => base.epoch(id),
  }
}
