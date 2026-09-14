import { Suspense, lazy, useState } from 'react'
import { Calculator } from '@/components/vault/Calculator'
import { Segment } from '@/components/common/Segment'
import { Panel } from '@/components/common/Panel'

/**
 * The Tools tab: the instruments, as opposed to the tabs that hold records.
 *
 * A picker rather than both stacked. The calculator is a small pad and the PDF
 * editor is a full-width workspace with a page preview in it; one above the
 * other, whichever is on top is a strip of clutter over the one actually being
 * used. The calculator stays the default so the tab opens on what it has
 * always opened on.
 */

/**
 * Loaded on demand, and this is the whole reason the tab has a picker at all.
 *
 * The editor pulls in pdf.js and pdf-lib — around a megabyte, most of it the
 * renderer. Imported normally that lands in the main bundle and is paid for on
 * first load by everybody, including the majority who never open this tab. A
 * dynamic import moves it into its own chunk, fetched when somebody actually
 * asks for it.
 */
const PdfEditor = lazy(() =>
  import('@/components/vault/pdf/PdfEditor').then((module) => ({ default: module.PdfEditor })),
)

const INSTRUMENTS = [
  { value: 'calculator', label: 'Calculator' },
  { value: 'pdf', label: 'PDF editor' },
] as const
type Instrument = (typeof INSTRUMENTS)[number]['value']

export function InstrumentsTool() {
  const [instrument, setInstrument] = useState<Instrument>('calculator')

  return (
    <div className="flex flex-col gap-3">
      <Segment
        options={INSTRUMENTS}
        value={instrument}
        onChange={setInstrument}
        label="Which tool"
        className="self-start"
      />
      {instrument === 'calculator' ? (
        <Calculator />
      ) : (
        <Suspense
          fallback={
            <Panel>
              <p className="text-sm text-text-3" aria-live="polite">
                Getting the PDF tools ready…
              </p>
            </Panel>
          }
        >
          <PdfEditor />
        </Suspense>
      )}
    </div>
  )
}
