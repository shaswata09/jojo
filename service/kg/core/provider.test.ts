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
import { PROVIDERS, PROVIDER_IDS, contextOf, isLoopbackEndpoint, parseContextWindow, providerMeta } from './provider'


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

/**
 * The rule that decides whether the phone tells somebody their endpoint can
 * only work on the computer they typed it from.
 *
 * Both directions are costly and they are costly differently. A false negative
 * is the original bug — a silent connection failure that looks like a server
 * being off. A false positive warns somebody whose address is fine, and the
 * address most likely to be flagged wrongly is the mDNS name (`studio.local`)
 * that the warning itself recommends.
 */
describe('isLoopbackEndpoint', () => {
  it('catches the two shipped defaults', () => {
    // Ollama's, and the placeholder mobile's Settings screen shows.
    expect(isLoopbackEndpoint('http://localhost:11434')).toBe(true)
    expect(isLoopbackEndpoint('http://localhost:8000/v1')).toBe(true)
    // RFC 6761 reserves the whole `.localhost` name, and container and
    // reverse-proxy setups do hand out `something.localhost`. It resolves to
    // loopback wherever it resolves at all, so it is the same trap.
    expect(isLoopbackEndpoint('http://ollama.localhost:11434')).toBe(true)
  })

  it('catches the whole 127 block and IPv6 loopback, bracketed or not', () => {
    expect(isLoopbackEndpoint('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLoopbackEndpoint('http://127.0.0.2:1234/v1')).toBe(true)
    expect(isLoopbackEndpoint('http://[::1]:11434')).toBe(true)
    expect(isLoopbackEndpoint('http://::1')).toBe(true)
    expect(isLoopbackEndpoint('https://0:0:0:0:0:0:0:1/v1')).toBe(true)
  })

  it('leaves alone every address a phone can actually reach', () => {
    // The LAN address the warning tells people to use.
    expect(isLoopbackEndpoint('http://192.168.1.20:11434')).toBe(false)
    expect(isLoopbackEndpoint('http://10.116.34.124:8103/v1')).toBe(false)
    // mDNS — resolves to a real host on the network, and is the friendliest
    // answer to the warning. Flagging it would send people in a circle.
    expect(isLoopbackEndpoint('http://studio.local:1234/v1')).toBe(false)
    expect(isLoopbackEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isLoopbackEndpoint('')).toBe(false)
    // Not a loopback host merely for containing the word.
    expect(isLoopbackEndpoint('https://localhost.example.com/v1')).toBe(false)
  })
})

describe('parseContextWindow', () => {
  it('takes a plain number', () => {
    expect(parseContextWindow('32768')).toBe(32768)
    expect(parseContextWindow(' 8192 ')).toBe(8192)
  })

  it('treats empty as "use the default", not as an error', () => {
    /*
     * The distinction the whole field turns on. Empty is a choice: it plans
     * against the provider's default AND, for Ollama, sends no `num_ctx` at
     * all, which is what lets the server size itself rather than fail to load a
     * model at a number the user guessed.
     */
    expect(parseContextWindow('')).toBeUndefined()
    expect(parseContextWindow('   ')).toBeUndefined()
  })

  it('refuses a number that cannot be a window', () => {
    // Zero and negatives would be ignored by `contextOf` anyway, so storing
    // one leaves a field reading `0` beside an app planning against 4,096.
    expect(parseContextWindow('0')).toBeUndefined()
    expect(parseContextWindow('-4096')).toBeUndefined()
  })

  it('refuses anything that is not digits, rather than parsing a prefix', () => {
    /*
     * `Number.parseInt` is the trap: it reads `'8k'` as 8 and `'32,768'` as 32.
     * Both are things a person types, and both would silently plan a
     * conversation against a window four orders of magnitude too small.
     */
    expect(parseContextWindow('8k')).toBeUndefined()
    expect(parseContextWindow('32,768')).toBeUndefined()
    expect(parseContextWindow('1e5')).toBeUndefined()
    expect(parseContextWindow('four thousand')).toBeUndefined()
  })

  it('agrees with contextOf about what it produces', () => {
    const base = { provider: 'ollama' as const, endpoint: 'http://localhost:11434', model: 'x' }
    const typed = parseContextWindow('16384')
    expect(contextOf({ ...base, ...(typed === undefined ? {} : { contextWindow: typed }) })).toBe(16384)
    const empty = parseContextWindow('')
    expect(contextOf({ ...base, ...(empty === undefined ? {} : { contextWindow: empty }) })).toBe(
      providerMeta('ollama').defaultContext,
    )
  })
})
