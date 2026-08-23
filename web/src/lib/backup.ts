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

import { useCallback, useMemo } from 'react'
import { useGraph } from '@jojo/service/react/kg-context'
import { buildBackup } from '@jojo/service/core/backup'
import { useVaultBlobs } from '@/lib/vault-blobs'

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

export type BackupState = {
  /** Records touched since the last backup, or since the beginning if never. */
  changed: number
  /** ISO instant of the last backup, or null. */
  lastBackupAt: string | null
  /** Whether `changed` has crossed the threshold worth mentioning. */
  shouldNudge: boolean
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

  const download = useCallback(async (name: string): Promise<boolean> => {
    const documents: { path: string; data: Uint8Array }[] = []
    for (const item of await blobs.all()) {
      const file = await blobs.get(item.id)
      // A document that will not read is skipped rather than aborting the whole
      // backup: a backup missing one file is worth far more than no backup, and
      // the count in the toast is what the user is told, not what was intended.
      if (file === null) continue
      documents.push({
        path: `Documents/${item.id}__${item.name}`,
        data: new Uint8Array(await file.arrayBuffer()),
      })
    }

    const at = new Date()
    const backup = buildBackup({
      exportedAt: at.toISOString(),
      nodes: graph.nodes(),
      edges: graph.edges(),
      documents,
      ...(readable === undefined ? {} : { readable: readable() }),
    })

    let href: string | null = null
    try {
      href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = name
      anchor.click()
    } catch {
      return false
    } finally {
      // In a `finally` so a throw between minting the URL and clicking still
      // releases it — a Blob URL pins the entire backup in memory.
      if (href !== null) URL.revokeObjectURL(href)
    }

    // Recorded only after the click. Recording it first would mean a browser
    // that blocked the download left jojo believing the user was safe.
    writeLastBackup(at.toISOString())
    return true
  }, [graph, blobs, readable])

  return {
    changed,
    lastBackupAt,
    shouldNudge: changed >= BACKUP_NUDGE_AT,
    download,
  }
}
