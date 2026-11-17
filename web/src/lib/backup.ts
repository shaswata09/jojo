/**
 * Making a backup, and knowing when to ask for one.
 *
 * The export that existed before this wrote projections — the readable views —
 * and could not be restored from. `@jojo/service/core/backup` explains why in
 * detail; the short version is that a denormalised view of an application does
 * not record which nodes and edges produced it, so importing one means guessing.
 * This gathers the raw rows and the document bytes instead, and keeps the
 * readable half alongside them so the file still opens into something a person
 * recognises.
 *
 * ## How "substantial change" is measured
 *
 * By `updatedAt`, not by a counter. Every stored node already carries the
 * instant it last changed, so the number of records touched since the last
 * backup is a filter over rows the app is holding anyway — no new plumbing, no
 * counter to keep in step with undo, and it survives a reload for free because
 * the timestamps are the ones that were persisted.
 *
 * A counter would have been the obvious choice and would have been wrong twice:
 * it would count an edit and its undo as two changes, and it would reset to zero
 * on reload, which is exactly when a person most needs to be told they have
 * unbacked-up work.
 *
 * ## Where it is said, and how it is put away
 *
 * `StorageBanner` reads `shouldNudge` and offers "Download a backup" (Q097).
 * Before that, `changed` and `shouldNudge` were computed here and read by
 * nothing, so the owner's request — prompt for a backup after a substantial
 * change — was a number nobody was shown.
 *
 * "Not now" stamps an instant beside the last-backup one, in localStorage, and
 * the prompt then counts from whichever is later. So it stays away until another
 * `BACKUP_NUDGE_AT` records have changed since it was put away — not until the
 * next load, which would be the nagging that teaches people to dismiss it unread.
 * A backup moves the later instant forward too, which is what resets the count.
 */

import { intlLocale } from '@jojo/service/core/intl-locale'
import { i18next } from '@/i18n/i18n'
import { reportError } from '@/lib/report-error'
import { revokeLater } from '@/lib/save-file'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import {
  BACKUP_TAIL,
  DOCUMENT_CLOSE,
  DOCUMENT_SLICE,
  backupHead,
  base64Bytes,
  documentOpen,
  type BackupPart,
} from '@jojo/service/core/backup-stream'
import { useVaultBlobs, type VaultBlobs } from '@/lib/vault-blobs'
import { blobPath } from '@jojo/service/core/blob-path'
import { report } from '@/lib/analytics'
import { bucket } from '@jojo/service/core/analytics'
import type { ToastOptions } from '@/lib/toast-context'
import { useMascot } from '@/lib/mascot-context'
import { CUES } from '@/lib/mascot-cues'

/** Where the last backup's instant lives. Per origin, like everything else. */
const LAST_BACKUP_KEY = 'jojo.lastBackupAt'

/**
 * How many touched records before jojo says something.
 *
 * Chosen to be a session's worth of real work rather than a number that fires on
 * the first edit. A prompt a person sees constantly is a prompt they learn to
 * dismiss without reading, and the one time it matters it will be dismissed the
 * same way.
 */
export const BACKUP_NUDGE_AT = 15

/**
 * When the person last said "Not now" to the backup prompt.
 *
 * Beside `LAST_BACKUP_KEY` rather than in IndexedDB: it is the same kind of fact
 * about this browser — not a record, not part of a backup, and gone with the
 * rest when someone clears the site.
 */
const NUDGE_DISMISSED_KEY = 'jojo.backupNudgeDismissedAt'

function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    // Private browsing blocks localStorage. Never having backed up is the safe
    // reading: the prompt appears, which is the harmless direction to be wrong in.
    return null
  }
}

function readNudgeDismissed(): string | null {
  try {
    return localStorage.getItem(NUDGE_DISMISSED_KEY)
  } catch {
    return null
  }
}

/**
 * Who to tell when either instant moves.
 *
 * The banner and the Settings panel are separate components with separate
 * `useBackup` calls, and localStorage fires no event in the tab that wrote it.
 * Read during render with no subscription, a backup taken from Settings left the
 * banner asking for one until some unrelated edit happened to re-render it.
 */
