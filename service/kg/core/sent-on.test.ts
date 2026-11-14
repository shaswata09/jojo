import { describe, expect, it } from 'vitest'
import { sentOn } from './sent-on'

describe('sentOn', () => {
  it('prefers the submitted date, which is the one a person corrects', () => {
    expect(sentOn({ appliedOn: '2026-09-03', submittedOn: '2026-09-10' })).toBe('2026-09-10')
  })

  it('falls back to appliedOn, then to nothing', () => {
    expect(sentOn({ appliedOn: '2026-09-03' })).toBe('2026-09-03')
    expect(sentOn({ submittedOn: '2026-09-10' })).toBe('2026-09-10')
    expect(sentOn({})).toBeUndefined()
  })
})
