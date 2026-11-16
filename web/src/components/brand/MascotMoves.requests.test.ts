import { describe, expect, it } from 'vitest'
import moves from '@/components/brand/MascotMoves.tsx?raw'
import appearance from '@/components/settings/AppearancePanel.tsx?raw'

/**
 * The list of moves and strokes, and the robot's credit, shown on the brand
 * card and in Settings (Q314, Q315). Source reads (D20).
 */
describe('the mascot moves list', () => {
  it('lists every move, with the stroke that plays it', () => {
    expect(moves).toMatch(/GESTURES\.map\(/)
    expect(moves).toMatch(/strokesFor\(pose\)/)
    expect(moves).toMatch(/PAD_STROKES\.map\(/)
  })

  it('credits the robot model as its CC BY licence asks: title, artist, source, licence, changes (Q314)', () => {
    const credit = moves.slice(moves.indexOf('export function MascotCredit'))
    expect(credit).toContain('Sci-fi O.B. Robot Unit TH-ICC02 (animated)')
    expect(credit).toContain('Jungle Jim')
    expect(credit).toContain('CC BY 4.0')
    expect(credit).toMatch(/Changed for jojo/)
    expect(credit).toMatch(/does not endorse/)
    expect(moves).toContain(
      "'https://sketchfab.com/3d-models/sci-fi-ob-robot-unit-th-icc02-animated-6c0764c2bc4c4aaa8e03ba1653f455a6'",
    )
    expect(moves).toContain("'https://sketchfab.com/jungle_jim'")
    expect(moves).toContain("'https://creativecommons.org/licenses/by/4.0/'")
  })

  it('shows the moves, the strokes and the credit in Settings too (Q318)', () => {
    expect(appearance).toMatch(/GESTURES\.map\(/)
    expect(appearance).toMatch(/<StrokeLegend\b/)
    expect(appearance).toMatch(/<MascotCredit\b/)
  })
})