const markListeners = new Set<() => void>()

function marksChanged(): void {
  for (const listener of markListeners) listener()
}

function subscribeMarks(listener: () => void): () => void {
  markListeners.add(listener)
  // `storage` is the other tabs: a backup taken in one puts the prompt away in all.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LAST_BACKUP_KEY || event.key === NUDGE_DISMISSED_KEY)
      listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    markListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const noMark = (): string | null => null

function writeLastBackup(at: string): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, at)
  } catch {
    // The backup still downloaded. Failing to REMEMBER that must not report the
    // backup as failed — the file is on their disk either way.
  }
  marksChanged()
}

/**
 * A restore counts as a backup taken at that moment.
 *
 * Every record a restore writes came out of a backup file, so nothing on this
 * device is unprotected yet — but the records keep their own `updatedAt`, and a
 * store restored on a new device has no last-backup stamp, so the count read
 * them all as unbacked and the prompt asked for a backup of the backup the
 * moment the page came back. Called once the restore has succeeded.
 */
export function markRestoredFromBackup(at: string): void {
  writeLastBackup(at)
}

/** "Not now": the prompt stays away until another `BACKUP_NUDGE_AT` changes. */
export function dismissBackupNudge(at: string = new Date().toISOString()): void {
  try {
    localStorage.setItem(NUDGE_DISMISSED_KEY, at)
  } catch {
    // Not remembered, so it comes back on the next render that crosses the line.
    // Asking again is the harmless direction to be wrong in.
  }
  marksChanged()
}

/** The later of two ISO instants, either of which may be missing. */
const later = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a > b ? a : b

export type BackupMarks = {
  /** The last backup this browser took, or null. */
  lastBackupAt: string | null
  /** When the prompt was last put away, or null. */
  dismissedAt: string | null
  /**
   * When the demo fixtures were written, or null. Every seeded node carries
   * exactly this `updatedAt`, so counting strictly after it leaves out demo
   * records nobody has touched — without it a first run, which has never backed
   * up, would be asked to back up a hundred records it did not write.
   */
  seededAt: string | null
}

/**
 * How many records have changed since the last backup, and whether to say so.
 *
 * Pure, for the tests (D20). `changed` is what the prompt reports: everything
 * since the last backup, because that is what a lost browser would lose.
 * `shouldNudge` counts only since the later of that and the last "Not now", so
 * putting the prompt away holds until there is a substantial change MORE.
 */
export function backupNudge(
  nodes: readonly { readonly updatedAt: string }[],
  { lastBackupAt, dismissedAt, seededAt }: BackupMarks,
): { changed: number; shouldNudge: boolean } {
  // ISO-8601 sorts lexicographically, which is the whole reason this app
  // stores instants as strings — no parsing, and no timezone to get wrong.
  const since = (from: string | null) =>
    from === null ? nodes.length : nodes.filter((n) => n.updatedAt > from).length
  const unbacked = later(lastBackupAt, seededAt)
  const changed = since(unbacked)
  const quietSince = later(unbacked, dismissedAt)
  const counted = quietSince === unbacked ? changed : since(quietSince)
  return { changed, shouldNudge: counted >= BACKUP_NUDGE_AT }
}

/**
 * The prompt's sentence: how much is unprotected, said in the person's terms.
 *
 * Pure so the counting and the never-backed-up branch are tested without a
 * renderer (D20). The date is the person's own calendar day, the same rule the
 * backup's filename follows.
 */
export function backupPromptText(changed: number, lastBackupAt: string | null): string {
  const parsed = lastBackupAt === null ? Number.NaN : Date.parse(lastBackupAt)
  if (Number.isNaN(parsed)) {
    return i18next.t('messages:backup.prompt.never', { count: changed })
  }
  // In the language jojo is showing, not the browser's: the date sits inside a
  // translated sentence.
  const day = new Date(parsed).toLocaleDateString(intlLocale(i18next.language), {
    dateStyle: 'medium',
  })
  return i18next.t('messages:backup.prompt.since', { count: changed, day })
}

