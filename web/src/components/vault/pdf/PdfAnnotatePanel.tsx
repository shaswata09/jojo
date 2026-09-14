import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Highlighter, MessageSquarePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segment } from '@/components/common/Segment'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { writeAnnotations } from '@/lib/pdf/document'
import {
  HIGHLIGHT_COLOURS,
  colourById,
  excerpt,
  summarise,
  without,
  type Annotation,
} from '@/lib/pdf/annotations'
import { derivedName } from '@/lib/pdf/output-name'
import { openPdf, type OpenPdf } from '@/lib/pdf/render'
import { PdfSourceAdd } from './PdfSourceAdd'
import { useDroppedPdfs, type PdfDelivery } from './use-dropped-pdfs'
import { PdfSaveBar } from './PdfSaveBar'
import { PdfPageView } from './PdfPageView'
import { asChoice, usePdfFiles, type PdfChoice } from './use-pdf-files'
import type { Quad } from '@/lib/pdf/geometry'
import type { FileBucket } from '@/data/vault'

const TOOLS = [
  { value: 'highlight', label: 'Highlight' },
  { value: 'comment', label: 'Comment' },
] as const
type Tool = (typeof TOOLS)[number]['value']

const ZOOMS = [0.75, 1, 1.25, 1.5, 2]

/**
 * Marking a document up: highlights over text, comments pinned to a spot.
 *
 * Both are written as real PDF annotations when saved, so what comes out opens
 * in Preview, Acrobat or Chrome with the marks intact and removable. Nothing is
 * written until Save — until then a mark lives only in this component, which is
 * what makes removing one a matter of forgetting it.
 */
