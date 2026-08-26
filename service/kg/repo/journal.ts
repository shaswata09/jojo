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
 * ids pointing at it from five collections (in the removed `store-context.ts`) and got
 * it right, while `removeLabel` captured three separate pieces of provider state
 * (the old `removeLabel` in `labels.tsx`) and `revertOf` (in
 * `routes/ApplicationDetail.tsx`) captured a
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
  /**
   * The record images were dropped to keep the persisted journal small.
   *
   * See `trimJournal`. The deltas and their ids remain, so the log still says
   * how much an entry touched; what is gone is the before/after, so this entry
   * can be READ and not reverted. Absent on every entry inside the undo window
   * and on every entry written before this existed, which is why it is optional
   * rather than a boolean that an old stored row would be missing.
   */
  trimmed?: true
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
 *
 * It replays the entry and NOTHING ELSE. A real `GraphWriter` — `MutableSnapshot`
 * — cascades incident edges out of `removeNode` to keep that same invariant, and
 * an edge removed that way is not in the entry, so it reaches no durable op and
 * no before-image. Naming the displaced edges is the caller's job, before it
 * gets here: `withDisplacedEdges` in `repository.ts`, which is the replay-side
 * counterpart of `tx.del`'s `dropIncident`.
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

/**
 * Structural equality over stored images. No library, and no `JSON.stringify`.
 *
 * Stringifying compares key ORDER as well as content, and `tx.patch` rebuilds
 * `props` by spreading and reassigning — so deleting a key and putting it back
 * with the same value moves it, and two identical records would have compared
 * unequal for a reason nobody could see in the values. Images are plain JSON by
 * construction: `props` is binary-free (D27) and every stored field is a string,
 * number, boolean, array or record.
 */
function sameImage(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameImage(item, b[index]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  // `in` rather than `!== undefined`: an explicitly-undefined key is a DIFFERENT
  // record from an absent one everywhere else in this codebase (D21), and a
  // comparison that folded them together would report a change as a no-op.
  return keys.every((key) => key in right && sameImage(left[key], right[key]))
}

/**
 * The image without the field the writer stamps whether or not anything moved.
 *
 * `updatedAt` is excluded because it is not something the user did — `tx.patch`
 * writes it on every call, including the call that wrote the same values back.
 */
const withoutStamp = (image: unknown): unknown => {
  if (typeof image !== 'object' || image === null) return image
  const rest: Record<string, unknown> = { ...(image as Record<string, unknown>) }
  delete rest['updatedAt']
  return rest
}

/** A create or a delete is always a change: one side is null. */
const isNoOp = <T>(delta: RecordDelta<T>): boolean => {
  if (delta.before === null || delta.after === null) return delta.before === delta.after
  return sameImage(withoutStamp(delta.before), withoutStamp(delta.after))
}

/**
 * Whether an entry left every record exactly as it found it.
 *
 * The question the undo stack needs answered, and it is not "does the entry have
 * deltas". That spelling was unanswerable-by-construction for every patch-based
 * tool: `tx.patch` writes `updatedAt: instant` whether or not anything else
 * moved, so a Save pressed over an unchanged form always staged one node delta,
 * always looked like a change, and always took the top of the undo stack — so
 * the next Ctrl+Z restored a timestamp and left the edit before it in place.
 *
 * Such an entry is still committed and still audited: "you pressed save and
 * nothing happened" is worth being able to see, and the timestamp is a real
 * write. It just is not what Undo means.
 */
export const changesNothing = (entry: Pick<JournalEntry, 'nodes' | 'edges'>): boolean =>
  entry.nodes.every(isNoOp) && entry.edges.every(isNoOp)

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
 * The persisted journal, with the record images dropped from the old entries.
 *
 * ## What this costs when it is not done
 *
 * Measured on the benchmark world with the ring full — 30 nodes and 13 edges of
 * actual graph:
 *
 *     nodes + edges     12.3 KB
 *     journal          228.5 KB   (200 entries)
 *     journal share        95% of every persisted blob
 *
 * On the phone that is not a storage number, it is a WRITE number: `rn-driver`
 * holds the whole store in one AsyncStorage key so that a commit is atomic
 * across its four stores, and rewrites the key on every commit. So every edit
 * serialised a quarter of a megabyte of history to save a note.
 *
 * ## Why the images can go
 *
 * A `RecordDelta` carries the whole record before and after, and two things
 * read them: the undo ring, which is in memory and does not survive a reload,
 * and `revert`, which the audit log offers on the NEWEST entry only. Everything
 * else the log renders is the label, the time, and how many records and links
 * an entry touched — and the counts are the LENGTHS of these arrays, not their
 * contents.
 *
 * So the deltas stay, with their ids, and the images are dropped beyond
 * `REVERTABLE_DEPTH` — which is about what a RELOAD can still undo, not what
 * the in-memory ring can. The lengths are unchanged, so the log reads exactly as
 * it did. `trimmed` marks it, because an entry whose `before` and `after` are
 * both null is otherwise indistinguishable from one that genuinely touched
 * nothing, and `revert` must be able to tell those apart rather than silently
 * "undoing" a change by writing nulls over a live record.
 */
/**
 * How many entries keep their record images when the journal is persisted.
 *
 * NOT `UNDO_DEPTH`, and the difference is the whole reason this number exists.
 * `UNDO_DEPTH` is the in-memory ring, and `rehydrate` clears it — undo does not
 * survive a reload, and never has. What DOES survive is the audit log, and the
 * only thing it can revert is its newest entry. So the images that outlive a
 * session buy exactly one undo.
 *
 * Ten rather than one, because "one" is the number that is exactly right today
 * and breaks silently the day the log offers undo on more than its top row —
 * and the failure would be a button that throws. Ten is headroom at a cost of
 * about eleven kilobytes.
 */
export const REVERTABLE_DEPTH = 10

export function trimJournal(
  entries: readonly JournalEntry[],
  keepImages = REVERTABLE_DEPTH,
): JournalEntry[] {
  // The newest are last, matching `slice(-AUDIT_CAP)` above and the store's
  // ascending keys. Getting this backwards would trim exactly the entries undo
  // needs and keep the ones nothing reads.
  const firstKept = Math.max(0, entries.length - keepImages)
  return entries.map((entry, i) => {
    if (i >= firstKept || entry.trimmed === true) return entry
    return {
      ...entry,
      trimmed: true as const,
      // `input` and `calls` go with the images, and for the same reason: the
      // only thing that reads either is `invert`, and a trimmed entry cannot be
      // inverted. `input` is the larger of the two by far — it is the tool's
      // whole argument object, so an edit that saved a long note stored that
      // note twice, once in the record and once here.
      //
      // `tool` STAYS. The log reads it (`NO_UNDO` is a list of tool names) and
      // it is six characters.
      input: null,
      calls: [],
      nodes: entry.nodes.map((d) => ({ id: d.id, before: null, after: null })),
      edges: entry.edges.map((d) => ({ id: d.id, before: null, after: null })),
    }
  })
}

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
