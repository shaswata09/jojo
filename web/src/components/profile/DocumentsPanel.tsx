import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router'
import { Download, FileText, Upload } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { FileViewer } from '@/components/vault/FileViewer'
import { useFileDrop } from '@/components/vault/files/use-file-drop'
import { useFileIntake } from '@/components/vault/files/use-file-intake'
import { Button } from '@/components/ui/button'
import { useApplications } from '@jojo/service/react/use-applications'
import { useVault } from '@jojo/service/react/use-vault'
import { vaultPath } from '@/lib/links'
import { pickedFiles } from '@/lib/file-input'
import { DocumentTile } from './DocumentTile'
import { DOCUMENTS_BUCKET } from './profile-lists'
import { useDocumentViewer } from './use-document-viewer'

/** The Profile's Documents card: upload, drop, the grid of documents and the inline viewer. */
export function DocumentsPanel() {
  const { files } = useVault()
  const { get } = useApplications()
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * A view over the Vault, never a second list.
   *
   * The audit found this panel keeping its own array of documents while the
   * Vault kept another: a CV uploaded in one place left the other stale, and
   * the "used by 12 applications" counts beside them were decoration, since
   * nothing ever counted anything. One collection, filtered to the bucket that
   * means "what I send with an application".
   */
  const documents = files.filter((f) => f.bucket === DOCUMENTS_BUCKET)

  /**
   * One intake for both ways in — and the same one the Vault uses.
   *
   * Picking and dropping have to file the same record, store the same bytes
   * and raise the same toast. This page used to do that by itself with one
   * `addFile` per file, which skipped the Vault's rules: a second drop of the
   * same CV made a second row, a row a full disk left without its document
   * could not be refilled from here, and a dropped folder filed as a document.
   */
  const takeFiles = useFileIntake({
    bucket: DOCUMENTS_BUCKET,
    place: `in the Vault under ${DOCUMENTS_BUCKET}`,
  })

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    // Copied off the input BEFORE it is cleared — see `lib/file-input.ts`.
    // This read `files` first, cleared, then filed: the list is live, the
    // clear emptied it, and nothing was ever stored from this page.
    takeFiles(pickedFiles(event.target))
  }

  const drop = useFileDrop(takeFiles)
  const viewer = useDocumentViewer(documents)

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="mb-0" hint={`the Vault's ${DOCUMENTS_BUCKET} bucket`}>
          Documents
        </PanelTitle>
        <div className="flex gap-2">
          {/* The button is the affordance; the input is only the mechanism, so
              it is hidden rather than styled. `hidden` and not `sr-only`:
              there is nothing here for a screen reader to operate that the
              button beside it does not already do. */}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.key,.txt,.md"
            className="hidden"
            onChange={(e) => void onPicked(e)}
          />
          <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
            Upload
          </Button>
          {/* Not a disabled "Export all": nothing on this page holds a
              document's contents, so the only honest export is the record
              export, and it lives one click away. */}
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              Export in Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* The whole list is the drop target, not a strip at the bottom.
          Someone dragging a CV aims at the documents, and a zone that only
          accepts below them is a zone they miss. */}
      <div
        onDragEnter={drop.onDragEnter}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
        className={`rounded-lg transition-colors ${
          drop.dragging
            ? 'outline-2 outline-offset-4 outline-accent outline-dashed'
            : 'outline-none'
        }`}
      >
        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description={`Drop your CV and statements here, or choose them — they are filed in the Vault under ${DOCUMENTS_BUCKET}, where the rest of the app can reach them.`}
            action={
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
                Upload a document
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((f) => (
              <DocumentTile
                key={f.id}
                file={f}
                get={get}
                onOpen={viewer.open}
                onDelete={viewer.onDelete}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Under the list, not at the foot of the page.
          `FileViewer` renders inline rather than as an overlay — in the Vault
          it sits in a second column beside the rows. This page has one column,
          so at the end of the document it opened four panels below the click
          and frequently off screen, which reads as nothing having happened.
          `scrollIntoView` in `useDocumentViewer` covers the case where the card
          itself is near the bottom of the window. */}
      {viewer.openDoc ? (
        <div ref={viewer.viewerRef} className="mt-4">
          <FileViewer
            file={viewer.openDoc}
            blob={viewer.openBlob ?? undefined}
            onClose={viewer.close}
          />
        </div>
      ) : null}

      <p className="mt-4 text-xs text-text-3">
        The same files as the Vault's{' '}
        <Link
          to={vaultPath({ tool: 'files' })}
          className="text-text-2 underline underline-offset-2 hover:text-text-1"
        >
          Files tool
        </Link>
        , filtered to {DOCUMENTS_BUCKET}. Drop a document here or choose one and the file itself is
        kept in this browser — nothing is uploaded anywhere. Click one to read it.
      </p>
    </Panel>
  )
}
