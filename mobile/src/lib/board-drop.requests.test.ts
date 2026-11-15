/**
 * Q071 — on the phone board a card is HELD, then dragged to another stage
 * column, and the move is written to the store.
 *
 * `board-drop.test.ts` owns the drop arithmetic (which column, released or
 * cancelled). What it cannot see is the wiring either side of `dropStage`: that
 * the gesture is a long press rather than a plain pan (a pan would steal every
 * horizontal scroll of the board), and that the stage `dropStage` answers is
 * handed to the row action that persists it through the shared
 * `useApplications().setStage`.
 *
 * D20: nothing is mounted. These are narrow source reads of the two files that
 * make that decision; each assertion names one line a refactor would have to
 * keep anyway.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const read = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8')
const board = read('../screens/applications/Board.tsx')
const rowActions = read('../screens/applications/use-row-actions.tsx')

describe('the phone board drag', () => {
  it('lifts a card on a long press, not on a plain pan', () => {
    expect(board).toMatch(/Gesture\.Pan\(\)\s*\.activateAfterLongPress\(/)
  })

  it('moves the held card to the stage dropStage answers', () => {
    expect(board).toContain('const target = dropStage(columnIndex, released)')
    expect(board).toMatch(
      /if \(card && target\) latest\.current\.actions\.onMoveStage\(card, target\)/,
    )
  })

  it('persists the move through the shared setStage', () => {
    expect(rowActions).toMatch(/const \{[^}]*\bsetStage\b[^}]*\} = useApplications\(\)/)
    expect(rowActions).toContain('setStage(a.id, stage)')
  })
})
