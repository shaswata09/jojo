/**
 * Agreeing a key with a device that can see your screen.
 *
 * The transfer itself runs over the local network, which is not trusted: anyone
 * on the same wifi can watch it, and on a network they control, change it. The
 * screen is the channel that fixes that. A camera pointed at this device reads
 * something no attacker on the network can see, and everything below is built on
 * that one asymmetry.
 *
 * `beam.ts` carries the bytes. This decides what they are and what they prove.
 *
 * ## Why the code carries a secret and not only a public key
 *
 * The obvious construction is an ephemeral public key on screen, the other
 * device's public key back over the network, Diffie-Hellman, done. It does not
 * work on its own. The optical half is authentic — a network attacker cannot put
 * a key on this screen — but the RETURN half is not, so an attacker who can
 * intercept the LAN substitutes their own key going back and ends up sharing one
 * key with each device while reading everything in the middle.
 *
 * The usual defence is a Short Authentication String: both devices derive a few
 * digits from the transcript, show them, and the person checks the two screens
 * match — ZRTP's construction, and the same idea as a Signal safety number. It
 * works, and it costs a step where the person is asked to compare numbers and
 * where saying "yes" without looking silently removes the protection.
 *
 * There is no need for it here, because the optical channel is CONFIDENTIAL as
 * well as authentic. So the code carries a 32-byte secret alongside the public
 * key. The other device proves it read that secret, in the same message that
 * carries its own public key, and an attacker who never saw the screen cannot
 * produce the proof. The person points a camera and is done: no digits to
 * compare, no dialog whose safe answer is the one nobody reads.
 *
 * ## What is still true if someone photographs the screen
 *
 * They can pair. That is the honest limit of a scheme whose root of trust is
 * "was looking at this display", and it is the same limit a wifi QR code has.
 * Two things bound it: the offer is single-use and expires (`PAIRING_TTL_MS`),
 * and the key is agreed by Diffie-Hellman over EPHEMERAL keys with the secret
 * mixed in. So a recording of the network traffic is not retrospectively
 * readable by someone who later obtains the code — the private halves are gone.
 *
 * ## What is deliberately NOT here
 *
 * No identity, no long-term keys, no trust that outlives the transfer. Two
 * devices belonging to one person, standing in front of each other, for the
 * length of one handoff. A device paired yesterday is a stranger today, which is
 * the right answer for a feature whose whole scope is "move this across".
 */

import type { Secrets } from './secrets'

/** Marks the payload as a pairing offer. 'jp'. */
export const PAIRING_MAGIC = 0x6a70

/** Bumped when the offer layout changes in a way an older reader misreads. */
export const PAIRING_VERSION = 1

/** X25519 public keys, the pairing secret, and every derived tag. */
const KEY_BYTES = 32
/** Salt for the key schedule, fresh per offer. */
const NONCE_BYTES = 16

/** magic(2) version(1) publicKey(32) secret(32) nonce(16) */
export const OFFER_BYTES = 3 + KEY_BYTES + KEY_BYTES + NONCE_BYTES

/** magic(2) version(1) publicKey(32) confirmation(32) */
export const RESPONSE_BYTES = 3 + KEY_BYTES + KEY_BYTES

/**
 * How long an offer stays good.
 *
 * Long enough to pick up the other device and find the camera, short enough that
 * a code left on an unattended screen stops being a way in. Enforced by the
 * device that ISSUED the offer, against its own clock — see `completePairing`.
 * Putting a timestamp in the offer instead would make pairing fail whenever two
 * devices disagreed about the time, which they routinely do by minutes.
 */
export const PAIRING_TTL_MS = 3 * 60 * 1000

/** Domain separation, so these keys cannot collide with any other use. */
const LABEL = 'jojo/pairing/v1'

export type PairingOffer = {
  /** The issuing device's ephemeral public key. */
  publicKey: Uint8Array
  /** Read from the screen and never sent over the network. */
  secret: Uint8Array
  /** Salt for the key schedule. */
  nonce: Uint8Array
}

/**
 * What the issuing device keeps while it waits.
 *
 * Holds the private half, so it never leaves the device that made it, and the
 * instant the offer stops being valid.
 */
export type PairingState = {
  offer: PairingOffer
  /** Opaque to this module: a `CryptoKey` on web, bytes elsewhere. */
  privateKey: unknown
  expiresAt: number
}

/**
 * The keys a completed pairing yields.
 *
 * Directional, so the two ends never encrypt with the same key — reusing one key
 * both ways is how nonce collisions turn into a plaintext recovery.
 */
export type SessionKeys = {
  /** Encrypts offerer -> answerer. */
  offererToAnswerer: Uint8Array
  /** Encrypts answerer -> offerer. */
  answererToOfferer: Uint8Array
}

