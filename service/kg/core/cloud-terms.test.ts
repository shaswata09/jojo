/**
 * The consent notice, which is the one piece of copy in this app that a person
 * relies on rather than reads.
 *
 * These assertions look pedantic and are not. Each names a sentence that had
 * already gone missing from one of the two apps while both claimed in comments
 * to be saying the same thing — so what is pinned here is not the wording but
 * the presence: a build that drops the NVIDIA storage licence, or the line
 * telling somebody to go and read the terms themselves, fails.
 */
import { describe, expect, it } from 'vitest'
import { cloudTerms } from './cloud-terms'
import { providerMeta } from './provider'

const flat = (p: ReturnType<typeof cloudTerms>) =>
  p.paragraphs.map((para) => para.map((s) => s.text).join('')).join('\n')

describe('cloudTerms', () => {
  const evaluation = cloudTerms(providerMeta('nvidia'))

  it('says what is sent, and that some of it is not the reader’s to send', () => {
    for (const provider of ['nvidia', 'openai'] as const) {
      const text = flat(cloudTerms(providerMeta(provider)))
      expect(text).toContain('your CV text once a document is read')
      expect(text).toContain('referees or recruiters')
      expect(text).toContain('other people’s personal information')
    }
  })

  it('keeps the two clauses of NVIDIA’s terms that are in tension with this app', () => {
    const text = flat(evaluation)
    expect(text).toContain('not in production')
    expect(text).toContain('will not upload any personal information')
    expect(text).toContain('Tracking a real job search is production use')
  })

  it('keeps the storage licence, which the phone had lost', () => {
    expect(flat(evaluation)).toContain('licence to store and reproduce it')
  })

  it('keeps the invitation to go and read the terms, which the phone had lost', () => {
    expect(flat(evaluation)).toContain('decide for yourself whether your use fits them')
  })

  it('keeps the paid provider’s "different bargain", which the phone had lost', () => {
    const paid = flat(cloudTerms(providerMeta('openai')))
    expect(paid).toContain('a different bargain from the local option, not a worse one')
  })

  it('always names who is party to the agreement', () => {
    for (const provider of ['nvidia', 'openai', 'anthropic'] as const) {
      const terms = cloudTerms(providerMeta(provider))
      const liability = terms.liability.map((s) => s.text).join('')
      expect(liability).toContain('You are the account holder')
      expect(liability).toContain('accepts no liability')
    }
  })

  it('uses the bare name in a possessive and the full one in the headline', () => {
    // "NVIDIA (build.nvidia.com)'s terms" is what happens without this, and
    // both apps were already making the distinction separately.
    expect(evaluation.headline).toContain('build.nvidia.com')
    expect(evaluation.liability.map((s) => s.text).join('')).toContain('NVIDIA’s terms')
    expect(evaluation.liability.map((s) => s.text).join('')).not.toContain('build.nvidia.com')
  })

  it('emphasises the sentence saying whose problem a breach is', () => {
    const emphasised = evaluation.liability.filter((s) => s.emphasis === true)
    expect(emphasised.map((s) => s.text).join('')).toContain('accepts no liability')
  })

  it('emphasises the phrases a skimming reader has to catch', () => {
    const emphasised = evaluation.paragraphs.flat().filter((s) => s.emphasis === true)
    expect(emphasised.length).toBeGreaterThanOrEqual(3)
    expect(emphasised.map((s) => s.text).join(' ')).toContain('other people’s personal information')
  })
})
