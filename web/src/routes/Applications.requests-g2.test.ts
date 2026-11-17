/**
 * Owner requests about the Applications page's layout: the board and the table
 * both fill the height left under the toolbar and scroll inside themselves, and
 * the page opens on the board.
 *
 * The heights only exist as classes in the JSX, so D20 leaves a narrow source
 * read for those. The default view is a constant and is read directly.
 */

import { describe, expect, it } from 'vitest'
import { APPLICATIONS_DEFAULTS } from '@/lib/links'
import page from './Applications.tsx?raw'
import filters from '@/components/applications/ApplicationsFilters.tsx?raw'
import table from '@/components/applications/table/ApplicationsTable.tsx?raw'

/** The `<Panel …>` that wraps one view, up to the view component it holds. */
function panelAround(component: string): string {
  const at = page.indexOf(`<${component}`)
  const open = page.lastIndexOf('<Panel', at)
  return at < 0 || open < 0 ? '' : page.slice(open, at)
}

describe('Q040 — the Applications page opens on the board', () => {
  it('defaults the view to the board, not the table', () => {
    expect(APPLICATIONS_DEFAULTS.view).toBe('board')
  })
})

describe('Q039 — the board fills the page height', () => {
  it('caps the board panel at the room left below it and lets it grow into that room', () => {
    const panel = panelAround('ApplicationsBoard')
    expect(panel).not.toBe('')
    expect(panel).toContain('ref={fill.ref}')
    expect(panel).toContain('maxHeight: fill.maxHeight')
    expect(panel).toMatch(/className="[^"]*\bflex-1\b[^"]*"/)
    expect(panel).toMatch(/className="[^"]*\bmin-h-0\b[^"]*"/)
  })

  it('puts the views in a column that takes the rest of the page', () => {
    expect(page).toContain('const fill = useFillViewport()')
    expect(page).toContain('<div className="flex min-h-0 min-w-0 flex-1 flex-col">')
  })
})

describe('Q047 — the table fits the page with its own scroll, filters and search', () => {
  it('caps the table panel at the room left below it, so the table scrolls inside it', () => {
    const panel = panelAround('ApplicationsTable')
    expect(panel).not.toBe('')
    expect(panel).toContain('ref={fill.ref}')
    expect(panel).toContain('maxHeight: fill.maxHeight')
    expect(panel).toMatch(/className="[^"]*\bflex-1\b[^"]*\bflex-col\b[^"]*"/)
    expect(panel).toMatch(/className="[^"]*\bmin-h-0\b[^"]*"/)
  })

  it('scrolls the rows under a header that stays put', () => {
    expect(table).toMatch(/<PanelScroll>/)
    expect(table).toMatch(/<tr className="sticky top-0/)
  })

  it('shows the filters, with a search box and a stage filter for the table', () => {
    expect(page).toContain(
      '<ApplicationsFilters params={params} pool={pool} stageCounts={stageCounts} />',
    )
    expect(filters).toMatch(/id="applications-search"\s+type="search"/)
    // The box holds its own text and writes `?q=` behind it (perf-1: bound
    // straight to the URL it dropped keystrokes on a slow re-render).
    expect(filters).toContain('onChange={(e) => setText(e.target.value)}')
    expect(filters).toMatch(/echo\.sent\(text\)\s*onSearch\(text\)/)
    expect(filters).toContain('const search = useCallback((q: string) => set({ q }), [set])')
    expect(filters).toMatch(/params\.view === 'table' \? \(\s*<BucketFilter/)
  })
})
