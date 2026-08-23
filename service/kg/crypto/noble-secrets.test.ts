/**
 * The one `Secrets` implementation, against the RFCs and against WebCrypto.
 *
 * `core/pairing.test.ts` fakes this port and says plainly that its fake is not
 * cryptography — it proves the protocol's shape and nothing about the
 * primitives. This is the other half.
 *
 * Three kinds of check, deliberately:
 *
 *   1. Published vectors (RFC 5869, RFC 7748). These cannot pass by being
 *      self-consistently wrong, which is the failure an implementation and its
 *      own test share when both are written from the same misreading.
 *   2. A differential run against WebCrypto, which is a completely independent
 *      implementation of the same primitives. It is a TEST dependency only —
 *      shipping both would reintroduce exactly the two-implementations risk this
 *      module exists to remove, and mobile has no WebCrypto to ship anyway.
 *   3. The handshake end to end on real keys.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  acceptPairing,
  beginPairing,
  completePairing,
  encodeOffer,
  encodeResponse,
} from '../core/pairing'
import { SecretsUnavailable, canPair, createSecrets } from './noble-secrets'

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (t: string) => new Uint8Array((t.match(/../g) ?? []).map((p) => parseInt(p, 16)))

/**
 * ASCII only, longhand — the same reason `core/backup.test.ts` writes its own.
 *
 * This project compiles with `lib: ["ES2023"]` and no ambient DOM, so
 * `TextEncoder` is not a name it can spell. Every string below is ASCII, so this
 * is exact.
 */
const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f
  return out
}
const unascii = (bytes: Uint8Array) => String.fromCharCode(...bytes)

const AT = 1_700_000_000_000
const secrets = createSecrets()

