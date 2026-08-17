import { Platform } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
import { Directory, File, Paths } from 'expo-file-system'
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

/** Where copies live, inside the app's own sandbox. */
const FOLDER = 'documents'

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
 */
const storedName = (name: string, at: number) => `${String(at)}-${name.replace(/[^\w.\- ]+/g, '_')}`

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
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      // Copying is this module's job, not the picker's: its cache copy is
      // still a temporary the OS may clear.
      copyToCacheDirectory: true,
    })
    if (result.canceled) return { ok: false, cancelled: true }

    const folder = new Directory(Paths.document, FOLDER)
    if (!folder.exists) folder.create({ intermediates: true })

    const documents: PickedDocument[] = []
    for (const [index, asset] of result.assets.entries()) {
      const source = new File(asset.uri)
      const target = new File(folder, storedName(asset.name, Date.now() + index))
      source.copy(target)

      documents.push({
        name: asset.name,
        kind: kindOfFile(asset.name, asset.mimeType),
        size: sizeLabel(asset.size ?? target.size ?? 0),
        uri: target.uri,
      })
    }
    return { ok: true, documents }
  } catch (error) {
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