export function PdfAnnotatePanel({ dropped }: { dropped?: PdfDelivery | null }) {
  const { available, bytesOf, saveResult, download } = usePdfFiles()
  const { toast } = useToast()
  const [choice, setChoice] = useState<PdfChoice | null>(null)
  const [document_, setDocument] = useState<OpenPdf | null>(null)
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('highlight')
  const [colour, setColour] = useState(HIGHLIGHT_COLOURS[0]?.id ?? 'yellow')
  const [marks, setMarks] = useState<readonly Annotation[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The mark whose text box should take the caret — the one just placed. */
  const [typing, setTyping] = useState<string | null>(null)

  const open = useCallback(
    async (picked: PdfChoice) => {
      setError(null)
      setChoice(picked)
      setMarks([])
      setPage(0)
      setName('')
      try {
        setDocument(await openPdf(await bytesOf(picked)))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setDocument(null)
      }
    },
    [bytesOf],
  )

  useEffect(() => () => document_?.close(), [document_])

  // One at a time: this panel works on a single document, and `useDroppedPdfs`
  // says so out loud rather than silently taking the first of five.
  useDroppedPdfs(
    dropped,
    1,
    useCallback(
      (files: readonly File[]) => {
        const first = files[0]
        if (first) void open(asChoice(first))
      },
      [open],
    ),
  )

  const addHighlight = useCallback(
    (quads: Quad[], text: string) => {
      setMarks((current) => [
        ...current,
        {
          id: `h${Date.now()}${current.length}`,
          kind: 'highlight',
          page,
          quads,
          colourId: colour,
          text,
          note: '',
        },
      ])
    },
    [colour, page],
  )

  const addNote = useCallback(
    (at: { x: number; y: number }) => {
      /*
       * The pin goes down empty and the caret moves to its row below.
       *
       * `prompt()` would be shorter and is what the first version did, but it
       * is blocked outright in a sandboxed frame — the note would simply never
       * appear — and it cannot be styled, tabbed through or dismissed the way
       * the rest of this panel can.
       */
      const id = `n${Date.now()}${marks.length}`
      setMarks((current) => [...current, { id, kind: 'note', page, at, body: '' }])
      setTyping(id)
    },
    [marks.length, page],
  )

  const suggested = choice ? derivedName(choice.name, 'annotated') : 'annotated.pdf'

  async function save(then: 'save' | 'download') {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      const out = await writeAnnotations(await bytesOf(choice), marks, {
        author: 'jojo',
        at: new Date(),
      })
      const bucket: FileBucket = choice.kind === 'vault' ? choice.bucket : 'Admin'
      const record = await saveResult(name.trim() || suggested, out, bucket)
      if (then === 'download') await download(record.id)
      toast({
        title: `${record.name} saved`,
        description: `${summarise(marks)}, filed under ${bucket}. ${choice.name} is unchanged.`,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <PdfSourceAdd
        available={available}
        onAdd={(choices) => {
          const first = choices[0]
          if (first) void open(first)
        }}
        label="Choose a PDF to mark up"
      />

      {choice === null || document_ === null ? (
        <p className="text-sm text-text-3">
          Choose one PDF. Select text on the page to highlight it, or switch to Comment and click
          where the note belongs.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segment options={TOOLS} value={tool} onChange={setTool} label="Marking tool" />

            {tool === 'highlight' ? (
              <div
                className="flex items-center gap-1"
                role="radiogroup"
                aria-label="Highlight colour"
              >
                {HIGHLIGHT_COLOURS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={colour === option.id}
                    aria-label={option.label}
                    title={option.label}
                    onClick={() => setColour(option.id)}
                    className={cn(
                      'size-6 cursor-pointer rounded-full border-2 transition-transform',
                      colour === option.id
                        ? 'scale-110 border-accent'
                        : 'border-hairline hover:scale-105',
                    )}
                    style={{ backgroundColor: option.hex }}
                  />
                ))}
              </div>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span className="min-w-20 text-center text-xs text-text-3 tabular-nums">
                Page {page + 1} of {document_.pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={page >= document_.pageCount - 1}
                onClick={() => setPage((current) => Math.min(document_.pageCount - 1, current + 1))}
              >
                <ChevronRight aria-hidden />
              </Button>
              <select
                className="h-7 cursor-pointer rounded-lg border border-input bg-transparent px-1.5 text-xs text-text-1 outline-none focus-visible:border-ring"
                aria-label="Zoom"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {ZOOMS.map((value) => (
                  <option key={value} value={value}>
                    {Math.round(value * 100)}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-text-3">
            {tool === 'highlight' ? (
              <>
                <Highlighter className="mr-1 inline size-3.5" aria-hidden />
                Select words on the page — across lines is fine — and they are marked when you let
                go.
              </>
            ) : (
              <>
                <MessageSquarePlus className="mr-1 inline size-3.5" aria-hidden />
                Click the page where the comment belongs.
              </>
            )}
          </p>

          <PdfPageView
            document_={document_}
            page={page}
            scale={zoom}
            annotations={marks}
            tool={tool}
            onHighlight={addHighlight}
            onNote={addNote}
          />

          {marks.length === 0 ? null : (
            <ul className="flex flex-col gap-1.5">
              {marks.map((mark) => (
                <li
                  key={mark.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-hairline bg-well px-2 py-1.5 text-sm"
                >
                  {mark.kind === 'highlight' ? (
                    <span
                      className="size-3 shrink-0 rounded-full border border-hairline"
                      style={{ backgroundColor: colourById(mark.colourId).hex }}
                      aria-hidden
                    />
                  ) : (
                    <MessageSquarePlus className="size-3.5 shrink-0 text-text-3" aria-hidden />
                  )}
                  <span className="w-14 shrink-0 text-xs text-text-3">Page {mark.page + 1}</span>
                  {mark.kind === 'highlight' ? (
                    <span className="min-w-0 flex-1 truncate" title={mark.text}>
                      {excerpt(mark.text)}
                    </span>
                  ) : null}
                  <Input
                    className={cn('h-7 shrink-0', mark.kind === 'note' ? 'min-w-0 flex-1' : 'w-40')}
                    placeholder={
                      mark.kind === 'note' ? 'What is the comment?' : 'Add a note to this…'
                    }
                    value={mark.kind === 'note' ? mark.body : mark.note}
                    aria-label={
                      mark.kind === 'note'
                        ? `Comment on page ${mark.page + 1}`
                        : `Note on the highlight of ${excerpt(mark.text, 30)}`
                    }
                    ref={(element) => {
                      // Focus once, when the pin has just been placed: a plain
                      // `autoFocus` would not fire, since the row is only ever
                      // re-rendered rather than remounted.
                      if (element && typing === mark.id) {
                        element.focus()
                        setTyping(null)
                      }
                    }}
                    onChange={(event) =>
                      setMarks((current) =>
                        current.map((item) =>
                          item.id !== mark.id
                            ? item
                            : item.kind === 'note'
                              ? { ...item, body: event.target.value }
                              : { ...item, note: event.target.value },
                        ),
                      )
                    }
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Remove this mark"
                    onClick={() => setMarks((current) => without(current, mark.id))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <PdfSaveBar
            name={name}
            suggested={suggested}
            onName={setName}
            busy={busy}
            error={error}
            disabled={marks.length === 0}
            hint={
              marks.length === 0
                ? 'Highlight some text or add a comment first.'
                : `${summarise(marks)} will be written in.`
            }
            onSave={() => void save('save')}
            onDownload={() => void save('download')}
            icon={Highlighter}
            verb="Save marked up"
          />
        </>
      )}
      {choice === null && error !== null ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