export type PairingFailure =
  /** Not a jojo pairing code — some other QR entirely. */
  | 'pairing/foreign'
  /** A jojo code from a version this build cannot read. */
  | 'pairing/version'
  /** The right shape but damaged, or the wrong length. */
  | 'pairing/malformed'
  /** The answering device could not prove it read the screen. */
  | 'pairing/unconfirmed'
  /** A public key the curve refuses — see `sharedSecret` below. */
  | 'pairing/bad-key'
  /** The offer was made too long ago. */
  | 'pairing/expired'

export type PairingResult<T> = { ok: true; value: T } | { ok: false; error: PairingFailure }

const fail = <T,>(error: PairingFailure): PairingResult<T> => ({ ok: false, error })
const done = <T,>(value: T): PairingResult<T> => ({ ok: true, value })

/**
 * Compares two tags without leaking where they differ.
 *
 * A `===` per byte returning early tells anyone who can time it how much of a
 * guess was right, which turns forging a 32-byte tag from impossible into 32
 * cheap guesses. Every byte is read, every time.
 */
export function sameTag(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i]! ^ b[i]!
  return diff === 0
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  let size = 0
  for (const part of parts) size += part.byteLength
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** ASCII only. Every label in this file is written here as a literal. */
const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f
  return out
}

/* --- the offer, which travels on the screen -------------------------------- */

export function encodeOffer(offer: PairingOffer): Uint8Array {
  const out = new Uint8Array(OFFER_BYTES)
  out[0] = (PAIRING_MAGIC >> 8) & 0xff
  out[1] = PAIRING_MAGIC & 0xff
  out[2] = PAIRING_VERSION
  out.set(offer.publicKey, 3)
  out.set(offer.secret, 3 + KEY_BYTES)
  out.set(offer.nonce, 3 + KEY_BYTES + KEY_BYTES)
  return out
}

export function decodeOffer(bytes: Uint8Array): PairingResult<PairingOffer> {
  if (bytes.byteLength < 3) return fail('pairing/foreign')
  if (((bytes[0]! << 8) | bytes[1]!) !== PAIRING_MAGIC) return fail('pairing/foreign')
  if (bytes[2] !== PAIRING_VERSION) return fail('pairing/version')
  // Exact, not "at least". A longer payload is not a longer offer, it is a
  // payload this build does not understand, and reading the first 83 bytes of it
  // would be guessing.
  if (bytes.byteLength !== OFFER_BYTES) return fail('pairing/malformed')
  return done({
    publicKey: bytes.slice(3, 3 + KEY_BYTES),
    secret: bytes.slice(3 + KEY_BYTES, 3 + KEY_BYTES + KEY_BYTES),
    nonce: bytes.slice(3 + KEY_BYTES + KEY_BYTES),
  })
}

/* --- the response, which travels over the network -------------------------- */

export function encodeResponse(publicKey: Uint8Array, confirmation: Uint8Array): Uint8Array {
  const out = new Uint8Array(RESPONSE_BYTES)
  out[0] = (PAIRING_MAGIC >> 8) & 0xff
  out[1] = PAIRING_MAGIC & 0xff
  out[2] = PAIRING_VERSION
  out.set(publicKey, 3)
  out.set(confirmation, 3 + KEY_BYTES)
  return out
}

export function decodeResponse(
  bytes: Uint8Array,
): PairingResult<{ publicKey: Uint8Array; confirmation: Uint8Array }> {
  if (bytes.byteLength < 3) return fail('pairing/foreign')
  if (((bytes[0]! << 8) | bytes[1]!) !== PAIRING_MAGIC) return fail('pairing/foreign')
  if (bytes[2] !== PAIRING_VERSION) return fail('pairing/version')
  if (bytes.byteLength !== RESPONSE_BYTES) return fail('pairing/malformed')
  return done({
    publicKey: bytes.slice(3, 3 + KEY_BYTES),
    confirmation: bytes.slice(3 + KEY_BYTES),
  })
}

/* --- the key schedule ------------------------------------------------------ */

/**
 * Everything both sides must agree on, in a fixed order.
 *
 * BOTH public keys, and this is not belt-and-braces. X25519 returns an all-zero
 * shared secret for a low-order peer key, and RFC 7748 §6.1 leaves rejecting
 * those optional — so a schedule resting on the shared secret alone would derive
 * the SAME key for every low-order key an attacker could send, and one
 * confirmation would then be good for all of them. Naming the keys in the
 * transcript is what keeps them distinguishable when the Diffie-Hellman does not
 * distinguish them.
 *
 * The nonce is deliberately NOT here. It is the HKDF salt, which binds it to
 * every derived byte already; a copy in the transcript changed no output and no
 * test could tell it apart, which is the definition of a line that should not be
 * in a file like this one.
 */
const transcript = (offer: PairingOffer, answererPublicKey: Uint8Array): Uint8Array =>
  concat(ascii(LABEL), new Uint8Array([PAIRING_VERSION]), offer.publicKey, answererPublicKey)

/**
 * Derives the four values a pairing produces.
 *
 * The Diffie-Hellman output and the screen secret are both fed in: the first is
 * what makes a recorded session unreadable later, the second is what makes the
 * exchange attributable to someone who saw the display. Either alone is weaker
 * than the pair, and an attacker has to defeat both.
 */
