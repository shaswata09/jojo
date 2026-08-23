import { useCallback } from 'react'
import type { CaptureEnvelope } from '@jojo/service/core/capture'
import { captureFileName, captureNote } from '@jojo/service/core/capture'
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
 * Whether two addresses are the same posting.
 *
 * Origin plus path, with the query and fragment dropped. A posting URL picks up
 * `?gh_src=`, `?utm_campaign=`, a session id and a scroll anchor on the way from
 * a job board to a user's clipboard, and every one of those makes a string
 * compare say "different posting" about the same job. What is deliberately NOT
 * ignored is the path: on Workday and Greenhouse the job id lives there, so two
 * roles at one company differ only after the last slash.
 */
function samePosting(a: string, b: string): boolean {
  try {
    const one = new URL(a)
    const two = new URL(b)
    return (
      one.origin === two.origin &&
      one.pathname.replace(/\/+$/, '') === two.pathname.replace(/\/+$/, '')
    )
  } catch {
    return false
  }
}

export type FiledCapture = {
  file: VaultFile
  /** The application it attached itself to, when the URL matched one. */
  application: Application | null
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
       * Filed against the application it belongs to, when that can be known
       * rather than guessed. The extension captures a tab and has no idea which
       * of a dozen applications the user meant; the URL is the one fact both
       * ends already hold, so matching on it is free and silent when it works.
       * A miss files the capture unattached, which the Vault's own picker fixes
       * in one click — the wrong application would be worse than none.
       */
      const match = capture.url
        ? (all.find((a) => a.url !== undefined && samePosting(a.url, capture.url)) ?? null)
        : null

      const name = captureFileName(capture.url, capture.title, TODAY)
      const bytes = new TextEncoder().encode(capture.html)

      const file = addFile({
        name,
        kind: 'page',
        /*
         * Its own drawer, not 'Applications'.
         *
         * This said 'Applications' on the argument that a posting kept against a
         * job is part of that application's paperwork. It is not: 'Applications'
         * holds the documents the USER wrote — the CV, the statements, the cover
         * letters — and the Profile page shows that drawer as "your documents".
         * Filing captures there meant a page the user never uploaded appeared
         * among the ones they did, and grew every time they clipped a listing.
         *
         * The link to the application is `applicationIds` below, which is what
         * actually joins them; the bucket was never carrying that weight.
         */
        bucket: 'Job postings',
        size: sizeLabel(bytes.byteLength),
        sourceUrl: capture.url,
        capturedAt: capture.capturedAt,
        // A list of one: `FILED_UNDER` is many-to-many, and a capture knows
        // about exactly the one application whose URL it matched.
        ...(match === null ? {} : { applicationIds: [match.id] }),
        note: captureNote(capture),
      })

      // `type` is set explicitly because it is what the viewer's `srcdoc` read
      // and any later download depend on, and a Blob built from bytes has no
      // type unless it is given one.
      const stored = await blobs.put(file.id, new File([bytes], name, { type: 'text/html' }))

      return { file, application: match, dropped: capture.dropped, stored }
    },
    [addFile, all, blobs],
  )
}
