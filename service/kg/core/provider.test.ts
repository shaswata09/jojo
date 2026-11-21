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
import {
  PROVIDERS,
  PROVIDER_IDS,
  contextOf,
  isLoopbackEndpoint,
  isRetiredProvider,
  isRetiredServer,
  parseContextWindow,
  providerMeta,
  withoutRetired,
} from './provider'


describe('NVIDIA, retired (Q345)', () => {
  /*
   * build.nvidia.com was a provider here until the owner removed it: NVIDIA's
   * API Trial Terms allow internal evaluation only, and a job tracker sending
   * personal records is neither. Removing the row is half of it — an unknown id
   * reads as `openai-compatible`, so the other half is that a setting or a saved
   * row written before the removal does not quietly keep reaching NVIDIA.
   */
  it('is no longer offered, and no provider points at its API', () => {
    expect(PROVIDER_IDS as readonly string[]).not.toContain('nvidia')
    expect(PROVIDERS.some((p) => /nvidia/i.test(p.endpoint + p.label + p.keyUrl))).toBe(false)
    expect(isRetiredProvider('nvidia')).toBe(true)
  })

  it('drops stored settings that still name it, and keeps any other provider', () => {
    const empty = { provider: 'openai-compatible', endpoint: '', model: '' }
    const stale = { provider: 'nvidia', endpoint: 'https://integrate.api.nvidia.com/v1', model: 'm', apiKey: 'nvapi-x' }
    expect(withoutRetired(stale, empty)).toBe(empty)
    const groq = { provider: 'groq', endpoint: 'https://api.groq.com/openai/v1', model: 'm' }
    expect(withoutRetired(groq, empty)).toBe(groq)
  })

  it('marks its saved rows for removal, and leaves rows with no provider alone', () => {
    expect(isRetiredServer({ provider: 'nvidia' })).toBe(true)
    expect(isRetiredServer({ provider: 'openrouter' })).toBe(false)
    expect(isRetiredServer({})).toBe(false)
  })
})

describe('billing and keys', () => {
  it('bills for every cloud provider and for no local one', () => {
    // Separate fields, kept separate: a free hosted tier would be cloud and not
    // billed, and the warning copy reads `billed` rather than assuming it.
    expect(PROVIDERS.filter((p) => p.cloud).every((p) => p.billed)).toBe(true)
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
