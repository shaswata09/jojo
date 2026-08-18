import { Platform } from 'react-native'
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  type DocumentPickerResponse,
  type FileToCopy,
  type NonEmptyArray,
} from '@react-native-documents/picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
import { File } from 'expo-file-system'
import { kindOfFile } from '@/lib/files'
import type { FileBucket, FileKind } from '@jojo/service/data/vault'

/**
 * Picking a document, and keeping it.
 *
 * Until now a file row was a name, a type and a size that somebody typed — the
 * app had a Vault full of documents it had never seen. This picks a real file
 * and copies it into the app's own document directory, so the record points at
 * something that can be opened.
 *
 * WHY A COPY RATHER THAN THE PICKER'S URI.
 *
 * What the picker hands back is a borrowed handle. On Android it is a
 * `content://` URI whose permission is scoped to this activity, and on iOS the
 * file often lives in a temporary inbox the OS is free to clear. Storing either
 * gives you a record that works until the next launch and then points at
 * nothing — which is worse than the typed record it replaced, because it looks
 * like it worked.
 *
 * WHAT THIS DOES NOT CHANGE.
 *
 * The graph still holds no bytes (D27). It holds a path, the same way it holds
 * a URL for a link. The bytes sit in the app's sandbox, they go when the app is
 * uninstalled, and nothing reads their contents — no parsing, no upload, no
 * indexing. `size` is still the label a human reads; the byte count is only
 * used to compute it.
 */

/**
 * WHERE COPIES LIVE — and this is no longer ours to choose.
 *
 * There used to be a `documents` folder inside the app's document directory,
 * created here. `keepLocalCopy` picks its own layout: it mints a fresh UUID
 * directory under the document directory for every call and puts the file
 * inside it, on both platforms. That is a better answer than the one it
 * replaced — two files of the same name can no longer meet — but it means the
 * app no longer knows the shape of its own storage beyond "whatever URI the
 * record holds". Nothing walks that tree, so nothing depended on knowing.
 */

export type PickedDocument = {
  name: string
  kind: FileKind
  size: string
  /** `file://` path inside this app's document directory. */
  uri: string
}

