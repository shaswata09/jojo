import { describe, expect, it } from 'vitest'
import { emptyProfile } from '@jojo/service/data/profile'
import type { ProfileText } from '@jojo/service/data/profile'
import { profileForm, sameText } from './profile-draft'

const text = (over: Partial<ProfileText> = {}): ProfileText => ({ ...emptyProfile().text, ...over })

describe('what the profile form shows', () => {
  it('renders the store while nothing is being typed', () => {
    const form = profileForm(null, text({ fullName: 'Alex Rivera' }))
    expect(form.fields.fullName).toBe('Alex Rivera')
    expect(form.dirty).toBe(false)
  })

  /*
   * The defect. `profile.text.set` is offered by the Spotlight palette over
   * every route, so the record changes under an open page — and the page used
   * to hold a copy taken at mount. Measured against a live store: the field
   * went on showing "Alex Rivera" after the tool had written "Dr Alex Rivera",
   * the save bar came up over changes nobody had typed, and Save wrote the
   * stale copy back.
   */
  it('follows a write from somewhere else, rather than shadowing it', () => {
    const form = profileForm(null, text({ fullName: 'Dr Alex Rivera' }))
    expect(form.fields.fullName).toBe('Dr Alex Rivera')
    // And no bar, because nobody typed anything.
    expect(form.dirty).toBe(false)
  })

  it('keeps what is being typed when the record moves underneath it', () => {
    const typed = text({ fullName: 'Alex Rivera-Smith' })
    const form = profileForm(typed, text({ fullName: 'Dr Alex Rivera' }))
    expect(form.fields.fullName).toBe('Alex Rivera-Smith')
    // A conflict the person can Discard, not a silent overwrite either way.
    expect(form.dirty).toBe(true)
  })

  it('drops the bar once what was typed matches what is stored', () => {
    const same = text({ email: 'a@b.edu' })
    expect(profileForm({ ...same }, same).dirty).toBe(false)
  })

  it('raises the bar for a field that was emptied', () => {
    expect(profileForm(text({ email: '' }), text({ email: 'a@b.edu' })).dirty).toBe(true)
  })
})

describe('comparing two records', () => {
  /*
   * BOTH DIRECTIONS, and the second one is not decoration: mutation-checked,
   * comparing over `Object.keys(b)` alone passed this test when it only had
   * the first assertion. The union is what the module promises, and a promise
   * only one half of which can fail is half a test.
   */
  it('reads a key the other record does not have, whichever side is missing it', () => {
    // A record written by an older build has fewer keys; comparing over one
    // side's keys alone would call the two identical.
    const partial = { fullName: 'Alex' } as unknown as ProfileText
    const full = text({ fullName: 'Alex', email: 'a@b.edu' })
    expect(sameText(partial, full)).toBe(false)
    expect(sameText(full, partial)).toBe(false)
  })

  it('says nothing changed when nothing changed', () => {
    expect(sameText(text({ github: 'https://github.com/x' }), text({ github: 'https://github.com/x' }))).toBe(true)
  })
})
