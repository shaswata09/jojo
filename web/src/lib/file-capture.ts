import { useCallback } from 'react'
import type { CaptureEnvelope } from '@jojo/service/core/capture'
import { captureFileName, captureNote, postingIdentity } from '@jojo/service/core/capture'
import { sizeLabel } from '@jojo/service/core/files'
import type { Application } from '@/data/seed'
import type { VaultFile } from '@/data/vault'
import { useApplications } from '@jojo/service/react/use-applications'
import { useVault } from '@jojo/service/react/use-vault'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { TODAY } from '@/lib/today'

/**
 * Turns a capture into a vault record with bytes behind it.
 *
 * Two writes that have to happen in this order and cannot be one: the record is
 * created first because the blob store is keyed on the record's id, and the
 * bytes go in second. There is no transaction across the two — the graph is
 * synchronous and IndexedDB is not — so the failure mode is a record with no
 * bytes, which is a state the viewer already renders honestly ("no saved copy on
 * this device"). The other order would produce orphan bytes under an id no
 * record claims, which nothing lists and nothing can clean up.
 */

/**
 * The application a captured page most likely belongs to, or null.
 *
 * A SUGGESTION, and nothing more — see `useFileCapture`, which files every
 * capture unassigned. This decides what to OFFER, never what to attach.
 *
 * `postingIdentity` decides, which is the same function the duplicate warning
 * and the posting lookup use — so a page cannot be filed under an application
 * that the form would not have called a duplicate.
 *
 * It used to compare origin and path here, with the query dropped. On a board
 * that puts the job id in the query — HigherEdJobs's
 * `/faculty/details.cfm?JobCode=…`, Indeed's `/viewjob?jk=` — every posting on
 * the site had one address, so a captured page was filed under whichever
 * application happened to be first: somebody else's job, scored against these
 * requirements. Measured 2026-09-12.
 *
 * A miss files the capture unattached, which the Vault's own picker fixes in
 * one click. The wrong application is worse than none, which is why this is
 * equality on an identity rather than a resemblance.
 */
export function applicationForCapture<T extends { id: string; url?: string | undefined }>(
  applications: readonly T[],
  url: string,
): T | null {
  const wanted = postingIdentity(url)
  if (wanted === undefined) return null
  return applications.find((a) => a.url !== undefined && postingIdentity(a.url) === wanted) ?? null
}

/**
 * The vault record a capture becomes, before its bytes are written.
 *
 * Lifted out of the hook so a test can hold it, because the rule it carries is
 * one line's ABSENCE: there is no `applicationIds`, so a capture is saved under
 * no application at all. An absent field is exactly the kind of thing that
 * comes back by accident — somebody re-adds the "helpful" match — and nothing
 * else in the app would notice.
 */
export function captureFileRecord(capture: CaptureEnvelope, today: string, bytes: number) {
  return {
    name: captureFileName(capture.url, capture.title, today),
    // 'page' is what the Vault's icon and both viewers key off.
    kind: 'page' as const,
    /*
     * Its own drawer, not 'Applications'.
     *
     * 'Applications' holds the documents the USER wrote — the CV, the
     * statements, the cover letters — and the Profile page shows that drawer as
     * "your documents". Filing captures there put pages the user never uploaded
     * among the ones they did, and grew every time they clipped a listing.
     */
    bucket: 'Job postings' as const,
    size: sizeLabel(bytes),
    sourceUrl: capture.url,
    capturedAt: capture.capturedAt,
    note: captureNote(capture),
  }
}

export type FiledCapture = {
  file: VaultFile
  /**
   * The application this page looks like it belongs to, or null.
   *
   * Offered, never applied. The file is saved with no application at all.
   */
  suggestion: Application | null
  /** Assets the capture could not keep. Reported, never hidden. */
  dropped: number
  /** False when the record was written but the bytes were not. */
  stored: boolean
}

export function useFileCapture(): (capture: CaptureEnvelope) => Promise<FiledCapture> {
  const { addFile } = useVault()
  const { all } = useApplications()
  const blobs = useVaultBlobs()

  return useCallback(
    async (capture: CaptureEnvelope): Promise<FiledCapture> => {
      /*
       * NOTHING IS ATTACHED HERE. A capture is filed unassigned.
       *
       * This used to file the page under the application whose posting URL it
       * matched. Even at its strictest — identity equality, which is already
       * the fix that stopped a whole board sharing one address — that is the
       * app deciding for the person: a page kept from a listing is not always
       * about the application already tracking that listing, and a record that
       * quietly joins itself to another is a link nobody chose and nobody sees
       * being made. Keeping a page and filing it are two acts, and both are the
       * user's.
       *
       * The match is still worked out, but only to SAY so: the toast can name
       * the likely application, and the picker on the file's own row in the
       * Vault does the filing in one click.
       */
      const suggestion = capture.url ? applicationForCapture(all, capture.url) : null

      const bytes = new TextEncoder().encode(capture.html)
      const record = captureFileRecord(capture, TODAY, bytes.byteLength)
      const name = record.name
      const file = addFile(record)

      // `type` is set explicitly because it is what the viewer's `srcdoc` read
      // and any later download depend on, and a Blob built from bytes has no
      // type unless it is given one.
      const stored = await blobs.put(file.id, new File([bytes], name, { type: 'text/html' }))

      return { file, suggestion, dropped: capture.dropped, stored }
    },
    [addFile, all, blobs],
  )
}
