/**
 * The consent notice a cloud model provider gets in setup (G6).
 *
 * Q188 — NVIDIA's own notice; superseded by Q345, which removed NVIDIA.
 * Q189 — every cloud provider says, by name, that what is sent to it is
 * no longer private to this device. That half had no test: the headline that
 * carries it could lose the provider's name, or stop saying the records leave,
 * and nothing would fail.
 */
import { describe, expect, it } from 'vitest'
import { cloudTerms } from './cloud-terms'
import { PROVIDERS } from './provider'

const others = PROVIDERS.filter((p) => p.cloud)

describe('choosing a cloud provider (Q189)', () => {
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
