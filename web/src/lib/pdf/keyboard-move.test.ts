import { describe, expect, it } from 'vitest'
import { rowStep, type RowBox } from './keyboard-move'

const rows: RowBox[] = [
  { id: 'a', top: 100 },
  { id: 'b', top: 150 },
  { id: 'c', top: 200 },
]

describe('stepping a picked-up row by the keyboard', () => {
  it('moves exactly one row down', () => {
    expect(rowStep(rows, 'a', 1)).toBe(50)
    expect(rowStep(rows, 'b', 1)).toBe(50)
  })

  it('moves exactly one row up', () => {
    expect(rowStep(rows, 'c', -1)).toBe(-50)
    expect(rowStep(rows, 'b', -1)).toBe(-50)
  })

  it('stops at the ends rather than moving nowhere', () => {
    /*
     * Null, not 0. A zero-distance move is still a move to dnd-kit: it re-runs
     * collision detection and announces the same row again, so a screen reader
     * says the row moved when it did not.
     */
    expect(rowStep(rows, 'a', -1)).toBeNull()
    expect(rowStep(rows, 'c', 1)).toBeNull()
  })

  it('spans an uneven gap, because rows are not all one height', () => {
    // A row wraps to two lines at a narrow width, and its neighbours do not.
    const uneven: RowBox[] = [
      { id: 'a', top: 0 },
      { id: 'b', top: 90 },
      { id: 'c', top: 140 },
    ]
    expect(rowStep(uneven, 'a', 1)).toBe(90)
    expect(rowStep(uneven, 'b', 1)).toBe(50)
  })

  it('sorts by position rather than trusting the order it was handed', () => {
    // `droppableRects` is a Map in REGISTRATION order, which stops matching
    // the screen as soon as a row is removed and another added.
    const shuffled: RowBox[] = [
      { id: 'c', top: 200 },
      { id: 'a', top: 100 },
      { id: 'b', top: 150 },
    ]
    expect(rowStep(shuffled, 'a', 1)).toBe(50)
    expect(rowStep(shuffled, 'c', 1)).toBeNull()
  })

  it('does nothing for a row that is no longer in the list', () => {
    expect(rowStep(rows, 'gone', 1)).toBeNull()
  })

  it('does nothing when there is only one row', () => {
    expect(rowStep([{ id: 'only', top: 0 }], 'only', 1)).toBeNull()
    expect(rowStep([], 'any', 1)).toBeNull()
  })
})
