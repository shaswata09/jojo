/**
 * Owner requests about which models the agent can run on, and how much of
 * their window it plans against.
 *
 * Q146 — Ollama and the cloud providers sit beside a local vLLM server as the
 *   agent's model, each cloud one asking for a key.
 * Q297 — a local OpenAI-compatible server (vLLM) is planned against 128k by
 *   default, not 32k, and the person's own number wins in either direction.
 */

import { describe, expect, it } from 'vitest'
import { PROVIDERS, PROVIDER_IDS, contextOf, providerMeta } from './provider'

describe('the providers the agent can run on', () => {
  it('offers Ollama and the cloud providers beside a local vLLM-style server', () => {
    for (const id of ['openai-compatible', 'ollama', 'anthropic', 'openai', 'nvidia']) {
      expect(PROVIDER_IDS as readonly string[], id).toContain(id)
    }
    expect(providerMeta('openai-compatible').cloud).toBe(false)
    expect(providerMeta('ollama').dialect).toBe('ollama')
  })

  it('asks every cloud provider for a key, and no local one', () => {
    for (const p of PROVIDERS) expect(p.needsKey, p.id).toBe(p.cloud)
  })
})

describe('the window a local server is planned against', () => {
  const vllm = { provider: 'openai-compatible' as const, endpoint: 'http://localhost:8000/v1', model: 'm' }

  it('defaults to 128k for a local OpenAI-compatible server', () => {
    expect(providerMeta('openai-compatible').defaultContext).toBe(131_072)
    expect(contextOf(vllm)).toBe(131_072)
  })

  it('takes the person’s own number, smaller or larger, over the default', () => {
    expect(contextOf({ ...vllm, contextWindow: 8_192 })).toBe(8_192)
    // A Gemma deployment serving 256k is not capped at the default.
    expect(contextOf({ ...vllm, contextWindow: 262_144 })).toBe(262_144)
  })
})
