/**
 * Q331 — the phone shows the web's sticky notes (Q289) and hand-edited stage
 * dates (Q264). These files import React Native, which this runner does not
 * load (see vitest.config.mts), so they are read as text with comments
 * removed. The rules themselves are core's and tested there:
 * `service/kg/core/sticky.test.ts` and `service/kg/core/stage-dates.test.ts`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('sticky notes on Today (Q331)', () => {
  const today = read('screens/TodayScreen.tsx')
  const board = read('components/dashboard/StickyBoard.tsx')

  it('toggles the recent card to the notes, and shows the notes unless this device chose the list', () => {
    expect(today).toMatch(/useState<NotesView>\('notes'\)/)
    expect(today).toMatch(/if \(live && stored === 'recent'\) setView\('recent'\)/)
    expect(today).toMatch(/\{view === 'notes' \? <StickyBoard \/> : <RecentList \/>\}/)
  })

  it('keeps its notes in the same store the web board does', () => {
    expect(board).toMatch(/const \{ notes, create, update, remove \} = useStickyNotes\(\)/)
  })

  it('turns a note into a reminder through the shared rule', () => {
    expect(board).toMatch(/from '@jojo\/service\/core\/sticky'/)
    expect(board).toMatch(
      /open\('timelineItem', \{\s*mode: 'reminder',\s*initial: reminderFromNote\(note\.text, TODAY\),?\s*\}\)/,
    )
  })
})

describe('stage dates on an application (Q331)', () => {
  const panel = read('components/applications/StageDatesPanel.tsx')
  const detail = read('screens/ApplicationDetailScreen.tsx')

  it('shows each stage’s date on the record, submitted included, and once', () => {
    expect(detail).toMatch(/<StageDatesPanel application=\{a\} \/>/)
    expect(panel).toMatch(/const rows = stagesToDate\(a\)/)
    // The Submitted row is where that date is read now; a read-only copy in
    // the facts above would be the one people believe.
    expect(detail).not.toMatch(/id: 'submittedOn'/)
  })

  it('writes a picked or cleared date through the rule that overwrites, with an Undo', () => {
    expect(panel).toMatch(/undoable\(\(\) => update\(a\.id, setStageDate\(a, stage, on\)\)\)/)
    expect(panel).toMatch(/action: \{ label: t\('shared\.undo'\), onPress: \(\) => void restore\(\) \}/)
    expect(panel).toMatch(/clearable/)
  })
})
