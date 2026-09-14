import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, Scissors, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/lib/toast-context'
import { applyPagePlan } from '@/lib/pdf/document'
import {
  movePage,
  planChanged,
  planFor,
  removePage,
  rotatePage,
  type PagePlan,
} from '@/lib/pdf/page-plan'
import { derivedName } from '@/lib/pdf/output-name'
import { openPdf, type OpenPdf } from '@/lib/pdf/render'
import { PdfSourceAdd } from './PdfSourceAdd'
import { PdfSaveBar } from './PdfSaveBar'
import { PdfThumb } from './PdfThumb'
import { usePdfFiles, type PdfChoice } from './use-pdf-files'
import type { FileBucket } from '@/data/vault'

/**
 * Turn, reorder and drop pages, then write the result once.
 *
 * Every button edits a PLAN rather than the document — see `page-plan.ts` for
 * why — so the whole sequence is one save at the end, and Undo is free because
 * nothing has been written yet.
 */
export function PdfPagesPanel() {
  const { available, bytesOf, saveResult, download } = usePdfFiles()
  const { toast } = useToast()
  const [choice, setChoice] = useState<PdfChoice | null>(null)
  const [document_, setDocument] = useState<OpenPdf | null>(null)
  const [plan, setPlan] = useState<PagePlan>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(
    async (picked: PdfChoice) => {
      setError(null)
      setChoice(picked)
      setName('')
      try {
        const opened = await openPdf(await bytesOf(picked))
        setDocument(opened)
        setPlan(planFor(opened.pageCount))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setDocument(null)
        setPlan([])
      }
    },
    [bytesOf],
  )

  // The worker behind an open document is not garbage: it has to be told.
  useEffect(() => () => document_?.close(), [document_])

  const dirty = document_ !== null && planChanged(plan, document_.pageCount)
  const suggested = choice ? derivedName(choice.name, `${plan.length} pages`) : 'pages.pdf'

  async function save(then: 'save' | 'download') {
    if (!choice) return
    setBusy(true)
    setError(null)
    try {
      const out = await applyPagePlan(await bytesOf(choice), plan)
      const bucket: FileBucket = choice.kind === 'vault' ? choice.bucket : 'Admin'
      const record = await saveResult(name.trim() || suggested, out, bucket)
      if (then === 'download') await download(record.id)
      toast({
        title: `${record.name} saved`,
        description: `${plan.length} pages, filed under ${bucket}. ${choice.name} is unchanged.`,
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
        label="Choose a PDF to organise"
      />

      {choice === null || document_ === null ? (
        <p className="text-sm text-text-3">
          Choose one PDF. You can turn pages, drop them, put them in a different order, and keep
          only part of it.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm" title={choice.name}>
              <span className="font-medium">{choice.name}</span>
              <span className="ml-1.5 text-text-3">
                · {plan.length} of {document_.pageCount} pages kept
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty}
              onClick={() => setPlan(planFor(document_.pageCount))}
            >
              <Undo2 aria-hidden /> Start over
            </Button>
          </div>

          <ol className="flex flex-wrap gap-3">
            {plan.map((page, at) => (
              <li
                key={`${page.source}:${at}`}
                className="flex w-[150px] flex-col gap-1.5 rounded-lg border border-hairline bg-well p-2"
              >
                <PdfThumb
                  document_={document_}
                  page={page.source}
                  rotation={page.rotation}
                  label={`Page ${page.source + 1}`}
                />
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs text-text-3">
                    {at + 1}
                    <span className="text-text-3/70"> · was {page.source + 1}</span>
                  </span>
                  <span className="text-xs tabular-nums text-text-3">
                    {page.rotation === 0 ? '' : `${page.rotation}°`}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-0.5">
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label={`Move page ${at + 1} earlier`}
                    disabled={at === 0}
                    onClick={() => setPlan((current) => movePage(current, at, at - 1))}
                  >
                    <ArrowLeft aria-hidden />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label={`Turn page ${at + 1} anticlockwise`}
                    onClick={() => setPlan((current) => rotatePage(current, at, -90))}
                  >
                    <RotateCcw aria-hidden />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label={`Turn page ${at + 1} clockwise`}
                    onClick={() => setPlan((current) => rotatePage(current, at, 90))}
                  >
                    <RotateCw aria-hidden />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label={`Remove page ${at + 1}`}
                    // A document has to keep something. Without this the last
                    // delete produces a file no reader will open.
                    disabled={plan.length === 1}
                    onClick={() => setPlan((current) => removePage(current, at))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label={`Move page ${at + 1} later`}
                    disabled={at === plan.length - 1}
                    onClick={() => setPlan((current) => movePage(current, at, at + 1))}
                  >
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          <PdfSaveBar
            name={name}
            suggested={suggested}
            onName={setName}
            busy={busy}
            error={error}
            disabled={!dirty}
            hint={dirty ? undefined : 'Turn, move or remove a page and this becomes available.'}
            onSave={() => void save('save')}
            onDownload={() => void save('download')}
            icon={Scissors}
            verb="Save pages"
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
