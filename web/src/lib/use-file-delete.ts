import { useCallback } from 'react'
import type { VaultFile } from '@jojo/service/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { useVaultBlobs } from '@/lib/vault-blobs'

/**
 * Deleting a document, everywhere it can be deleted from.
 *
 * Extracted from the Vault's files tool when the Profile page grew a delete of
 * its own. A document is four things — the record, its keywords, the bytes in
 * IndexedDB, and whatever is on screen showing it — and a second hand-written
 * delete would have got the first and forgotten the third. Bytes left behind
 * that way are invisible, unreachable, and still counted against a quota the
 * user cannot get back, so the failure is silent and permanent.
 *
 * `onGone` is for the caller's own state: a viewer or an editor open on the
 * record that has just stopped existing.
 */
export function useFileDelete() {
  const { removeFile } = useVault()
  const { labelIdsOf, setRecord, removeRecord } = useLabels()
  const blobs = useVaultBlobs()
  const { toast } = useToast()

  return useCallback(
    (file: VaultFile, onGone?: (id: string) => void) => {
      /*
       * Whether there were bytes to lose, asked BEFORE they are taken.
       *
       * Without it the Undo warned "came back without its document" for every
       * record that never had one — every seeded row, and every document typed
       * in by hand rather than chosen from disk. A warning about a loss that did
       * not happen is worse than no warning: it teaches people to ignore the one
       * that matters. Seen on the Profile page, whose card is mostly such rows,
       * but the Vault's delete had it too — they are the same call.
       */
      const had = blobs.has(file.id)
      const stashed = labelIdsOf(file.id)
      const { restore } = removeFile(file.id)
      removeRecord(file.id)
      // The stored copy goes too. Without this the record disappears and its
      // bytes stay in IndexedDB for good.
      void blobs.remove(file.id)
      onGone?.(file.id)

      toast({
        title: `${file.name} deleted`,
        description: had
          ? 'The row, its keywords and jojo’s copy of the document all go. The original on your computer is untouched.'
          : 'The row and its keywords go. There was no stored copy of this one to lose.',
        tone: 'danger',
        action: {
          label: 'Undo',
          onClick: () => {
            restore()
            // The document comes back with the row — and if it cannot, say so.
            // An Undo that restores a record whose document has gone is worse
            // than no Undo, because the row looks intact and the loss is only
            // discovered later, by someone opening it.
            if (!had) {
              if (stashed.length > 0) setRecord(file.id, stashed)
              return
            }
            void blobs.restore(file.id).then((came) => {
              if (came) return
              toast({
                title: `${file.name} came back without its document`,
                description:
                  'The row and its keywords are restored, but the stored copy could not be. Drop the file in again to attach it.',
                tone: 'danger',
              })
            })
            // Guarded: `setRecord` with an empty list files the record as
            // carrying no keywords rather than leaving it unmentioned.
            if (stashed.length > 0) setRecord(file.id, stashed)
          },
        },
      })
    },
    [blobs, labelIdsOf, removeFile, removeRecord, setRecord, toast],
  )
}
