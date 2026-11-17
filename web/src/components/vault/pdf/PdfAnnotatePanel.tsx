import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Highlighter, MessageSquarePlus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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

type Tool = 'highlight' | 'comment'

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
  const { t } = useTranslation('vault')
  // Built in the render so the labels follow the language on screen.
  const tools = [
    { value: 'highlight', label: t('pdf.annotate.tools.highlight') },
    { value: 'comment', label: t('pdf.annotate.tools.comment') },
  ] as const
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
        title: t('pdf.saved', { name: record.name }),
        description: t('pdf.annotate.savedDescription', {
          summary: summarise(marks),
          bucket,
          name: choice.name,
        }),
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
        label={t('pdf.annotate.chooseLabel')}
      />

      {choice === null || document_ === null ? (
        <p className="text-sm text-text-3">{t('pdf.annotate.empty')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segment
              options={tools}
              value={tool}
              onChange={setTool}
              label={t('pdf.annotate.toolLabel')}
            />

            {tool === 'highlight' ? (
              <div
                className="flex items-center gap-1"
                role="radiogroup"
                aria-label={t('pdf.annotate.colour')}
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

            <div className="ms-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('pdf.annotate.previousPage')}
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="rtl:-scale-x-100" aria-hidden />
              </Button>
              <span className="min-w-20 text-center text-xs text-text-3 tabular-nums">
                {t('pdf.annotate.pageOf', { page: page + 1, total: document_.pageCount })}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('pdf.annotate.nextPage')}
                disabled={page >= document_.pageCount - 1}
                onClick={() => setPage((current) => Math.min(document_.pageCount - 1, current + 1))}
              >
                <ChevronRight className="rtl:-scale-x-100" aria-hidden />
              </Button>
              <select
                className="h-7 cursor-pointer rounded-lg border border-input bg-transparent px-1.5 text-xs text-text-1 outline-none focus-visible:border-ring"
                aria-label={t('pdf.annotate.zoom')}
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
                <Highlighter className="me-1 inline size-3.5" aria-hidden />
                {t('pdf.annotate.highlightHint')}
              </>
            ) : (
              <>
                <MessageSquarePlus className="me-1 inline size-3.5" aria-hidden />
                {t('pdf.annotate.commentHint')}
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
                  <span className="w-14 shrink-0 text-xs text-text-3">
                    {t('pdf.pages.page', { number: mark.page + 1 })}
                  </span>
                  {mark.kind === 'highlight' ? (
                    <span className="min-w-0 flex-1 truncate" title={mark.text}>
                      {excerpt(mark.text)}
                    </span>
                  ) : null}
                  <Input
                    className={cn('h-7 shrink-0', mark.kind === 'note' ? 'min-w-0 flex-1' : 'w-40')}
                    placeholder={
                      mark.kind === 'note'
                        ? t('pdf.annotate.commentPlaceholder')
                        : t('pdf.annotate.notePlaceholder')
                    }
                    value={mark.kind === 'note' ? mark.body : mark.note}
                    aria-label={
                      mark.kind === 'note'
                        ? t('pdf.annotate.commentLabel', { number: mark.page + 1 })
                        : t('pdf.annotate.noteLabel', { excerpt: excerpt(mark.text, 30) })
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
                    aria-label={t('pdf.annotate.removeMark')}
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
                ? t('pdf.annotate.hintEmpty')
                : t('pdf.annotate.hint', { summary: summarise(marks) })
            }
            onSave={() => void save('save')}
            onDownload={() => void save('download')}
            icon={Highlighter}
            saveLabel={t('pdf.annotate.action')}
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
