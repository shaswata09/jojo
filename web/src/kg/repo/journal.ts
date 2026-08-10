/**
 * L2 — RecordDelta, JournalEntry, applyJournal.
 *
 * Undo is a change journal at record granularity — before/after images captured
 * by the transaction — not inverse commands and not snapshots. An inverse
 * `create` mints a new id and orphans every edge that pointed at the old one,
 * and `application/remove` unlinks six collections, which no inverse command
 * knows about.
 *
 * Undo and redo are the same function with a direction, so redo is free.
 *
 * The 42 hand-written undo closures this replaces all had the same shape and the
 * same hole: `useApplications().remove` captured the record, its index and the
 * ids pointing at it from five collections (`store-context.ts:334-368`) and got
 * it right, while `removeLabel` captured three separate pieces of provider state
 * (`labels.tsx:86-146`) and `revertOf` (`ApplicationDetail.tsx:759`) captured a
 * hand-written before-image of one field. Every one of them was a person
 * remembering what a write touched. A delta captured BY the write cannot forget.
 */

import type { EdgeId, Instant, NodeId, StoredEdge, StoredNode } from '../core/model'

/**
 * `before` and `after` are whole records, not patches.
 *
 * A patch has to be interpreted to be undone, and interpreting it means knowing
 * whether an absent key meant "unchanged" or "cleared" — the distinction that
 * makes `Partial<T>` a bad undo format and a fine update format.
 */
export type RecordDelta<T> = { id: string; before: T | null; after: T | null }

/** Every tool name is a string here: L2 may not import the L3 registry. */
export type ToolName = string

export type JournalEntry = {
  id: string
  at: Instant
  tool: ToolName
  input: unknown
  /** 'Rice — Assistant Professor added'. The Undo toast, and the audit row. */
  label: string
  /** Nested tools, for the inspector. One entry per user action, not per call. */
  calls: readonly ToolName[]
  nodes: readonly RecordDelta<StoredNode>[]
  edges: readonly RecordDelta<StoredEdge>[]
}

/** An entry as a tool hands it over: the repository stamps the id and the time. */
export type JournalDraft = Omit<JournalEntry, 'id' | 'at'>

/**
 * The write surface `applyJournal` needs, and nothing else.
 *
 * `MutableSnapshot` satisfies this structurally. Spelling it out rather than
 * importing the whole thing keeps the journal testable against four lines of
 * fake and keeps this file honest about what replaying an entry can do: put a
 * record, or remove one. It cannot patch, cannot query, and cannot mint an id —
 * which is the property that makes an entry replayable in either direction.
 */
export type GraphWriter = {
  putNode(node: StoredNode): void
  removeNode(id: NodeId): unknown
  putEdge(edge: StoredEdge): void
  removeEdge(id: EdgeId): unknown
}

export type Direction = 'undo' | 'redo'

const imageFor = <T>(delta: RecordDelta<T>, dir: Direction): T | null =>
  dir === 'undo' ? delta.before : delta.after

/**
 * Replays one entry in one direction.
 *
 * The four passes are ordered so no intermediate state holds an edge whose ends
 * are not both there. Edges come out first and go back in last; without that,
 * undoing a delete would put the application back after its `AT` edge, and any
 * index keyed on the endpoints would have been asked to file an edge against a
 * node that did not exist yet.
 */
export function applyJournal(s: GraphWriter, entry: JournalEntry, dir: Direction): void {
  for (const delta of entry.edges) {
    if (imageFor(delta, dir) === null) s.removeEdge(delta.id)
  }
  for (const delta of entry.nodes) {
    if (imageFor(delta, dir) === null) s.removeNode(delta.id)
  }
  for (const delta of entry.nodes) {
    const image = imageFor(delta, dir)
    if (image !== null) s.putNode(image)
  }
  for (const delta of entry.edges) {
    const image = imageFor(delta, dir)
    if (image !== null) s.putEdge(image)
  }
}

const flip = <T>(delta: RecordDelta<T>): RecordDelta<T> => ({
  id: delta.id,
  before: delta.after,
  after: delta.before,
})

/**
 * The same entry, pointing the other way.
 *
 * `revert` commits this rather than mutating the stack, which is what makes redo
 * free: the revert of a revert is the original, so redo needs no second
 * mechanism and no second code path to get wrong.
 */
