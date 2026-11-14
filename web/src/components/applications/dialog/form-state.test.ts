import { describe, expect, it } from 'vitest'
import type { Application } from '@/data/seed'
import { deadlineWrite, editInitial, formFrom, hasUnsaved, refusalOf } from './form-state'

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

  // Two messages on one field: the field shows the first, which is also the
  // toast's — a later one there would contradict the toast beside it.
  it('keeps the first message per field, the one the toast leads with', () => {
    const out = refusalOf([
      { message: 'Cannot be blank.', field: 'org' },
      { message: 'Too long.', field: 'org' },
      { message: 'Not a link.', field: 'url' },
    ])
    expect(out).toEqual({
      message: 'Cannot be blank.',
      fields: { org: 'Cannot be blank.', url: 'Not a link.' },
    })
  })

  it('still says something when the tool gave no message', () => {
    expect(refusalOf([]).message).not.toBe('')
  })
})

describe('deadlineWrite after a discarded edit is handed back', () => {
  // Edit → change the date → Escape → "Changes discarded · Undo" → Save. The
  // form reopens seeded with the typed date; the calendar still holds the old.
  it('sends the moved date', () => {
    const initial = { deadline: '2026-12-15', storedDeadline: '2026-12-01' }
    expect(deadlineWrite({ deadline: '2026-12-15' }, initial)).toBe('2026-12-15')
  })

  it('sends null for a cleared date', () => {
    const initial = { deadline: '', storedDeadline: '2026-12-01' }
    expect(deadlineWrite({ deadline: '' }, initial)).toBeNull()
  })

  it('still sends nothing when the field ends where the calendar is', () => {
    const initial = { deadline: '2026-12-15', storedDeadline: '2026-12-01' }
    expect(deadlineWrite({ deadline: '2026-12-01' }, initial)).toBeUndefined()
  })
})

describe('editInitial', () => {
  const record = { id: 'app:x', org: 'X', role: 'Lecturer' } as Application

  it('seeds the field from the calendar on a plain open', () => {
    expect(editInitial(record, undefined, '2026-12-01')).toMatchObject({
      deadline: '2026-12-01',
      storedDeadline: '2026-12-01',
    })
  })

  it('a handed-back draft keeps its typed date but saves against the stored one', () => {
    // The draft carries the storedDeadline of the first open; a later change
    // on the calendar must still win.
    const draft = { deadline: '2026-12-15', storedDeadline: '2026-11-20' }
    const initial = editInitial(record, draft, '2026-12-01')
    expect(initial).toMatchObject({ deadline: '2026-12-15', storedDeadline: '2026-12-01' })
    expect(deadlineWrite({ deadline: '2026-12-15' }, initial)).toBe('2026-12-15')
    expect(deadlineWrite({ deadline: '2026-12-01' }, initial)).toBeUndefined()
  })

  it('no deadline on the calendar reads as an empty stored date', () => {
    const initial = editInitial(record, { deadline: '' }, undefined)
    expect(initial.storedDeadline).toBe('')
    expect(deadlineWrite({ deadline: '' }, initial)).toBeUndefined()
  })
})

describe('hasUnsaved', () => {
  const record = { id: 'app:rice', org: 'Rice', role: 'Lecturer', roleTag: 'Lecturer' } as const
  const initial = editInitial(record as unknown as Application, undefined, '2026-12-01')

  it('is clean as opened, and dirty once a field or a keyword changes', () => {
    const form = formFrom(initial)
    expect(hasUnsaved(form, ['k1'], initial, ['k1'])).toBe(false)
    expect(hasUnsaved({ ...form, role: 'Principal scientist' }, ['k1'], initial, ['k1'])).toBe(true)
    expect(hasUnsaved(form, ['k1', 'k2'], initial, ['k1'])).toBe(true)
  })

  // Edit → type → Escape → "Changes discarded · Undo" → Escape. The draft
  // handed back is the new `initial`, so measured against it the restored form
  // read as untouched and the second Escape threw the edits away with no toast.
  it('counts a draft handed back by Undo as unsaved, in edit and in create', () => {
    const draft = { ...initial, role: 'Principal scientist', restored: true }
    expect(hasUnsaved(formFrom(draft), ['k1'], draft, ['k1'])).toBe(true)
    const created = { org: 'Databricks', role: 'Researcher', restored: true }
    expect(hasUnsaved(formFrom(created), [], created, [])).toBe(true)
  })
})
