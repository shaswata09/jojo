/**
 * Reading what a posting asks for.
 *
 * The tests that matter here are about what the reader REFUSES: boilerplate
 * that would dilute the score, a duplicate that would be counted twice at
 * double weight, and an `essential` flag guessed upward. The first two change
 * the number; the third changes the advice.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_REQUIREMENTS,
  REQUIREMENTS_BUDGET,
  readRequirements,
  requirementMessages,
} from './read-requirements'

const reply = (payload: unknown) => JSON.stringify(payload)

describe('what comes back', () => {
  it('reads a plain list', () => {
    const out = readRequirements(
      reply({
        requirements: [
          { text: 'PhD in Computer Science', essential: true },
          { text: 'Rust', essential: false },
        ],
      }),
    )
    expect(out.ok && out.requirements).toEqual([
      { text: 'PhD in Computer Science', essential: true },
      { text: 'Rust', essential: false },
    ])
  })

  it('survives a fence and a sentence in front of the JSON', () => {
    // Small local models do both, and neither is worth a failed read — this is
    // a round trip to somebody's GPU.
    const out = readRequirements(
      'Here is what I found:\n```json\n{"requirements":[{"text":"Go","essential":true}]}\n```',
    )
    expect(out.ok && out.requirements[0]?.text).toBe('Go')
  })

  it('refuses when the page is not a posting', () => {
    const out = readRequirements(reply({ notAPosting: true }))
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toMatch(/not read as a job posting/i)
  })

  it('refuses rather than throwing on prose', () => {
    expect(readRequirements('I could not find any requirements.').ok).toBe(false)
  })
})

describe('the essential flag', () => {
  it('reads the shapes a small model actually emits', () => {
    /*
     * This used to accept only the literal `true`, on the argument that
     * understating is the safe direction. That is right PER ROW and wrong for
     * the real failure: a model that writes `"essential": "true"` writes it for
     * all twelve entries, so EVERY requirement became preferred, `assess`
     * weighed none double, `tailor` never capped the verdict, and the person
     * saw a fit score systematically too high with a gap list that looked fine.
     */
    const out = readRequirements(
      reply({
        requirements: [
          { text: 'a', essential: 'true' },
          { text: 'b', essential: 1 },
          { text: 'c', essential: 'Yes' },
          { text: 'd', essential: true },
        ],
      }),
    )
    expect(out.ok && out.requirements.map((r) => r.essential)).toEqual([true, true, true, true])
  })

  it('still refuses anything outside a closed list', () => {
    // Not a truthiness test. A `"false"` string, or an object, reads as
    // preferred — the direction that only costs a cap rather than inventing one.
    const out = readRequirements(
      reply({
        requirements: [
          { text: 'a', essential: 'false' },
          { text: 'b', essential: 0 },
          { text: 'c' },
          { text: 'd', essential: { value: true } },
        ],
      }),
    )
    expect(out.ok && out.requirements.map((r) => r.essential)).toEqual([false, false, false, false])
  })

  it('reports a coercion rather than making it silently', () => {
    // A coercion that mattered has to be visible: "four of twelve were read as
    // required" is something a person can weigh against a score.
    const out = readRequirements(reply({ requirements: [{ text: 'a', essential: 'true' }] }))
    expect(out.ok && out.skipped.join(' ')).toMatch(/rather than true or false/)
    expect(out.ok && out.skipped.join(' ')).toMatch(/read as required/)
  })
})

describe('what it will not let through', () => {
  it('drops a requirement the posting listed twice', () => {
    /*
     * Real postings name the same skill under Required and again under
     * Preferred. Kept, it becomes two requirements that `assess` counts twice —
     * once at double weight — so a posting that mentions Rust in two places
     * scores as though Rust were a third of the job.
     */
    const out = readRequirements(
      reply({
        requirements: [
          { text: 'Rust', essential: true },
          { text: 'rust', essential: false },
        ],
      }),
    )
    expect(out.ok && out.requirements).toHaveLength(1)
    expect(out.ok && out.requirements[0]?.essential).toBe(true)
    expect(out.ok && out.skipped[0]).toMatch(/already listed/)
  })

  it('skips an entry with no text rather than the whole read', () => {
    const out = readRequirements(
      reply({ requirements: [{ essential: true }, { text: 'Go', essential: true }] }),
    )
    expect(out.ok && out.requirements.map((r) => r.text)).toEqual(['Go'])
    expect(out.ok && out.skipped).toHaveLength(1)
  })

  it('caps the list and says how many it left', () => {
    // A posting that yields forty is one where the model started listing
    // sentences, and a score divided across thirty pieces of boilerplate is a
    // worse answer than one drawn from twelve.
    const many = Array.from({ length: MAX_REQUIREMENTS + 5 }, (_, i) => ({
      text: `requirement ${String(i)}`,
      essential: false,
    }))
    const out = readRequirements(reply({ requirements: many }))
    expect(out.ok && out.requirements).toHaveLength(MAX_REQUIREMENTS)
    expect(out.ok && out.skipped.join(' ')).toMatch(/5 more were past the limit/)
  })

  it('says nothing about a limit when the list fits', () => {
    // The off-by-one worth pinning: a posting with exactly the cap has not had
    // anything dropped, and saying so would be a lie about its own output.
    const exact = Array.from({ length: MAX_REQUIREMENTS }, (_, i) => ({
      text: `requirement ${String(i)}`,
      essential: false,
    }))
    const out = readRequirements(reply({ requirements: exact }))
    expect(out.ok && out.requirements).toHaveLength(MAX_REQUIREMENTS)
    expect(out.ok && out.skipped).toEqual([])
  })

  it('refuses when everything was skipped', () => {
    // Rather than returning ok with an empty list, which `assess` would read as
    // "nothing to measure" and report as not-measured — hiding a failed read
    // behind a screen that says the profile is empty.
    const out = readRequirements(reply({ requirements: [{}, { text: '   ' }] }))
    expect(out.ok).toBe(false)
  })
})

describe('what the model is shown', () => {
  it('says the page was cut, so a fragment does not read as a short posting', () => {
    const out = requirementMessages('Staff Engineer', 'x'.repeat(REQUIREMENTS_BUDGET + 1))
    expect(out[1]?.content).toContain('first part of a longer page')
  })

  it('says nothing about length when the whole page fits', () => {
    const out = requirementMessages('Staff Engineer', 'Requirements: Rust.')
    expect(out[1]?.content).not.toContain('longer page')
  })

  it('names the headings rather than asking the model to judge importance', () => {
    /*
     * The instruction that keeps `essential` checkable. "Decide what sounds
     * important" produces a flag nobody can argue with; "use the heading it sat
     * under" produces one a person can check against the posting.
     */
    const system = String(requirementMessages('x', 'y')[0]?.content)
    expect(system).toContain('Minimum qualifications')
    expect(system).toContain('Nice to have')
    expect(system).toMatch(/Do not decide for yourself/)
  })

  it('tells the model what is not a requirement', () => {
    // Benefits and mission statements are the bulk of a posting by length, and
    // a list padded with them divides a real score across boilerplate.
    const system = String(requirementMessages('x', 'y')[0]?.content)
    expect(system).toMatch(/benefits/i)
    expect(system).toMatch(/equal-opportunity/i)
  })
})
