/**
 * The `Secrets` port, implemented once for every platform jojo runs on.
 *
 * ## Why this is not two adapters
 *
 * The pattern everywhere else in this codebase is a port in `core` and an
 * adapter per app, because the platforms genuinely differ: IndexedDB is not
 * AsyncStorage, and a `window` listener is not a `TextInput` focus. Cryptography
 * is the case where that pattern is actively harmful.
 *
 * Both ends of a pairing must derive byte-identical keys. Two implementations
 * that disagree anywhere — a curve, a key encoding, an HKDF argument order — do
 * not fail loudly. They fail at the confirmation, which is the same symptom as
 * being under attack, on a screen that cannot tell the difference. One
 * implementation removes that entire class, and this is pure JavaScript with no
 * platform surface, so there is nothing to adapt.
 *
 * ## Why not WebCrypto on web
 *
 * It was written that way first and it worked. Two things retired it:
 *
 * React Native 0.81.5 ships no `crypto` global at all — `globalThis.crypto` is
 * `undefined`, which is why `core/ref.ts` mints ids from `Math.random` on the
 * phone. So WebCrypto could never have been the mobile answer, and the phone is
 * the only device in this design with a camera.
 *
 * And WebCrypto's X25519 arrived in Safari 18.4, not Safari 17 as MDN's
 * browser-compat data records — caniuse derives from the same data, so anyone
 * checking gets the same wrong answer. A floor set from it would be about a year
 * and a half too low and would fail on real iOS devices. This has no such floor.
 *
 * What is given up is WebCrypto's non-extractable `CryptoKey`: private key
 * material here is ordinary JavaScript memory. For an ephemeral key that exists
 * for one transfer inside the page's own heap, that is a small loss — anything
 * able to read this heap is already running as the page.
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import type { KeyPair, Secrets } from '../core/secrets'

export class SecretsUnavailable extends Error {
  constructor(what: string, options?: { cause?: unknown }) {
    super(what, options)
    this.name = 'SecretsUnavailable'
  }
}

/** X25519 keys, HKDF output and AES-256 keys are all 32 bytes. */
const KEY_BYTES = 32
/** AES-GCM's standard nonce width. Anything else weakens the construction. */
export const NONCE_BYTES = 12

/**
 * Random bytes, or nothing.
 *
 * `@noble` sources these from `crypto.getRandomValues` and throws when there is
 * none, which is the behaviour this file wants and the opposite of
 * `core/ref.ts`, whose `Math.random` fallback is correct for ids and would be
 * catastrophic here: a key from `Math.random` produces a pairing that SUCCEEDS,
 * a transfer that completes, and bytes anyone can reproduce. There would be
 * nothing on either screen to suggest a problem, which is why the throw is
 * re-labelled rather than caught.
 */
function secureRandom(bytes: number): Uint8Array {
  try {
    return randomBytes(bytes)
  } catch (cause) {
    throw new SecretsUnavailable(
      'This device has no secure random number generator, so it cannot pair safely.',
      { cause },
    )
  }
}

export function createSecrets(): Secrets {
  return {
    random: secureRandom,

    async generateKeyPair(): Promise<KeyPair> {
      const privateKey = secureRandom(KEY_BYTES)
      return { publicKey: x25519.getPublicKey(privateKey), privateKey }
    },

    async sharedSecret(ours: unknown, theirs: Uint8Array): Promise<Uint8Array> {
      /*
       * `@noble` rejects low-order peer keys — the ones that make X25519 return
       * an all-zero shared secret — by throwing. RFC 7748 §6.1 leaves that check
       * optional, and this implementation takes the strict side.
       *
       * That is belt and braces rather than the defence: `core/pairing.ts` names
       * both public keys in its transcript precisely so a degenerate shared
       * secret cannot collapse two different keys onto one session, and it has a
       * test that pins it. Two independent barriers, because a peer key is the
       * one input here that an attacker chooses freely.
       */
      return x25519.getSharedSecret(ours as Uint8Array, theirs)
    },

    async derive(
      ikm: Uint8Array,
      salt: Uint8Array,
      info: Uint8Array,
      bytes: number,
    ): Promise<Uint8Array> {
      return hkdf(sha256, ikm, salt, info, bytes)
    },

    async seal(
      key: Uint8Array,
      nonce: Uint8Array,
      plaintext: Uint8Array,
      aad: Uint8Array,
    ): Promise<Uint8Array> {
      return gcm(key, nonce, aad).encrypt(plaintext)
    },

    async open(
      key: Uint8Array,
      nonce: Uint8Array,
      ciphertext: Uint8Array,
      aad: Uint8Array,
    ): Promise<Uint8Array | null> {
      try {
        return gcm(key, nonce, aad).decrypt(ciphertext)
      } catch {
        // A failed tag is the ordinary case for anything tampered with, not an
        // exception: the caller's job is to stop the transfer, not to handle a
        // throw. Null says "this did not come from the paired device" without a
        // stack trace implying a bug.
        return null
      }
    },
  }
}

/**
 * Whether this device can pair at all.
 *
 * Synchronous and cheap, because the only thing that can be missing is the
 * random source — the curve, the hash and the cipher are in this bundle. The
 * UI needs this where the button is, not after somebody has carried the other
 * device across the room.
 */
export function canPair(): boolean {
  try {
    secureRandom(1)
    return true
  } catch {
    return false
  }
}
