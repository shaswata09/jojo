import { describe, expect, it } from 'vitest'
import cloudTerms from '@/components/settings/CloudTerms.tsx?raw'
import localModel from '@/components/settings/LocalModelPanel.tsx?raw'
import setupSteps from '@/components/common/SetupSteps.tsx?raw'
import settingsEn from '@/i18n/locales/en/settings.json'
import { CLOUD_TERMS_EN } from '@jojo/service/core/cloud-terms'

/**
 * Q189 — choosing a cloud provider in setup shows its terms: by name, that the
 * records leave this device, with jojo's disclaimer of liability. (Q188 was
 * NVIDIA's own notice, superseded when Q345 removed NVIDIA.)
 *
 * The words are `core/cloud-terms.ts`'s and the service tests pin them. This
 * pins that setup actually shows them. Source reads (D20); comments stripped.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('the provider terms in setup (Q188, Q189)', () => {
  it('the setup step for a model is the model panel itself', () => {
    expect(strip(setupSteps)).toMatch(/body=\{<LocalModelPanel bare \/>\}/)
  })

  it('the model panel shows the terms for any cloud provider chosen', () => {
    expect(strip(localModel)).toMatch(
      /\{provider\.cloud \? <CloudTerms provider=\{provider\} \/> : null\}/,
    )
  })

  it('the terms box renders the headline, the paragraphs, the liability line and the provider’s own terms', () => {
    const code = strip(cloudTerms)
    expect(code).toMatch(/const terms = cloudTerms\(provider, /)
    expect(code).toMatch(/\{terms\.headline\}/)
    expect(code).toMatch(/terms\.paragraphs\.map/)
    expect(code).toMatch(/terms\.liability\.map/)
    expect(code).toMatch(/href=\{provider\.termsUrl\}/)
  })
})

/**
 * 2026-11-21: the notice was English in all twenty languages — this panel
 * rendered core's sentences with no `t()` on the path. It now hands core its
 * own translator under `cloudNotice.*`, and the English catalog must say what
 * core says, so the two cannot become two Englishes.
 */
describe('the provider terms, in the reader’s language', () => {
  it('reads core’s sentences through this panel’s translator', () => {
    expect(strip(cloudTerms)).toMatch(
      /cloudTerms\(provider, \(key, options\) => t\(`cloudNotice\.\$\{key\}`, options\)\)/,
    )
  })

  it('holds the notice in the English core writes it in', () => {
    expect((settingsEn as { cloudNotice?: unknown }).cloudNotice).toEqual(CLOUD_TERMS_EN)
  })

  it('makes no claim that a provider’s terms allow production use', () => {
    // The comment that said "every provider offered here sells production use"
    // was an assertion about other companies' contracts; nothing here makes one.
    expect(cloudTerms).not.toMatch(/sells production use/)
  })
})

/**
 * 2026-11-21: a model server typed under "Ollama" or "a local server" is not
 * `cloud`, so it got no notice even at a public address. The panel now says
 * so when the address is not this machine or the local network, by the same
 * rule core uses everywhere else for that question.
 */
describe('a model server somewhere else', () => {
  it('gets a notice when its address is not local', () => {
    const code = strip(localModel)
    expect(code).toMatch(/!provider\.fixedEndpoint && isRemoteEndpoint\(endpoint\) \?/)
    expect(code).toContain("t('model.endpoint.remote')")
  })

  it('has the sentence in the English catalog', () => {
    const endpoint = (settingsEn as { model: { endpoint: Record<string, string> } }).model.endpoint
    expect(endpoint['remote']).toMatch(/not on this device or your local network/)
  })
})
