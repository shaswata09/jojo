import { describe, expect, it } from 'vitest'
import { announceRefusal, refusalToast } from './write-result'

describe('refusalToast', () => {
  it('says nothing about a write that went through', () => {
    expect(refusalToast({ ok: true })).toBeNull()
  })

  it('says nothing for a hook that still returns nothing', () => {
    expect(refusalToast(undefined)).toBeNull()
  })

  it("names a refusal in the tool's own words", () => {
    expect(refusalToast({ ok: false, errors: [{ message: 'Cannot be blank.' }] })).toEqual({
      title: 'That did not save',
      description: 'Cannot be blank.',
      tone: 'danger',
    })
  })

  it('still says something when the refusal carries no message', () => {
    expect(refusalToast({ ok: false, errors: [] })?.description).toBe('The change was refused.')
  })
})

describe('announceRefusal', () => {
  it('shows the refusal and reports it', () => {
    const shown: unknown[] = []
    expect(announceRefusal({ ok: false, errors: [{ message: 'No.' }] }, (t) => shown.push(t))).toBe(
      true,
    )
    expect(shown).toHaveLength(1)
  })

  it('stays quiet on success', () => {
    const shown: unknown[] = []
    expect(announceRefusal({ ok: true }, (t) => shown.push(t))).toBe(false)
    expect(shown).toHaveLength(0)
  })
})
