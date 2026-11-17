import { describe, expect, it } from 'vitest'
import { reminderFromNote } from './sticky'

describe('a sticky note turned into a reminder', () => {
  it('takes the first line as the title and the rest as the detail', () => {
    expect(
      reminderFromNote('  Email Dr. Rao\nabout the third letter\nbefore Friday ', '2026-10-16'),
    ).toEqual({
      title: 'Email Dr. Rao',
      detail: 'about the third letter\nbefore Friday',
      date: '2026-10-16',
    })
  })

  it('leaves the detail out when the note is one line', () => {
    expect(reminderFromNote('Call the registrar', '2026-10-16')).toEqual({
      title: 'Call the registrar',
      date: '2026-10-16',
    })
  })

  it('keeps a title short enough to read in a list', () => {
    const { title } = reminderFromNote('x'.repeat(300), '2026-10-16')
    expect(title).toHaveLength(120)
    expect(title.endsWith('…')).toBe(true)
  })
})