/**
 * The half of `useVaultBlobs` a backup reads, and nothing more.
 *
 * A plain parameter rather than a hook call, and exported, because D20 rules out
 * mounting: the guards below are the whole of the fix and a guard nothing
 * exercises is a guard nobody notices the loss of. `Pick` rather than a hand-
 * written shape so it cannot drift from the hook it is fed.
 */
export type BackupBlobs = Pick<VaultBlobs, 'ready' | 'all' | 'get'>

/**
 * What `reportError('backup', …)` and the console are given when a backup is
 * refused for want of the documents it is supposed to contain.
 *
 * Exported so the test asserts the sentence somebody debugging their own machine
 * will actually read, rather than a string it wrote itself.
 */
export const DOCUMENTS_NOT_READY =
  'The document index had not finished loading, so a backup taken now would say you have none. Nothing was written.'

export const DOCUMENTS_UNREADABLE =
  'None of the stored documents could be read, so the backup would have held records only. Nothing was written.'

/**
 * Lets the page paint and answer between pieces of long work — but only once a
 * slice of time has actually gone by.
 *
 * Not a yield per piece: a 500 MB store is ~10,000 reads of a file stream,
 * and a browser clamps nested timers to 4 ms, so yielding on every one would
 * add most of a minute of pure waiting. 25 ms of work between yields keeps a
 * frame or two of latency and costs almost nothing.
 */
export function pacer(budgetMs = 25): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < budgetMs) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    since = performance.now()
  }
}

/** Where the pieces of a backup go: a file on disk, or a Blob being assembled. */
export type BackupSink = (part: BackupPart) => Promise<void>

/** How far a backup has got, for a sentence on screen. */
export type BackupProgress = { readonly done: number; readonly total: number }

/**
 * Streams every stored document into `sink`, or REFUSES rather than quietly
 * writing none.
 *
 * ## One slice at a time
 *
 * This used to read every document's bytes into memory and hand the lot to
 * `buildBackup`, whose caller stringified it: the whole store as one string.
 * Measured against a 500 MB store, that string would be ~667 million
 * characters — past V8's ~536 million limit — built on the page's only
 * thread, and the tab stopped answering long before it failed. Now each
 * document is read from its stored `File` in `DOCUMENT_SLICE` pieces, encoded
 * as base64 BYTES, and passed on; nothing larger than one slice is held.
 *
 * ## What was measured, and still holds
 *
 * With an index listing two documents and every `get` answering null — an
 * IndexedDB that opened and would not read, which is what an evicted store looks
 * like — `download()` wrote `documents: []`, returned true, and stamped
 * `jojo.lastBackupAt`. The user was told "it holds your records and every
 * document you have attached", the file held none of them, and the app then
 * counted them as backed up. A backup is the one thing between a person and
 * losing everything, so a false claim here is the most expensive sentence in the
 * app: somebody told their backup exists stops looking for one.
 *
 * ## The two refusals, which are different failures
 *
 * NOT READY is the ordinary one and has nothing wrong with it. The index loads
 * asynchronously on mount — `hydrate()` opens the store before the first
 * `list` — so for a moment after the page appears `all()`
 * answers `[]` for a store that is full. An empty index is not "no documents",
 * it is "not known yet", and the two must not produce the same file. It is
 * checked BEFORE anything is written.
 *
 * UNREADABLE is the store answering wrongly: anything listed but nothing read.
 * Streaming finds that out only at the end, so it throws then, and the caller
 * discards what it wrote — `download` aborts the file, `build` drops the Blob.
 *
 * ## Why a PARTIAL loss is still a backup
 *
 * A backup missing one file is worth far more than no backup. What changes is
 * that the shortfall is REPORTED instead of being invisible.
 */
/** How many documents a backup holds, of how many there were. */
export type DocumentCount = { written: number; total: number }

