/**
 * Q049: a card being dragged between stages renders above every column and is
 * never hidden behind one.
 *
 * The fix is structural: the card in transit is drawn in dnd-kit's
 * `DragOverlay`, outside the columns' scrolling lists, and the card left in its
 * column no longer carries the drag transform (a child of an `overflow-y-auto`
 * list is clipped by it whatever its z-index). D20 leaves a source read.
 */

import { describe, expect, it } from 'vitest'
import board from './ApplicationsBoard.tsx?raw'
import card from './BoardCard.tsx?raw'

describe('Q049 — a dragged card stays above every column', () => {
  it('draws the carried card in a DragOverlay', () => {
    const overlay = /<DragOverlay\b[\s\S]*?<\/DragOverlay>/.exec(board)?.[0] ?? ''
    expect(overlay).toContain('<BoardCardBody')
    expect(overlay).toContain('app={activeCard}')
  })

  it('renders the overlay outside the scrolling columns', () => {
    const columnsEnd = board.indexOf('</PanelScroll>')
    const overlayAt = board.indexOf('<DragOverlay')
    expect(columnsEnd).toBeGreaterThan(0)
    expect(overlayAt).toBeGreaterThan(columnsEnd)
  })

  it('does not move the card left in its column with the pointer', () => {
    const draggable = /const \{([^}]*)\} = useDraggable\(/.exec(card)?.[1] ?? ''
    expect(draggable).toContain('isDragging')
    expect(draggable).not.toMatch(/\btransform\b/)
  })
})
