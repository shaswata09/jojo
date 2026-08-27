/**
 * One question: did the finger let go, and over what.
 *
 * The cancel case is the one this module exists for. `onEnd` fires for
 * CANCELLED and FAILED as well as END, so the board used to move the card and
 * post its undo toast when a call arrived mid-drag — the drag was over the
 * Interview column at that instant, so Interview is where the application went.
 * Every case below pairs a released drag with an identical cancelled one, so
 * the assertion is about the release and not about the column.
 */

import { describe, expect, it } from 'vitest'
import { STAGES } from '@jojo/service/data/seed'
import { dropStage } from './board-drop'

describe('dropStage', () => {
  it('lands the card on the column the finger was over', () => {
    expect(dropStage(3, true)).toBe(STAGES[3].id)
  })

  it('lands nothing when the drag was cancelled rather than released', () => {
    // Same column, same board — only the release differs.
    expect(dropStage(3, false)).toBe(null)
  })

  it('lands nothing when the card was lifted but never moved', () => {
    // -1 is `hoverSV`'s resting value: `onUpdate` never ran, so no column was
    // ever hovered. A long press that goes nowhere must not move anything.
    expect(dropStage(-1, true)).toBe(null)
  })

  it('lands nothing past the last column', () => {
    // The gesture clamps the index, so this is belt and braces — but the clamp
    // reads `STAGES.length` on the UI thread and this reads `STAGES`, and the
    // failure if those ever disagree is a crash on `column.id`.
    expect(dropStage(STAGES.length, true)).toBe(null)
  })

  it('answers for every column, so no stage is unreachable by drag', () => {
    expect(STAGES.map((_, i) => dropStage(i, true))).toEqual(STAGES.map((s) => s.id))
  })
})
