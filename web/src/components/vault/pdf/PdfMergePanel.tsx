import { useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { Combine } from 'lucide-react'
import { useToast } from '@/lib/toast-context'
import { mergePdfs, pageCount } from '@/lib/pdf/document'
import { moveItem } from '@/lib/pdf/page-plan'
import { rowStep } from '@/lib/pdf/keyboard-move'
import { mergedName } from '@/lib/pdf/output-name'
import { parsePageRange } from '@/lib/pdf/page-range'
import { PdfSourceAdd } from './PdfSourceAdd'
import { PdfSaveBar } from './PdfSaveBar'
import { PdfMergeRow, PdfMergeRowGhost, type MergeRow } from './PdfMergeRow'
import { asChoice, usePdfFiles, type PdfChoice } from './use-pdf-files'
import { useDroppedPdfs, type PdfDelivery } from './use-dropped-pdfs'
import type { FileBucket } from '@/data/vault'

/**
 * One arrow press, one position.
 *
 * dnd-kit's default keyboard handling moves the dragged row a flat 25px, and
 * these rows are 50 tall: reordering by keyboard took four presses to travel
 * one place, announcing nothing along the way. Measured in Chrome 151 before
 * this existed. The arithmetic is `rowStep`, which is tested; this is the part
 * that has to read dnd-kit's live measurements, which a test cannot hold.
 */
const byRow: KeyboardCoordinateGetter = (event, { active, currentCoordinates, context }) => {
  const direction = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0
  if (direction === 0) return undefined
  event.preventDefault()
  const rows = [...context.droppableRects.entries()].map(([id, rect]) => ({
    id: String(id),
    top: rect.top,
  }))
  // Where the row IS, which after the first press is not where it started:
  // `over` is the row currently under it, and only falls back to the dragged
  // row's own id while it has not yet left home.
  const from = String(context.over?.id ?? active)
  const step = rowStep(rows, from, direction)
  if (step === null) return undefined
  return { x: currentCoordinates.x, y: currentCoordinates.y + step }
}

/**
 * Joins several PDFs into one, in an order the person sets.
 *
 * The page-range box per source is what makes this more than a concatenation:
 * the common job is not "all of A then all of B", it is "the covering letter,
 * then pages 1-2 of the CV, then the references page". Blank means the whole
 * document, so the simple case needs nothing typed.
 */
export function PdfMergePanel({ dropped }: { dropped?: PdfDelivery | null }) {
  const { available, bytesOf, saveResult, download } = usePdfFiles()
  const { toast } = useToast()
  const [rows, setRows] = useState<readonly MergeRow[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggested = mergedName(rows.map((row) => row.choice.name))
  const edit = (key: string, patch: Partial<MergeRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const add = useCallback((choices: readonly PdfChoice[]) => {
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
  }, [])

  /** The row in the pointer's hand, drawn in the overlay. */
  const [dragging, setDragging] = useState<string | null>(null)

  const sensors = useSensors(
    // The board's activation distance, for the board's reason: without it a
    // click on the grip is read as a drag of zero length.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // What replaces the up/down buttons this row used to carry. Space or Enter
    // on the grip picks the row up, the arrows move it, Space drops it.
    useSensor(KeyboardSensor, { coordinateGetter: byRow }),
  )

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    const over = event.over
    if (!over) return
    setRows((current) => {
      const from = current.findIndex((row) => row.key === String(event.active.id))
      const to = current.findIndex((row) => row.key === String(over.id))
      // The same clamped move the page organiser uses, so a list and a page
      // cannot disagree about what reordering means.
      return from < 0 || to < 0 ? current : moveItem(current, from, to)
    })
  }

  // Merging is the one panel with no ceiling: joining eight documents is the
  // job, not an edge case.
  useDroppedPdfs(
    dropped,
    Number.POSITIVE_INFINITY,
    useCallback((files: readonly File[]) => add(files.map(asChoice)), [add]),
  )

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
          Add two or more PDFs, or drop them onto this card. They are joined top to bottom — drag a
          row by its left edge to change the order — and the originals are left as they are.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event: DragStartEvent) => setDragging(String(event.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <ol className="flex flex-col gap-2">
            {rows.map((row, at) => (
              <PdfMergeRow
                key={row.key}
                row={row}
                position={at + 1}
                total={rows.length}
                onRange={(range) => edit(row.key, { range })}
                onRemove={() =>
                  setRows((current) => current.filter((item) => item.key !== row.key))
                }
              />
            ))}
          </ol>
          {/* Outside the list, so nothing clips it as it travels. */}
          {/* Looked up rather than asserted: a row can leave the list while it
              is in the air — the drop handler removes one — and the overlay
              would then be indexing an array that no longer has a first row. */}
          <DragOverlay dropAnimation={null}>
            {(() => {
              const at = rows.findIndex((row) => row.key === dragging)
              const held = rows[at]
              return held ? <PdfMergeRowGhost row={held} position={at + 1} /> : null
            })()}
          </DragOverlay>
        </DndContext>
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
