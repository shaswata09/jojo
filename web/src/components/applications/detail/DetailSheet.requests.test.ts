/**
 * Owner requests about the application details panel itself:
 * - Q272: there is padding above the title card, so the record does not start
 *   flush against the top of the panel;
 * - Q269: the panel is resized by dragging its edge, clamped between its
 *   default width and a maximum. The clamp is held by `lib/sheet-width.test.ts`;
 *   what is read here is that the panel opens at that minimum, clamps every
 *   width it takes, and mounts the handle.
 *
 * JSX and effect wiring, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import sheet from './DetailSheet.tsx?raw'

/** The class list of the sheet's content: the fixed, full-height panel. */
const panelClasses =
  /'(fixed end-0 top-0 bottom-0 z-40 [^']*)'/.exec(sheet)?.[1]?.split(/\s+/) ?? []

describe('Q272 — padding above the title card', () => {
  it('found the panel', () => {
    expect(panelClasses).toContain('overflow-y-auto')
  })

  it('pads the top of the panel at every width', () => {
    expect(panelClasses).toContain('pt-4')
    expect(panelClasses).toContain('sm:pt-5')
  })
})

describe('Q269 — the panel resizes from its edge, between its default width and a maximum', () => {
  it('opens at the minimum width, which is also what a reset returns to', () => {
    expect(sheet).toContain('const [width, setWidth] = useState(MIN_SHEET_WIDTH)')
    expect(sheet).toContain(
      'const onReset = useCallback(() => onWidth(MIN_SHEET_WIDTH), [onWidth])',
    )
  })

  it('clamps a stored width to what this screen allows', () => {
    expect(sheet).toMatch(/return clampSheetWidth\(wanted, viewport\)/)
  })

  it('takes its width from the handle on its edge', () => {
    expect(sheet).toContain('style={{ width }}')
    expect(sheet).toContain(
      '<SheetResizer width={width} max={max} onWidth={onWidth} onReset={onReset} />',
    )
  })
})
