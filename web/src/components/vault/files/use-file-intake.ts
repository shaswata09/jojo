import { useCallback } from 'react'
import { useVault } from '@jojo/service/react/use-vault'
import type { FileBucket } from '@/data/vault'
import { report } from '@/lib/analytics'
import { kindOfFile, sizeLabel } from '@/lib/files'
import { useToast } from '@/lib/toast-context'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { sortDrop } from '@/components/vault/files/intake'
import { CAPTURE_MAX_BYTES, remoteRefCount } from '@jojo/service/core/capture'

/**
 * What to tell the person about a web page they dropped in, or null when there
 * is nothing to say.
 *
 * A capture from the extension or the phone is checked by `readCapture` before
 * it is filed, and refused if it still names anything on the web. A .html file
 * dropped on the Vault skipped that check entirely, so a saved page that loads
 * its pictures from a tracker was filed as if it were self-contained — and,
 * before the viewer's lock was rebuilt, beaconed on every viewing.
 *
 * It is filed anyway rather than refused. An ordinary "Save page as" file names
 * dozens of addresses, and refusing all of those would make the Vault useless
 * for the one kind of page people most often have; the viewer shows a page with
 * every fetch blocked whatever it names. What changes is that the person is
 * TOLD, so a page with its images missing is not a mystery.
 */
export async function droppedPageNote(
  file: File,
): Promise<{ title: string; description: string } | null> {
  // .mhtml is a MIME archive, not markup; the scan would read its encoded parts.
  if (!/\.html?$/i.test(file.name)) return null
  // The scan is a regex over the whole text, so a huge file is not handed to it
  // — the same order `readCapture` checks in.
  if (file.size > CAPTURE_MAX_BYTES) {
    return {
      title: `${file.name} was too large to check`,
      description:
        'It is filed, and it opens with every web address in it blocked, so nothing in it reaches the network — but anything it loads from the web will be missing.',
    }
  }
  let refs: number
  try {
    refs = remoteRefCount(await file.text())
  } catch {
    return null
  }
  if (refs === 0) return null
  return {
    title: `${file.name} names ${String(refs)} web address${refs === 1 ? '' : 'es'}`,
    description:
      'It is filed as you dropped it, and jojo shows it with every one of them blocked, so opening it never reaches the network. Pictures or styles it loaded from the web will be missing.',
  }
}

/**
 * The one way a document enters the Vault, for every surface that takes one.
 *
 * The Profile page used to file its own drops: one `addFile` per file, with
 * none of `sortDrop`'s rules — so the same CV dropped twice made two rows, a
 * row left without its bytes by a full disk could not be refilled from there
 * (the failure toast's own advice), and a dropped folder became a 192-byte
 * "document". Both pages now go through here and cannot drift apart again.
 */
export type FileIntakeOptions = {
  /** Where new rows are filed. */
  bucket: FileBucket
  /**
   * How the success toast says where they went — "under To read" in the Vault,
   * where the bucket is on screen; "in the Vault under Documents" elsewhere.
   */
  place?: string | undefined
  /** New rows will not show in the list right now (a keyword filter is up). */
  hidden?: boolean | undefined
  /** Count each new file as `vault_item_added`. The Vault's own tool does. */
  reportAdds?: boolean | undefined
}

export function useFileIntake({
  bucket,
  place,
  hidden = false,
  reportAdds = false,
}: FileIntakeOptions) {
  const { files, addFile, removeFile } = useVault()
  const blobs = useVaultBlobs()
  const { toast } = useToast()
  const where = place ?? `under ${bucket}`

  return useCallback(
    (list: Iterable<File> | ArrayLike<File> | null) => {
      // `blobs.has` so a record left without its document — a write refused on
      // quota — is refillable rather than rejected as a duplicate of itself.
      const { total, picked, fresh, refill, folders, skipped } = sortDrop(list, files, (f) =>
        blobs.has(f.id),
      )
      if (total === 0) return

      if (picked.length === 0) {
        toast({
          title: folders === 1 ? 'That looks like a folder' : 'Those look like folders',
          description:
            'jojo files documents one at a time. Open the folder and drop the files in it.',
        })
        return
      }

      // Refills first: they add no rows, so the toast below can still speak
      // about what was newly filed without counting them twice.
      for (const { file, record } of refill) {
        void blobs.put(record.id, file).then((stored) => {
          toast(
            stored
              ? {
                  title: `${file.name} is attached again`,
                  description: 'The row was already here without its document. It has one now.',
                }
              : {
                  title: `${file.name} still could not be saved`,
                  description:
                    'This browser refused to store it again — its storage is probably still full.',
                  tone: 'danger',
                },
          )
        })
      }

      const added: string[] = []
      for (const file of fresh) {
        const record = addFile({
          name: file.name,
          kind: kindOfFile(file.name, file.type),
          bucket,
          size: sizeLabel(file.size),
        })
        added.push(record.id)
        // A dropped web page is scanned the way a capture is; see `droppedPageNote`.
        if (record.kind === 'page') {
          void droppedPageNote(file).then((note) => {
            if (note) toast(note)
          })
        }
        // Per file: six documents dropped at once are six filings.
        if (reportAdds) report('vault_item_added', { kind: 'file' })
        // Not awaited, so the row appears immediately — a slow disk or a full
        // quota can take a while. The RESULT is not discarded: a refusal says
        // so, rather than a row naming a document that was never stored.
        void blobs.put(record.id, file).then((stored) => {
          if (stored) return
          toast({
            title: `${file.name} was filed, but not saved`,
            description:
              'The row is here, but this browser refused to store the document — usually because its storage is full. Free some space and drop the same file in again; it will attach to this row rather than making a second one.',
            tone: 'danger',
          })
        })
      }

      if (fresh.length === 0 && refill.length === 0) {
        toast({
          title: skipped === 1 ? 'That file is already here' : 'Those files are already here',
          description: 'A file of the same name is already in the vault.',
        })
        return
      }

      if (fresh.length > 0) {
        const named = fresh.length === 1 ? fresh[0].name : `${fresh.length} files`
        toast({
          title: `${named} added`,
          description: hidden
            ? `Filed ${where} — hidden while the keyword filter is on.`
            : `Filed ${where} and saved in this browser. Nothing was uploaded anywhere.`,
          action: {
            label: 'Undo',
            onClick: () =>
              added.forEach((id) => {
                removeFile(id)
                // Undoing an add that already stored its bytes would otherwise
                // leave them in IndexedDB with no record pointing at them.
                void blobs.remove(id)
              }),
          },
        })
      }
      if (skipped > 0) {
        toast({
          title: `${skipped} skipped`,
          description: 'A file of the same name was already in the vault.',
        })
      }
      // Said even when the rest of the drop landed, so nobody is left counting
      // rows and not finding the number they expected.
      if (folders > 0) {
        toast({
          title: folders === 1 ? '1 folder skipped' : `${folders} folders skipped`,
          description:
            'jojo files documents one at a time. Open the folder and drop the files in it.',
        })
      }
    },
    [files, blobs, toast, addFile, removeFile, bucket, where, hidden, reportAdds],
  )
}
