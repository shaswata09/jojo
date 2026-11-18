import { Platform, Share } from 'react-native'
import { i18next } from '@/i18n/i18n'
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  type DocumentPickerResponse,
  type FileToCopy,
  type NonEmptyArray,
} from '@react-native-documents/picker'
import AsyncStorage from '@react-native-async-storage/async-storage'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { kindOfFile, mimeOfFile, sizeLabel } from '@/lib/files'
import { DOCUMENT_TRASH_SUFFIX } from '@/lib/restore-documents'
import { ownDocumentPath } from '@/lib/document-path'
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
    const files: NonEmptyArray<FileToCopy> = [
      toCopy(first, 0),
      ...rest.map((a, i) => toCopy(a, i + 1)),
    ]

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
        firstFailure ??=
          copy?.status === 'error' ? copy.copyError : i18next.t('messages:documents.incomplete')
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
      return {
        ok: false,
        cancelled: false,
        reason: firstFailure ?? i18next.t('messages:documents.nothingCopied'),
      }
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
  // A path outside the app's own documents is not a copy this app holds.
  const path = ownDocumentPath(uri)
  if (path === null) return false
  try {
    return await ReactNativeBlobUtil.fs.exists(path)
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
 * Called from `forgetDocuments` below and from nowhere else. This comment used
 * to say nothing called it at all, which was true and was the bug: Settings'
 * "Clear every record" told the user their vault was going and left every
 * attached document's bytes in the sandbox, reclaimable only by uninstalling.
 *
 * It is still NOT called when a single document row is deleted, and that is a
 * different question with a different answer — see `trashDocument` below. That
 * delete offers an Undo, and bytes deleted under a restorable record are a
 * record restored to point at nothing, so the single-row path sets the copy
 * aside instead, and a launch past the retention window sweeps it.
 */
export async function forgetDocument(uri: string | undefined): Promise<void> {
  // Only ever the app's own copies: a record's uri can be written by the
  // assistant or a backup, and naming a path is not a licence to delete it.
  const own = ownDocumentPath(uri)
  if (own === null) return
  // The set-aside copy as well: a wipe empties the store, that commit can move
  // the bytes into the trash before this runs (`reconcileTrashedDocuments`),
  // and "your vault is gone" must not mean "in a month".
  for (const path of [own, `${own}${TRASH_SUFFIX}`]) {
    try {
      await ReactNativeBlobUtil.fs.unlink(path)
    } catch {
      // A copy that cannot be deleted is a few kilobytes in the app's sandbox,
      // and it goes with the app. Not worth failing the delete the user asked
      // for — the record is what they were removing.
    }
  }
}

/**
 * A copy set aside so an Undo can bring it back, and swept at a launch once
 * it has waited out the retention window.
 *
 * ## Why the single-row delete could not just unlink
 *
 * Deleting one document offers an Undo, and bytes deleted under a restorable
 * record leave a record restored to point at nothing — a row that looks intact
 * with the loss invisible until somebody opens it. So `forgetDocument` was kept
 * off that path entirely, and the cost was the other way round: "Document
 * removed" left every byte in the sandbox, reclaimable only by uninstalling.
 * The web app solved this at its own layer — `blobs.remove` then
 * `blobs.restore` on Undo — and the phone had no equivalent.
 *
 * ## Why the sweep asks the records (review 2026-11-17, health-1)
 *
 * This used to say a sweep at launch was safe because "the undo ring is in
 * memory, so a document still in the trash is one nothing can restore". The
 * toast was never the only Undo. Settings › Audit log › Undo last, and the
 * assistant's step Undo, revert the same journal entry from the persisted
 * journal — across launches — and only the toast moved the bytes back. So the
 * record returned, its copy stayed `.jojo-trashed`, and the next launch
 * unlinked it: the row intact, the document gone.
 *
 * Now the trash follows the records (`planTrashedDocuments`). On every commit a
 * trashed copy whose original path a live record names again is moved back,
 * whatever ran the revert. At launch, once the store has hydrated from disk, a
 * trashed copy no record names is deleted once it has been set aside for
 * `TRASH_RETENTION_MS` — and only once hydrated: an in-memory store after a
 * failed boot names nothing, and reading that as "every record is gone" would
 * delete every set-aside document on the phone.
 *
 * ## Why a retention window (review 2026-11-17, follow-up)
 *
 * Deleting at the next launch still lost the document for the audit log's
 * Undo of a delete from an EARLIER launch: the journal outlives the session,
 * so the record came back and its bytes were already gone. A copy is now kept
 * for 30 days from when it was set aside (`TrashedDocument.at`) and deleted at
 * a launch after that, if its record is still gone. Entries written before the
 * timestamp existed are read as "set aside now", so an upgrade deletes nothing.
 *
 * ## Copies whose record went some other way
 *
 * Only `FilesTool`'s delete called `trashDocument`. A record that left any
 * other way — the assistant's `vault.file.delete`, "Undo last" of an upload, a
 * restore that dropped it — left its bytes in the sandbox for good. Now the
 * caller (`DocumentTrash` in `App.tsx`) compares each commit with the one
 * before it, and a path the previous snapshot named and no record names now is
 * passed to `reconcileTrashedDocuments` as `vanished` and set aside exactly as
 * the row's delete does — so a revert brings it back the same way, and the
 * retention sweeps it if nothing does. Already set aside (the row's own delete
 * got there first) is a no-op, and so is a path that is already gone.
 *
 * ## Why a list rather than a directory
 *
 * `keepLocalCopy` mints its own UUID directory per file, so the app does not
 * know the shape of its own storage — the comment at the top of this file says
 * so. Walking that tree to find trash would make it start depending on a layout
 * it does not own. A list of paths depends on nothing — which is also why a
 * copy whose record went some other way is found by comparing commits (above)
 * rather than by looking at the disk.
 */
const TRASH_KEY = 'jojo/documents/trashed'
const TRASH_SUFFIX = DOCUMENT_TRASH_SUFFIX

/**
 * How long a set-aside document whose record is gone is kept before a launch
 * deletes it — 30 days from when it was set aside. The web app keeps the same
 * window under the same name (`web/src/lib/vault-blobs.ts`); see the section
 * above for why there is one.
 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60_000

/** One set-aside copy: its path, and when it was set aside (epoch ms). */
export type TrashedDocument = { readonly path: string; readonly at: number }

/**
 * The list as last read or written, so the check made on every commit costs no
 * AsyncStorage read. Only this module writes the key, and every write goes
 * through `writeTrashList`, which keeps this current.
 */
let knownTrash: TrashedDocument[] | null = null

/**
 * The stored list, read once. A bare string is an entry from before the
 * timestamp existed: read as set aside now, and written back that way, so the
 * window starts once rather than at every launch.
 */
const trashList = async (): Promise<TrashedDocument[]> => {
  if (knownTrash !== null) return knownTrash
  try {
    const raw = await AsyncStorage.getItem(TRASH_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    const now = Date.now()
    let migrated = false
    const list: TrashedDocument[] = []
    for (const item of Array.isArray(parsed) ? parsed : []) {
      if (typeof item === 'string') {
        list.push({ path: item, at: now })
        migrated = true
      } else if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as TrashedDocument).path === 'string' &&
        typeof (item as TrashedDocument).at === 'number'
      ) {
        list.push({ path: (item as TrashedDocument).path, at: (item as TrashedDocument).at })
      }
    }
    if (migrated) await writeTrashList(list)
    knownTrash = list
  } catch {
    // Not cached: a read that failed is tried again next time.
    return []
  }
  return knownTrash
}

