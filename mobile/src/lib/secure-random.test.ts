/**
 * The guard that stops the phone pairing with predictable keys.
 *
 * Worth testing precisely because its failure is invisible. If the guard is
 * absent and the native module is missing, `react-native-get-random-values`
 * falls back to `Math.random()`, the handshake succeeds, the transfer completes,
 * and both screens look exactly right. There is no symptom to notice, so a test
 * is the only thing standing between that and shipping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** What the registry reports. Set per test before importing the module. */
let present = true

vi.mock('react-native', () => ({
  TurboModuleRegistry: {
    get: (name: string) => (name === 'RNGetRandomValues' && present ? {} : null),
  },
}))

/*
 * `globalThis.crypto` is a getter-only property on Node, so it cannot be
 * assigned back the obvious way — the first cut of this file threw
 * "Cannot set property crypto of #<Object> which has only a getter" in its own
 * teardown. `defineProperty` is how the platform allows it, and the descriptor
 * is captured rather than the value so a case that deletes the global can put
 * the real one back.
 */
const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

afterEach(() => {
  // Every case here replaces a global. Without this the next test FILE in the
  // run inherits a generator that throws.
  if (original) Object.defineProperty(globalThis, 'crypto', original)
  vi.resetModules()
})

const load = async () => (await import('@/lib/secure-random')).guardSecureRandom

describe('when the native random module is there', () => {
  it('leaves the platform generator alone', async () => {
    present = true
    const guard = await load()
    const before = globalThis.crypto.getRandomValues
    expect(guard()).toBe(true)
    expect(globalThis.crypto.getRandomValues).toBe(before)
    // And it still produces bytes rather than throwing.
    expect(globalThis.crypto.getRandomValues(new Uint8Array(8))).toHaveLength(8)
  })
})

describe('when it is not', () => {
  it('makes the generator ABSENT, not a function that throws', async () => {
    /*
     * The distinction this whole file turns on, and the bug the first version
     * shipped. A thrower passes `typeof x === 'function'`, which is how
     * `core/ref.ts` picks its random source — so it would be selected, and then
     * throw inside `uuidv7()`, and take every record creation down with it.
     */
    present = false
    const guard = await load()
    expect(guard()).toBe(false)
    expect(globalThis.crypto.getRandomValues).toBeUndefined()
    expect(typeof globalThis.crypto?.getRandomValues).not.toBe('function')
  })

  it('shadows an INHERITED generator, not just an own property', async () => {
    // `delete` removes an own property and reveals the prototype's. Node's
    // `Crypto` puts `getRandomValues` on the prototype, and a future React
    // Native may too — so a guard built on `delete` would silently do nothing
    // on exactly the platforms where it looked like it worked.
    present = false
    expect(Object.getPrototypeOf(globalThis.crypto)).not.toBeNull()
    ;(await load())()
    expect(globalThis.crypto.getRandomValues).toBeUndefined()
  })

  it('lets the app keep minting ids, which is the half that must NOT break', async () => {
    /*
     * The interaction the first version of this file got wrong, and the reason
     * a test of the guard alone was not enough.
     *
     * `core/ref.ts` falls back to `Math.random` when there is no secure source,
     * deliberately — ids only need to not collide. That fallback is reached by a
     * `typeof` check with no `try`/`catch`, so a THROWING generator would be
     * selected and would take `newNodeId()` and every record creation with it.
     * Absence is what leaves this path working.
     */
    present = false
    ;(await load())()
    const { newNodeId } = await import('@jojo/service/core/ref')
    const first = newNodeId('application', 1_700_000_000_000)
    const second = newNodeId('application', 1_700_000_000_000)
    expect(first).toMatch(/^app:/)
    // Two ids minted in the same millisecond must still differ — the fallback
    // has to actually produce varying bytes, not merely fail to throw.
    expect(first).not.toBe(second)
  })

  it('makes @noble refuse, which is the half that MUST break', async () => {
    // The other side of the same coin. `noble-secrets` reads `globalThis.crypto`
    // per call, so absence reaches it, and `canPair()` is what the UI asks
    // before offering to pair at all.
    present = false
    ;(await load())()
    const { canPair, createSecrets, SecretsUnavailable } = await import(
      '@jojo/service/crypto/noble-secrets'
    )
    expect(canPair()).toBe(false)
    expect(() => createSecrets().random(32)).toThrow(SecretsUnavailable)
  })

  it('works even when there is no crypto object at all, which is RN’s real state', async () => {
    // React Native 0.81.5 ships no `crypto` global. If the package failed to
    // install one, assigning onto it would throw a TypeError at startup rather
    // than degrading to "cannot pair".
    present = false
    // Deleted rather than set to undefined: React Native's state is a MISSING
    // property, and defining it as a read-only undefined would be testing an
    // artefact of the test rather than the platform.
    Reflect.deleteProperty(globalThis, 'crypto')
    const guard = await load()
    expect(() => guard()).not.toThrow()
    expect(() => globalThis.crypto.getRandomValues(new Uint8Array(4))).toThrow()
  })
})