export async function streamDocuments(
  blobs: BackupBlobs,
  sink: BackupSink,
  onProgress?: (p: BackupProgress) => void,
): Promise<DocumentCount> {
  if (!blobs.ready) throw new Error(DOCUMENTS_NOT_READY)

  const listed = await blobs.all()
  const pace = pacer()
  let written = 0
  for (const [at, item] of listed.entries()) {
    onProgress?.({ done: at, total: listed.length })
    const file = await blobs.get(item.id)
    // A document that will not read is skipped rather than aborting the whole
    // backup — see the header. The count is reconciled below.
    if (file === null) continue
    // `blobPath`, not a second `Documents/${id}__${name}` written out here.
    // The format crosses to a phone restoring this file, and `blob-path.ts`
    // exists because a format with two implementations is a format with two
    // spellings.
    await sink(documentOpen(blobPath(item.id, item.name), file.size, written === 0))
    for (let from = 0; from < file.size; from += DOCUMENT_SLICE) {
      const bytes = new Uint8Array(await file.slice(from, from + DOCUMENT_SLICE).arrayBuffer())
      await sink(base64Bytes(bytes))
      await pace()
    }
    await sink(DOCUMENT_CLOSE)
    written += 1
    await pace()
  }
  onProgress?.({ done: listed.length, total: listed.length })

  if (listed.length > 0 && written === 0) throw new Error(DOCUMENTS_UNREADABLE)
  if (written < listed.length) {
    reportError(
      'backup',
      new Error(
        `${listed.length - written} of ${listed.length} documents would not read and are not in this backup.`,
      ),
    )
  }
  // Returned, not only logged: the toast used to promise "every document you
  // have attached" over a backup that had quietly left some out.
  return { written, total: listed.length }
}

/**
 * The bytes of every stored document, for a caller that needs them in hand.
 *
 * Kept for the tests that pin the two refusals on their own; the backup
 * itself streams through `streamDocuments` and never holds them all.
 */
export async function collectDocuments(
  blobs: BackupBlobs,
): Promise<{ path: string; data: Uint8Array }[]> {
  if (!blobs.ready) throw new Error(DOCUMENTS_NOT_READY)
  const listed = await blobs.all()
  const documents: { path: string; data: Uint8Array }[] = []
  for (const item of listed) {
    const file = await blobs.get(item.id)
    if (file === null) continue
    documents.push({
      path: blobPath(item.id, item.name),
      data: new Uint8Array(await file.arrayBuffer()),
    })
  }
  if (listed.length > 0 && documents.length === 0) throw new Error(DOCUMENTS_UNREADABLE)
  if (documents.length < listed.length) {
    reportError(
      'backup',
      new Error(
        `${listed.length - documents.length} of ${listed.length} documents would not read and are not in this backup.`,
      ),
    )
  }
  return documents
}

/**
 * Above this much stored data, a backup asks where to save rather than
 * downloading, where the browser allows it.
 *
 * Writing through a file handle puts each piece on disk as it is made, so
 * nothing the size of the store is ever held by the page. Below the line the
 * ordinary download is kept: a save dialog for a 2 MB file is friction, and a
 * Blob of that size is nothing.
 */
export const SAVE_PICKER_FROM = 200 * 1024 * 1024

/** The File System Access API, where the browser has it (Chrome and Edge). */
type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: BackupPart) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }>
}>