const writeTrashList = async (entries: readonly TrashedDocument[]): Promise<void> => {
  knownTrash = [...entries]
  try {
    await AsyncStorage.setItem(TRASH_KEY, JSON.stringify(entries))
  } catch {
    // A trash list that cannot be written means the sweep misses this file —
    // the old behaviour, and a few kilobytes. Not worth failing the delete.
  }
}

/**
 * Moves one document's bytes aside and lists them. The one way anything is
 * trashed, so the row's delete and a vanished record cannot trash twice: a
 * path already listed, or no longer there to move, is left alone. Runs inside
 * `serially`. Resolves the trashed path, or null when nothing moved.
 */
async function setAside(from: string, now: number): Promise<string | null> {
  // Never a path outside the app's own documents (security-2): a record the
  // assistant pointed at the store's own database, then re-pointed, would
  // otherwise have that database renamed aside on the next commit.
  if (ownDocumentPath(from) === null) return null
  const to = `${from}${TRASH_SUFFIX}`
  if ((await trashList()).some((entry) => entry.path === to)) return null
  try {
    await ReactNativeBlobUtil.fs.mv(from, to)
  } catch {
    // Already gone, or unmovable. Either way there is nothing to restore and
    // nothing to sweep.
    return null
  }
  await writeTrashList([...(await trashList()), { path: to, at: now }])
  return to
}