export function invert(entry: JournalEntry, label: string): JournalDraft {
  return {
    tool: entry.tool,
    input: entry.input,
    label,
    calls: entry.calls,
    nodes: entry.nodes.map(flip),
    edges: entry.edges.map(flip),
  }
}

/** Whether an entry changed anything. An empty one is not worth an Undo. */
export const isEmpty = (entry: Pick<JournalEntry, 'nodes' | 'edges'>): boolean =>
  entry.nodes.length === 0 && entry.edges.length === 0

/* --------------------------------- reading -------------------------------- */

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Journal rows off disk, envelope-checked and nothing more.
 *
 * The before/after images inside an entry are deliberately NOT re-validated
 * against the node schemas. They are historical: an image captured under last
 * month's shape is supposed to look like last month's shape, and running today's
 * validator over it would reject the entries that document exactly the change
 * that makes them look wrong. The envelope is checked because a row that is not
 * an object at all would take the audit log's renderer down, and because
 * `revert` reaches into `nodes` and `edges` and needs them to be arrays.
 *
 * A row that fails is dropped rather than reported: an unreadable audit entry is
 * a lost note about a change, not a lost change. `validateRows` is the path
 * where a rejection means a record vanished, and that one counts every one.
 */
export function readJournalRows(rows: readonly unknown[]): JournalEntry[] {
  const entries: JournalEntry[] = []

  for (const row of rows) {
    if (!isRow(row)) continue
    const id = row['id']
    const at = row['at']
    const tool = row['tool']
    const label = row['label']
    const calls = row['calls']
    const nodes = row['nodes']
    const edges = row['edges']
    if (typeof id !== 'string' || typeof at !== 'string') continue
    if (typeof tool !== 'string' || typeof label !== 'string') continue
    if (!Array.isArray(nodes) || !Array.isArray(edges)) continue

    entries.push({
      id,
      at,
      tool,
      input: row['input'],
      label,
      calls: Array.isArray(calls) ? (calls as ToolName[]) : [],
      nodes: nodes as RecordDelta<StoredNode>[],
      edges: edges as RecordDelta<StoredEdge>[],
    })
  }

  // Oldest first, which is the order a Ring's `load` wants and the order the
  // `ops` store's autoincrementing keys already put them in. Sorted rather than
  // trusted: a prune-and-renumber pass rewrites those keys, and a rehydrate
  // after another tab's prune would otherwise read the audit inside out.
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return entries
}

/* ---------------------------------- rings --------------------------------- */

/**
 * Session-scoped, depth 50.
 *
 * An undo stack that survived a reload would invite "undo last Tuesday", and
 * undoing across a reload needs conflict rules this app does not have: the
 * before-image was captured against a store that another tab may since have
 * written to, and replaying it would clobber whatever they did.
 */
export const UNDO_DEPTH = 50

/**
 * Persisted, capped 200, pruned on open.
 *
 * The rows are free to keep and are the debugging tool you will want the first
 * time someone says a record changed by itself. Capped because an unbounded
 * journal of whole-record images grows faster than the records themselves.
 */
export const AUDIT_CAP = 200

/**
 * A bounded FIFO that drops from the front.
 *
 * Not an array with a `.slice()` at every call site: three of them exist (undo,
 * redo, audit) with three different capacities, and the one that forgot to trim
 * would be the one holding whole before-images of every write in the session.
 */
export class Ring<T> {
  private items: T[] = []
  readonly capacity: number

  // Written out rather than as a parameter property: `erasableSyntaxOnly` is on,
  // and a constructor parameter with a modifier emits code rather than erasing.
  constructor(capacity: number) {
    this.capacity = capacity
  }

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity)
  }

  /** Newest first — the order both the Undo menu and the audit log read in. */
  get entries(): readonly T[] {
    return [...this.items].reverse()
  }

  get size(): number {
    return this.items.length
  }

  pop(): T | undefined {
    return this.items.pop()
  }

  clear(): void {
    this.items = []
  }

  /** Seeds the ring from rows read off disk, oldest first, trimming to capacity. */
  load(items: readonly T[]): void {
    this.items = items.slice(-this.capacity)
  }
}
