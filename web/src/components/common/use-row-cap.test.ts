/**
 * The web's row cap, RUN rather than read (finding coverage-12).
 *
 * Its only test used to match one line of `use-row-cap.ts` as text, so an
 * off-by-one that hid the arrival row, or a Show more that restarted from 100,
 * would have passed. These are the phone's cases (mobile
 * `row-cap.requests.test.ts`) against the web's copy: the arithmetic is called,
 * and `useRowCap` runs across renders through a few lines standing in for
 * React's `useState` — this runner mounts nothing (environment: node).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A one-component stand-in for React's state: slots by call order, and a
 * render that re-runs while a set-state happened during it — what React does
 * for a component that sets its own state while rendering.
 */
const slots: unknown[] = []
let cursor = 0
let dirty = false
vi.mock('react', () => ({
  useState: <T>(initial: T) => {
    const at = cursor++
    if (slots.length <= at) slots.push(initial)
    const set = (next: T) => {
      if (slots[at] !== next) dirty = true
      slots[at] = next
    }
    return [slots[at] as T, set] as const
  },
}))

const { ROW_PAGE, indexOfId, rowCap, useRowCap } = await import('./use-row-cap')

function render<T>(hook: () => T): T {
  for (let pass = 0; pass < 5; pass++) {
    cursor = 0
    dirty = false
    const out = hook()
    if (!dirty) return out
  }
  throw new Error('render did not settle')
}

describe('rowCap on web: how many rows a long list mounts', () => {
  it('mounts a page of 100, and everything under a page', () => {
    expect(ROW_PAGE).toBe(100)
    expect(rowCap(80, ROW_PAGE)).toEqual({ shown: 80, hidden: 0 })
    expect(rowCap(100, ROW_PAGE)).toEqual({ shown: 100, hidden: 0 })
    expect(rowCap(101, ROW_PAGE, -1)).toEqual({ shown: 100, hidden: 1 })
    expect(rowCap(2000, ROW_PAGE)).toEqual({ shown: 100, hidden: 1900 })
    expect(rowCap(0, ROW_PAGE)).toEqual({ shown: 0, hidden: 0 })
  })

  it('always mounts the row an arrival or an open record points at, however far down', () => {
    expect(rowCap(2000, ROW_PAGE, 1499)).toEqual({ shown: 1500, hidden: 500 })
    expect(rowCap(2000, ROW_PAGE, 1999)).toEqual({ shown: 2000, hidden: 0 })
    // The last row of the first page, the first row past it.
    expect(rowCap(2000, ROW_PAGE, 99)).toEqual({ shown: 100, hidden: 1900 })
    expect(rowCap(2000, ROW_PAGE, 100)).toEqual({ shown: 101, hidden: 1899 })
    expect(rowCap(2000, ROW_PAGE, -1)).toEqual({ shown: 100, hidden: 1900 })
  })

  it('finds the kept row by id, and -1 for none', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(indexOfId(rows, 'c')).toBe(2)
    expect(indexOfId(rows, 'zz')).toBe(-1)
    expect(indexOfId(rows, undefined)).toBe(-1)
    expect(indexOfId(rows, null)).toBe(-1)
    expect(indexOfId(rows, '')).toBe(-1)
  })
})

describe('useRowCap on web, across renders', () => {
  beforeEach(() => {
    slots.length = 0
  })

  it('adds a page per Show more, counted from what is shown', () => {
    let cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 100, hidden: 250 })
    cap.more()
    cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 200, hidden: 150 })
    // Two presses before a re-render are one page: each counts from `shown`.
    cap.more()
    cap.more()
    cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 300, hidden: 50 })
    cap.more()
    cap = render(() => useRowCap(350))
    expect(cap).toMatchObject({ shown: 350, hidden: 0 })
  })

  it('keeps the kept row mounted after `keep` returns to -1', () => {
    // The open record at row 1,500 of 2,000; then the sheet closes.
    expect(render(() => useRowCap(2000, 1500))).toMatchObject({ shown: 1501, hidden: 499 })
    expect(render(() => useRowCap(2000, -1))).toMatchObject({ shown: 1501, hidden: 499 })
    // And Show more carries on from there rather than from the first page.
    render(() => useRowCap(2000, -1)).more()
    expect(render(() => useRowCap(2000, -1))).toMatchObject({ shown: 1601, hidden: 399 })
  })

  it('shrinks with the list and never reports a negative remainder', () => {
    render(() => useRowCap(500)).more()
    expect(render(() => useRowCap(500))).toMatchObject({ shown: 200, hidden: 300 })
    // A search narrows the list under the raised limit.
    expect(render(() => useRowCap(40))).toMatchObject({ shown: 40, hidden: 0 })
  })
})