/** '184 KB' — the label the app has always shown, from a real byte count. */
export function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${String(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${String(Math.round(kb))} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/**
 * A name that will not collide, and will not surprise.
 *
 * Two CVs both called `CV.pdf` must not overwrite each other, so the stored
 * copy is prefixed with the moment it was filed. The *record* keeps the name
 * the user recognises — this is only what the bytes are called on disk.
 *
 * Kept even though `keepLocalCopy`'s per-call UUID directory has already made
 * collision impossible. The prefix is now belt to that braces, and it costs
 * nothing; the sanitising half still earns its keep, because the name goes
 * onto a filesystem either way.
 */
const storedName = (name: string, at: number) => `${String(at)}-${name.replace(/[^\w.\- ]+/g, '_')}`

/** The picker's `name` is nullable in theory. A file still has to be called something. */
const nameOf = (asset: DocumentPickerResponse) => asset.name ?? 'document'

export type PickOutcome =
  | { ok: true; documents: PickedDocument[] }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; reason: string }

/**
 * Opens the system picker and keeps whatever comes back.
 *
 * Multi-select, because filing an application's four documents one sheet at a
 * time is the kind of friction that stops people filing them at all.
 */
export async function pickDocuments(bucket: FileBucket): Promise<PickOutcome> {
  void bucket
  try {
    const picked = await pick({ allowMultiSelection: true })

    // Destructured rather than mapped, because `keepLocalCopy` wants a
    // NonEmptyArray and `pick` already promises one. A cast would have said the
    // same thing with less of it checked.
    const [first, ...rest] = picked
    const at = Date.now()
    const toCopy = (asset: DocumentPickerResponse, index: number): FileToCopy => ({
      uri: asset.uri,
      fileName: storedName(nameOf(asset), at + index),
    })
    const files: NonEmptyArray<FileToCopy> = [toCopy(first, 0), ...rest.map((a, i) => toCopy(a, i + 1))]

    // This replaces the hand-rolled copy that used to be here, and it is not a
    // convenience: on Android the picker now hands back a raw `content://` SAF
    // URI whose read grant dies with the activity, and there is no
    // `copyToCacheDirectory` option any more. Copying it by hand would mean
    // teaching the copy step to read a content URI. `keepLocalCopy` is the
    // module's own answer to exactly that, so it is the one used.
    const copies = await keepLocalCopy({ files, destination: 'documentDirectory' })

    const documents: PickedDocument[] = []
    let firstFailure: string | undefined
    for (const [index, asset] of picked.entries()) {
      const copy = copies[index]
      // `keepLocalCopy` resolves even when a file failed, reporting per file.
      // The old code threw on the first failure and lost the rest of the batch;
      // this keeps whatever copied and only reports if nothing did.
      if (!copy || copy.status !== 'success') {
        firstFailure ??= copy?.status === 'error' ? copy.copyError : 'The copy did not complete.'
        continue
      }

      const name = nameOf(asset)
      documents.push({
        name,
        // `mimeType` is called `type` here, and it is nullable rather than
        // optional — `kindOfFile` wants undefined for "not reported".
        kind: kindOfFile(name, asset.type ?? undefined),
        size: sizeLabel(asset.size ?? sizeOnDisk(copy.localUri)),
        uri: copy.localUri,
      })
    }

    if (documents.length === 0) {
      return { ok: false, cancelled: false, reason: firstFailure ?? 'Nothing was copied.' }
    }
    return { ok: true, documents }
  } catch (error) {
    // CANCELLING IS A THROW NOW, NOT A FLAG. `result.canceled` is gone; the
    // picker rejects with OPERATION_CANCELED instead. Without this branch every
    // dismissed picker would fall through to the reason below and FileEditor
    // would print an error for a user who simply changed their mind.
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
      return { ok: false, cancelled: true }
    }
    // Reported rather than swallowed: a picker that fails silently reads as a
    // button that does nothing, and the commonest cause — a provider the OS
    // refused — is worth naming.
    return {
      ok: false,
      cancelled: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Last resort for a file whose size the picker did not report. */
function sizeOnDisk(uri: string): number {
  try {
    return new File(uri).size ?? 0
  } catch {
    return 0
  }
}

/** Whether a record's bytes are still where it says they are. */
export function documentExists(uri: string | undefined): boolean {
  if (!uri) return false
  try {
    return new File(uri).exists
  } catch {
    return false
  }
}

/** Removes the copy behind a record. Best effort — the record is the truth. */
export function forgetDocument(uri: string | undefined): void {
  if (!uri) return
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // A copy that cannot be deleted is a few kilobytes in the app's sandbox,
    // and it goes with the app. Not worth failing the delete the user asked
    // for — the record is what they were removing.
  }
}

/**
 * Hands a stored copy to whatever on this phone can open it.
 *
 * The two platforms need different things and neither is the other's fallback.
 *
 * **Android** cannot receive a `file://` URI from another app at all — passing
 * one across a process boundary throws `FileUriExposedException` by design. It
 * needs a `content://` URI minted for the receiver, which is what
 * `getContentUriAsync` does, plus the read grant on the intent.
 *
 * **iOS** has no equivalent intent, so this is the share sheet, which is where
 * Quick Look and "Copy to Files" live. It reads as a share rather than an open,
 * and it is the only route a sandboxed app has to another app's viewer.
 *
 * Throws rather than returning a Result, because the caller is a press handler
 * that already has somewhere to put the message and every failure here is one
 * sentence: nothing offered to open it.
 */
export async function openDocument(uri: string): Promise<void> {
  if (Platform.OS === 'android') {
    const content = await FileSystem.getContentUriAsync(uri)
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: content,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    })
    return
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('This device has no way to open the file from here.')
  }
  await Sharing.shareAsync(uri)
}
