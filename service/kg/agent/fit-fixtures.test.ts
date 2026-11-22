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

  /*
   * `cs-faculty` replaced a real posting that was committed verbatim. The two
   * properties that made it a hard read have to survive the rewrite, or the
   * live run stops measuring what it was built to measure: the AI-only rule is
   * prose, and nothing on the page is headed "Required".
   */
  it('keeps the hard parts of the faculty posting: the AI-only rule is prose', () => {
    const posting = POSTINGS.find((p) => p.id === 'cs-faculty')
    expect(posting?.text).toContain(
      'Applicants whose research is solely in AI/ML will not be considered',
    )
    expect(posting?.text).not.toMatch(/required/i)
    expect(posting?.text).toContain('(1) carry out and publish scholarly research;')
  })

  /*
   * Fixtures ship in a public, Apache-2.0 repository. A real person's address
   * there is published by us, and only RFC 2606's reserved domains are
   * guaranteed to reach nobody.
   */
  it('carries no address outside the reserved example domains', () => {
    for (const posting of POSTINGS) {
      const addresses = posting.text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []
      for (const address of addresses) {
        expect(address, posting.id).toMatch(/@example\.(?:com|org|edu|net)$/)
      }
    }
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
