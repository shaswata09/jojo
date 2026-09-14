import { useState } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { PdfMergePanel } from './PdfMergePanel'
import { PdfPagesPanel } from './PdfPagesPanel'
import { PdfAnnotatePanel } from './PdfAnnotatePanel'

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

  return (
    <Panel>
      <PanelTitle hint="Merge, reorganise and mark up PDFs. Everything runs in this browser — no document is uploaded.">
        PDF editor
      </PanelTitle>
      <div className="mt-3 flex flex-col gap-3">
        <Segment options={MODES} value={mode} onChange={setMode} label="PDF operation" />
        {mode === 'merge' ? <PdfMergePanel /> : null}
        {mode === 'pages' ? <PdfPagesPanel /> : null}
        {mode === 'annotate' ? <PdfAnnotatePanel /> : null}
      </div>
    </Panel>
  )
}