const savePicker = (): SavePicker | null => {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

async function storedBytes(): Promise<number> {
  try {
    return (await navigator.storage.estimate()).usage ?? 0
  } catch {
    return 0
  }
}

/** How a download ended, because "cancelled" must not read as "failed". */
export type DownloadKind = 'saved' | 'started' | 'cancelled' | 'failed'

/**
 * How a download ended, and what it held.
 *
 * The bare word is still accepted — a caller that catches a throw says
 * 'failed' — but the hook answers with the detail: how many documents went
 * in, and, for a refusal jojo made on purpose, the sentence that says why.
 * Without it a backup missing three unreadable documents was announced as
 * holding "every document you have attached", and an index that had not
 * loaded was reported as a blocked download.
 */
export type DownloadOutcome =
  DownloadKind | { kind: DownloadKind; documents?: DocumentCount; reason?: string }

/** The refusals that are jojo's own, whose sentence is worth more than "check the download". */
const OWN_REFUSALS: ReadonlySet<string> = new Set([DOCUMENTS_NOT_READY, DOCUMENTS_UNREADABLE])

const reasonOf = (error: unknown): string | undefined =>
  error instanceof Error && OWN_REFUSALS.has(error.message) ? error.message : undefined

/**
 * One of jojo's own refusals, in the reader's language. The English constants
 * stay the error's message — they are what is matched and what is logged.
 */
const ownRefusal = (reason: string | undefined): string | undefined =>
  reason === DOCUMENTS_NOT_READY
    ? i18next.t('messages:backup.documentsNotReady')
    : reason === DOCUMENTS_UNREADABLE
      ? i18next.t('messages:backup.documentsUnreadable')
      : reason

/**
 * What to tell the person once a download has ended, or null to say nothing.
 *
 * Here rather than in the Settings panel because a backup can now be started
 * from two places — that panel and the storage banner's prompt — and the
 * careful wording below (asserted only where it is known, named rather than
 * promised where it is not) must not exist in two spellings.
 */
export function backupToast(outcome: DownloadOutcome, name: string): ToastOptions | null {
  const { kind, documents, reason } =
    typeof outcome === 'string'
      ? { kind: outcome, documents: undefined, reason: undefined }
      : outcome
  if (kind === 'cancelled') return null
  if (kind === 'failed') {
    return {
      title: i18next.t('messages:backup.failedTitle'),
      description: ownRefusal(reason) ?? i18next.t('messages:backup.failedDescription'),
      tone: 'danger',
    }
  }
  const missing = documents === undefined ? 0 : documents.total - documents.written
  const counts = {
    name,
    written: documents?.written ?? 0,
    total: documents?.total ?? 0,
    count: missing,
  }
  return kind === 'saved'
    ? {
        // Asserted, because it is known: the file handle closed on disk.
        title: i18next.t('messages:backup.savedTitle'),
        description:
          missing === 0
            ? i18next.t('messages:backup.savedAll', { name })
            : i18next.t('messages:backup.savedSome', counts),
      }
    : {
        title: i18next.t('messages:backup.startedTitle'),
        // Named, not asserted. The click is the last thing this page can
        // observe — the browser's decision after it fires no event — so what is
        // said is what to look for rather than that it arrived.
        description:
          missing === 0
            ? i18next.t('messages:backup.startedAll', { name })
            : i18next.t('messages:backup.startedSome', counts),
      }
}

export type BuildOptions = {
  /**
   * Whether document bytes go in. Default true.
   *
   * False is not a smaller backup so much as a DIFFERENT one: it restores every
   * record and leaves each document unreachable on this device. That is the
   * right trade for a channel with a throughput ceiling — a beam through a
   * camera moves a records-only backup in seconds and a documents-bearing one in
   * minutes — and the wrong trade for a file someone is keeping as their only
   * copy, which is why it is opt-out rather than a second entry point.
   */
  documents?: boolean
}

export type BackupState = {
  /** Records touched since the last backup, or since the beginning if never. */
  changed: number
  /** ISO instant of the last backup, or null. */
  lastBackupAt: string | null
  /**
   * Whether to ask for a backup: `BACKUP_NUDGE_AT` changes since the later of
   * the last backup and the last "Not now".
   */
  shouldNudge: boolean
  /** Puts the prompt away until the next substantial change. */
  dismiss: () => void
  /**
   * The backup as bytes, without saving anything.
   *
   * Split out from `download` because a backup now has a second destination:
   * `useHandoffSend` seals these bytes into convoy chunks and streams them to a
   * phone, and it has no use for a file on disk. Building does NOT record a
   * backup as having been taken — nothing durable has happened on THIS device,
   * and `changed` resetting because a transfer started would tell someone they
   * were safe when the only copy here is still in a tab.
   *
   * REJECTS rather than answering with a document-free backup when the stored
   * documents cannot be vouched for — see `collectDocuments` for the two cases
   * and what was measured. Both callers already turn a rejection into a sentence
   * on screen (`download` below, `guardedTransfer` in `handoff-send.ts`), which
   * is what makes refusing expressible here at all.
   */
  build: (options?: BuildOptions) => Promise<Uint8Array<ArrayBuffer>>
  /**
   * The backup as a Blob assembled from per-slice Blobs, without saving it.
   *
   * What `download` falls back to where there is no save picker, and what
   * `build` reads its bytes from. A Blob made of Blobs is not joined in the
   * page's memory — the browser keeps the pieces in its own blob store, which
   * Chrome pages to disk past its memory limit.
   */
  blob: (options?: BuildOptions, onProgress?: (p: BackupProgress) => void) => Promise<Blob>
  /**
   * Builds the file and hands it to the browser under `name`.
   *
   * The NAME comes from the caller rather than from here, because
   * `components/settings/export-name.ts` already owns it and already has the
   * test that stops a button promising a filename nothing writes. A second
   * generator in this file would be the same drift that test exists to catch.
   *
   * `saved` when it wrote through a save picker and the file is closed on
   * disk; `started` when the click was dispatched to the browser's downloader;
   * `cancelled` when the person closed the save dialog; `failed` otherwise — so
   * a caller can tell each apart. The export this replaces could not, and said
   * "started" either way.
   */
  download: (name: string, onProgress?: (p: BackupProgress) => void) => Promise<DownloadOutcome>
}

export function useBackup(readable?: () => unknown): BackupState {
  const mascot = useMascot()
  const graph = useGraph()
  const blobs = useVaultBlobs()

  const { repo } = useKg()

  const lastBackupAt = useSyncExternalStore(subscribeMarks, readLastBackup, noMark)
  const dismissedAt = useSyncExternalStore(subscribeMarks, readNudgeDismissed, noMark)
  // Off the repository's meta during render. `useGraph()` above is the
  // subscription, and `seededAt` only moves on a reseed, which commits.
  const seededAt = repo.meta.seededAt

  const { changed, shouldNudge } = useMemo(
    () => backupNudge(graph.nodes(), { lastBackupAt, dismissedAt, seededAt }),
    [graph, lastBackupAt, dismissedAt, seededAt],
  )

  /** Everything in front of the documents, as the head of the file. */
  const head = useCallback(
    () =>
      backupHead({
        exportedAt: new Date().toISOString(),
        nodes: graph.nodes(),
        edges: graph.edges(),
        ...(readable === undefined ? {} : { readable: readable() }),
      }),
    [graph, readable],
  )

  /**
   * The whole file, into `sink`. Throws, having written part of it, when the
   * documents cannot be vouched for — every caller discards what it got.
   */
  const write = useCallback(
    async (
      sink: BackupSink,
      withDocuments: boolean,
      onProgress?: (p: BackupProgress) => void,
    ): Promise<DocumentCount> => {
      await sink(head())
      const counted = withDocuments
        ? await streamDocuments(blobs, sink, onProgress)
        : { written: 0, total: 0 }
      await sink(BACKUP_TAIL)
      return counted
    },
    [head, blobs],
  )

  /** The whole file as a Blob, and how many documents it holds. */
  const assemble = useCallback(
    async (
      { documents: withDocuments = true }: BuildOptions = {},
      onProgress?: (p: BackupProgress) => void,
    ) => {
      const pieces: Blob[] = []
      const documents = await write(
        async (part) => {
          pieces.push(new Blob([part as BlobPart]))
        },
        withDocuments,
        onProgress,
      )
      return { file: new Blob(pieces, { type: 'application/json' }), documents }
    },
    [write],
  )

  const blob = useCallback(
    async (options: BuildOptions = {}, onProgress?: (p: BackupProgress) => void) =>
      (await assemble(options, onProgress)).file,
    [assemble],
  )

  const build = useCallback(
    async (options: BuildOptions = {}): Promise<Uint8Array<ArrayBuffer>> => {
      // Through the same writer, so a transfer and a download are one format
      // written one way. A transfer seals bytes into chunks and needs them in
      // hand; an ArrayBuffer has no string's length limit.
      return new Uint8Array(await (await blob(options)).arrayBuffer())
    },
    [blob],
  )

  const download = useCallback(
    async (name: string, onProgress?: (p: BackupProgress) => void): Promise<DownloadOutcome> => {
      const at = new Date()

      /*
       * Straight to disk where the browser can, and the store is big enough to
       * need it. Asked FIRST, before any await that could outlast the click's
       * user activation — the picker refuses to open without it. A refusal of
       * that kind (no activation, a policy) falls through to the download; a
       * person closing the dialog is `cancelled`, and nothing is written.
       */
      const picker = savePicker()
      if (picker !== null && (await storedBytes()) >= SAVE_PICKER_FROM) {
        let handle: Awaited<ReturnType<SavePicker>> | null = null
        try {
          handle = await picker({
            suggestedName: name,
            types: [{ description: 'jojo backup', accept: { 'application/json': ['.json'] } }],
          })
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
          handle = null
        }
        if (handle !== null) {
          let file: Awaited<ReturnType<typeof handle.createWritable>> | null = null
          let documents: DocumentCount
          try {
            file = await handle.createWritable()
            const out = file
            documents = await write((part) => out.write(part), true, onProgress)
            // `close` is what makes the file real: until it resolves the bytes
            // are in a swap file the browser deletes on abort.
            await file.close()
          } catch (error) {
            reportError('backup', error)
            await file?.abort().catch(() => undefined)
            const reason = reasonOf(error)
            return reason === undefined ? 'failed' : { kind: 'failed', reason }
          }
          writeLastBackup(at.toISOString())
          report('backup_used', { direction: 'export', records: bucket(graph.nodes().length) })
          mascot.play(CUES.backupSaved)
          return { kind: 'saved', documents }
        }
      }

      // `build` INSIDE the try. It reads every document and writes the lot, so
      // it throws on a quota read, on a document index that has not loaded yet
      // or that lists documents it will not read. It used to sit above the
      // try, where a throw rejected this promise — and the only caller does
      // `void download(...).then(...)` with no `.catch`, so the user got no
      // file, no toast and no error. A button that does nothing reads as a
      // broken button, not as a warning about their records.
      let href: string | null = null
      let documents: DocumentCount
      try {
        const made = await assemble({}, onProgress)
        documents = made.documents
        href = URL.createObjectURL(made.file)
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = name
        anchor.click()
      } catch (error) {
        // The user gets a toast saying it failed; this says WHY, to somebody who
        // can fix it. A backup is the one thing between a person and losing
        // everything, so a silent failure here is the most expensive silence in
        // the app.
        reportError('backup', error)
        if (href !== null) URL.revokeObjectURL(href)
        const reason = reasonOf(error)
        return reason === undefined ? 'failed' : { kind: 'failed', reason }
      }

      // Revoked LATER, NOT synchronously and not in a `finally`. An early
      // revoke races the download the click just started and the file arrives
      // EMPTY — which is the worst possible outcome here, because the user has
      // a file named like a backup that contains nothing, and
      // `writeLastBackup` below has just told them they are safe. "Next task"
      // was not late enough for Firefox on a large file; see `revokeLater`.
      revokeLater(href)

      // Recorded only after the click. Recording it first would mean a browser
      // that blocked the download left jojo believing the user was safe.
      writeLastBackup(at.toISOString())
      /*
       * Reported here for the same reason `writeLastBackup` is: this is the
       * first line that runs only when a file actually reached the user. The
       * count is how much the person has in jojo, BUCKETED — which answers
       * "is this feature used by people with real stores or only on empty
       * demos", while an exact number would be a small fingerprint and answer
       * nothing extra.
       */
      report('backup_used', { direction: 'export', records: bucket(graph.nodes().length) })
      mascot.play(CUES.backupSaved)
      return { kind: 'started', documents }
    },
    [assemble, write, graph, mascot],
  )

  return {
    changed,
    lastBackupAt,
    shouldNudge,
    // A closure, not `dismissBackupNudge` itself: handed straight to `onClick`,
    // the click event arrived as `at` and was stored as "[object Object]" —
    // which sorts after every ISO instant, so the prompt never came back.
    dismiss: () => dismissBackupNudge(),
    build,
    blob,
    download,
  }
}