describe('against the published vectors', () => {
  it('derives HKDF-SHA256 exactly as RFC 5869 test case 1 says', async () => {
    const okm = await secrets.derive(
      unhex('0b'.repeat(22)),
      unhex('000102030405060708090a0b0c'),
      unhex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    )
    expect(hex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a' +
        '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
        '34007208d5b887185865',
    )
  })

  it('derives HKDF-SHA256 exactly as RFC 5869 test case 3 says (empty salt and info)', async () => {
    // The degenerate inputs, which are a different code path in most HKDFs and
    // the one an implementation is most likely to get wrong.
    const okm = await secrets.derive(
      unhex('0b'.repeat(22)),
      new Uint8Array(0),
      new Uint8Array(0),
      42,
    )
    expect(hex(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31' +
        'b8a11f5c5ee1879ec3454e5f3c738d2d' +
        '9d201395faa4b61a96c8',
    )
  })

  it('computes X25519 exactly as RFC 7748 section 6.1 says', async () => {
    // The canonical vector. `sharedSecret` takes raw private key bytes, so the
    // RFC's own keys go straight in — which is a thing the WebCrypto version of
    // this adapter could not do, because it would not import a private key.
    const alicePrivate = unhex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
    const alicePublic = unhex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')
    const bobPrivate = unhex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')
    const bobPublic = unhex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f')
    const expected = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'

    expect(hex(await secrets.sharedSecret(alicePrivate, bobPublic))).toBe(expected)
    expect(hex(await secrets.sharedSecret(bobPrivate, alicePublic))).toBe(expected)
  })

  it('refuses a low-order peer key rather than returning a shared zero', async () => {
    // RFC 7748 §6.1 leaves this check optional and this implementation takes the
    // strict side. It is the second barrier, not the first: `core/pairing.ts`
    // names both public keys in its transcript so that a degenerate secret
    // cannot collapse two sessions onto one key, and has its own test for it.
    const pair = await secrets.generateKeyPair()
    for (const lowOrder of [
      new Uint8Array(32),
      unhex('0100000000000000000000000000000000000000000000000000000000000000'),
      unhex('e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800'),
    ]) {
      await expect(secrets.sharedSecret(pair.privateKey, lowOrder)).rejects.toThrow()
    }
  })
})

/**
 * WebCrypto, reached deliberately and from a test only.
 *
 * `tsconfig.core.json` compiles this project with `lib: ["ES2023"]` and no
 * ambient DOM — the rule that keeps the shared layers portable, and the reason
 * `crypto.subtle` is not a name the implementation can spell. That is exactly
 * right for the implementation and exactly inconvenient here, where the point is
 * to check our primitives against a completely separate one.
 *
 * So the surface is declared locally and narrowly: five methods, opaque keys,
 * and nothing exported. It is the smallest hole that does the job, and it sits
 * on the test side of the boundary rather than widening the project's lib, which
 * would quietly grant `document` to every file in `core` as well.
 */
type OpaqueKey = { readonly __brand: unique symbol }
type WebSubtle = {
  importKey(
    format: string,
    data: ArrayBuffer,
    algorithm: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<OpaqueKey>
  exportKey(format: string, key: OpaqueKey): Promise<ArrayBuffer>
  generateKey(
    algorithm: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<{ publicKey: OpaqueKey; privateKey: OpaqueKey }>
  deriveBits(algorithm: unknown, key: OpaqueKey, length: number): Promise<ArrayBuffer>
  encrypt(algorithm: unknown, key: OpaqueKey, data: ArrayBuffer): Promise<ArrayBuffer>
  decrypt(algorithm: unknown, key: OpaqueKey, data: ArrayBuffer): Promise<ArrayBuffer>
}

const subtle = (globalThis as { crypto?: { subtle?: WebSubtle } }).crypto?.subtle

describe('against WebCrypto, which is an independent implementation', () => {
  // A test dependency only. Shipping both would be the two-implementations risk
  // the module header exists to argue against — and mobile has no WebCrypto.
  const buf = (view: Uint8Array): ArrayBuffer => {
    const out = new ArrayBuffer(view.byteLength)
    new Uint8Array(out).set(view)
    return out
  }

  it('has a WebCrypto to compare against, so the cases below are not vacuous', () => {
    // Guards the guard: every test in this block early-returns without one, and
    // a silently skipped differential suite is worse than no differential suite.
    expect(subtle).toBeDefined()
  })

  it('agrees with WebCrypto on HKDF across many inputs', async () => {
    for (let n = 0; n < 24; n += 1) {
      const ikm = secrets.random(1 + n)
      const salt = secrets.random(n)
      const info = secrets.random(n * 2)
      const bytes = 1 + n * 3

      const mine = await secrets.derive(ikm, salt, info, bytes)
      const base = await subtle!.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits'])
      const theirs = new Uint8Array(
        await subtle!.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
          base,
          bytes * 8,
        ),
      )
      expect(hex(mine), `n=${n}`).toBe(hex(theirs))
    }
  })

  it('agrees with WebCrypto on X25519', async () => {
    for (let i = 0; i < 8; i += 1) {
      const theirs = await subtle!.generateKey({ name: 'X25519' }, true, ['deriveBits'])
      const theirPublic = new Uint8Array(await subtle!.exportKey('raw', theirs.publicKey))
      const ours = await secrets.generateKeyPair()

      const fromNoble = await secrets.sharedSecret(ours.privateKey, theirPublic)
      const ourPublic = await subtle!.importKey(
        'raw',
        buf(ours.publicKey),
        { name: 'X25519' },
        false,
        [],
      )
      const fromWebCrypto = new Uint8Array(
        await subtle!.deriveBits({ name: 'X25519', public: ourPublic }, theirs.privateKey, 256),
      )
      expect(hex(fromNoble), `round ${i}`).toBe(hex(fromWebCrypto))
    }
  })

  it('produces AES-256-GCM that WebCrypto can open, and opens WebCrypto’s', async () => {
    for (let n = 0; n < 12; n += 1) {
      const key = secrets.random(32)
      const nonce = secrets.random(12)
      const message = secrets.random(n * 7)
      const aad = secrets.random(n)

      const mine = await secrets.seal(key, nonce, message, aad)
      const k = await subtle!.importKey('raw', buf(key), 'AES-GCM', false, ['encrypt', 'decrypt'])
      const opened = new Uint8Array(
        await subtle!.decrypt(
          { name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad) },
          k,
          buf(mine),
        ),
      )
      expect(hex(opened), `n=${n}`).toBe(hex(message))

      const theirs = new Uint8Array(
        await subtle!.encrypt(
          { name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad) },
          k,
          buf(message),
        ),
      )
      expect(hex(theirs), `n=${n}`).toBe(hex(mine))
      const back = await secrets.open(key, nonce, theirs, aad)
      expect(back).not.toBeNull()
      expect(hex(back!), `n=${n}`).toBe(hex(message))
    }
  })
})

