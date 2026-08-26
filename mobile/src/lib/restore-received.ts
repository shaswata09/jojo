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
import { restoreBackup, type RestoreOutcome } from '@jojo/service/repo/restore'
import { handedOver } from '@jojo/service/repo/meta'
import type { Instant } from '@jojo/service/core/model'
import type { Repository } from '@jojo/service/repo/repository'
import { createDocumentStore, plannedUris, withDocumentUris } from '@/lib/restore-documents'

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
  const read = readBackup(decodeUtf8(payload))
  if (!read.ok) {
    // Authenticated bytes that are not a backup. Not an attack — GCM already
    // ruled that out — so it is a version mismatch or a truncated file, and the
    // message `readBackup` wrote is more specific than anything this could add.
    return { ok: false, message: read.error.message }
  }
  return { ok: true, plan: read.value }
}

/** Writes a plan the user has agreed to. Destroys what is already here. */
export async function applyPlan(
  repo: Repository,
  plan: RestorePlan,
  at: string,
): Promise<RestoreOutcome> {
  const uris = plannedUris(plan.documents)
  const outcome = await restoreBackup(
    repo,
    createDocumentStore(),
    { ...plan, nodes: withDocumentUris(plan.nodes, uris) },
    at,
  )

  /*
   * Stamped only on success, and only here rather than inside `restoreBackup`.
   *
   * That function serves two callers with different meanings: this one, which is
   * a handover from another device, and Settings' Restore, which is a file the
   * user kept. Recording the second as a transfer would tell them a device is
   * holding a copy when none is.
   */
  if (outcome.ok) repo.setMeta(handedOver(repo.meta, at as Instant))
  return outcome
}
