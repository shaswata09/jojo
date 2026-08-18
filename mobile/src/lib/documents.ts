import { Platform, Share } from 'react-native'
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  type DocumentPickerResponse,
  type FileToCopy,
  type NonEmptyArray,
} from '@react-native-documents/picker'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { kindOfFile, mimeOfFile, sizeLabel } from '@/lib/files'
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

/**
 * '184 KB', or a dash when nobody could say.
 *
 * `sizeLabel` is the shared formatter and it is the only one now. This file
 * declared a second copy of it during the ejection, differing in one case — a
 * dash for a count of zero — and that copy is why the same Vault list could
 * show two spellings of the same size. The disagreement was real, so it is kept
 * as a rule ABOUT the count rather than as a second formatter: a zero arriving
 * here means the picker reported no size and `stat` could not find one either,
 * so the number is missing rather than small, and '—' is already what the app
 * writes for a size nobody knows (see `FileEditor`). A genuinely empty file
 * reads '0 B' everywhere else and would be lying if it read '—' — but this
 * function cannot be reached with a real zero, because `sizeOnDisk` returns 0
 * only when the stat failed.
 */
const sizeOfPick = (bytes: number): string =>
  Number.isFinite(bytes) && bytes > 0 ? sizeLabel(bytes) : '—'

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

/**
 * `file:///data/.../My%20CV.pdf` becomes `/data/.../My CV.pdf`.
 *
 * A record keeps a URI, because that is what it has always kept and what every
 * row already written contains. `react-native-blob-util`'s fs takes a PATH,
 * and `expo-file-system`'s File took a URI — that is the whole difference, and
 * it is invisible until a filename contains a space, at which point the two
 * strings stop being the same one. `storedName` deliberately permits spaces,
 * and `keepLocalCopy` percent-encodes what it returns (`Uri.fromFile` on
 * Android, and the iOS side matches it on purpose).
 *
 * Skip this decode and nothing throws. `fs.exists` simply answers false for a
 * file that is right there, so every document with a space in its name reports
 * itself lost the moment it is filed.
 */
const pathOf = (uri: string) =>
  uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri

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
        // The `await` is only reached when the picker reported no size —
        // `??` short-circuits — which is the whole reason it can afford to
        // touch the disk here.
        size: sizeOfPick(asset.size ?? (await sizeOnDisk(copy.localUri))),
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
async function sizeOnDisk(uri: string): Promise<number> {
  try {
    return (await ReactNativeBlobUtil.fs.stat(pathOf(uri))).size
  } catch {
    return 0
  }
}

/**
 * Whether a record's bytes are still where it says they are.
 *
 * ASYNC NOW, AND THAT IS THE EXPENSIVE HALF OF THIS MIGRATION. `File.exists`
 * was a synchronous getter and `FileViewer` read it straight out of its render
 * body. No React Native filesystem library offers a synchronous form — not
 * blob-util, not any candidate that was measured — so the answer arrives a tick
 * late and the viewer gained a state it had never had to describe: not yet
 * known. See `FileViewer` for what it says while it waits.
 */
export async function documentExists(uri: string | undefined): Promise<boolean> {
  if (!uri) return false
  try {
    return await ReactNativeBlobUtil.fs.exists(pathOf(uri))
  } catch {
    return false
  }
}

/**
 * Removes the copy behind a record. Best effort — the record is the truth.
 *
 * The file goes; the UUID directory `keepLocalCopy` put it in stays. That is
 * deliberate: recognising our own directories would mean pattern-matching a
 * UUID and hoping, and an empty directory is an inode that leaves with the app.
 *
 * Nothing calls this today — it is the delete half of a feature whose delete
 * path was never wired up — which is exactly why it is ported rather than left
 * to rot against an API that has gone.
 */
export async function forgetDocument(uri: string | undefined): Promise<void> {
  if (!uri) return
  try {
    await ReactNativeBlobUtil.fs.unlink(pathOf(uri))
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
 * needs a `content://` URI minted for the receiver by a FileProvider, plus the
 * read grant on the intent. `react-native-blob-util` declares its own provider
 * with `grantUriPermissions`, so nothing has to be added to the manifest — but
 * the app now has a provider it did not declare, and that merge is worth
 * reading rather than assuming.
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
    // One call where there were two. `actionViewIntent` mints the content URI
    // through the package's own FileProvider and sets the read grant itself, so
    // `getContentUriAsync` + `startActivityAsync` collapse into it.
    //
    // The MIME is now ours to supply — the intent used to get it from the
    // content resolver — and it comes off the stored copy's own filename, which
    // `storedName` guarantees still carries the extension. It rejects with
    // ENOAPP when nothing handles the type, which is the sentence the caller
    // already knows how to show.
    await ReactNativeBlobUtil.android.actionViewIntent(pathOf(uri), mimeOfFile(uri))
    return
  }

  // React Native's own Share, not a new dependency. Same iOS activity sheet
  // `expo-sharing` presented, same Quick Look and "Copy to Files" in it.
  //
  // The `isAvailableAsync` guard is gone rather than replaced. It existed
  // because expo-sharing also ran on web, where there is no sheet; this file
  // is reached only from a phone, and Share throws on its own if the sheet
  // cannot be presented — which is what the caller is catching.
  await Share.share({ url: uri })
}
