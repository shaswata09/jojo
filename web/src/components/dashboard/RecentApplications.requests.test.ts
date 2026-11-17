/**
 * Q289: the Recent applications card toggles to a Sticky notes board, shown by
 * default, whose notes persist and can become a reminder.
 *
 * Persistence is the `sticky.note.*` tools (`service/test/coverage.test.ts`)
 * and the note-to-reminder rule is `reminderFromNote` (`service/kg/core/sticky.test.ts`).
 * What neither can see is the card: that the toggle exists, that it opens on
 * the notes, and that the board writes through the store and hands a note to
 * the reminder dialog through that rule. D20 bans mounting, so this is a
 * narrow source read.
 */

import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/dashboard.json'

const sources = import.meta.glob(
  ['/src/components/dashboard/RecentApplications.tsx', '/src/components/dashboard/StickyBoard.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const card = sources['/src/components/dashboard/RecentApplications.tsx'] ?? ''
const board = sources['/src/components/dashboard/StickyBoard.tsx'] ?? ''

describe('the Recent applications card (Q289)', () => {
  it('toggles between the notes and the recent list', () => {
    expect(card).toMatch(/const VIEWS = \['notes', 'recent'\] as const/)
    expect(en.recent.views).toEqual({ notes: 'Notes', recent: 'Recent applications' })
    expect(card).toMatch(/<Segment options=\{views\} value=\{view\} onChange=\{choose\}/)
    expect(card).toContain("{view === 'notes' ? <StickyBoard /> : <RecentList />}")
  })

  it('shows the notes unless this browser last chose the list', () => {
    expect(card).toContain("readStored(VIEW_KEY) === 'recent' ? 'recent' : 'notes'")
    expect(card).toContain('useState<View>(storedView)')
  })
})

describe('the sticky notes board (Q289)', () => {
  it('keeps its notes in the store', () => {
    expect(board).toContain('const { notes, create, update, remove } = useStickyNotes()')
  })

  it('turns a note into a reminder through the tested rule', () => {
    expect(board).toMatch(
      /open\('timelineItem', \{ mode: 'reminder', initial: reminderFromNote\(note\.text, TODAY\) \}\)/,
    )
    expect(board).toContain('onReminder={() => toReminder(note)}')
  })
})
