import { useEffect, useMemo, useState } from 'react'
import { FileQuestion, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { ExpandButton, FullScreenDialog } from '@/components/common/FullScreen'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Button } from '@/components/ui/button'
import { agoLabel } from '@/data/timeline'
import type { VaultFile } from '@/data/vault'
import { pdfObjectUrl, placeholderPdf } from '@/lib/placeholder-pdf'
import { htmlFromText, textFromHtml } from '@/lib/rich-text'
import { useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'

/**
 * Shows a file in the browser's own document viewer.
 *
 * An `<iframe>` pointed at a PDF hands rendering to whatever reader the browser
 * ships — scrolling, zoom, page count, find, print, all of it — which is the
 * behaviour asked for and none of which is worth reimplementing.
 *
 * Only PDFs get a preview. A browser cannot render .doc or .slides, and dressing
 * one up in a viewer frame would promise something it cannot do.
 *
 * A `blob` means the caller holds the real file — anything added this session —
 * and the frame shows the document itself. The seeded rows have no bytes behind
 * them, so they get a generated placeholder that says as much.
 */
export function FileViewer({
  file,
  blob,
  onClose,
}: {
  file: VaultFile
  /**
   * The real bytes, for a file the user added this session. Seed rows have
   * none and fall back to the generated placeholder below.
   */
  blob?: File
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const [noteSaved, setNoteSaved] = useState(false)
  const { updateFile } = useVault()
  const { toast } = useToast()

  /**
   * The stored note is one line of plain text; the editor speaks HTML.
   *
   * Keyed on the file so switching documents in the viewer loads that
   * document's note rather than carrying the last one across.
   */
  const storedHtml = useMemo(() => htmlFromText(file.note ?? ''), [file.note])
  const [noteHtml, setNoteHtml] = useState(storedHtml)
  useEffect(() => {
    setNoteHtml(storedHtml)
    setNoteSaved(false)
  }, [storedHtml])

  const noteText = textFromHtml(noteHtml)
  const noteDirty = noteText !== (file.note ?? '')

  const saveNote = () => {
    updateFile(file.id, { note: noteText || undefined })
    setNoteSaved(true)
    toast({
      title: `Note saved on ${file.name}`,
      description: noteText
        ? 'It shows against this file wherever the vault lists it.'
        : 'The note is now empty, so nothing shows against this file.',
    })
  }

  // Only a PDF is worth pointing the frame at: a real .docx would hand the user
  // a download prompt where they asked for a preview.
  const real = file.kind === 'pdf' ? blob : undefined

  const pdf = useMemo(
    () =>
      file.kind === 'pdf' && !real
        ? placeholderPdf({
            title: file.name,
            lines: [
              { text: 'Placeholder preview', size: 12 },
              { text: `${file.size} · ${file.bucket} · saved ${agoLabel(file.savedOn)}`, gap: 6 },
              ...(file.note ? [{ text: file.note }] : []),
              {
                text: 'This row shipped with the app. A file you add yourself previews for real.',
                gap: 14,
              },
            ],
          })
        : null,
    [file, real],
  )

  useEffect(() => {
    // Blob URLs pin their data until revoked either way, so both branches clean
    // up after themselves — without it every preview leaks a document for the
    // life of the tab.
    if (real) {
      const next = URL.createObjectURL(real)
      setUrl(next)
      return () => URL.revokeObjectURL(next)
    }
    if (!pdf) return setUrl(null)
    const next = pdfObjectUrl(pdf)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [pdf, real])

  /**
   * The frame, built once and rendered in whichever box is showing.
   *
   * `key={url}` and nothing else identifying: expanding remounts the iframe and
   * the PDF reloads from the same blob, which costs the reader their scroll
   * position and nothing more.
   */
  const frame = url ? (
    <iframe
      key={url}
      src={url}
      title={`${file.name} preview`}
      className="w-full flex-1 rounded-md border border-hairline bg-well"
    />
  ) : (
    <EmptyState
      icon={FileQuestion}
      title="No preview for this type"
      description={`Browsers render PDFs natively but not ${file.kind} files. Opening it will hand off to your own application once files are stored locally.`}
    />
  )

  return (
    <Panel className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <PanelTitle className="mb-0 truncate font-mono text-sm">{file.name}</PanelTitle>
        <div className="flex shrink-0 items-center gap-1">
          {/* Only offered when there is something to enlarge. On the
              no-preview state the button would open a bigger copy of a
              sentence explaining that there is nothing to see. */}
          {url ? (
            <ExpandButton onClick={() => setFull(true)} label="Open the preview full screen" />
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="size-3.5" strokeWidth={2} aria-hidden />
            Close
          </Button>
        </div>
      </div>

      <div className="flex min-h-[28rem] flex-1 flex-col">{full ? null : frame}</div>

      <FullScreenDialog
        open={full}
        onOpenChange={setFull}
        title={file.name}
        description={`${file.name}, full screen, with a notes panel. Press Escape to go back.`}
      >
        {full ? (
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">{frame}</div>

            {/* A drawer beside the document rather than a panel under it: notes
                on a PDF are written while reading it, and anything below the
                page means scrolling away from the thing being annotated.

                Open by default — a collapsed rail is tidier but nobody finds
                it, and the notes are half the reason this view exists. It
                collapses to that rail when the document needs the width. */}
            {notesOpen ? (
              <aside className="flex w-[22rem] min-w-0 shrink-0 flex-col gap-2 border-l border-hairline pl-3 xl:w-[26rem]">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Notes</h3>
                  <button
                    type="button"
                    onClick={() => setNotesOpen(false)}
                    title="Hide the notes panel"
                    aria-label="Hide the notes panel"
                    aria-expanded
                    className="pressable grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent text-text-3 transition-colors hover:border-hairline hover:bg-well hover:text-text-1"
                  >
                    <PanelRightClose className="size-4" strokeWidth={1.9} aria-hidden />
                  </button>
                </div>

                <p className="text-xs text-text-3">
                  Kept against {file.name}, and shown wherever this file is listed.
                </p>

                <RichTextEditor
                  value={noteHtml}
                  onChange={setNoteHtml}
                  ariaLabel={`Notes on ${file.name}`}
                  placeholder="What matters in this document — the deadline buried on page 3, who to ask about it…"
                  className="min-h-0 flex-1"
                />

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span aria-live="polite" className="text-xs text-text-3">
                    {noteSaved ? 'Saved' : noteDirty ? 'Unsaved changes' : ''}
                  </span>
                  <Button type="button" size="sm" disabled={!noteDirty} onClick={saveNote}>
                    Save note
                  </Button>
                </div>
              </aside>
            ) : (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                title="Show the notes panel"
                aria-label="Show the notes panel"
                aria-expanded={false}
                /* `justify-items-center` rather than `place-items-start`, which
                   set BOTH axes and left the icon pinned to the top-left corner
                   of a 36px rail. Centred across, and held to the top so it
                   lands on the same line as the collapse button it swaps with —
                   a toggle whose control jumps somewhere else is a toggle you
                   have to re-find every time. `pt-1.5` centres the 16px icon
                   against that button's 28px box. */
                className="pressable grid w-9 shrink-0 items-start justify-items-center rounded-md border border-hairline bg-well pt-1.5 text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
              >
                <PanelRightOpen className="size-4" strokeWidth={1.9} aria-hidden />
              </button>
            )}
          </div>
        ) : null}
      </FullScreenDialog>
    </Panel>
  )
}
