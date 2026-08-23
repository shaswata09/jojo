/**
 * Putting a backup back.
 *
 * Nothing here is new machinery. `Repository.replaceAll` already existed and is
 * documented on the Driver as "Wholesale replace in one transaction: demo /
 * empty / import" — the import case was written and never called.
 * `validateRows(..., { salvage: true })` says in its own comment that it is
 * "used ONLY on the restore path", and until now had no caller outside its test.
 * This is the caller both were waiting for.
 *
 * ## Why the rows are validated even though jojo wrote them
 *
 * A backup is a file on someone's disk. It can be edited, truncated by a failed
 * download, merged by a sync client, or written by a jojo three versions older
 * than this one. `readBackup` has already refused anything malformed at the
 * envelope level; this is the second gate, on the records themselves, and it
 * SALVAGES rather than refuses — a single unreadable row in a backup of four
 * hundred should cost the user that row, not the restore.
 *
 * ## The order, which is the only interesting decision
 *
 * Graph first, documents second. Both orders lose something if the second half
 * fails, and this is the one that fails better: records with some documents
 * missing is a state the app already renders correctly — the row says the
 * document is not on this device — and re-importing the same file fixes it.
 * The reverse leaves documents belonging to records that do not exist, which
 * nothing displays and nothing can clean up.
 *
 * ## What a restore costs, stated because it cannot be undone
 *
 * `replaceAll` passes `ops: []`, so the journal goes: there is no undo of a
 * restore, and no undo of anything that happened before it. That is not an
 * oversight to fix here — every before-image in the journal describes a record
 * that no longer exists.
 */

import { validateRows } from '@jojo/service/core/validate'
import type { RestorePlan } from '@jojo/service/core/backup'
import type { Repository } from '@jojo/service/repo/repository'
import type { StoreMeta } from '@jojo/service/repo/meta'
import type { VaultBlobs } from '@/lib/vault-blobs'

export type RestoreOutcome =
  | {
      ok: true
      /** What went in, after salvage. */
      nodes: number
      edges: number
      documents: number
      /** Rows the backup held that could not be read. Zero in the normal case. */
      skipped: number
    }
  | { ok: false; message: string }

/**
 * The meta row a restored store should carry.
 *
 * `dataSet: 'user'` because restored records are the user's, whatever they were
 * in the store that produced the backup — a restore of a demo store is still a
 * deliberate act, and marking it 'demo' would make jojo offer to replace it.
 * `createdAt` and `schemaVersion` come from the store already on disk rather
 * than from the backup: this database was created when it was created, and the
 * schema it speaks is this build's, not the one that wrote the file.
 */
export function metaForRestore(current: StoreMeta, at: string): StoreMeta {
  return { ...current, dataSet: 'user', seededAt: null, lastOpenedAt: at }
}

export async function restoreBackup(
  repo: Repository,
  blobs: Pick<VaultBlobs, 'replaceAll'>,
  plan: RestorePlan,
  at: string,
): Promise<RestoreOutcome> {
  // Salvage rather than refuse: `validateRows` drops a row it cannot read and
  // reports it, which is the right trade when the alternative is refusing a
  // whole backup over one damaged record.
  const checked = validateRows(plan.nodes, plan.edges, { salvage: true })
  if (checked.nodes.length === 0 && plan.nodes.length > 0) {
    return {
      ok: false,
      message: 'Not one record in that file could be read. Nothing has been changed.',
    }
  }

  const swapped = await repo.replaceAll(
    { nodes: checked.nodes, edges: checked.edges },
    metaForRestore(repo.meta, at),
  )
  if (!swapped.ok) {
    return {
      ok: false,
      message: `The records could not be written: ${swapped.error.message}. Nothing has been changed.`,
    }
  }

  // Documents second, and as a replace rather than a merge: leaving the previous
  // store's documents behind would mean a restored jojo holding files belonging
  // to records that no longer exist, taking up a quota nothing can account for.
  const documents = await blobs.replaceAll(plan.documents)

  return {
    ok: true,
    nodes: checked.nodes.length,
    edges: checked.edges.length,
    documents,
    skipped: checked.skipped.length,
  }
}