/**
 * The paths a previous commit's records named that none names now — what a
 * record that left by any route leaves behind. Pure; `DocumentTrash` feeds it
 * the uris of two consecutive commits. Deduped, and never a path still named.
 */
export function vanishedDocuments(
  previous: readonly (string | undefined)[],
  next: readonly (string | undefined)[],
): string[] {
  const still = new Set(next.filter((uri): uri is string => Boolean(uri)).map(pathOf))
  const out = new Set<string>()
  for (const uri of previous) {
    if (!uri) continue
    const path = pathOf(uri)
    if (!still.has(path)) out.add(path)
  }
  return [...out]
}

/**
 * Every change to the trash, one at a time.
 *
 * A delete moves the file and then appends to the list; a revert landing in
 * between used to find nothing to move back, after which the delete finished
 * and the copy waited for the sweep. Each step reads the list and writes it
 * whole, so two running together also dropped each other's entries.
 */
let trashQueue: Promise<unknown> = Promise.resolve()

function serially<T>(step: () => Promise<T>): Promise<T> {
  const run = trashQueue.then(step, step)
  trashQueue = run.catch(() => undefined)
  return run
}

/** What `reconcileTrashedDocuments` does with each set-aside copy. */
export type TrashPlan = {
  /** Copies a live record names again: moved back from `from` to `to`. */
  readonly restore: readonly { readonly from: string; readonly to: string }[]
  /**
   * Copies no record names, set aside for `TRASH_RETENTION_MS`, unlinked. Only
   * in a sweep of a hydrated store.
   */
  readonly purge: readonly string[]
  /** Everything else stays set aside. */
  readonly keep: readonly TrashedDocument[]
}

/**
 * The decision, pure: which set-aside copies come back, go, or wait.
 *
 * `livePaths` are the filesystem paths the records name now. Putting a copy
 * back is safe against any store, so it is done whenever its path is named;
 * deleting one needs `sweep` (launch, when no Undo in this session can be
 * owed), `hydrated` (the records are the ones on disk) and the copy to have
 * been set aside for the retention window by `now`.
 */
export function planTrashedDocuments(input: {
  readonly trashed: readonly TrashedDocument[]
  readonly livePaths: ReadonlySet<string>
  readonly sweep: boolean
  readonly hydrated: boolean
  readonly now: number
  readonly retentionMs?: number
}): TrashPlan {
  const restore: { from: string; to: string }[] = []
  const purge: string[] = []
  const keep: TrashedDocument[] = []
  const deleting = input.sweep && input.hydrated
  const retention = input.retentionMs ?? TRASH_RETENTION_MS
  for (const entry of input.trashed) {
    const from = entry.path
    const to = from.endsWith(TRASH_SUFFIX) ? from.slice(0, -TRASH_SUFFIX.length) : null
    if (to !== null && input.livePaths.has(to)) restore.push({ from, to })
    else if (deleting && input.now - entry.at >= retention) purge.push(from)
    else keep.push(entry)
  }
  return { restore, purge, keep }
}

/**
 * Set a document's bytes aside, and hand back the way to put them back.
 *
 * `shared` is the caller's answer to "does another record point at this same
 * uri", which it can see and this cannot. `onDuplicate` copies `uri` verbatim,
 * so two rows can and do name one file — and trashing it under one of them
 * would take the other's document with it. Shared files are left alone and the
 * restore is a no-op, which is the same outcome as before for that case.
 *
 * The returned restore is the toast's; every other Undo reaches the bytes
 * through `reconcileTrashedDocuments`. Both are queued behind this move, so an
 * Undo pressed before it finished still finds the copy.
 */
export function trashDocument(
  uri: string | undefined,
  shared: boolean,
): Promise<() => Promise<void>> {
  if (!uri || shared) return Promise.resolve(async () => {})
  const from = pathOf(uri)
  return serially(async () => {
    // Already gone, unmovable, or already set aside by the commit that removed
    // the record (`vanished`): nothing for this toast to restore, and the
    // record's revert brings the bytes back through `reconcileTrashedDocuments`.
    const to = await setAside(from, Date.now())
    if (to === null) return async () => {}
    return () =>
      serially(async () => {
        if (!(await trashList()).some((entry) => entry.path === to)) return
        try {
          await ReactNativeBlobUtil.fs.mv(to, from)
        } catch {
          // The Undo restores the record either way; `documentExists` is what
          // the row uses to tell the person the document did not come back.
          // But while the set-aside copy is the record's ONLY copy it stays
          // listed, as `reconcileTrashedDocuments` keeps it: unlisted, a move
          // that failed once was never tried again and the bytes were never
          // swept either (coverage-3).
          const there = await ReactNativeBlobUtil.fs.exists(from).catch(() => false)
          const here = await ReactNativeBlobUtil.fs.exists(to).catch(() => false)
          if (!there && here) return
        }
        await writeTrashList((await trashList()).filter((entry) => entry.path !== to))
      })
  })
}

