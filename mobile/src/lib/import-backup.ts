/**
 * A backup coming back onto the phone from a FILE or the clipboard — the parts
 * that can be decided without a phone.
 *
 * Until this existed the only way a backup reached the phone was a transfer.
 * Settings' Import was a disabled button explaining that the picker was not
 * wired, and the phone's own Export put a backup on the clipboard that nothing
 * on the phone could read back. The format was never the problem: a real web
 * backup through `planReceived` and `applyPlan` restores whole. Only the way in
 * was missing.
 *
 * Kept free of native modules on purpose. D20 forbids mounting a component in a
 * test and the mobile suite runs on node, so everything that decides what a
 * person is told — whether the text is a backup, whether it is empty, which
 * picker failures deserve a sentence, what the outcome says — lives here where
 * it can be asserted. The screen only moves bytes between the picker, the
 * filesystem and these functions.
 */

import { fromBase64, readBackup, type RestorePlan } from '@jojo/service/core/backup'
import { decodeUtf8 } from '@jojo/service/core/utf8'
import type { RestoreOutcome } from '@/lib/restore-received'
import type { ToastOptions } from '@/lib/toast-context'
import { i18next } from '@/i18n/i18n'

export type ImportSource = 'file' | 'clipboard'

export type ImportPlan = { ok: true; plan: RestorePlan } | { ok: false; message: string }

const BOM = '﻿'

/**
 * Drops a leading U+FEFF.
 *
 * Many note apps write one when they save a pasted export, and `decodeUtf8`
 * keeps it — correctly: it is a character, and a decoder is not the place to
 * decide it is noise. `JSON.parse` then refuses the whole file on its first
 * character. The web reader never saw this because `TextDecoderStream` strips it.
 */
export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

/**
 * Text to a plan the person can be asked about, or the reason there is none.
 *
 * Two refusals happen here rather than later, and both are about not asking a
 * question whose answer cannot help:
 *
 * - Text that is not JSON. `readBackup` passes on `JSON.parse`'s own message,
 *   which names a token and a column — accurate, and useless to somebody who
 *   picked the wrong file.
 * - A backup with no records. `restoreBackup` refuses it too, but only after
 *   the sheet has asked "Replace everything on this phone?" — offering to
 *   replace every record with none, and then saying no to the yes.
 */
export function planImport(text: string, source: ImportSource): ImportPlan {
  const body = stripBom(text)
  if (body.trim().length === 0) {
    return {
      ok: false,
      message:
        source === 'clipboard'
          ? i18next.t('transfer:import.clipboardEmpty')
          : i18next.t('transfer:import.fileEmpty'),
    }
  }
  const read = readBackup(body)
  if (!read.ok) {
    const reason =
      read.error.code === 'backup/unreadable'
        ? i18next.t('transfer:import.notBackup')
        : read.error.message
    // One whole sentence per source — "That file" and "What is on the
    // clipboard" are where the sentence starts, which is not where every
    // language starts it.
    return {
      ok: false,
      message: i18next.t(`transfer:import.unrestorable.${source}`, { reason }),
    }
  }
  if (read.value.nodes.length === 0) {
    return {
      ok: false,
      message: i18next.t(`transfer:import.noRecords.${source}`),
    }
  }
  return { ok: true, plan: read.value }
}

/** A picked file's bytes, as `fs.readFile(path, 'base64')` hands them over. */
export function planImportBase64(base64: string): ImportPlan {
  const bytes = fromBase64(base64)
  if (bytes === null) {
    return { ok: false, message: i18next.t('transfer:import.unreadable') }
  }
  return planImport(decodeUtf8(bytes), 'file')
}

/**
 * `file:///data/.../My%20Backup.json` becomes `/data/.../My Backup.json`.
 *
 * `keepLocalCopy` percent-encodes the uri it returns and blob-util's fs takes a
 * path — see `pathOf` in `documents.ts`, where skipping this made every file
 * with a space in its name report itself missing.
 */
export function pathOfUri(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri
}

/**
 * Which picker failures deserve a sentence. `null` means say nothing.
 *
 * Cancelling is a throw in this picker, not a flag, so without this a person who
 * changed their mind would be shown an error. A second tap while the picker is
 * still opening throws too, and the picker that is opening is answer enough.
 * Codes compared as strings so this file stays off the native module; they are
 * `errorCodes` in `@react-native-documents/picker/src/errors.ts`.
 */
export function pickFailure(error: unknown): string | null {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined
  if (code === 'OPERATION_CANCELED' || code === 'ASYNC_OP_IN_PROGRESS') return null
  if (code === 'UNABLE_TO_OPEN_FILE_TYPE') {
    return i18next.t('transfer:import.noPicker')
  }
  const detail = error instanceof Error ? error.message : String(error)
  return i18next.t('transfer:import.openFailed', { detail })
}

/**
 * What a finished import says — the same counts the transfer receive shows.
 *
 * The skipped count is said out loud rather than rounded away, for the reason
 * `ReceivePanel` gives: somebody checking their records against the device that
 * wrote the backup needs to know the number is short before they go looking.
 */
export function importOutcomeToast(outcome: RestoreOutcome): ToastOptions {
  if (!outcome.ok) {
    return {
      title: i18next.t('transfer:import.failedTitle'),
      description: outcome.message,
      tone: 'danger',
    }
  }
  return { title: i18next.t('transfer:import.restoredTitle'), description: landedText(outcome) }
}

/**
 * What a restore left on this phone — records, documents, and what could not
 * be read — said the same way by an import and by a transfer's receive.
 */
export function landedText({
  nodes,
  documents,
  skipped,
}: {
  nodes: number
  documents: number
  skipped: number
}): string {
  const held =
    documents === 0
      ? i18next.t('transfer:landed.plain', { count: nodes })
      : i18next.t('transfer:landed.withDocuments', {
          count: nodes,
          documents: i18next.t('transfer:landed.documents', { count: documents }),
        })
  return skipped === 0
    ? held
    : `${held} ${i18next.t('transfer:landed.skipped', { count: skipped })}`
}
