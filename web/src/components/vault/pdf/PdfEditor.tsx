import { useRef, useState } from 'react'
import { FileDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { useFileDrop } from '@/components/vault/files/use-file-drop'
import { cn } from '@/lib/utils'
import { PdfMergePanel } from './PdfMergePanel'
import { PdfPagesPanel } from './PdfPagesPanel'
import { PdfAnnotatePanel } from './PdfAnnotatePanel'
import type { PdfDelivery } from './use-dropped-pdfs'

type Mode = 'merge' | 'pages' | 'annotate'

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
  const { t } = useTranslation('vault')
  const [mode, setMode] = useState<Mode>('merge')
  // Built in the render so the labels follow the language on screen.
  const modes = [
    { value: 'merge', label: t('pdf.modes.merge') },
    { value: 'pages', label: t('pdf.modes.pages') },
    { value: 'annotate', label: t('pdf.modes.annotate') },
  ] as const
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
      data-tour="pdf"
      className={cn(
        'relative transition-colors',
        drop.dragging ? 'border-accent bg-accent-soft' : '',
      )}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      <PanelTitle hint={t('pdf.editor.hint')}>{t('pdf.editor.title')}</PanelTitle>
      <div className="mt-3 flex flex-col gap-3">
        <Segment
          options={modes}
          value={mode}
          onChange={setMode}
          label={t('pdf.editor.operation')}
        />
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
            {mode === 'merge' ? t('pdf.editor.dropMerge') : t('pdf.editor.dropOpen')}
          </p>
        </div>
      ) : null}
    </Panel>
  )
}
