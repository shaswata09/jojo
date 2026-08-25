import { useCallback } from 'react'
import { convertFile } from '@/lib/markitdown'
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
      if (reader.trim() === '') {
        return {
          ok: false as const,
          reason:
            'No document reader is connected, so the inside of this file cannot be read. Settings is where its address goes.',
        }
      }
      const file = await blobs.get(fileId)
      if (!file) {
        return {
          ok: false as const,
          reason:
            'No copy of that document is stored in this browser, so there is nothing to read.',
        }
      }
      return convertFile(reader, file)
    },
    [blobs, reader],
  )
}
