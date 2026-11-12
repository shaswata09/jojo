import { describe, expect, it } from 'vitest'
import { deadlineWrite, refusalOf } from './form-state'

describe('deadlineWrite', () => {
  it('sends nothing when the field still holds what the dialog opened with', () => {
    expect(deadlineWrite({ deadline: '' }, undefined)).toBeUndefined()
    expect(deadlineWrite({ deadline: '2026-11-01' }, { deadline: '2026-11-01' })).toBeUndefined()
  })

  it('sends null when the person emptied it, so the tool deletes the item', () => {
    expect(deadlineWrite({ deadline: '' }, { deadline: '2026-11-01' })).toBeNull()
  })

  it('sends the new date when it moved or was added', () => {
    expect(deadlineWrite({ deadline: '2026-11-08' }, { deadline: '2026-11-01' })).toBe('2026-11-08')
    expect(deadlineWrite({ deadline: '2026-11-08' }, {})).toBe('2026-11-08')
  })
})

describe('refusalOf', () => {
  it('puts a refusal on the field the form has, and leads the toast with it', () => {
    // The probe that found this: `application.update` with org '' answers
    // "Cannot be blank." on `org`, and the form used to say "Changes saved".
    const out = refusalOf([{ message: 'Cannot be blank.', field: 'org' }])
    expect(out).toEqual({ message: 'Cannot be blank.', fields: { org: 'Cannot be blank.' } })
  })

  it('keeps a refusal on a field the form does not show for the toast alone', () => {
    const out = refusalOf([{ message: 'Needs to be a date.', field: 'appliedOn' }])
    expect(out).toEqual({ message: 'Needs to be a date.', fields: {} })
  })

  it('still says something when the tool gave no message', () => {
    expect(refusalOf([]).message).not.toBe('')
  })
})
