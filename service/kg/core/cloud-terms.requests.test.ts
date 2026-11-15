/**
 * The consent notice a cloud model provider gets in setup (G6).
 *
 * Q188 — NVIDIA shows its terms and says jojo is not liable for breaches of
 * NVIDIA's policy (pinned in `cloud-terms.test.ts`).
 * Q189 — every OTHER cloud provider says, by name, that what is sent to it is
 * no longer private to this device. That half had no test: the headline that
 * carries it could lose the provider's name, or stop saying the records leave,
 * and nothing would fail.
 */
import { describe, expect, it } from 'vitest'
import { cloudTerms } from './cloud-terms'
import { PROVIDERS } from './provider'

const others = PROVIDERS.filter((p) => p.cloud && !p.evaluationOnly)

describe('choosing a cloud provider other than NVIDIA (Q189)', () => {
  it('covers every one there is', () => {
    expect(others.map((p) => p.id).sort()).toEqual(['anthropic', 'groq', 'openai', 'openrouter'])
  })

  it.each(others.map((p) => [p.id, p] as const))('%s: says, naming it, that the records leave this device', (_id, provider) => {
    const terms = cloudTerms(provider)
    const name = provider.label.split(' —')[0]!
    expect(terms.headline).toBe(`Your records leave this device when you use ${name}`)
  })

  it.each(others.map((p) => [p.id, p] as const))('%s: names it again as the party whose terms apply', (_id, provider) => {
    const short = provider.label.split(' —')[0]!.replace(/\s*\([^)]*\)\s*$/, '')
    const liability = cloudTerms(provider).liability.map((s) => s.text).join('')
    expect(liability).toContain(`Compliance with ${short}’s terms is yours`)
  })
})

describe('choosing NVIDIA (Q188)', () => {
  const nvidia = PROVIDERS.find((p) => p.id === 'nvidia')!

  it('says jojo accepts no liability for a breach of NVIDIA’s terms', () => {
    const liability = cloudTerms(nvidia).liability.map((s) => s.text).join('')
    expect(liability).toContain('Compliance with NVIDIA’s terms is yours, and jojo accepts no liability for any breach of them.')
  })
})
