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

import { EDGE_SCHEMA } from '../core/model'
import type {
  EdgeId,
  Instant,
  NodeId,
  NodePropsByType,
  NodeType,
  StoredEdge,
  StoredNode,
} from '../core/model'

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
  /**
   * Set on an entry `revert` wrote: which entry it took back, what that action
   * was called, and whether the action now stands undone.
   *
   * Without it an undo was journalled under the original tool AND label, so the
   * audit log showed "Rice added" twice and nothing said the second one was its
   * opposite. `label` now says so ("Undo Rice added" / "Redo Rice added"), and
   * `of` keeps the plain name for the ⌘Z toast, which announces "Undone · Rice
   * added" rather than "Undone · Undo Rice added".
   */
  reverts?: {
    id: string
    of: string
    undone: boolean
    /**
     * The entry at the bottom of the undo/redo chain — the tool commit every
     * revert in it takes back or puts back.
     *
     * A step's Undo (`undoStep`) and a toast's Undo (`undoableWith`) have to
     * find the change after ⌘Z/⇧⌘Z moved it under a redo's id. They walked
     * `reverts.id` back through the AUDIT ring, which holds 200 rows shared with
     * every `stack: false` system write — so after a burst of fit readings the
     * walk broke and the Undo silently did nothing. Stamped on every revert, it
     * is answered from the entry itself. Optional: rows written before it
     * existed lack it, and `rootOf` falls back to the walk for those.
     */
    root?: string
  }
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
    if (image === null) continue
    // Removed, then put back, because `putEdge` is insert-if-absent: the real
    // writer (`MutableSnapshot.putEdge`) returns early on an id it already
    // holds. So an edge delta with BOTH images set never reached memory, while
    // `opsFor` wrote the `after` image to disk in the same commit — the two
    // copies then disagreed until the next reload. `fileUnder` (`tools/vault.ts`)
    // makes that delta on every save: it unlinks every FILED_UNDER edge and
    // writes them all back, so re-saving an untouched form restamps
    // `createdAt`. Measured against the code before this line: memory held
    // 15:00:02 and the ops store held 15:00:04 for the same edge.
    //
    // Remove-then-insert rather than letting `putEdge` overwrite, because
    // `#degrees` is a counter the writer increments on insert — a put over a
    // live id would add a second degree to both ends of an edge that was
    // already there, and degree is what the graph reports as a record's links.
    s.removeEdge(delta.id)
    s.putEdge(image)
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
 * The image without the fields the writer stamps whether or not anything moved.
 *
 * `updatedAt` is not something the user did — `tx.patch` writes it on every
 * call, including the call that wrote the same values back.
 *
 * `createdAt` is here for the SAME reason, one record type over, and leaving it
 * out was a real bug. Nodes carry `updatedAt`; edges carry only `createdAt`, and
 * an edge that is unlinked and relinked to the same target comes back with a
 * fresh stamp and nothing else different. `fileUnder` did exactly that on every
 * save, so re-saving a document with its filing untouched read as a change:
 * the entry went onto the undo ring and cleared the redo stack, and the next
 * Ctrl+Z restored a timestamp while the edit before it stayed put.
 *
 * Stripping it cannot hide user content. Both are stamps — nothing a person
 * typed lives in either — so a pair of images identical apart from them
 * describes a write that changed nothing, which is precisely what this asks.
 */
