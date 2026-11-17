/**
 * Q270: the details panel's resize handle reads as draggable — a thin vertical
 * capsule centred on the panel edge, holding a 2×4 grid of grip dots.
 *
 * Shape only, in JSX, so D20 leaves a narrow source read. The drag itself is
 * held by `lib/sheet-width.test.ts` (Q269).
 */

import { describe, expect, it } from 'vitest'
import resizer from './SheetResizer.tsx?raw'

/** The class list of the grip: the span that holds the grid of dots. */
const grip =
  /<span\s+aria-hidden\s+className="([^"]*)"\s*>[\s\S]*?<span className="grid grid-cols-2/.exec(
    resizer,
  )?.[1] ?? ''

describe('Q270 — the resize handle is a capsule of grip dots on the edge', () => {
  it('is a vertical capsule, taller than it is wide', () => {
    const classes = grip.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['rounded-full', 'h-9', 'w-3.5']))
  })

  it('is centred on the panel edge, top to bottom and side to side', () => {
    const classes = grip.split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining([
        'absolute',
        'top-1/2',
        'left-1/2',
        '-translate-x-1/2',
        '-translate-y-1/2',
      ]),
    )
  })

  it('holds two columns of four dots', () => {
    expect(resizer).toMatch(
      /<span className="grid grid-cols-2 gap-\[3px\]">\s*\{Array\.from\(\{ length: 8 \}, \(_, dot\) => \(\s*<span\s+key=\{dot\}\s+className="size-\[2px\] rounded-full/,
    )
  })

  it('sits on the edge and resizes along it', () => {
    // The inline end, as the sheet is: the right, or the left in Arabic.
    expect(resizer).toContain('style={{ insetInlineEnd: width }}')
    expect(resizer).toMatch(/'group fixed top-0 bottom-0 z-50 -me-1\.5 w-3 cursor-col-resize/)
  })
})
