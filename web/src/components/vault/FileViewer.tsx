import { useEffect, useMemo, useState } from 'react'
import { FileQuestion, FileWarning, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { ExpandButton, FullScreenDialog } from '@/components/common/FullScreen'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Button } from '@/components/ui/button'
import { agoLabel } from '@/data/timeline'
import type { VaultFile } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { pdfObjectUrl, placeholderPdf } from '@/lib/placeholder-pdf'
import { htmlFromText, textFromHtml } from '@/lib/rich-text'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { useUndoable } from '@/lib/undo'

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
  /** Set when the browser refused to mint a blob URL. See the effect below. */
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const [noteSaved, setNoteSaved] = useState(false)
  const { updateFile } = useVault()
  const { toast } = useToast()
  const undoable = useUndoable()

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

  /**
   * Saving a note clears the editor's dirty state, so the text that was
   * replaced is gone from the screen as well as from the record — which is
   * exactly the write that has to be reversible. It had no Undo; it has one
   * now, off the journal's before-image rather than a copy captured here.
   */
  const saveNote = () => {
    const { restore } = undoable(() => updateFile(file.id, { note: noteText || undefined }))
    setNoteSaved(true)
    toast({
      title: `Note saved on ${file.name}`,
      description: noteText
        ? 'It shows against this file wherever the vault lists it.'
        : 'The note is now empty, so nothing shows against this file.',
      action: restore ? { label: 'Undo', onClick: restore } : undefined,
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
              {
                text: `${file.size} · ${file.bucket} · saved ${agoLabel(file.savedOn, TODAY)}`,
                gap: 6,
              },
              ...(file.note ? [{ text: file.note }] : []),
              /*
               * This used to read "This row shipped with the app. A file you
               * add yourself previews for real." — and it was printed over
               * documents the user had dropped themselves.
               *
               * D27 is why. The vault keeps a file's name and size and never
               * its bytes, so the `File` behind a real preview lives in React
               * state and goes at the next reload while the row it created
               * survives. After that reload a seeded row and the user's own
               * file are indistinguishable here: both arrive with no blob. The
               * old sentence guessed, guessed wrong for the user's file, and
               * told them their own document was a fixture.
               *
               * So it no longer guesses. What is said instead is true of both:
               * jojo never held the contents, which is the actual reason there
               * is nothing to render, and it is worth the user knowing anyway.
               */
              {
                text: 'jojo keeps a file\u2019s name, size and notes — never its contents — so there is no document stored here to show. A file added in this session previews for real until the page reloads.',
                gap: 14,
              },
            ],
          })
        : null,
    [file, real],
  )

  useEffect(() => {
    /*
     * Every `createObjectURL` here is inside a `try`, and that is not belt and
     * braces — it is a blast-radius fix. This runs in an effect, so a throw is
     * not caught by the click that opened the preview; it goes to the nearest
     * error boundary, and the nearest one is the app root (`main.tsx`). A
     * browser that refuses blob URLs therefore replaced the sidebar, the topbar
     * and the route with "Something broke" because somebody pressed Preview on
     * a file. A preview pane may fail as a preview pane; it may not take the
     * application down.
     */
    setPreviewError(null)

    // Blob URLs pin their data until revoked either way, so both branches clean
    // up after themselves — without it every preview leaks a document for the
    // life of the tab.
    if (real) {
      let next: string
      try {
        next = URL.createObjectURL(real)
      } catch (error) {
        setUrl(null)
        setPreviewError(error instanceof Error ? error.message : String(error))
        return
      }
      setUrl(next)
      return () => URL.revokeObjectURL(next)
    }
    if (!pdf) return setUrl(null)
    let next: string
    try {
      next = pdfObjectUrl(pdf)
    } catch (error) {
      setUrl(null)
      setPreviewError(error instanceof Error ? error.message : String(error))
      return
    }
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
  ) : previewError ? (
    <EmptyState
      icon={FileWarning}
      title="This browser would not open the preview"
      // Names the record as untouched, because the failure is in the viewer and
      // a user watching a preview fail has no way to know the row is fine.
      description={`${previewError}. The file's record in your vault is unaffected — only the preview could not be built.`}
    />
  ) : (
    <EmptyState
      icon={FileQuestion}
      title="No preview for this type"
      /*
       * This used to end "Opening it will hand off to your own application once
       * files are stored locally" — a promise of work that is not coming. D27
       * keeps a file's name, size and notes and never its bytes, so there is no
       * stored document to hand anywhere, and the placeholder page a few lines
       * above says exactly that. Two states of the same viewer describing the
       * same file in opposite terms, and the one that read as a roadmap was the
       * wrong one.
       *
       * Says nothing about THIS row's bytes, deliberately, for the reason the
       * placeholder's own comment gives: a .docx dropped in this session is here
       * too, held in state and unframed on purpose, and a sentence guessing
       * which of the two the reader is looking at gets it wrong for one of them.
       */
      description={`Browsers render PDFs natively but not ${file.kind} files \u2014 and jojo keeps a file\u2019s name, size and notes rather than its contents, so there is no stored document to open.`}
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