const withoutStamp = (image: unknown): unknown => {
  if (typeof image !== 'object' || image === null) return image
  const rest: Record<string, unknown> = { ...(image as Record<string, unknown>) }
  delete rest['updatedAt']
  delete rest['createdAt']
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
      // Carried, and it is the one field here that is not just envelope.
      //
      // `trimmed` is what tells an entry whose images were DROPPED from one that
      // genuinely touched nothing, and it is written to disk by the prune in
      // `boot-ready.ts`. Reading it back as absent meant `trimJournal`'s
      // "already trimmed" short-circuit never fired on a row it had trimmed on
      // an earlier launch: it rebuilt those entries every time, so the identity
      // check in `boot-ready.ts` was true on every open, and every open cleared
      // the `ops` store and wrote all 200 rows back unchanged — logging 'pruned
      // the audit log from 200 to 200 entries' each launch. Measured on a
      // fifteen-row store: launch two cleared `ops` and re-put all fifteen. On
      // the phone that is the entire store rewritten for no change, because
      // `rn-driver` holds all four stores in one AsyncStorage key.
      //
      // It also re-arms `revert`'s refusal. `boot-live.ts` seeds the audit ring
      // straight from here on a cross-tab rehydrate, and an entry that arrived
      // with `trimmed` missing and both images null passes the guard in
      // `repository.ts` — landing an `invert` of two nulls, which is a "revert"
      // that deletes every record the entry named.
      //
      // Spread rather than assigned: `exactOptionalPropertyTypes` is on, and the
      // key must be ABSENT — not `undefined` — on every entry inside the undo
      // window and every row written before this field existed.
      ...(row['trimmed'] === true ? { trimmed: true as const } : {}),
      ...readReverts(row['reverts']),
    })
  }

  // Oldest first, which is the order a Ring's `load` wants and the order the
  // `ops` store's autoincrementing keys already put them in. Sorted rather than
  // trusted: a prune-and-renumber pass rewrites those keys, and a rehydrate
  // after another tab's prune would otherwise read the audit inside out.
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return entries
}

/** `reverts` off disk, kept only when it is the shape `revert` writes. */
function readReverts(value: unknown): { reverts?: NonNullable<JournalEntry['reverts']> } {
  if (!isRow(value)) return {}
  const { id, of, undone, root } = value
  if (typeof id !== 'string' || typeof of !== 'string' || typeof undone !== 'boolean') return {}
  return { reverts: { id, of, undone, ...(typeof root === 'string' ? { root } : {}) } }
}

/* --------------------------------- revert --------------------------------- */

/** What `revertDraft` reads the live records through. `GraphSnapshot` satisfies it. */
export type GraphReader = {
  node(id: NodeId): StoredNode | undefined
  edge(id: EdgeId): StoredEdge | undefined
  /** Edges pointing AT a record: what decides whether a created record can go. See `keepReferenced`. */
  in(id: NodeId): readonly StoredEdge[]
}

type Image = Record<string, unknown>

/**
 * Props that are written together and mean something only together.
 *
 * Field-level revert put back each key on its own, so a stage move split: move
 * to Submitted (stamps `submittedOn`), then to Interview, then Undo the first —
 * `stage` had moved on and stayed, `submittedOn` had not and went, and the
 * record sat at Interview with no date it was ever submitted. A group goes back
 * whole or not at all: if any key in it has moved since, every key in it keeps
 * its live value.
 *
 * Declared per node type here rather than by each tool, because L2 may not
 * import the tool registry and a group is a property of the RECORD (any tool
 * that moves a stage writes these together), not of one tool. Typed against
 * the props so a renamed field fails to compile here.
 *
 * `lastAction`/`lastActionAt` are deliberately NOT in the stage group. Every
 * write stamps them (`touch`), so with them inside, editing a note after a
 * stage move would pin the move and its Undo would do nothing. They revert per
 * key as before, which already leaves them alone once a later write restamps.
 * A text and its formatting are a group because spans are offsets into that
 * exact text: reverting one without the other misplaces every span.
 */
const FIELD_GROUPS: { readonly [T in NodeType]?: readonly (readonly (keyof NodePropsByType[T] & string)[])[] } = {
  application: [
    ['stage', 'submittedOn', 'appliedOn', 'firstReplyOn', 'stageDates', 'outcome'],
    ['note', 'noteFormat'],
  ],
  file: [['note', 'noteFormat']],
  snippet: [['body', 'bodyFormat']],
}

/**
 * `live`, with every key `forward` changed and nobody has changed since put back
 * to `back`. One level deep; `props` goes one level further.
 *
 * A key the entry did not change keeps its live value, and a key somebody has
 * written since keeps theirs: the later write wins, because it is the one the
 * user (or the system) did last. `groups` (for `props`) widens "a key" to a set
 * of keys that move as one — see `FIELD_GROUPS`.
 */
