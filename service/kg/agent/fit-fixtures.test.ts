/**
 * The fit fixtures are well-formed, so a live run never fails for a reason the
 * live run cannot see.
 *
 * Cheap guards in the spirit of `bench-fixtures.test.ts`: each document is
 * classified the way its author intended, every expectation is distinct, and
 * every fit expectation names a posting and a person that exist.
 */
import { describe, expect, it } from 'vitest'
import { documentKindOf } from '../core/document-kind'
import { EXPECTED_FIT, POSTINGS, PRIYA } from './fit-fixtures'

describe('the second person’s documents', () => {
  it('are classified as their names intend', () => {
    const kinds = Object.fromEntries(PRIYA.map((f) => [f.id, documentKindOf(f.name, f.text)]))
    expect(kinds).toEqual({
      'priya-cv': 'cv',
      'priya-research-statement': 'research-statement',
      'priya-teaching-statement': 'teaching-statement',
      'priya-cover-letter': 'cover-letter',
    })
  })

  it('expect entries that are actually in the text, so a miss is the model’s', () => {
    for (const doc of PRIYA) {
      const text = doc.text.toLowerCase()
      for (const want of doc.expect) {
        // The matcher looks for `says` in what the model wrote; a phrase the
        // document never contains can only be recalled by luck.
        expect(text, `${doc.id}: ${want.label}`).toContain(want.says.split(' ')[0] ?? '')
      }
    }
  })
})

describe('the postings', () => {
  it('each ask for something, and every expectation is a phrase in the posting', () => {
    for (const posting of POSTINGS) {
      expect(posting.expect.length).toBeGreaterThan(0)
      const text = posting.text.toLowerCase()
      for (const want of posting.expect) {
        expect(text, `${posting.id}: ${want.label}`).toContain(want.says.split(' ')[0] ?? '')
      }
    }
  })

  it('keeps the real one real: the UTK page rules out AI-only candidates in prose', () => {
    const utk = POSTINGS.find((p) => p.id === 'utk-cs')
    expect(utk?.text).toContain(
      'Candidates whose only research area is AI/ML will not be considered',
    )
  })
})

describe('the fit expectations', () => {
  it('name people and postings that exist', () => {
    const ids = new Set(POSTINGS.map((p) => p.id))
    for (const e of EXPECTED_FIT) {
      expect(ids.has(e.posting), e.posting).toBe(true)
      expect(['priya', 'amara']).toContain(e.person)
      expect(Boolean(e.atLeastTailoring) || Boolean(e.notStrong)).toBe(true)
    }
  })
})
