/**
 * The three decisions both platforms' entry forms used to make separately.
 *
 * The one worth a file: a blank box on an EDIT takes the field off, and a
 * blank box on an ADD is simply nothing. A form that got the first wrong left
 * a wrong "Where" on the record with no way to remove it from the page.
 */
import { describe, expect, it } from 'vitest'
import type { Background } from './model'
import {
  addEntryFrom,
  draftOf,
  draftProblems,
  emptyDraft,
  parseHighlights,
  updateFrom,
} from './background-form'

const postdoc: Background = {
  id: 'b1',
  kind: 'employment',
  title: 'Postdoctoral Researcher',
  where: 'Allen Institute for AI',
  period: '2024–present',
  detail: 'Trustworthy language models.',
  highlights: ['Built the evaluation harness.', 'Supervise two interns.'],
  source: 'file:cv',
}

describe('filling the form from an entry', () => {
  it('round-trips every field, with the bullets one per line', () => {
    const draft = draftOf(postdoc)
    expect(draft.title).toBe('Postdoctoral Researcher')
    expect(draft.highlights).toBe('Built the evaluation harness.\nSupervise two interns.')
    expect(draft.year).toBe('')
    // And back: an unchanged form is no update at all.
    expect(updateFrom(postdoc, draft)).toBeNull()
  })
})

describe('what an edit sends', () => {
  it('sends only what changed', () => {
    expect(updateFrom(postdoc, { ...draftOf(postdoc), period: '2024–2026' })).toEqual({
      period: '2024–2026',
    })
  })

  it('takes a field OFF when its box was emptied', () => {
    expect(updateFrom(postdoc, { ...draftOf(postdoc), where: '', detail: '   ' })).toEqual({
      where: null,
      detail: null,
    })
  })

  it('does not mention a field that was never there and is still blank', () => {
    const bare: Background = { id: 'b2', kind: 'skill', title: 'Rust' }
    expect(updateFrom(bare, { ...draftOf(bare), where: '' })).toBeNull()
  })

  it('sends the year as a number, and null when it was cleared', () => {
    const dated: Background = { id: 'b3', kind: 'education', title: 'PhD', year: 2024 }
    expect(updateFrom(dated, { ...draftOf(dated), year: '2025' })).toEqual({ year: 2025 })
    expect(updateFrom(dated, { ...draftOf(dated), year: '' })).toEqual({ year: null })
  })

  it('replaces the bullets as a whole, and an emptied box clears them', () => {
    expect(
      updateFrom(postdoc, { ...draftOf(postdoc), highlights: '- Built it.\n\n• Shipped it.' }),
    ).toEqual({
      highlights: ['Built it.', 'Shipped it.'],
    })
    expect(updateFrom(postdoc, { ...draftOf(postdoc), highlights: '' })).toEqual({ highlights: [] })
  })

  it('never sends an emptied title — the tool requires one and the form refuses first', () => {
    expect(updateFrom(postdoc, { ...draftOf(postdoc), title: '' })).toBeNull()
    expect(draftProblems({ ...draftOf(postdoc), title: '' }).title).toBeDefined()
  })
})

describe('what an add sends', () => {
  it('leaves blank boxes out rather than filing empty strings', () => {
    expect(addEntryFrom({ ...emptyDraft('skill'), title: ' Rust ' })).toEqual({
      kind: 'skill',
      title: 'Rust',
    })
    expect(
      addEntryFrom({ ...emptyDraft('grant'), title: 'NSF GRFP', year: '2019', highlights: 'a\nb' }),
    ).toEqual({ kind: 'grant', title: 'NSF GRFP', year: 2019, highlights: ['a', 'b'] })
  })
})

describe('refusing before the tool does', () => {
  it('needs a title and a real year', () => {
    expect(draftProblems(emptyDraft()).title).toBeDefined()
    expect(draftProblems({ ...emptyDraft(), title: 'x', year: '19' }).year).toBeDefined()
    expect(draftProblems({ ...emptyDraft(), title: 'x', year: '2101' }).year).toBeDefined()
    expect(draftProblems({ ...emptyDraft(), title: 'x', year: '2019' })).toEqual({})
  })

  it('reads bullets however they were typed', () => {
    expect(parseHighlights('- one\n* two\n• three\n\nfour ')).toEqual([
      'one',
      'two',
      'three',
      'four',
    ])
  })
})