function mergeBack(
  live: Image,
  forward: Image,
  back: Image,
  nested: boolean,
  groups: readonly (readonly string[])[] = [],
): Image {
  const out: Image = { ...live }
  const grouped = new Map<string, readonly string[]>()
  for (const group of groups) for (const key of group) grouped.set(key, group)
  const settled = new Set<string>()
  for (const key of new Set([...Object.keys(forward), ...Object.keys(back)])) {
    const f = forward[key]
    const b = back[key]
    if (nested && key === 'props' && isRow(f) && isRow(b) && isRow(live[key])) {
      const type = typeof forward['type'] === 'string' ? (forward['type'] as NodeType) : undefined
      out[key] = mergeBack(live[key], f, b, false, type ? (FIELD_GROUPS[type] ?? []) : [])
      continue
    }
    const group = grouped.get(key)
    if (group) {
      if (settled.has(key)) continue
      for (const k of group) settled.add(k)
      // Any key of the group written since pins the whole group as it is now.
      if (group.some((k) => !sameImage(live[k], forward[k]))) continue
      for (const k of group) {
        if (sameImage(forward[k], back[k])) continue
        if (k in back) out[k] = back[k]
        else delete out[k]
      }
      continue
    }
    if (sameImage(f, b) || !sameImage(live[key], f)) continue
    if (key in back) out[key] = b
    else delete out[key]
  }
  return out
}

/**
 * One delta of an entry, replayed backwards against what is live NOW.
 *
 * Returns the delta to commit — `before` is the live record, so the journal row
 * and the next revert (redo) read what really happened — or `null` for nothing.
 */
function revertDelta<T extends StoredNode | StoredEdge>(
  delta: RecordDelta<T>,
  live: T | undefined,
): RecordDelta<T> | null {
  const now = live ?? null
  // Untouched since: the stored image goes back exactly, byte for byte.
  if (sameImage(now, delta.after)) {
    return now === null && delta.before === null ? null : { id: delta.id, before: now, after: delta.before }
  }
  // The entry created it: undoing the creation removes it, whatever has been
  // written to its own fields since. Already gone is nothing to do. Whether a
  // later record still hangs on it is `keepReferenced`'s question, below.
  if (delta.before === null) return now === null ? null : { id: delta.id, before: now, after: null }
  // The entry deleted it and it is back (only another revert does that), or
  // the entry edited it and it has since been deleted: the later write stands.
  if (delta.after === null || now === null) return null
  const merged = mergeBack(
    now as unknown as Image,
    delta.after as unknown as Image,
    delta.before as unknown as Image,
    true,
  ) as unknown as T
  return sameImage(merged, now) ? null : { id: delta.id, before: now, after: merged }
}

/**
 * The draft minus the removal of any record a later write still depends on.
 *
 * `revertDelta` removes a record the entry created "whatever has been written
 * to it since", and that was right for the record's own fields and wrong for
 * what OTHER records say about it. Creating the first job at Rice creates the
 * Rice organisation; a second job at Rice links to it. Undoing the first job
 * removed the organisation, and `withDisplacedEdges` then took the second
 * job's `AT` edge with it — a later, unrelated application left with no
 * employer.
 *
 * So a created record stays when a live edge of a `fromCardinality: 'one'`
 * relation — the source's single slot, such as an application's employer —
 * points at it from a record that stays. Only those: a keyword's tag, a
 * reminder's ABOUT and a document's FILED_UNDER are associations that D15
 * already lets a deletion drop, so tagging a new application inside its Undo
 * window does not pin it. Iterated, because a kept record keeps the links it
 * hangs by: a kept application keeps its employer. What stays is only what
 * something else needs; everything else the entry linked still comes out.
 */
function keepReferenced(
  nodes: RecordDelta<StoredNode>[],
  edges: RecordDelta<StoredEdge>[],
  live: GraphReader,
): { nodes: RecordDelta<StoredNode>[]; edges: RecordDelta<StoredEdge>[] } {
  const removing = new Set(nodes.filter((d) => d.after === null).map((d) => d.id))
  if (removing.size === 0) return { nodes, edges }
  // The entry's own links that this draft takes out. One of those holds a
  // record only when its source is itself being kept; any other live edge was
  // written after the entry and holds it when its source stays.
  const unlinking = new Set(edges.filter((d) => d.after === null).map((d) => d.id))
  const kept = new Set<string>()
  const stays = (id: string) => !removing.has(id) || kept.has(id)

  for (let grew = true; grew; ) {
    grew = false
    for (const id of removing) {
      if (kept.has(id)) continue
      const held = live
        .in(id as NodeId)
        .some(
          (e) =>
            EDGE_SCHEMA[e.rel].fromCardinality === 'one' &&
            (unlinking.has(e.id) ? kept.has(e.from) : stays(e.from)),
        )
      if (held) {
        kept.add(id)
        grew = true
      }
    }
  }
  if (kept.size === 0) return { nodes, edges }

  // A link survives when both ends stay and it belongs to a kept record: a
  // one-slot link belongs to its source; an association to either end.
  const keepsLink = (e: StoredEdge) =>
    stays(e.from) &&
    stays(e.to) &&
    (kept.has(e.from) || (EDGE_SCHEMA[e.rel].fromCardinality === 'many' && kept.has(e.to)))
  return {
    nodes: nodes.filter((d) => !kept.has(d.id)),
    edges: edges.filter((d) => d.after !== null || d.before === null || !keepsLink(d.before)),
  }
}

