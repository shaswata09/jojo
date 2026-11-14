/**
 * L3 — what the vault tools share: the filing list, the blank-field rule, and
 * `fileUnder`, which files a record under exactly the applications given.
 *
 * The tools themselves are split by the record they write — `vault-people.ts`,
 * `vault-links.ts`, `vault-files.ts` and `vault-snippets.ts` — and this is the
 * only thing they have in common. Everything here is a helper, not a tool, so
 * `tools/index.ts` registers nothing from this file.
 *
 * Three collections that take the same three edits, so the shape in those
 * files repeats on purpose rather than being generalised: `useCollectionActions`
 * (in the removed `store-context.ts`) proved one generic serves them, and it also
 * proved what that costs — the generic could not carry a rule that belonged to
 * one of them, so `savedOn`, the id prefix and the name field all had to be
 * passed in as parameters and the call sites became the documentation.
 *
 * No file bytes. `lib/files.ts`'s header — "Nothing here reads file CONTENT" — is
 * the existing statement of this and D27 makes it an invariant: `props` is
 * binary-free, so `getAll('nodes')` stays a five-millisecond operation. A file
 * record is a name, a size label and a bucket.
 */

import type { NodeId } from '../core/model'
import { s } from '../core/schema'
import type { ToolContext } from './tool'

/** `null` unfiles it; absent leaves the edge alone. The two are not the same. */
/**
 * The applications a record is filed under, as a SET.
 *
 * A list, since `FILED_UNDER` became `fromCardinality: 'many'`. Absent means
 * "leave the filing alone" and an empty list means "file it under nothing",
 * which are different instructions — renaming a link must not unfile it.
 */
export const applicationIds = s.optional(
  s.nullable(s.array(s.id('application'), { label: 'Filed under' })),
)

export const cleared = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() || undefined

/**
 * Files a record under exactly the applications given.
 *
 * A SET operation, not an add: the whole list replaces whatever was there, so a
 * caller passing three ids gets three edges and passing two of the same three
 * drops the one it left out. `FILED_UNDER` is `fromCardinality: 'many'` now, so
 * `tx.link` no longer displaces the previous edge on its own — the `unlinkAll`
 * is what makes this a set rather than an ever-growing pile.
 *
 * Absent still means "leave it where it is", or renaming a link would unfile it
 * from every application it was saved against.
 */
export function fileUnder(ctx: ToolContext, id: NodeId, appIds: readonly NodeId[] | null | undefined) {
  if (appIds === undefined) return

  /*
   * Wholesale, and deliberately so after measuring the alternative.
   *
   * The obvious improvement is to unlink only what is no longer wanted, the way
   * `keyword.record.set` reads. Measured, it changes nothing: the link half
   * still runs for every wanted id — `keyword.record.set` does the same — so a
   * no-op save produces one edge delta either way, and no test at this boundary
   * can tell the two apart.
   *
   * What DID matter was the journal's reading of that delta. An edge carries
   * only `createdAt`, and `withoutStamp` stripped only `updatedAt`, so a
   * relinked edge looked like a change: a save over an untouched form took the
   * top of the undo ring and cleared the redo stack. That is fixed in
   * `repo/journal.ts`, where the cause was.
   *
   * An edge that survives the rewrite keeps its props. A person's edge carries
   * their role on that job (`ContactRole`), and `link` mints a fresh `{}` edge,
   * so without this every save of the Vault's person form — which sends the
   * whole filing back — would quietly forget who was a recommender where.
   */
  const kept = new Map(ctx.memory.out(id, 'FILED_UNDER').map((e) => [e.to, e.props]))
  ctx.tx.unlinkAll(id, { rel: 'FILED_UNDER' })
  if (appIds === null) return
  for (const appId of appIds) ctx.tx.link(id, 'FILED_UNDER', appId, kept.get(appId) ?? {})
}
