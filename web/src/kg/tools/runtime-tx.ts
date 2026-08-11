/**
 * L3 — `ctx.tx`: the six writes a tool may make, staged into the buffer.
 *
 * Every one of them goes through `stage` in `runtime-buffer.ts`, which is what
 * gives undo its before-image. Nothing here touches the repository, and nothing
 * here can commit — a tool that throws after calling `tx.del` leaves the
 * committed graph exactly as it found it.
 */

import { EDGE_SCHEMA } from '@/kg/core/model'
import type { Instant, NodeId, NodeType, Props, Rel, StoredNode } from '@/kg/core/model'
import { edgeId } from '@/kg/core/ref'
import type { GraphSnapshot } from '@/kg/core/snapshot'
import { stage } from './runtime-buffer'
import type { Buffer } from './runtime-buffer'
import type { PropsPatch, ToolContext, Tx } from './tool'

/**
 * `read` is the overlay, so a mutator sees this transaction's earlier writes.
 * `instant` is the one the whole transaction stamps: a single commit whose rows
 * carry timestamps a few milliseconds apart stops being replayable in order.
 */
export function makeTx(
  read: () => GraphSnapshot,
  buf: Buffer,
  instant: Instant,
  fail: ToolContext['fail'],
): Tx {
  const dropIncident = (id: NodeId, rel?: Rel) => {
    for (const e of read().incident(id, rel)) stage(buf.edges, e.id, e, null)
  }

  const priorNode = (id: NodeId) => read().node(id) ?? null

  return {
    put<T extends NodeType>(node: StoredNode<T>) {
      // The cast is the gap between `StoredNode<T>` for a generic T and the
      // eleven-way union the buffer holds. Nothing is being reinterpreted: T is
      // always one of the eleven at the call site.
      stage(buf.nodes, node.id, priorNode(node.id), node as StoredNode)
      return node
    },

    patch<T extends NodeType>(id: NodeId, patch: PropsPatch<T>) {
      const current = read().node(id)
      if (!current) fail(`No record with id ${id}.`, { code: 'graph/not-found' })

      // A key carrying `undefined` DELETES rather than storing the key. D21: a
      // stored `{ offer: undefined }` survives the round trip through IndexedDB
      // as a present key, and then passes the `in` check that every read path
      // uses to mean "this application has an offer".
      const props: Record<string, unknown> = { ...current.props }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete props[key]
        else props[key] = value
      }

      const next = { ...current, props, updatedAt: instant } as StoredNode
      stage(buf.nodes, id, current, next)
      return next as StoredNode<T>
    },

    del(id: NodeId) {
      // The edges go with it. An edge whose endpoint is missing is corrupt and
      // the boot integrity check rejects the whole graph over one of them —
      // whereas the RECORDS at the other end are untouched, which is D15.
      dropIncident(id)
      stage(buf.nodes, id, priorNode(id), null)
    },

    link(from: NodeId, rel: Rel, to: NodeId, props: Props = {}) {
      const memory = read()
      const spec = EDGE_SCHEMA[rel]
      const a = memory.node(from)
      const b = memory.node(to)
      if (!a) {
        fail(`Cannot link from a record that is not here (${from}).`, { code: 'graph/not-found' })
      }
      if (!b) {
        fail(`Cannot link to a record that is not here (${to}).`, { code: 'graph/not-found' })
      }
      if (!spec.from.includes(a.type) || !spec.to.includes(b.type)) {
        fail(`A ${a.type} cannot be ${spec.label} a ${b.type}.`, { code: 'graph/invariant' })
      }

      const id = edgeId(from, rel, to)

      // `fromCardinality: 'one'` is what preserves the old `applicationId?:
      // string` semantics. That invariant used to live nowhere — it was IMPLIED
      // by the field being a scalar, so nothing stopped a second write leaving a
      // reminder filed under two applications at once.
      if (spec.fromCardinality === 'one') {
        for (const e of memory.out(from, rel)) {
          if (e.id !== id) stage(buf.edges, e.id, e, null)
        }
      }

      // Idempotent with no read-before-write, because the id IS the triple (D7).
      const existing = memory.out(from, rel).find((e) => e.id === id)
      if (existing) return id

      stage(buf.edges, id, null, { id, rel, from, to, props, createdAt: instant })
      return id
    },

    unlink(from: NodeId, rel: Rel, to: NodeId) {
      const id = edgeId(from, rel, to)
      const existing = read()
        .out(from, rel)
        .find((e) => e.id === id)
      if (existing) stage(buf.edges, id, existing, null)
    },

    unlinkAll(id: NodeId, opts?: { rel?: Rel }) {
      dropIncident(id, opts?.rel)
    },
  }
}
