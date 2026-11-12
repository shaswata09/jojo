import { describe, expect, it } from 'vitest'
import { DRAG_SLOP, pastSlop } from './drag-slop'

describe('pastSlop', () => {
  it('stays a click inside the slop', () => {
    expect(pastSlop({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false)
    expect(pastSlop({ x: 0, y: 0 }, { x: DRAG_SLOP, y: 0 })).toBe(false)
  })

  it('becomes a drag past it', () => {
    expect(pastSlop({ x: 0, y: 0 }, { x: DRAG_SLOP + 0.5, y: 0 })).toBe(true)
  })

  it('counts a slow drag by its total travel, not its last step', () => {
    // Twenty moves of one unit each: no single step crosses the slop, and the
    // old per-step comparison read this as a click.
    const press = { x: 0, y: 0 }
    let moved = false
    for (let i = 1; i <= 20; i += 1) if (pastSlop(press, { x: i, y: 0 })) moved = true
    expect(moved).toBe(true)
  })
})
