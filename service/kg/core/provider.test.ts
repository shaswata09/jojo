/**
 * The provider table, and the two facts it now keeps apart.
 *
 * This table is read by three places that must agree — the Settings form, the
 * request builder, and the copy that explains a failure — which is exactly why
 * it is data rather than a switch. What is asserted here is the data, because a
 * wrong row is not a crash: it is a request sent to the wrong host, or a
 * sentence on screen telling somebody something untrue about their money.
 */

import { describe, expect, it } from 'vitest'
import { chatUrl, modelsUrl } from './model-server'
import { PROVIDERS, PROVIDER_IDS, providerMeta } from './provider'


describe('NVIDIA, the one that is free', () => {
  const nvidia = providerMeta('nvidia')

  it('is in the list and speaks the OpenAI shape', () => {
    /*
     * The reason it costs a table row rather than an adapter: build.nvidia.com
     * serves an OpenAI-compatible API, so `chatUrl`/`modelsUrl` and the whole
     * request builder already work. This pins that it was added as data.
     */
    expect(PROVIDER_IDS).toContain('nvidia')
    expect(nvidia.dialect).toBe('openai')
    expect(nvidia.endpoint).toBe('https://integrate.api.nvidia.com/v1')
    expect(chatUrl(nvidia.endpoint)).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
    expect(modelsUrl(nvidia.endpoint)).toBe('https://integrate.api.nvidia.com/v1/models')
  })

  it('needs a key, and says where to get one', () => {
    expect(nvidia.needsKey).toBe(true)
    expect(nvidia.keyLooksLike).toBe('nvapi-…')
    expect(nvidia.keyUrl).toContain('build.nvidia.com')
  })

  it('leaves the device but does NOT bill — the two facts that made them separate fields', () => {
    /*
     * The distinction this provider forced. The settings warning used to read
     * "and is billed to your account" for anything with `cloud: true`, which is
     * false here: NVIDIA's free tier charges nothing and rate-limits instead.
     * Telling somebody they are being charged for something free, on the screen
     * where they decide whether to use it, is not a small inaccuracy.
     */
    expect(nvidia.cloud).toBe(true)
    expect(nvidia.billed).toBe(false)
  })

  it('is the only free cloud provider, and every local one is free', () => {
    // Guards the guard: if `billed` ever gets copy-pasted as `true` everywhere,
    // the case above still passes on its own and this does not.
    const freeCloud = PROVIDERS.filter((p) => p.cloud && !p.billed).map((p) => p.id)
    expect(freeCloud).toEqual(['nvidia'])
    expect(PROVIDERS.filter((p) => !p.cloud).every((p) => !p.billed)).toBe(true)
  })

  it('gives every provider a key shape, so the placeholder is never another vendor’s', () => {
    for (const p of PROVIDERS) {
      if (p.needsKey) {
        expect(p.keyLooksLike, p.id).not.toBe('')
        expect(p.keyUrl, p.id).not.toBe('')
      }
    }
    // The specific lie this replaced: everyone showed OpenAI's prefix.
    expect(providerMeta('anthropic').keyLooksLike).toBe('sk-ant-…')
    expect(providerMeta('groq').keyLooksLike).toBe('gsk_…')
  })
})
