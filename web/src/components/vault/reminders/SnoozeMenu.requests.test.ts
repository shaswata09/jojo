/**
 * Review finding web-3: "Pick a date" moved the reminder on the first
 * keystroke. The field opens holding a whole date, so typing '2' in the month
 * was already a different whole date, and the reminder went to February.
 */

import { describe, expect, it } from 'vitest'
import source from './SnoozeMenu.tsx?raw'
import en from '@/i18n/locales/en/vault.json'

describe('picking a date in the snooze menu (web-3)', () => {
  it('only keeps the draft as the field changes', () => {
    expect(source).toContain('onChange={(event) => setPicked(event.target.value)}')
    expect(source).not.toMatch(/onChange=\{[\s\S]{0,200}actions\.moveTo/)
  })

  it('moves the reminder from the form — Enter or the Move button — once the date is whole', () => {
    expect(source).toContain('const movable = isWholeDate(picked) && picked !== item.date')
    expect(source).toMatch(
      /onSubmit=\{[\s\S]*?if \(!movable\) return[\s\S]*?actions\.moveTo\(item, picked\)/,
    )
    expect(source).toMatch(/<Button type="submit"[^>]*disabled=\{!movable\}>/)
    expect(en.reminders.snooze.move).toBe('Move')
  })
})
