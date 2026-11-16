/**
 * The last step of a transfer: bytes that arrived, becoming records.
 *
 * Everything before this had a home and a test. `handoff-receive.ts` agrees the
 * key and holds the socket open, `core/convoy.ts` decrypts and authenticates
 * the stream, `core/backup.ts` refuses a file it does not understand, and
 * `repo/restore.ts` puts the rows back. What was missing was the call that
 * joins them — the payload was decrypted, authenticated in full, and then
 * dropped on the floor. The phone did every expensive and every dangerous part
 * of a transfer correctly and kept nothing.
 *
 * ## Why the decode is not `TextDecoder`
 *
 * Because Hermes does not have one. See `core/utf8.ts`, which exists for this
 * caller and explains what it costs to find that out the hard way.
 *
 * ## The order, and the one thing that is phone-specific
 *
 * A backup's file nodes point at documents by a uri that means whatever the
 * device that wrote it meant. So the destinations are worked out first, written
 * into the nodes, and honoured when the bytes land — see `restore-documents.ts`
 * for why that has to happen in that order.
 *
 * Everything else is the shared path, deliberately: a phone and a laptop must
 * not disagree about what restoring a backup means, because the disagreement
 * would only ever show up after somebody's records had already been replaced.
 */

import { readBackup, type RestorePlan } from '@jojo/service/core/backup'
import { decodeUtf8 } from '@jojo/service/core/utf8'
import { stripBom } from '@/lib/import-backup'
import { restoreBackup, type RestoreOutcome } from '@jojo/service/repo/restore'

/** Re-exported for the import screen, which may not reach into the repo layer itself. */
export type { RestoreOutcome }
import { handedOver } from '@jojo/service/repo/meta'
import type { Instant } from '@jojo/service/core/model'
import type { Repository } from '@jojo/service/repo/repository'
import {
  createDocumentStore,
  forgetUris,
  heldDocuments,
  orphanedUris,
  plannedUris,
  withDocumentUris,
} from '@/lib/restore-documents'

/**
 * Replaces everything on this phone with what arrived.
 *
 * There is no confirmation step in here and there should not be: the person
 * holding this phone started the transfer, watched it pair, and is looking at
 * the progress bar. Asking again at the end would be asking about a decision
 * they have already made twice.
 */
/**
 * The received bytes as a plan, WITHOUT writing anything.
 *
 * Split from `applyReceived` so a confirmation can happen between reading and
 * destroying. Applying used to begin the instant the last chunk authenticated:
 * the poll saw `complete`, called `applyReceived`, and `replaceAll` took every
 * record, every document and the journal off the phone with nothing on screen
 * asking first.
 *
 * The argument against a confirmation was that the person "watched it pair".
 * Pairing is consent to receive; it is not consent to destroy what is already
 * here, and the two are only the same when the phone is empty — which is the
 * one case where the confirmation costs nothing anyway.
 */
export function planReceived(
  payload: Uint8Array,
): { ok: true; plan: RestorePlan } | { ok: false; message: string } {
  // A leading U+FEFF is dropped before parsing: `decodeUtf8` keeps it, and
  // `JSON.parse` refuses a whole backup over it. See `stripBom`.
  const read = readBackup(stripBom(decodeUtf8(payload)))
  if (!read.ok) {
    // Authenticated bytes that are not a backup. Not an attack — GCM already
    // ruled that out — so it is a version mismatch or a truncated file, and the
    // message `readBackup` wrote is more specific than anything this could add.
    return { ok: false, message: read.error.message }
  }
  return { ok: true, plan: read.value }
}

/**
 * Writes a plan the user has agreed to. Destroys what is already here.
 *
 * `handover` says where the plan came from, and it is required rather than
 * defaulted so neither caller can get the other's meaning by omission: `true`
 * for a transfer from another device, `false` for a backup file or a paste the
 * person kept themselves — see the stamp at the end.
 */
export async function applyPlan(
  repo: Repository,
  plan: RestorePlan,
  at: string,
  { handover }: { handover: boolean },
): Promise<RestoreOutcome> {
  const uris = plannedUris(plan.documents)
  // What this phone holds now, read before the records are replaced: the copy
  // a record keeps when it arrives without its document, and the copies that
  // go when their record does.
  const held = await heldDocuments(repo.getSnapshot().ofType('file'))
  const nodes = withDocumentUris(plan.nodes, uris, held)
  const outcome = await restoreBackup(repo, createDocumentStore(), { ...plan, nodes }, at)
  if (outcome.ok) await forgetUris(orphanedUris(held, nodes))

  /*
   * Stamped only on success, and only here rather than inside `restoreBackup`.
   *
   * That function serves two callers with different meanings: a handover from
   * another device, and Settings' Import, which is a file or a paste the user
   * kept. Both now reach it through here, so the difference is the `handover`
   * flag. Recording an import as a transfer would tell them a device is holding
   * a copy when none is.
   */
  if (outcome.ok && handover) repo.setMeta(handedOver(repo.meta, at as Instant))
  return outcome
}
