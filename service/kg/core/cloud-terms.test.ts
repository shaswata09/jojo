/**
 * The consent notice, which is the one piece of copy in this app that a person
 * relies on rather than reads.
 *
 * These assertions look pedantic and are not. Each names a sentence that had
 * already gone missing from one of the two apps while both claimed in comments
 * to be saying the same thing — so what is pinned here is not the wording but
 * the presence: a build that drops what is sent, the "different bargain", or
 * the line saying whose agreement it is, fails.
 */
import { describe, expect, it } from 'vitest'
import { CLOUD_TERMS_EN, cloudTerms } from './cloud-terms'
import { PROVIDERS, providerMeta } from './provider'

const flat = (p: ReturnType<typeof cloudTerms>) =>
  p.paragraphs.map((para) => para.map((s) => s.text).join('')).join('\n')

describe('cloudTerms', () => {
  const claude = cloudTerms(providerMeta('anthropic'))

  it('says what is sent, and that some of it is not the reader’s to send', () => {
    for (const provider of ['anthropic', 'openai'] as const) {
      const text = flat(cloudTerms(providerMeta(provider)))
      expect(text).toContain('your CV text once a document is read')
      expect(text).toContain('referees or recruiters')
      expect(text).toContain('other people’s personal information')
    }
  })

  it('keeps the "different bargain", which the phone had lost, for every provider', () => {
    for (const p of PROVIDERS.filter((x) => x.cloud)) {
      expect(flat(cloudTerms(p)), p.id).toContain('a different bargain from the local option, not a worse one')
    }
  })

  it('no longer claims the chat is the only part of jojo that is not local', () => {
    // Usage analytics and crash reports can leave too, once switched on; the
    // sentence that said otherwise was untrue the day they were added.
    for (const p of PROVIDERS.filter((x) => x.cloud)) {
      expect(flat(cloudTerms(p)), p.id).not.toContain('the one part that is not')
    }
  })

  it('always names who is party to the agreement', () => {
    for (const provider of ['openai', 'anthropic', 'groq'] as const) {
      const terms = cloudTerms(providerMeta(provider))
      const liability = terms.liability.map((s) => s.text).join('')
      expect(liability).toContain('You are the account holder')
      expect(liability).toContain('accepts no liability')
    }
  })

  it('uses the bare name in a possessive and the full one in the headline', () => {
    // "Anthropic (Claude)'s terms" is what happens without this, and both apps
    // were already making the distinction separately.
    expect(claude.headline).toContain('Anthropic (Claude)')
    expect(claude.liability.map((s) => s.text).join('')).toContain('Anthropic’s terms')
    expect(claude.liability.map((s) => s.text).join('')).not.toContain('(Claude)')
  })

  it('emphasises the sentence saying whose problem a breach is', () => {
    const emphasised = claude.liability.filter((s) => s.emphasis === true)
    expect(emphasised.map((s) => s.text).join('')).toContain('accepts no liability')
  })

  it('emphasises the phrases a skimming reader has to catch', () => {
    const emphasised = claude.paragraphs.flat().filter((s) => s.emphasis === true)
    expect(emphasised.map((s) => s.text).join(' ')).toContain('other people’s personal information')
  })
})

/**
 * The verified disclosure gaps of 2026-11-21, each pinned to the sentence that
 * closes it.
 */
describe('cloudTerms: what the notice had left out', () => {
  const cloud = PROVIDERS.filter((p) => p.cloud)

  it('says records go in the background too, naming each task that sends them', () => {
    for (const p of cloud) {
      const text = flat(cloudTerms(p))
      expect(text, p.id).toContain('It is not only when you chat.')
      for (const task of [
        'the duplicate check when you save an application',
        'reading the postings your scout finds',
        'fit readings',
        'tailoring your CV and letters',
        'shortening a long conversation',
      ])
        expect(text, `${p.id}: ${task}`).toContain(task)
    }
  })

  it('does not tell somebody on a free tier that they are paying', () => {
    // Groq and OpenRouter both have one; the notice said "is paid, billed to
    // your account" of all four.
    for (const id of ['groq', 'openrouter'] as const) {
      const text = flat(cloudTerms(providerMeta(id)))
      expect(text, id).toContain('has a free tier with limits')
      expect(text, id).not.toMatch(/\bis paid\b/)
    }
    for (const id of ['anthropic', 'openai'] as const) {
      expect(flat(cloudTerms(providerMeta(id))), id).toContain('bills your account')
    }
  })

  it('says OpenRouter hands the request on, and what its own terms let it keep', () => {
    const text = flat(cloudTerms(providerMeta('openrouter')))
    expect(text).toContain('passes each request on to the company that makes the model you pick')
    expect(text).toContain('anonymised form')
    // Said of OpenRouter alone: the others do not route.
    for (const id of ['anthropic', 'openai', 'groq'] as const) {
      expect(flat(cloudTerms(providerMeta(id))), id).not.toContain('passes each request on')
    }
  })

  it('says the terms are written for businesses, without saying a job search is allowed', () => {
    for (const p of cloud) {
      const text = flat(cloudTerms(p))
      expect(text, p.id).toContain('written for businesses and developers')
      expect(text, p.id).toContain('checking that they fit your use is up to you')
      // No claim about what the terms permit, either way.
      expect(text, p.id).not.toMatch(/production use|permit/i)
    }
  })
})

describe('cloudTerms: translated, not English in every language', () => {
  it('reads every sentence through the translator it is given, with the names filled in', () => {
    const asked: { key: string; options: Record<string, unknown> | undefined }[] = []
    const terms = cloudTerms(providerMeta('openrouter'), (key, options) => {
      asked.push({ key, options })
      return `«${key}»`
    })
    expect(terms.headline).toBe('«headline»')
    const keys = asked.map((a) => a.key)
    for (const key of [
      'sent.what',
      'sent.others',
      'sent.local',
      'background',
      'cost.freeTier',
      'cost.bargain',
      'openrouter',
      'business',
      'liability.party',
      'liability.breach',
    ])
      expect(keys, key).toContain(key)
    expect(asked[0]?.options).toEqual({ name: 'OpenRouter', short: 'OpenRouter' })
    // Nothing English left over once a translator is in: every segment is
    // either a translated sentence or the space between two.
    const texts = [...terms.paragraphs.flat(), ...terms.liability].map((s) => s.text)
    expect(texts.every((x) => x === ' ' || /^«[\w.]+»$/.test(x))).toBe(true)
  })

  it('asks only for keys the English catalog has', () => {
    const missing: string[] = []
    const lookup = (key: string) =>
      key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], CLOUD_TERMS_EN)
    for (const p of PROVIDERS.filter((x) => x.cloud)) {
      cloudTerms(p, (key) => {
        if (typeof lookup(key) !== 'string') missing.push(key)
        return key
      })
    }
    expect(missing).toEqual([])
  })
})
