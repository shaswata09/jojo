/**
 * One node row or one edge row off disk, checked into a record or a diagnostic.
 *
 * THE TWO CASTS, AND WHAT IS ACTUALLY UNIQUE ABOUT THEM
 *
 * `as StoredNode` reads as if it should appear nowhere else, and it does appear
 * elsewhere — this comment used to say otherwise and a grep refutes it in one
 * line, which is worse than saying nothing. `snapshot.ts` and
 * `tools/runtime-overlay.ts` re-assert a type PARAMETER the compiler cannot
 * carry through a container it fetched by key; `repo/seed.ts` and
 * `tools/runtime-tx.ts` assemble a record out of values that are already typed.
 * None of those turns an unchecked value into a record.
 *
 * The two in this file are the only casts that turn an unchecked value into a
 * DOMAIN RECORD. Every field above them has been read and checked one at a
 * time. A third of that kind anywhere else means some other module has decided
 * it knows what is on disk, and the guarantee that a malformed record can only
 * enter through a counted diagnostic is gone.
 *
 * Stated that way rather than as "the only casts whose input is `unknown`",
 * which is what this said a revision ago and is false: `journal.ts`,
 * `channel.ts`, `meta.ts`, `idb-events.ts`, `react/undo.ts` and `tools/memory.ts`
 * all widen an `unknown` to `Record<string, unknown>` in order to LOOK at it.
 * Widening a value to inspect it and asserting it is a `StoredNode` are opposite
 * acts, and the paragraph above already had to be rewritten once for making an
 * absolute claim a single grep refuted. Twice is a pattern worth naming.
 */

import type { NodeType, Rel, StoredEdge, StoredNode } from './model'
import { EDGE_SCHEMA, edgeIsWellTyped, NODE_TYPES, RELS } from './model'
import { edgeId, parseNodeId, typeOfId } from './ref'
import { formatIssues, s } from './schema'
import type { Validated } from './validate-diagnostic'
import { diagnostic } from './validate-diagnostic'
import { propSchemaFor } from './validate-props'

const NODE_TYPE_SET: ReadonlySet<string> = new Set<string>(NODE_TYPES)
const REL_SET: ReadonlySet<string> = new Set<string>(RELS)

const isNodeType = (value: string): value is NodeType => NODE_TYPE_SET.has(value)
const isRel = (value: string): value is Rel => REL_SET.has(value)

/* -------------------------------- envelopes ------------------------------- */

export const isRow = (row: unknown): row is Record<string, unknown> =>
  typeof row === 'object' && row !== null && !Array.isArray(row)

const readString = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

/**
 * The envelope's timestamps, held to the standard every timestamp inside
 * `props` is already held to.
 *
 * They used to get a non-empty-string check and nothing else, while
 * `lastActionAt` sitting one field away went through `s.instant`. So a
 * hand-edited or truncated backup carrying `updatedAt: 'undefined'` crossed the
 * trust boundary untouched and surfaced as the literal 'undefined NaN' in the
 * thread list — a corrupt record that produced a screenshot instead of a
 * counted diagnostic, which is the one outcome this file exists to prevent.
 */
const INSTANT = s.instant()

const isInstant = (value: string): boolean => INSTANT.parse(value).ok

/**
 * A node row off disk.
 *
 * The id and the `type` field are checked against each other rather than
 * trusted separately. They are two spellings of one fact — 'app:0192…' already
 * says application — and a row where they disagree is a row written by a bug,
 * which is worth catching here rather than three layers up where the projection
 * hands an application's props to a keyword's renderer.
 */
export function validateNode(row: unknown): Validated<StoredNode> {
  if (!isRow(row)) return { ok: false, diagnostics: [diagnostic('nodes', null, 'Not a record.')] }

  const id = readString(row, 'id')
  if (!id) return { ok: false, diagnostics: [diagnostic('nodes', null, 'Has no id.')] }

  const parsed = parseNodeId(id)
  if (!parsed) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, 'Its id is not a jojo id.')] }
  }

  const type = readString(row, 'type')
  if (!type || !isNodeType(type)) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, `Unknown record type '${type}'.`)] }
  }
  if (type !== parsed.type) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('nodes', id, `Says it is a ${type} but its id says ${parsed.type}.`),
      ],
    }
  }

  const createdAt = readString(row, 'createdAt')
  const updatedAt = readString(row, 'updatedAt')
  if (!createdAt || !updatedAt) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, 'Is missing its timestamps.')] }
  }
  if (!isInstant(createdAt) || !isInstant(updatedAt)) {
    return { ok: false, diagnostics: [diagnostic('nodes', id, 'Its timestamps are not times.')] }
  }

  const props = propSchemaFor(parsed.type).parse(row['props'], '')
  if (!props.ok) {
    return {
      ok: false,
      diagnostics: [diagnostic('nodes', id, `Could not be read — ${formatIssues(props.issues)}`)],
    }
  }

  // The trust boundary. Every field above has been checked; `props` came back
  // from the schema for exactly the type the id declares.
  return {
    ok: true,
    value: { id, type: parsed.type, props: props.value, createdAt, updatedAt } as StoredNode,
  }
}

/**
 * An edge row off disk.
 *
 * `EDGE_SCHEMA` is checked here and not left to a later integrity pass, because
 * type-prefixed ids make it a pure question: 'kw:…|TAGS|app:…' carries both
 * endpoint types in the key itself. An edge the schema forbids has no
 * projection that will ever read it, so keeping it would mean a row that exists,
 * survives export and renders nowhere.
 */
export function validateEdge(row: unknown): Validated<StoredEdge> {
  if (!isRow(row)) return { ok: false, diagnostics: [diagnostic('edges', null, 'Not a record.')] }

  const id = readString(row, 'id')
  if (!id) return { ok: false, diagnostics: [diagnostic('edges', null, 'Has no id.')] }

  const from = readString(row, 'from')
  const to = readString(row, 'to')
  const rel = readString(row, 'rel')
  if (!from || !to || !rel || !isRel(rel)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Does not name two records.')] }
  }

  const fromType = typeOfId(from)
  const toType = typeOfId(to)
  if (!fromType || !toType) {
    const message = 'Points at something that is not a jojo id.'
    return { ok: false, diagnostics: [diagnostic('edges', id, message)] }
  }

  if (id !== edgeId(from, rel, to)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Its id disagrees with its ends.')] }
  }

  if (!edgeIsWellTyped(rel, fromType, toType)) {
    const message = `A ${fromType} cannot ${EDGE_SCHEMA[rel].label} a ${toType}.`
    return { ok: false, diagnostics: [diagnostic('edges', id, message)] }
  }

  const createdAt = readString(row, 'createdAt')
  if (!createdAt) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Is missing its timestamp.')] }
  }
  if (!isInstant(createdAt)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Its timestamp is not a time.')] }
  }

  const rawProps = row['props']
  const props = rawProps === undefined ? {} : rawProps
  if (!isRow(props)) {
    return { ok: false, diagnostics: [diagnostic('edges', id, 'Its details could not be read.')] }
  }

  return { ok: true, value: { id, rel, from, to, props, createdAt } as StoredEdge }
}