describe('the primitives on their own terms', () => {
  it('round-trips AES-GCM and refuses anything altered', async () => {
    const key = secrets.random(32)
    const nonce = secrets.random(12)
    const message = ascii('every application, every note')
    const aad = ascii('jojo/transfer/1')

    const sealed = await secrets.seal(key, nonce, message, aad)
    expect(hex(sealed)).not.toContain(hex(message))
    expect(hex((await secrets.open(key, nonce, sealed, aad))!)).toBe(hex(message))

    // Each of the four ways it can be wrong, all returning null rather than
    // throwing or — far worse — returning plaintext.
    const flipped = sealed.slice()
    flipped[0]! ^= 0x01
    expect(await secrets.open(key, nonce, flipped, aad)).toBeNull()
    expect(await secrets.open(secrets.random(32), nonce, sealed, aad)).toBeNull()
    expect(await secrets.open(key, secrets.random(12), sealed, aad)).toBeNull()
    expect(await secrets.open(key, nonce, sealed, ascii('other'))).toBeNull()
  })

  it('carries the authentication tag, so the output is longer than the input', async () => {
    // GCM's tag is 16 bytes. Output the same length as the input would mean the
    // tag was dropped and nothing is authenticated.
    const sealed = await secrets.seal(
      secrets.random(32),
      secrets.random(12),
      new Uint8Array(100),
      new Uint8Array(0),
    )
    expect(sealed.byteLength).toBe(116)
  })

  it('produces random that is actually random', () => {
    const first = secrets.random(32)
    expect(first.byteLength).toBe(32)
    expect(hex(first)).not.toBe(hex(secrets.random(32)))
    expect(hex(first)).not.toBe(hex(new Uint8Array(32)))
  })

  it('gives every key pair a different key', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 16; i += 1) seen.add(hex((await secrets.generateKeyPair()).publicKey))
    expect(seen.size).toBe(16)
  })

  it('says up front whether this device can pair at all', () => {
    expect(canPair()).toBe(true)
  })

  it('says NO on a device with no secure random source, and refuses to guess', () => {
    /*
     * The case this machine cannot reach on its own, and the one that matters:
     * React Native 0.81.5 ships no `crypto` global at all, so on the phone this
     * is the starting position rather than an edge case.
     *
     * Both halves are asserted. `canPair` must say no BEFORE anything is on
     * screen, and `random` must THROW rather than fall back — `core/ref.ts`
     * falls back to `Math.random` for ids, which is right there and is a live
     * template for doing the catastrophic thing here. A key from `Math.random`
     * pairs successfully, transfers successfully, and is reproducible by anyone.
     */
    const source = globalThis.crypto as { getRandomValues: (a: Uint8Array) => Uint8Array }
    const stub = vi.spyOn(source, 'getRandomValues').mockImplementation(() => {
      throw new Error('no secure random source on this platform')
    })
    try {
      expect(canPair()).toBe(false)
      expect(() => createSecrets().random(32)).toThrow(SecretsUnavailable)
      expect(() => createSecrets().random(32)).toThrow(/secure random/i)
    } finally {
      stub.mockRestore()
    }
    expect(canPair()).toBe(true)
  })
})

describe('the whole handshake, on real keys', () => {
  it('leaves both devices holding the same session keys', async () => {
    const offerer = createSecrets()
    const answerer = createSecrets()

    const state = await beginPairing(offerer, AT)
    const seen = encodeOffer(state.offer)
    expect(seen.byteLength).toBe(83)

    const accepted = await acceptPairing(answerer, seen)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    const completed = await completePairing(offerer, state, accepted.value.response, AT + 1000)
    expect(completed.ok).toBe(true)
    if (!completed.ok) return

    expect(hex(completed.value.offererToAnswerer)).toBe(hex(accepted.value.keys.offererToAnswerer))
    expect(hex(completed.value.answererToOfferer)).toBe(hex(accepted.value.keys.answererToOfferer))
  })

  it('produces keys that actually decrypt each other', async () => {
    const offerer = createSecrets()
    const answerer = createSecrets()
    const state = await beginPairing(offerer, AT)
    const accepted = await acceptPairing(answerer, encodeOffer(state.offer))
    if (!accepted.ok) throw new Error('setup')
    const completed = await completePairing(offerer, state, accepted.value.response, AT + 1)
    if (!completed.ok) throw new Error('setup')

    const nonce = offerer.random(12)
    const aad = ascii('jojo/transfer/1')
    const sealed = await offerer.seal(
      completed.value.offererToAnswerer,
      nonce,
      ascii('the whole backup'),
      aad,
    )
    const opened = await answerer.open(accepted.value.keys.offererToAnswerer, nonce, sealed, aad)
    expect(opened).not.toBeNull()
    expect(unascii(opened!)).toBe('the whole backup')
  })

  it('refuses a device that answers without having seen the screen', async () => {
    const offerer = createSecrets()
    const attacker = createSecrets()
    const state = await beginPairing(offerer, AT)

    // The attacker has everything the network carries. The offer never crossed
    // the network, so it must guess the screen secret.
    const blind = { ...state.offer, secret: new Uint8Array(32) }
    const accepted = await acceptPairing(attacker, encodeOffer(blind))
    if (!accepted.ok) throw new Error('setup')

    const completed = await completePairing(offerer, state, accepted.value.response, AT + 1000)
    expect(completed.ok).toBe(false)
    if (!completed.ok) expect(completed.error).toBe('pairing/unconfirmed')
  })

  it('refuses a substituted public key carrying a genuine confirmation', async () => {
    const offerer = createSecrets()
    const answerer = createSecrets()
    const attacker = createSecrets()
    const state = await beginPairing(offerer, AT)
    const honest = await acceptPairing(answerer, encodeOffer(state.offer))
    if (!honest.ok) throw new Error('setup')

    const theirs = await attacker.generateKeyPair()
    const spliced = encodeResponse(theirs.publicKey, honest.value.response.slice(35))
    const completed = await completePairing(offerer, state, spliced, AT + 1000)
    expect(completed.ok).toBe(false)
    if (!completed.ok) expect(completed.error).toBe('pairing/unconfirmed')
  })
})
