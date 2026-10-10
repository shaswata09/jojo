import { describe, expect, it } from 'vitest'
import { focusLine } from './focus'

describe('focusLine', () => {
  it('names the record and its id, so "this one" has a referent', () => {
    const line = focusLine({ id: 'application:0192-rice', org: 'Rice', role: 'Statistics' })
    expect(line).toContain('"Rice — Statistics"')
    expect(line).toContain('(id application:0192-rice)')
    expect(line).toMatch(/this application/)
  })

  it('keeps the name one clean phrase, whatever was typed into it', () => {
    const line = focusLine({
      id: 'application:1',
      org: 'Rice\nUniversity',
      role: 'Lecturer "senior"',
    })
    expect(line).toContain('"Rice University — Lecturer senior"')
    expect(line).not.toMatch(/\n/)
  })

  it('falls back to the employer when the role is blank, and bounds a long name', () => {
    expect(focusLine({ id: 'application:1', org: 'Rice', role: '  ' })).toContain('"Rice"')
    const long = focusLine({ id: 'application:1', org: 'x'.repeat(500), role: '' })
    expect(long).not.toContain('x'.repeat(121))
  })
})
