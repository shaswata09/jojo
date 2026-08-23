/**
 * L1 — the Secrets port: the cryptographic primitives `core` may not reach for.
 *
 * L1 because it is IN `kg/core`, which every guard calls L1, and a header that
 * disagrees with the directory it sits in is worse than no header: the layer
 * labels are how somebody decides what a file may import, and `check-layers`
 * reads the path rather than the comment. The old L4 was copied from a port
 * that genuinely lives at the application edge; this one is a type declaration
 * that core itself depends on.
 *
 * Same rule as `Driver` and `Host`, for a sharper reason. `core` compiles with
 * `lib: ["ES2023"]` and no ambient DOM, so `crypto.subtle` is not declared here
 * — but even if it were, the three platforms genuinely disagree. Browsers have
 * WebCrypto; React Native has no `crypto.subtle` at all without a polyfill, and
 * which curves are available differs between engines and versions. A pairing
 * protocol that assumed one of them would be a `ReferenceError` on the others,
 * discovered at the moment somebody tried to move their data.
 *
 * ## Why this is not `globalThis.crypto`
 *
 * `core/ref.ts` reads WebCrypto straight off `globalThis` and falls back to
 * `Math.random`, with the note that "ids only need to not collide, they are not
 * a secret". Both halves of that are wrong for this file. A key that fell back
 * to `Math.random` would be predictable, and predictable is indistinguishable
 * from working: pairing would succeed, the transfer would run, and the bytes
 * would be readable by anyone who cared to reproduce the sequence. There is no
 * fallback in this interface, and an adapter that cannot provide these MUST
 * throw rather than approximate them. A feature that refuses to start is a
 * problem someone can see.
 *
 * ## Why the private key is `unknown`
 *
 * Because a browser's is a non-extractable `CryptoKey` — the point of it is that
 * its bytes cannot be read, including by us — and another platform's is bytes.
 * Typing it as `Uint8Array` would force every adapter to export key material it
 * should not export, to satisfy a type. It goes in one end of `sharedSecret` and
 * comes from `generateKeyPair`, and nothing in between needs to look inside.
 */

export type KeyPair = {
  /** X25519 public key, 32 bytes, safe to show on a screen. */
  publicKey: Uint8Array
  /** Opaque and platform-owned. Never logged, persisted, or transmitted. */
  privateKey: unknown
}

export interface Secrets {
  /**
   * Cryptographically secure random bytes.
   *
   * Must throw rather than return anything a `Math.random` could have produced.
   */
  random(bytes: number): Uint8Array

  /**
   * A fresh ephemeral X25519 key pair, discarded after one pairing.
   *
   * X25519 rather than P-256 because the public key is 32 bytes against 65, and
   * this key has to fit on a screen next to a 32-byte secret and a nonce. An
   * adapter on a platform without X25519 should throw from here rather than
   * silently substitute a curve — the two ends would then derive different
   * secrets and fail at the confirmation, which is a far harder thing to
   * diagnose than a refusal at the start.
   */
  generateKeyPair(): Promise<KeyPair>

  /** The X25519 shared secret. 32 bytes. */
  sharedSecret(ours: unknown, theirs: Uint8Array): Promise<Uint8Array>

  /**
   * HKDF over SHA-256: extract with `salt`, expand with `info`.
   *
   * One call rather than separate extract and expand, because that is the shape
   * WebCrypto offers and splitting it would make every adapter reassemble it.
   */
  derive(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array>

  /**
   * AES-256-GCM. `nonce` must never repeat under one key — see how the transfer
   * counts them.
   *
   * `aad` is authenticated but not encrypted: framing a receiver must be able to
   * trust before it has decrypted anything.
   */
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>

  /** Returns null on any authentication failure, rather than throwing. */
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array | null>
}
