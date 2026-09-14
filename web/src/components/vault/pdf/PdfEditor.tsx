import { useRef, useState } from 'react'
import { FileDown } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { useFileDrop } from '@/components/vault/files/use-file-drop'
import { cn } from '@/lib/utils'
import { PdfMergePanel } from './PdfMergePanel'
import { PdfPagesPanel } from './PdfPagesPanel'
import { PdfAnnotatePanel } from './PdfAnnotatePanel'
import type { PdfDelivery } from './use-dropped-pdfs'

const MODES = [
  { value: 'merge', label: 'Merge' },
  { value: 'pages', label: 'Pages' },
  { value: 'annotate', label: 'Annotate' },
] as const
type Mode = (typeof MODES)[number]['value']

/**
 * Basic PDF work, done in the browser.
 *
 * Three operations rather than one screen that does everything, because they
 * want different shapes: merging is a list, organising is a grid of pages, and
 * marking up is one page at a time and as large as it will go. A single canvas
 * with a mode switch would make two of the three cramped.
 *
 * ## Where the work happens
 *
 * Here, in the tab. `pdf-lib` writes the bytes and `pdf.js` draws them, both in
 * this browser; nothing is sent anywhere. That matters more than it usually
 * would: the documents this is for are CVs, contracts and references, and every
 * free "merge your PDF" site on the web is one that asks you to upload them.
 *
 * The operations themselves are in `@/lib/pdf`, which is where the tests are.
 * These components choose and wire; they do not compute.
 */
export function PdfEditor() {
  const [mode, setMode] = useState<Mode>('merge')
  const [delivery, setDelivery] = useState<PdfDelivery | null>(null)
  const deliveries = useRef(0)

  /*
   * The whole card is the drop target, not the row of buttons inside it.
   *
   * That is the shape of the gesture: somebody dragging a file at a panel aims
   * at the panel. A strip would also move under the pointer whenever the mode
   * changed, which is the one moment a drop is most likely.
   *
   * `useFileDrop` is the Files tool's, unchanged — it counts dragenter against
   * dragleave so the highlight does not flicker across every child, and it
   * swallows drops that miss, which otherwise navigate the tab to the file and
   * take an unsaved session with them.
   */
  const drop = useFileDrop((list) => {
    deliveries.current += 1
    setDelivery({ id: deliveries.current, files: [...list] })
  })

  return (
    <Panel
      className={cn(
        'relative transition-colors',
        drop.dragging ? 'border-accent bg-accent-soft' : '',
      )}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      <PanelTitle hint="Merge, reorganise and mark up PDFs. Everything runs in this browser — no document is uploaded.">
        PDF editor
      </PanelTitle>
      <div className="mt-3 flex flex-col gap-3">
        <Segment options={MODES} value={mode} onChange={setMode} label="PDF operation" />
        {mode === 'merge' ? <PdfMergePanel dropped={delivery} /> : null}
        {mode === 'pages' ? <PdfPagesPanel dropped={delivery} /> : null}
        {mode === 'annotate' ? <PdfAnnotatePanel dropped={delivery} /> : null}
      </div>

      {drop.dragging ? (
        // `pointer-events-none`, so the overlay cannot become the drop target
        // and leave the card's own handler never hearing about the release.
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-panel/85">
          <p className="flex items-center gap-2 text-sm font-medium text-text-1">
            <FileDown className="size-4" aria-hidden />
            {mode === 'merge' ? 'Drop PDFs to add them to the merge' : 'Drop a PDF to open it'}
          </p>
        </div>
      ) : null}
    </Panel>
  )
}
