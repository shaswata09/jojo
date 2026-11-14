/**
 * What the restore path may strip or re-address to keep a record, and how.
 * Used by `validateRows` in `validate-rows.ts` when `salvage` is set.
 */

import type { NodeType, StoredNode } from './model'
import { uniqueSlug } from './ref'
import type { Diagnostic } from './validate-diagnostic'
import { diagnostic } from './validate-diagnostic'
import { isRow } from './validate-records'

/**
 * Props whose only job is pointing at a file, and which a restore may drop.
 *
 * A node fails validation as a WHOLE — one bad value and the record, its name,
 * its note and every edge incident to it are gone. That is right for a store
 * that came out of a transactional database, and wrong for `jojo/graph.json`,
 * which is explicitly a disposable mirror on a user's disk that they may copy,
 * sync, restore from a different moment, or edit by hand.
 *
 * Losing an application because one digit of a byte count is wrong, in a field
 * describing a document that is sitting right there in the same folder, is not
 * a trade worth making. These five are stripped and the record kept.
 *
 * `uri` joined them with the phone's file records. It belongs here for the same
 * reason and one extra: it is an absolute path into an app document directory
 * that a reinstall moves, so of the five it is the one most likely to be stale
 * in a backup a user restores months later. A stale `uri` costs an Open button;
 * dropping the whole application it was filed under costs the record.
 */
/*
 * `reading` is the sixth, and the only one that is not a link to bytes. It
 * earns its place on the same arithmetic: what it costs to strip is one model
 * call, and what it costs to keep is the whole file record.
 */
const SALVAGEABLE_FILE_PROPS = ['path', 'bytes', 'mtime', 'hash', 'uri', 'reading'] as const

/**
 * Props that may be dropped to keep the record, by the type that carries them.
 *
 * Was a single list for `file`, because `file` was the only type with one. An
 * application's `checklist` is the second, and it is the reason this generalised
 * rather than growing a second branch: the arithmetic is identical — what
 * stripping costs is a to-do list the person can ask for again, and what
 * keeping it costs is the application, its stage, its dates, its offer and
 * every edge pointing at it.
 *
 * A type absent from here has nothing droppable, and a malformed prop on one is
 * still what it always was: a database saying something impossible.
 */
const SALVAGEABLE_PROPS: Partial<Record<NodeType, readonly string[]>> = {
  file: [...SALVAGEABLE_FILE_PROPS, 'noteFormat'],
  application: ['checklist', 'stageDates', 'noteFormat'],
  keyword: ['ink'],
  // The text is the record; the formatting over it is not worth losing the
  // record for. Same trade as the application's note, one type up.
  snippet: ['bodyFormat'],
  person: ['briefs'],
}

/** What the restore summary says about each, in the person's terms. */
export const SALVAGE_NOTE: Partial<Record<NodeType, string>> = {
  file: 'Came back without its document link or its note formatting.',
  application: 'Came back without its checklist, its stage dates or its note formatting.',
  keyword: 'Came back in one of the eight named colours rather than its own.',
  person: 'Came back without the highlights and notes kept for their applications.',
}

/**
 * Strips whatever this row's type is allowed to lose. `null` when there is
 * nothing to strip, which is also the answer for a row whose type is unreadable.
 */
export function withoutSalvageable(row: unknown): { row: unknown; type: NodeType } | null {
  if (!isRow(row)) return null
  const props = row['props']
  const type = row['type']
  if (!isRow(props) || typeof type !== 'string') return null
  const droppable = SALVAGEABLE_PROPS[type as NodeType]
  if (droppable === undefined) return null
  const present = droppable.filter((k) => k in props)
  if (present.length === 0) return null
  const nextProps: Record<string, unknown> = { ...props }
  for (const k of present) delete nextProps[k]
  return { row: { ...row, props: nextProps }, type: type as NodeType }
}

/**
 * The salvage path's answer to two records of one type sharing a slug.
 *
 * `[type, slug]` is a unique index in IndexedDB (`by-type-slug`), so a backup
 * holding two keywords slugged 'remote' — a hand-merged file, or one written
 * before the rule was kept everywhere — made the store refuse the WHOLE restore
 * with a ConstraintError. The first keeps its address; each later one takes the
 * next free `-n`, the same way `mintSlug` would have, and is reported. Edges
 * join ids, not slugs, so nothing else moves.
 */
export function readdressed(nodes: readonly StoredNode[], skipped: Diagnostic[]): StoredNode[] {
  const taken = new Map<NodeType, Set<string>>()
  for (const node of nodes) {
    if (node.type === 'profile') continue
    let slugs = taken.get(node.type)
    if (!slugs) taken.set(node.type, (slugs = new Set()))
    slugs.add(node.props.slug)
  }
  const kept = new Map<NodeType, Set<string>>()
  return nodes.map((node) => {
    if (node.type === 'profile') return node
    let mine = kept.get(node.type)
    if (!mine) kept.set(node.type, (mine = new Set()))
    const slug = node.props.slug
    if (!mine.has(slug)) {
      mine.add(slug)
      return node
    }
    // Free against EVERY slug of this type in the file, not only the ones seen
    // so far — a later record may already be called 'remote-2'.
    const all = taken.get(node.type) ?? new Set<string>()
    const next = uniqueSlug(slug, all)
    all.add(next)
    mine.add(next)
    skipped.push(
      diagnostic('nodes', node.id, `Shared the address '${slug}' with another ${node.type}; it is now '${next}'.`),
    )
    return { ...node, props: { ...node.props, slug: next } } as StoredNode
  })
}
