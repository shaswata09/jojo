import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { Marked, MarksLegend } from '@/components/common/Marked'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { contentModal } from '@/components/ui/dialog-width'
import { Button } from '@/components/ui/button'
import { stripMarks } from '@jojo/service/core/marks'
import { vaultPath } from '@/lib/links'
import { cn } from '@/lib/utils'

/**
 * A snippet, read where it was found.
 *
 * The same move `FilePreviewDialog` makes for a document, and for the same
 * reason: a tailored CV is a page of prose, and a card that printed it turned
 * the application record into a wall of text with the next card half a screen
 * below. The cards say what each one IS — which document, which model, when —
 * and this is where the words are, over the record, with the record still
 * behind it when it closes.
 *
 * Read-only on purpose. Editing a snippet is the Vault's job, where the editor,
 * its unsaved-changes guard and its keyword picker already live; this offers
 * the two things somebody wants from a preview — the text, and the text on the
 * clipboard — and a way through to that editor.
 */

export type PreviewSnippet = {
  readonly id: string
  readonly title: string
  readonly tag: string
  readonly body: string
  /** 'CV · from Raghunathan-CV.md · gemma_4_31b · today'. Drawn under the title. */
  readonly subtitle: string
  /** Whether the body carries the marks a model wrote. See `core/marks.ts`. */
  readonly marked: boolean
}

export function SnippetPreviewDialog({
  snippet,
  onClose,
}: {
  /** The snippet to show, or `null` for "nothing is being previewed". */
  snippet: PreviewSnippet | null
  onClose: () => void
}) {
  /*
   * The snippet still on screen while the dialog animates out.
   *
   * `open` goes false a beat before Radix unmounts the content — that gap is
   * the closing animation, and it is also when focus is handed back to the
   * Preview button that was pressed. Rendering nothing as soon as `snippet` is
   * null would cut both short. `FilePreviewDialog` keeps its file for the same
   * reason and says so at greater length.
   */
  const last = useRef<PreviewSnippet | null>(null)
  if (snippet !== null) last.current = snippet
  const shown = snippet ?? last.current

  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = async () => {
    if (!shown) return
    try {
      // Marks are for reading, not for pasting: what lands in the document is
      // the text. `stripMarks` is a no-op on a snippet nobody tailored.
      await navigator.clipboard.writeText(shown.marked ? stripMarks(shown.body) : shown.body)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog
      open={snippet !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {shown === null ? null : (
        <DialogContent
          className={cn(
            contentModal,
            'max-h-[min(85vh,52rem)] grid-rows-[auto_minmax(0,1fr)_auto]',
          )}
        >
          <DialogHeader>
            <DialogTitle>{shown.title}</DialogTitle>
            <DialogDescription>{shown.subtitle}</DialogDescription>
          </DialogHeader>

          {/* The one scrolling region. A tailored CV is pages, and the header
              and the footer have to stay put while it moves. */}
          <div className="min-h-0 overflow-auto rounded-lg border border-hairline bg-well p-4">
            {shown.marked ? (
              <Marked body={shown.body} />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-text-2">{shown.body}</p>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            {shown.marked ? <MarksLegend className="sm:mr-auto" /> : <span />}
            <div className="flex items-center gap-2">
              <Link
                to={vaultPath({ tool: 'snippets', focus: shown.id })}
                className="text-xs text-text-2 underline underline-offset-2 hover:text-text-1"
              >
                Open in the Vault
              </Link>
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                <CopyFeedback copied={copied} failed={failed} />
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
