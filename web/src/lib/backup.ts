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
import { buildBackup } from '@jojo/service/core/backup'
import { useVaultBlobs } from '@/lib/vault-blobs'
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
   */
  build: (options?: BuildOptions) => Promise<Uint8Array<ArrayBuffer>>
  /**
   * Builds the file and hands it to the browser under `name`.
   *
   * The NAME comes from the caller rather than from here, because
   * `components/settings/export-name.ts` already owns it and already has the
   * test that stops a button promising a filename nothing writes. A second
   * generator in this file would be the same drift that test exists to catch.
   *
   * Returns true if the click was dispatched and false if the browser refused,
   * so a caller can tell the difference — the export this replaces could not,
   * and said "started" either way.
   */
  download: (name: string) => Promise<boolean>
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

  const build = useCallback(
    async ({ documents: withDocuments = true }: BuildOptions = {}): Promise<
      Uint8Array<ArrayBuffer>
    > => {
      const documents: { path: string; data: Uint8Array }[] = []
      if (withDocuments) {
        for (const item of await blobs.all()) {
          const file = await blobs.get(item.id)
          // A document that will not read is skipped rather than aborting the
          // whole backup: a backup missing one file is worth far more than no
          // backup, and the count in the toast is what the user is told, not
          // what was intended.
          if (file === null) continue
          documents.push({
            path: `Documents/${item.id}__${item.name}`,
            data: new Uint8Array(await file.arrayBuffer()),
          })
        }
      }

      const backup = buildBackup({
        exportedAt: new Date().toISOString(),
        nodes: graph.nodes(),
        edges: graph.edges(),
        documents,
        ...(readable === undefined ? {} : { readable: readable() }),
      })

      return new TextEncoder().encode(JSON.stringify(backup))
    },
    [graph, blobs, readable],
  )

  const download = useCallback(
    async (name: string): Promise<boolean> => {
      const at = new Date()

      // `build()` INSIDE the try. It reads every document's bytes and stringifies
      // the lot, so it throws on a quota read, on a missing blob, and on a store
      // large enough for `JSON.stringify` to exceed V8's string limit. It used to
      // sit above the try, where a throw rejected this promise — and the only
      // caller does `void download(...).then(...)` with no `.catch`, so the user
      // got no file, no toast and no error. A button that does nothing reads as a
      // broken button, not as a warning about their records.
      let href: string | null = null
      try {
        const bytes = await build()
        href = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = name
        anchor.click()
      } catch (error) {
        // The user gets a toast saying it failed; this says WHY, to somebody who
        // can fix it. A backup is the one thing between a person and losing
        // everything, so a silent failure here is the most expensive silence in
        // the app — and the two likeliest causes, a quota wall and a string too
        // long for `JSON.stringify`, are both invisible from the outside.
        reportError('backup', error)
        if (href !== null) URL.revokeObjectURL(href)
        return false
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
       * The count is how much the person has in jojo, BUCKETED — which answers
       * "is this feature used by people with real stores or only on empty
       * demos", while an exact number would be a small fingerprint and answer
       * nothing extra.
       */
      report('backup_used', { direction: 'export', records: bucket(graph.nodes().length) })
      return true
    },
    [build, graph],
  )

  return {
    changed,
    lastBackupAt,
    shouldNudge: changed >= BACKUP_NUDGE_AT,
    build,
    download,
  }
}
