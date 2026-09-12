import { useCallback } from 'react'
import { convertFile } from '@/lib/markitdown'
import { readHere } from '@/lib/read-here'
import type { ConvertResult } from '@jojo/service/agent/markitdown'
import { useModelSettings } from '@/lib/model-settings-context'
import { useVaultBlobs } from '@/lib/vault-blobs'

/**
 * Opening a document the Vault holds, by its record id.
 *
 * Three callers need exactly this now — the assistant's `vault.file.read`, the
 * CV reader behind the profile offer, and the fit assessment that has to read a
 * captured posting — and it was written inline in `Assistant.tsx` first. Left
 * there, the second and third copies would each have had to re-derive the two
 * failures that are not the same failure: no bytes stored in this browser, and
 * no reader configured to open them with.
 *
 * WHY IT IS TWO LOOKUPS. The graph holds a record about a file and never its
 * bytes — D27's binary-free invariant, which is what keeps `getAll('nodes')` a
 * 5 ms operation. So the id names a row, the row is turned into a `File` by the
 * blob store, and only then is there something a reader can open. A record with
 * no blob behind it is an ordinary state: it is every file in a backup restored
 * onto a machine that never had the originals.
 */
export function useReadDocument(): (fileId: string) => Promise<ConvertResult> {
  const { reader } = useModelSettings()
  const blobs = useVaultBlobs()

  return useCallback(
    async (fileId: string) => {
      const file = await blobs.get(fileId)
      if (!file) {
        return {
          ok: false as const,
          reason:
            'No copy of that document is stored in this browser, so there is nothing to read.',
        }
      }
      /*
       * This tab first, the reader second — the phone's order, and for the
       * same reason. A saved posting is HTML; it was being sent to MarkItDown,
       * which refused the extension's captures as too large, on the one screen
       * built to read them. Only an `ok` answer is taken here: a document that
       * read as empty falls through, because the reader has OCR.
       */
      const here = await readHere(file)
      if (here?.ok) return here
      if (reader.trim() === '') {
        return {
          ok: false as const,
          reason:
            here === null
              ? 'No document reader is connected, so the inside of this file cannot be read. Settings is where its address goes.'
              : `${here.reason} No document reader is connected to try harder — Settings is where its address goes.`,
        }
      }
      return convertFile(reader, file)
    },
    [blobs, reader],
  )
}
