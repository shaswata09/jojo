import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { contentModal } from '@/components/ui/dialog-width'
import { FileViewer } from '@/components/vault/FileViewer'
import type { VaultFile } from '@/data/vault'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { cn } from '@/lib/utils'

/**
 * A filed document, previewed where it was found.
 *
 * The Vault shows a document in a panel beside its list, which is right there
 * and wrong everywhere else: a person reading an application and wanting to see
 * the CV they sent had to leave the record, land in the Vault with the row
 * highlighted, and find their way back. Three navigations to look at one page.
 * This is the same viewer in a modal, so the document opens over the record and
 * closing it puts the record back exactly as it was.
 *
 * `FileViewer` rather than a second preview: the blob URL lifecycle, the
 * sandboxed frame a captured page needs, the placeholder for a row with no
 * bytes, the notes drawer and the download are all decisions taken there, and
 * a copy of them here would be a copy that drifts.
 *
 * ## Why the dialog is its own surface and holds no padding
 *
 * `FileViewer` opens with a `Panel`, which already draws the frosted surface
 * and the padding a dialog would otherwise draw around it. Two of them nest
 * into a frame inside a frame, so this one stands down to a transparent box of
 * a definite height and lets the viewer be the thing on screen. The height is
 * definite rather than content-sized because an `<iframe>` has no intrinsic
 * height to grow from — left to size itself, a PDF renders as a sliver.
 */
export function FilePreviewDialog({
  file,
  onClose,
}: {
  /** The document to show, or `null` for "nothing is being previewed". */
  file: VaultFile | null
  onClose: () => void
}) {
  const blobs = useVaultBlobs()
  const [blob, setBlob] = useState<File | null>(null)

  /**
   * The document still on screen while the dialog animates out.
   *
   * `open` goes false a beat before Radix unmounts the content — that gap is
   * the closing animation, and it is also when `onCloseAutoFocus` hands focus
   * back to the Preview button that was pressed. Rendering nothing as soon as
   * `file` is null would cut both short, so the last one is kept for the way
   * out. It is never shown after a close completes: the dialog is shut.
   */
  const lastFile = useRef<VaultFile | null>(null)
  if (file !== null) lastFile.current = file
  const shown = file ?? lastFile.current

  const fileId = file?.id

  useEffect(() => {
    // Cleared first. Without this the previous document's bytes are still in
    // state when a second file opens, and the viewer renders the wrong PDF for
    // as long as the read takes.
    setBlob(null)
    if (fileId === undefined) return
    let alive = true
    void blobs.get(fileId).then((stored) => {
      // Guarded the way the Vault's own read is: the dialog can be closed, or
      // another document opened, while a large file is still being read.
      if (alive) setBlob(stored)
    })
    return () => {
      alive = false
    }
  }, [fileId, blobs])

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {shown === null ? null : (
        <DialogContent
          // The viewer's own header ends in Close, and a second dismissal in the
          // corner above it would read as closing something else.
          showCloseButton={false}
          className={cn(
            contentModal,
            // One row that takes the whole box: a grid row defaults to `auto`,
            // which would size to the viewer's content and leave the frame flat.
            'grid-rows-[minmax(0,1fr)] overflow-hidden border-0 bg-transparent p-0 ring-0',
            'h-[min(85vh,52rem)]',
          )}
        >
          {/* Announced, not drawn: the viewer prints the name in its own header,
              and Radix logs a warning for a dialog with no title at all. */}
          <DialogTitle className="sr-only">{shown.name}</DialogTitle>
          <DialogDescription className="sr-only">
            A preview of {shown.name}, filed under this application. Press Escape to go back to the
            record.
          </DialogDescription>
          <FileViewer file={shown} blob={blob ?? undefined} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  )
}
