import { describe, expect, it } from 'vitest'
import cloudTerms from '@/components/settings/CloudTerms.tsx?raw'
import localModel from '@/components/settings/LocalModelPanel.tsx?raw'
import setupSteps from '@/components/common/SetupSteps.tsx?raw'

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
    expect(strip(localModel)).toMatch(/\{provider\.cloud \? <CloudTerms provider=\{provider\} \/> : null\}/)
  })

  it('the terms box renders the headline, the paragraphs, the liability line and the provider’s own terms', () => {
    const code = strip(cloudTerms)
    expect(code).toMatch(/const terms = cloudTerms\(provider\)/)
    expect(code).toMatch(/\{terms\.headline\}/)
    expect(code).toMatch(/terms\.paragraphs\.map/)
    expect(code).toMatch(/terms\.liability\.map/)
    expect(code).toMatch(/href=\{provider\.termsUrl\}/)
  })
})