/**
 * The draft that takes `entry` back, rebased onto the records as they are now.
 *
 * `invert` replays whole before-images, which is only right while nothing has
 * written those records since. Writes off the undo ring do — `fit.reading.set`
 * stores its reading on the very file whose note was just edited, a file's
 * bytes attach seconds after the drop — and ⌘Z of the note used to land the
 * whole old file image and erase the reading with it. An agent step's Undo
 * reaches past later steps the same way. So a revert puts back only what the
 * entry changed, field by field, and only where the field still holds what the
 * entry left: everything written since survives, in both directions, because
 * redo is a revert of this.
 */
export function revertDraft(
  entry: JournalEntry,
  live: GraphReader,
  label: string,
  undone: boolean,
  audit: readonly JournalEntry[] = [],
): JournalDraft {
  const nodes: RecordDelta<StoredNode>[] = []
  const edges: RecordDelta<StoredEdge>[] = []
  for (const d of entry.nodes) {
    const back = revertDelta(d, live.node(d.id as NodeId))
    if (back) nodes.push(back)
  }
  for (const d of entry.edges) {
    const back = revertDelta(d, live.edge(d.id as EdgeId))
    if (back) edges.push(back)
  }
  const kept = keepReferenced(nodes, edges, live)
  return {
    tool: entry.tool,
    input: entry.input,
    label,
    calls: entry.calls,
    nodes: kept.nodes,
    edges: kept.edges,
    reverts: { id: entry.id, of: entry.reverts?.of ?? entry.label, undone, root: rootOf(entry, byIdOf(audit)) },
  }
}

const byIdOf = (audit: readonly JournalEntry[]) => {
  let index: Map<string, JournalEntry> | undefined
  return (id: string) => {
    index ??= new Map(audit.map((e) => [e.id, e]))
    return index.get(id)
  }
}

/**
 * The tool commit at the bottom of `entry`'s undo/redo chain.
 *
 * `reverts.root` when the entry carries it. A row written before that field
 * existed is walked back through `reverts.id` against `find` — which is only as
 * deep as the audit ring, and the reason the field was added.
 */
function rootOf(entry: JournalEntry, find: (id: string) => JournalEntry | undefined): string {
  let at: JournalEntry | undefined = entry
  for (let hops = 0; at?.reverts !== undefined && hops < AUDIT_CAP; hops += 1) {
    if (at.reverts.root !== undefined) return at.reverts.root
    const next = find(at.reverts.id)
    if (next === undefined) return at.reverts.id
    at = next
  }
  return at?.id ?? entry.id
}

/**
 * The entry on the undo ring that stands for the change `id` made, if any.
 *
 * `id` itself while ⌘Z has not touched it; after ⌘Z then ⇧⌘Z, the redo — a
 * revert whose chain bottoms out at `id` and that left it NOT undone. Nothing
 * when the change is undone, or has aged off the ring. Shared by a step's Undo
 * (`undoStep` in `tools/runtime.ts`) and a toast's (`undoableWith` in
 * `react/undo.ts`), which used to disagree about the same entry.
 */
export function standingFor(
  id: string,
  undoable: readonly JournalEntry[],
  audit: readonly JournalEntry[] = [],
): JournalEntry | undefined {
  const find = byIdOf(audit)
  return undoable.find(
    (e) => e.id === id || (e.reverts?.undone === false && rootOf(e, find) === id),
  )
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
