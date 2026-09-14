import { useState } from 'react'
import { ArrowDown, ArrowUp, Combine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/lib/toast-context'
import { mergePdfs, pageCount } from '@/lib/pdf/document'
import { moveItem } from '@/lib/pdf/page-plan'
import { mergedName } from '@/lib/pdf/output-name'
import { parsePageRange } from '@/lib/pdf/page-range'
import { PdfSourceAdd } from './PdfSourceAdd'
import { PdfSaveBar } from './PdfSaveBar'
import { usePdfFiles, type PdfChoice } from './use-pdf-files'
import type { FileBucket } from '@/data/vault'

/** One document in the merge, and which of its pages to take. */
type Row = { readonly key: string; readonly choice: PdfChoice; readonly range: string }

/**
 * Joins several PDFs into one, in an order the person sets.
 *
 * The page-range box per source is what makes this more than a concatenation:
 * the common job is not "all of A then all of B", it is "the covering letter,
 * then pages 1-2 of the CV, then the references page". Blank means the whole
 * document, so the simple case needs nothing typed.
 */
export function PdfMergePanel() {
  const { available, bytesOf, saveResult, download } = usePdfFiles()
  const { toast } = useToast()
  const [rows, setRows] = useState<readonly Row[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggested = mergedName(rows.map((row) => row.choice.name))
  const edit = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const add = (choices: readonly PdfChoice[]) => {
    setError(null)
    setRows((current) => [
      ...current,
      // Keyed by position as well as id: the same document may legitimately
      // appear twice in a merge — a cover sheet front and back — and a key that
      // was only the id would collapse the two rows into one.
      ...choices.map((choice, at) => ({
        key: `${choice.id}:${current.length + at}`,
        choice,
        range: '',
      })),
    ])
  }

  async function merge(then: 'save' | 'download') {
    setBusy(true)
    setError(null)
    try {
      const sources = []
      for (const row of rows) {
        const bytes = await bytesOf(row.choice)
        // Parsed here rather than as it is typed: the page count is not known
        // until the bytes are read, and a range cannot be checked without it.
        const total = await pageCount(bytes)
        const range = parsePageRange(row.range, total)
        if (!range.ok) throw new Error(`${row.choice.name}: ${range.reason}`)
        sources.push({ name: row.choice.name, bytes, pages: range.pages })
      }
      const merged = await mergePdfs(sources)
      const first = rows[0]?.choice
      const bucket: FileBucket = first?.kind === 'vault' ? first.bucket : 'Admin'
      const record = await saveResult(name.trim() || suggested, merged, bucket)
      if (then === 'download') await download(record.id)
      toast({
        title: `${record.name} saved`,
        description: `${sources.reduce((n, source) => n + source.pages.length, 0)} pages from ${sources.length} documents, filed under ${bucket}. The originals are untouched.`,
      })
      setRows([])
      setName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <PdfSourceAdd available={available} onAdd={add} label="Add a PDF to merge" multiple />

      {rows.length === 0 ? (
        <p className="text-sm text-text-3">
          Add two or more PDFs. They are joined top to bottom, and the originals are left as they
          are.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, at) => (
            <li
              key={row.key}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-hairline bg-well px-2 py-2"
            >
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-text-3">
                {at + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" title={row.choice.name}>
                {row.choice.name}
                {row.choice.kind === 'device' ? (
                  <span className="ml-1.5 text-xs text-text-3">· from this device</span>
                ) : null}
              </span>
              <Input
                className="h-8 w-32 shrink-0"
                value={row.range}
                placeholder="All pages"
                aria-label={`Pages to take from ${row.choice.name}`}
                onChange={(event) => edit(row.key, { range: event.target.value })}
              />
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Move ${row.choice.name} earlier`}
                  disabled={at === 0}
                  onClick={() => setRows((current) => moveItem(current, at, at - 1))}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Move ${row.choice.name} later`}
                  disabled={at === rows.length - 1}
                  onClick={() => setRows((current) => moveItem(current, at, at + 1))}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Take ${row.choice.name} out of the merge`}
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <PdfSaveBar
        name={name}
        suggested={suggested}
        onName={setName}
        busy={busy}
        error={error}
        disabled={rows.length < 1}
        hint="Ranges like 1-3, 7, 9- take part of a document. Leave a box empty for all of it."
        onSave={() => void merge('save')}
        onDownload={() => void merge('download')}
        icon={Combine}
        verb="Merge"
      />
    </div>
  )
}
