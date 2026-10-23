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
 */

import { reportError } from '@/lib/report-error'
import { useCallback, useMemo } from 'react'
import { useGraph } from '@jojo/service/react/kg-context'
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

function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    // Private browsing blocks localStorage. Never having backed up is the safe
    // reading: the prompt appears, which is the harmless direction to be wrong in.
    return null
  }
}

function writeLastBackup(at: string): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, at)
  } catch {
    // The backup still downloaded. Failing to REMEMBER that must not report the
    // backup as failed — the file is on their disk either way.
  }
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
 * asynchronously on mount — `purgeOnce()` opens the store and sweeps the trash
 * before the first `list` — so for a moment after the page appears `all()`
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
export async function streamDocuments(
  blobs: BackupBlobs,
  sink: BackupSink,
  onProgress?: (p: BackupProgress) => void,
): Promise<void> {
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
      new Error(`${listed.length - written} of ${listed.length} documents would not read and are not in this backup.`),
    )
  }
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
    documents.push({ path: blobPath(item.id, item.name), data: new Uint8Array(await file.arrayBuffer()) })
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
export type DownloadOutcome = 'saved' | 'started' | 'cancelled' | 'failed'

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
  /** Whether `changed` has crossed the threshold worth mentioning. */
  shouldNudge: boolean
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
  const graph = useGraph()
  const blobs = useVaultBlobs()

  const lastBackupAt = readLastBackup()

  const changed = useMemo(() => {
    const nodes = graph.nodes()
    if (lastBackupAt === null) return nodes.length
    // ISO-8601 sorts lexicographically, which is the whole reason this app
    // stores instants as strings — no parsing, and no timezone to get wrong.
    return nodes.filter((n) => n.updatedAt > lastBackupAt).length
  }, [graph, lastBackupAt])

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
    async (sink: BackupSink, withDocuments: boolean, onProgress?: (p: BackupProgress) => void) => {
      await sink(head())
      if (withDocuments) await streamDocuments(blobs, sink, onProgress)
      await sink(BACKUP_TAIL)
    },
    [head, blobs],
  )

  const blob = useCallback(
    async ({ documents: withDocuments = true }: BuildOptions = {}, onProgress?: (p: BackupProgress) => void) => {
      const pieces: Blob[] = []
      await write(async (part) => {
        pieces.push(new Blob([part as BlobPart]))
      }, withDocuments, onProgress)
      return new Blob(pieces, { type: 'application/json' })
    },
    [write],
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
          try {
            file = await handle.createWritable()
            const out = file
            await write((part) => out.write(part), true, onProgress)
            // `close` is what makes the file real: until it resolves the bytes
            // are in a swap file the browser deletes on abort.
            await file.close()
          } catch (error) {
            reportError('backup', error)
            await file?.abort().catch(() => undefined)
            return 'failed'
          }
          writeLastBackup(at.toISOString())
          report('backup_used', { direction: 'export', records: bucket(graph.nodes().length) })
          return 'saved'
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
      try {
        const file = await blob({}, onProgress)
        href = URL.createObjectURL(file)
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
        return 'failed'
      }

      // Revoked on the next task, NOT synchronously and not in a `finally`.
      // A synchronous revoke races the download the click just started and the
      // file arrives EMPTY — which is the worst possible outcome here, because
      // the user has a file named like a backup that contains nothing, and
      // `writeLastBackup` below has just told them they are safe.
      // `vault-blobs.ts` learned this first; this path had kept the racy form.
      const url = href
      setTimeout(() => URL.revokeObjectURL(url), 0)

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
      return 'started'
    },
    [blob, write, graph],
  )

  return {
    changed,
    lastBackupAt,
    shouldNudge: changed >= BACKUP_NUDGE_AT,
    build,
    blob,
    download,
  }
}
