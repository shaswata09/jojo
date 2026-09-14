import { useCallback, useMemo } from 'react'
import { useVault } from '@jojo/service/react/use-vault'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { kindOfFile, sizeLabel } from '@/lib/files'
import { safeName } from '@/lib/pdf/output-name'
import type { FileBucket, VaultFile } from '@/data/vault'

/**
 * Where the PDF editor gets bytes from, and where it puts them back.
 *
 * The one place in the tool that touches storage, so the panels stay about
 * documents rather than about the vault. Everything runs here, in the tab: the
 * bytes are read out of the browser's own file store, edited in memory and
 * written back, and nothing is uploaded anywhere. That is not a detail of the
 * implementation — it is the reason this tool can be offered at all for a CV.
 */

/** A PDF the editor can open: one already filed, or one just picked. */
export type PdfChoice =
  | { readonly kind: 'vault'; readonly id: string; readonly name: string; readonly bucket: FileBucket }
  | { readonly kind: 'device'; readonly id: string; readonly name: string; readonly file: File }

export const choiceOf = (file: VaultFile): PdfChoice => ({
  kind: 'vault',
  id: file.id,
  name: file.name,
  bucket: file.bucket,
})

export function usePdfFiles() {
  const { files, addFile } = useVault()
  const blobs = useVaultBlobs()

  /**
   * The PDFs that can actually be opened.
   *
   * A vault row and its bytes are separate things: a seeded record, or one
   * whose document was never stored, has a name and no file behind it. Offering
   * those would mean a picker where half the entries fail on click.
   *
   * `blobs.revision` is in the dependency list on purpose — `has` is a stable
   * function reading a ref, so without it this list would never notice a
   * document arriving.
   */
  const available = useMemo(
    () => files.filter((file) => file.kind === 'pdf' && blobs.has(file.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `revision` above.
    [files, blobs.has, blobs.revision],
  )

  const bytesOf = useCallback(
    async (choice: PdfChoice): Promise<Uint8Array> => {
      const file = choice.kind === 'device' ? choice.file : await blobs.get(choice.id)
      if (!file) throw new Error(`${choice.name} is no longer stored, so it cannot be opened.`)
      return new Uint8Array(await file.arrayBuffer())
    },
    [blobs],
  )

  /**
   * Files the result as a NEW document, and reports where it went.
   *
   * Never an overwrite, and never optional. The input is usually the only copy
   * of something — a CV, a signed contract — and a tool that can reorder pages
   * is a tool that can destroy one. A new row costs a little storage and makes
   * every operation here undoable by deleting it.
   */
  const saveResult = useCallback(
    async (name: string, bytes: Uint8Array, bucket: FileBucket): Promise<VaultFile> => {
      const finalName = safeName(name)
      // A fresh copy of the buffer: `bytes` may be a view onto a larger one,
      // and `Blob` would then take the whole of it.
      const blob = new Blob([bytes.slice()], { type: 'application/pdf' })
      const file = new File([blob], finalName, { type: 'application/pdf' })
      const record = addFile({
        name: finalName,
        kind: kindOfFile(finalName, 'application/pdf'),
        bucket,
        size: sizeLabel(file.size),
      })
      const stored = await blobs.put(record.id, file)
      if (!stored) {
        throw new Error(
          `${finalName} was filed, but its bytes would not fit in this browser's storage.`,
        )
      }
      return record
    },
    [addFile, blobs],
  )

  return { available, bytesOf, saveResult, download: blobs.download }
}