/**
 * Brings the set-aside copies in line with the records.
 *
 * Called on every change to the records with `sweep: false` — a copy whose
 * record a revert brought back is moved back, whichever Undo ran — and once at
 * launch with `sweep: true`, when copies no record names are deleted once past
 * the retention window. `vanished` are the paths the commit before this one
 * named and this one does not (`vanishedDocuments`): set aside first, exactly
 * as the row's delete does, but only over a hydrated store and never a path a
 * live record still names. `now` is for tests. Never rejects: a leaked copy is
 * a few kilobytes, and the caller is an effect.
 */
export function reconcileTrashedDocuments(
  uris: readonly (string | undefined)[],
  options: {
    readonly sweep: boolean
    readonly hydrated: boolean
    readonly vanished?: readonly string[]
    readonly now?: number
  },
): Promise<void> {
  return serially(async () => {
    const now = options.now ?? Date.now()
    const livePaths = new Set(uris.filter((uri): uri is string => Boolean(uri)).map(pathOf))
    if (options.hydrated) {
      for (const path of options.vanished ?? []) {
        if (!livePaths.has(path)) await setAside(path, now)
      }
    }
    const trashed = await trashList()
    if (trashed.length === 0) return
    const plan = planTrashedDocuments({
      trashed,
      livePaths,
      sweep: options.sweep,
      hydrated: options.hydrated,
      now,
    })
    if (plan.restore.length === 0 && plan.purge.length === 0) return
    const keep = [...plan.keep]
    for (const { from, to } of plan.restore) {
      try {
        await ReactNativeBlobUtil.fs.mv(from, to)
      } catch {
        // Kept for another try only while it is the record's one copy; when the
        // original is back already, this one is a leftover and never tried again.
        const there = await ReactNativeBlobUtil.fs.exists(to).catch(() => false)
        const here = await ReactNativeBlobUtil.fs.exists(from).catch(() => false)
        const entry = trashed.find((item) => item.path === from)
        if (!there && here && entry !== undefined) keep.push(entry)
      }
    }
    await Promise.all(
      plan.purge.map(async (path) => {
        // A list written by an older build could name anything; only the app's
        // own documents are ever deleted.
        if (ownDocumentPath(path) === null) return
        try {
          await ReactNativeBlobUtil.fs.unlink(path)
        } catch {
          // Gone already, which is the outcome wanted.
        }
      }),
    )
    await writeTrashList(keep)
  }).catch(() => undefined)
}

/**
 * Every copy behind a set of records, for the one action that takes them all.
 *
 * WHY THIS EXISTS AT ALL. Wiping the store is the only place in this app where
 * deleting the bytes is unambiguously right: there is no Undo on it — Settings
 * says so in the confirmation — so there is no restored record left to point at
 * a file, which is the objection that keeps `forgetDocument` off the
 * single-row delete path. Without it the store emptied, the confirmation said
 * the vault was gone, and every document a user had ever attached stayed on the
 * device until they uninstalled the app.
 *
 * DEDUPED, and that is load-bearing rather than tidy. `onDuplicate` in
 * `FilesTool` copies `uri` verbatim, so two records can and do name one file.
 * A second unlink of the same path rejects with ENOENT, which `forgetDocument`
 * swallows — so the dedupe changes no outcome today and states the sharing, so
 * that a future caller which reports failures does not report a phantom one.
 *
 * Never rejects, for the same reason `forgetDocument` never does: the caller is
 * a press handler that has already emptied the store, and a leaked copy is a
 * few kilobytes that leave with the app.
 */
export async function forgetDocuments(uris: readonly (string | undefined)[]): Promise<void> {
  const paths = new Set(uris.filter((uri): uri is string => Boolean(uri)))
  await Promise.all([...paths].map(forgetDocument))
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
  // Handing another app a path outside this app's documents would share a
  // file nobody chose to share — the FileProvider would mint a grant for it.
  const path = ownDocumentPath(uri)
  if (path === null) throw new Error(i18next.t('messages:reader.gone'))
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
    await ReactNativeBlobUtil.android.actionViewIntent(path, mimeOfFile(uri))
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