export async function deriveSession(
  secrets: Secrets,
  shared: Uint8Array,
  offer: PairingOffer,
  answererPublicKey: Uint8Array,
): Promise<{
  /** Proof the answerer read the screen. Travels on the network. */
  confirmation: Uint8Array
  /** Never leave this device. */
  keys: SessionKeys
}> {
  const info = transcript(offer, answererPublicKey)
  const ikm = concat(shared, offer.secret)
  // Three independent 32-byte values from one expansion. The first is SENT, so
  // it must not overlap the two that encrypt — publishing a session key as a
  // handshake tag would hand the transfer to anyone watching the network.
  const bits = await secrets.derive(ikm, offer.nonce, info, KEY_BYTES * 3)
  return {
    confirmation: bits.slice(0, KEY_BYTES),
    keys: {
      offererToAnswerer: bits.slice(KEY_BYTES, KEY_BYTES * 2),
      answererToOfferer: bits.slice(KEY_BYTES * 2),
    },
  }
}

/**
 * Diffie-Hellman, turned from a throw into a refusal.
 *
 * `Secrets.sharedSecret` REJECTS a low-order peer key rather than returning the
 * all-zero shared secret X25519 would otherwise produce — the strict side of
 * RFC 7748 §6.1, and the right side. But a peer key is the one input here an
 * attacker chooses freely: it arrives as 32 bytes over the network, from a
 * device that has not proved anything yet.
 *
 * So the throw has to become a value. Both callers are typed to return a
 * `PairingResult`, and neither guarded — a 67-byte reply built by hand would
 * have come back as an unhandled promise rejection rather than as a refusal,
 * taking down whatever was awaiting it instead of failing the pairing.
 *
 * Null rather than a thrown error, because refusing a key is the ordinary
 * outcome of being sent a bad one, not an exceptional condition.
 */
async function agree(
  secrets: Secrets,
  ours: unknown,
  theirs: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    return await secrets.sharedSecret(ours, theirs)
  } catch {
    return null
  }
}

/* --- the three steps ------------------------------------------------------- */

/**
 * Step one, on the device showing the animation.
 *
 * `now` is passed rather than read: `core` has no clock, for the same reason it
 * has no randomness. The returned state holds a private key and must not be
 * logged, persisted, or sent anywhere.
 */
export async function beginPairing(secrets: Secrets, now: number): Promise<PairingState> {
  const pair = await secrets.generateKeyPair()
  return {
    offer: {
      publicKey: pair.publicKey,
      secret: secrets.random(KEY_BYTES),
      nonce: secrets.random(NONCE_BYTES),
    },
    privateKey: pair.privateKey,
    expiresAt: now + PAIRING_TTL_MS,
  }
}

/**
 * Step two, on the device that read the code with its camera.
 *
 * Returns the bytes to send back over the network and the keys to use once the
 * other end accepts them. The keys are usable immediately here — this device has
 * already proved to itself that it holds the screen secret — but nothing should
 * be SENT with them until the offerer has answered, or a transfer would start to
 * a device that turned out not to be listening.
 */
export async function acceptPairing(
  secrets: Secrets,
  offerBytes: Uint8Array,
): Promise<PairingResult<{ response: Uint8Array; keys: SessionKeys }>> {
  const read = decodeOffer(offerBytes)
  if (!read.ok) return read

  const pair = await secrets.generateKeyPair()
  const shared = await agree(secrets, pair.privateKey, read.value.publicKey)
  if (shared === null) return fail('pairing/bad-key')
  const { confirmation, keys } = await deriveSession(secrets, shared, read.value, pair.publicKey)

  return done({ response: encodeResponse(pair.publicKey, confirmation), keys })
}

/**
 * Step three, back on the device that showed the animation.
 *
 * The confirmation is the whole point: it can only be produced by something that
 * read the secret off this screen, so a device that answers with its own key and
 * no proof is refused rather than paired with. This is what a machine sitting in
 * the middle of the network cannot do.
 */
export async function completePairing(
  secrets: Secrets,
  state: PairingState,
  responseBytes: Uint8Array,
  now: number,
): Promise<PairingResult<SessionKeys>> {
  // Checked before any key work: an expired offer is refused whatever it is
  // answered with, and a device that walked away should not have its private key
  // used on an attacker's public key at leisure.
  if (now >= state.expiresAt) return fail('pairing/expired')

  const read = decodeResponse(responseBytes)
  if (!read.ok) return read

  const shared = await agree(secrets, state.privateKey, read.value.publicKey)
  if (shared === null) return fail('pairing/bad-key')
  const { confirmation, keys } = await deriveSession(
    secrets,
    shared,
    state.offer,
    read.value.publicKey,
  )

  if (!sameTag(confirmation, read.value.confirmation)) return fail('pairing/unconfirmed')
  return done(keys)
}
