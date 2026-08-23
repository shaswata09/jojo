/**
 * The pairing handshake.
 *
 * Weighted almost entirely towards REFUSAL. A pairing that fails is a person
 * pointing a camera again; a pairing that succeeds when it should not have is a
 * stranger on the wifi holding the key to everything the user owns, with nothing
 * on either screen to say so. So most of what follows is an attacker.
 *
 * ## About the fake
 *
 * `Secrets` is faked here, and the fake is NOT cryptography — its "shared
 * secret" is a hash of two public values and its "private key" is public. That
 * is deliberate and it is the only honest way to test this file: `core` has no
 * WebCrypto, and what is under test is the PROTOCOL — what is mixed into which
 * key, what is compared against what, what is refused and in which order.
 *
 * It buys nothing about the strength of X25519 or HKDF, and claims nothing. The
 * real primitives arrive through an adapter, and that adapter needs its own
 * tests against known-answer vectors. What the fake does have to be is sensitive
 * to every input byte, or the transcript-binding cases below would pass without
 * the transcript being bound at all.
 */

import { describe, expect, it } from 'vitest'
import type { KeyPair, Secrets } from './secrets'
import type { PairingOffer } from './pairing'
import { PULSE_FPS, createPulseReceiver, planPulse } from './pulse'
import {
  OFFER_BYTES,
  PAIRING_MAGIC,
  PAIRING_TTL_MS,
  PAIRING_VERSION,
  RESPONSE_BYTES,
  acceptPairing,
  beginPairing,
  deriveSession,
  completePairing,
  decodeOffer,
  encodeOffer,
  encodeResponse,
  sameTag,
} from './pairing'

/** A deterministic function of every byte it is given. Not a hash. */
const mix = (...parts: readonly Uint8Array[]): [number, number] => {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (const part of parts) {
    for (const byte of part) {
      a = Math.imul(a ^ byte, 0x01000193) >>> 0
      b = Math.imul(b + byte + 1, 0x85ebca6b) >>> 0
      b = (b ^ (b >>> 13)) >>> 0
    }
    a = Math.imul(a ^ part.byteLength, 0xc2b2ae35) >>> 0
  }
  return [a, b]
}

const stretch = (seed: [number, number], bytes: number): Uint8Array => {
  let [x, y] = seed
  const out = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i += 1) {
    x ^= (x << 13) >>> 0
    x = (x ^ (x >>> 17)) >>> 0
    x = (x ^ ((x << 5) >>> 0)) >>> 0
    y = Math.imul(y ^ x, 0x27d4eb2d) >>> 0
    out[i] = (y >>> 24) & 0xff
  }
  return out
}

/**
 * A `Secrets` that is deterministic, commutative, and not remotely secret.
 *
 * `random` counts, so every value in a test is reproducible and two runs of the
 * same test agree. The "key pair" has a public half equal to its private half,
 * which makes `sharedSecret` commutative the way a real Diffie-Hellman is —
 * enough to exercise "both sides reach the same key" and nothing more.
 */
function fakeSecrets(seed = 1): Secrets & { issued: () => number } {
  let counter = seed
  return {
    issued: () => counter,
    random(bytes) {
      counter += 1
      return stretch([counter, seed], bytes)
    },
    async generateKeyPair(): Promise<KeyPair> {
      counter += 1
      const material = stretch([counter * 7919, seed], 32)
      return { publicKey: material, privateKey: material }
    },
    async sharedSecret(ours, theirs) {
      const a = ours as Uint8Array
      const b = theirs
      // Ordered, so the two ends agree regardless of who asks.
      const [lo, hi] = sameTag(a, b) || a[0]! <= b[0]! ? [a, b] : [b, a]
      return stretch(mix(lo, hi), 32)
    },
    async derive(ikm, salt, info, bytes) {
      return stretch(mix(ikm, salt, info), bytes)
    },
    async seal(key, nonce, plaintext, aad) {
      const pad = stretch(mix(key, nonce, aad), plaintext.byteLength)
      const out = new Uint8Array(plaintext.byteLength)
      for (let i = 0; i < plaintext.byteLength; i += 1) out[i] = plaintext[i]! ^ pad[i]!
      return out
    },
    async open(key, nonce, ciphertext, aad) {
      return this.seal(key, nonce, ciphertext, aad)
    },
  }
}

const AT = 1_700_000_000_000

describe('a pairing that works', () => {
  it('leaves both devices holding the same two keys', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const accepted = await acceptPairing(secrets, encodeOffer(state.offer))
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    const completed = await completePairing(secrets, state, accepted.value.response, AT + 1000)
    expect(completed.ok).toBe(true)
    if (!completed.ok) return

    expect([...completed.value.offererToAnswerer]).toEqual([...accepted.value.keys.offererToAnswerer])
    expect([...completed.value.answererToOfferer]).toEqual([...accepted.value.keys.answererToOfferer])
  })

  it('gives each direction its own key', async () => {
    // One key both ways means both ends choose nonces from the same space under
    // the same key, and a repeat there is not a degraded transfer, it is the
    // plaintext.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const accepted = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!accepted.ok) throw new Error('setup')
    expect([...accepted.value.keys.offererToAnswerer]).not.toEqual([
      ...accepted.value.keys.answererToOfferer,
    ])
  })

  it('never puts the screen secret on the network', async () => {
    // The one value that must exist only in photons. If it is ever in the
    // response, the whole construction collapses to "trust the LAN".
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const accepted = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!accepted.ok) throw new Error('setup')
    const wire = [...accepted.value.response].join(',')
    expect(wire).not.toContain([...state.offer.secret].join(','))
  })

  it('gives two pairings entirely different keys', async () => {
    const secrets = fakeSecrets()
    const first = await beginPairing(secrets, AT)
    const second = await beginPairing(secrets, AT)
    expect([...first.offer.secret]).not.toEqual([...second.offer.secret])
    expect([...first.offer.nonce]).not.toEqual([...second.offer.nonce])

    const a = await acceptPairing(secrets, encodeOffer(first.offer))
    const b = await acceptPairing(secrets, encodeOffer(second.offer))
    if (!a.ok || !b.ok) throw new Error('setup')
    expect([...a.value.keys.offererToAnswerer]).not.toEqual([...b.value.keys.offererToAnswerer])
  })

  it('fits in ten frames of the animation, which is about a second', async () => {
    // The reason the handshake goes optically and the backup does not. An offer
    // is 83 bytes and a frame of the animation carries nine, so the key is said
    // in about a second and then said again for as long as the screen is up.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const plan = planPulse(encodeOffer(state.offer))
    expect(OFFER_BYTES).toBe(83)
    expect(plan.total).toBe(10)
    // At the rate the sender actually shows them, not a rate nobody uses. Under
    // two seconds is the number that decides whether this is worth doing.
    expect(plan.lapSeconds(PULSE_FPS)).toBeCloseTo(1.67, 2)
    expect(plan.lapSeconds(PULSE_FPS)).toBeLessThan(2)
  })

  it('survives the animation being read with frames missed', async () => {
    // What a hand-held camera actually does. The frames cycle, so a miss costs
    // part of another pass and never a restart.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const payload = encodeOffer(state.offer)
    const plan = planPulse(payload)
    const receiver = createPulseReceiver()

    for (let i = 0; i < plan.total; i += 1) if (i % 2 === 0) receiver.accept(plan.frames[i]!)
    expect(receiver.progress().complete).toBe(false)
    for (const frame of plan.frames) receiver.accept(frame)

    const read = receiver.payload()
    expect(read).not.toBeNull()
    const accepted = await acceptPairing(secrets, read!.subarray(0, payload.byteLength))
    expect(accepted.ok).toBe(true)
  })
})

describe('the attacker in the middle of the network', () => {
  it('cannot pair by answering with its own key', async () => {
    // The whole reason the code carries a secret. The attacker sees the response
    // and can send any public key it likes; what it cannot do is produce a
    // confirmation, because that needs the value that only ever existed on the
    // screen.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)

    const attacker = await secrets.generateKeyPair()
    const forged = encodeResponse(attacker.publicKey, secrets.random(32))

    const completed = await completePairing(secrets, state, forged, AT + 1000)
    expect(completed.ok).toBe(false)
    if (!completed.ok) expect(completed.error).toBe('pairing/unconfirmed')
  })

  it('cannot pair by guessing the secret', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)

    // Everything the attacker legitimately has: the offer's PUBLIC key and
    // nonce, which it could learn from the network. Not the secret.
    const guessed = { ...state.offer, secret: new Uint8Array(32) }
    const accepted = await acceptPairing(secrets, encodeOffer(guessed))
    if (!accepted.ok) throw new Error('setup')

    const completed = await completePairing(secrets, state, accepted.value.response, AT + 1000)
    expect(completed.ok).toBe(false)
    if (!completed.ok) expect(completed.error).toBe('pairing/unconfirmed')
  })

  it('cannot replay a confirmation from an earlier pairing', async () => {
    // Both pairings are between the same two devices with the same fake keys, so
    // only the transcript separates them. If the nonce were left out of the key
    // schedule this would pass and a captured handshake would be reusable.
    const secrets = fakeSecrets()
    const first = await beginPairing(secrets, AT)
    const captured = await acceptPairing(secrets, encodeOffer(first.offer))
    if (!captured.ok) throw new Error('setup')

    const second = await beginPairing(secrets, AT)
    const replayed = await completePairing(secrets, second, captured.value.response, AT + 1000)
    expect(replayed.ok).toBe(false)
    if (!replayed.ok) expect(replayed.error).toBe('pairing/unconfirmed')
  })

  it('cannot swap the answering key after the confirmation was made', async () => {
    // The confirmation covers the answerer's public key, so lifting a genuine
    // tag onto a different key does not carry.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const honest = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!honest.ok) throw new Error('setup')

    const attacker = await secrets.generateKeyPair()
    const spliced = encodeResponse(attacker.publicKey, honest.value.response.slice(3 + 32))

    const completed = await completePairing(secrets, state, spliced, AT + 1000)
    expect(completed.ok).toBe(false)
    if (!completed.ok) expect(completed.error).toBe('pairing/unconfirmed')
  })

  it('cannot flip a single bit of the confirmation', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const honest = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!honest.ok) throw new Error('setup')

    for (const at of [3 + 32, 3 + 32 + 15, RESPONSE_BYTES - 1]) {
      const tampered = honest.value.response.slice()
      tampered[at]! ^= 0x01
      const completed = await completePairing(secrets, state, tampered, AT + 1000)
      expect(completed.ok, `byte ${at}`).toBe(false)
    }
  })
})

describe('an offer that has gone stale', () => {
  it('is refused once its time is up', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const accepted = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!accepted.ok) throw new Error('setup')

    expect(state.expiresAt).toBe(AT + PAIRING_TTL_MS)
    const late = await completePairing(secrets, state, accepted.value.response, state.expiresAt)
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.error).toBe('pairing/expired')

    // And a moment earlier it is still good, so the boundary is where it says.
    const just = await completePairing(secrets, state, accepted.value.response, state.expiresAt - 1)
    expect(just.ok).toBe(true)
  })

  it('is refused BEFORE the response is looked at', async () => {
    // Order matters: an expired offer must not have its private key put to work
    // on whatever an attacker sends, and the failure a caller sees should say
    // "too late" rather than "that did not verify".
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const rubbish = new Uint8Array(RESPONSE_BYTES)
    const late = await completePairing(secrets, state, rubbish, AT + PAIRING_TTL_MS + 1)
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.error).toBe('pairing/expired')
  })

  it('carries no timestamp on the wire, so the two clocks need not agree', async () => {
    // Devices disagree about the time by minutes routinely. Expiry is the
    // issuer's own business, measured against its own clock, and the answering
    // device is never asked what time it thinks it is.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const encoded = encodeOffer(state.offer)
    expect(encoded.byteLength).toBe(OFFER_BYTES)

    // Every byte after the header is accounted for by the three secret values,
    // so there is nowhere for a clock reading to be hiding.
    const body = [...encoded.slice(3)]
    const parts = [...state.offer.publicKey, ...state.offer.secret, ...state.offer.nonce]
    expect(body).toEqual(parts)
  })
})

describe('reading a code that is not the one we wanted', () => {
  it('says foreign for something that is not ours at all', async () => {
    const secrets = fakeSecrets()
    for (const bad of [
      new Uint8Array(0),
      new Uint8Array(2),
      new Uint8Array([...'https://example.com'].map((c) => c.charCodeAt(0))),
    ]) {
      const read = await acceptPairing(secrets, bad)
      expect(read.ok, String(bad.byteLength)).toBe(false)
      if (!read.ok) expect(read.error).toBe('pairing/foreign')
    }
  })

  it('says version for a code from a newer jojo', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const future = encodeOffer(state.offer)
    future[2] = PAIRING_VERSION + 1
    const read = await acceptPairing(secrets, future)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('pairing/version')
  })

  it('refuses a length that is not exactly right, in either direction', async () => {
    // Not "at least". A longer payload is a payload this build does not
    // understand, and reading its first 83 bytes would be a guess about what the
    // rest meant.
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const good = encodeOffer(state.offer)

    const short = good.slice(0, OFFER_BYTES - 1)
    const long = new Uint8Array(OFFER_BYTES + 1)
    long.set(good)

    for (const [bytes, what] of [
      [short, 'short'],
      [long, 'long'],
    ] as const) {
      const read = await acceptPairing(secrets, bytes)
      expect(read.ok, what).toBe(false)
      if (!read.ok) expect(read.error, what).toBe('pairing/malformed')
    }
  })

  it('refuses a response whose length is not exactly right', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const honest = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!honest.ok) throw new Error('setup')

    const long = new Uint8Array(RESPONSE_BYTES + 1)
    long.set(honest.value.response)
    for (const [bytes, what] of [
      [honest.value.response.slice(0, RESPONSE_BYTES - 1), 'short'],
      [long, 'long'],
    ] as const) {
      const read = await completePairing(secrets, state, bytes, AT + 1000)
      expect(read.ok, what).toBe(false)
      if (!read.ok) expect(read.error, what).toBe('pairing/malformed')
    }
  })

  it('round-trips an offer through the screen and back', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const read = decodeOffer(encodeOffer(state.offer))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect([...read.value.publicKey]).toEqual([...state.offer.publicKey])
    expect([...read.value.secret]).toEqual([...state.offer.secret])
    expect([...read.value.nonce]).toEqual([...state.offer.nonce])
  })

  it('marks itself so a jojo code is not mistaken for another app’s', () => {
    expect(PAIRING_MAGIC).toBe(0x6a70)
  })
})

describe('what each input to the key schedule is actually doing', () => {
  /**
   * X25519 hands back an all-zero shared secret for a low-order peer key, and
   * RFC 7748 §6.1 makes rejecting those optional rather than required. So the
   * schedule has to stay sound when the Diffie-Hellman contributes nothing.
   */
  const DEGENERATE = new Uint8Array(32)

  const offerFor = (secrets: Secrets): PairingOffer => ({
    publicKey: secrets.random(32),
    secret: secrets.random(32),
    nonce: secrets.random(16),
  })

  it('tells two answering keys apart even when Diffie-Hellman degenerates', async () => {
    // Without both public keys in the transcript, every low-order key would
    // derive the same session and one confirmation would be good for all of
    // them. This is the case the transcript exists for.
    const secrets = fakeSecrets()
    const offer = offerFor(secrets)
    const first = await deriveSession(secrets, DEGENERATE, offer, secrets.random(32))
    const second = await deriveSession(secrets, DEGENERATE, offer, secrets.random(32))
    expect([...first.confirmation]).not.toEqual([...second.confirmation])
    expect([...first.keys.offererToAnswerer]).not.toEqual([...second.keys.offererToAnswerer])
  })

  it('carries the Diffie-Hellman output into the keys', async () => {
    // What forward secrecy rests on, and the one property here a behavioural
    // test cannot show directly: a recording of the network is unreadable later
    // because the ephemeral private halves are gone. What CAN be pinned is that
    // the shared secret reaches the keys at all — drop it and the schedule
    // becomes a function of the screen code alone, which a photograph replays.
    const secrets = fakeSecrets()
    const offer = offerFor(secrets)
    const answerer = secrets.random(32)
    const first = await deriveSession(secrets, secrets.random(32), offer, answerer)
    const second = await deriveSession(secrets, secrets.random(32), offer, answerer)
    expect([...first.keys.offererToAnswerer]).not.toEqual([...second.keys.offererToAnswerer])
  })

  it('carries the screen secret into the keys', async () => {
    const secrets = fakeSecrets()
    const base = offerFor(secrets)
    const shared = secrets.random(32)
    const answerer = secrets.random(32)
    const first = await deriveSession(secrets, shared, base, answerer)
    const second = await deriveSession(
      secrets,
      shared,
      { ...base, secret: secrets.random(32) },
      answerer,
    )
    expect([...first.keys.offererToAnswerer]).not.toEqual([...second.keys.offererToAnswerer])
  })

  it('carries the nonce into the keys, via the salt', async () => {
    // The nonce is not in the transcript — it is the HKDF salt. This is what
    // says that placement still binds it, and it is what would fail if an
    // adapter ignored the salt argument.
    const secrets = fakeSecrets()
    const base = offerFor(secrets)
    const shared = secrets.random(32)
    const answerer = secrets.random(32)
    const first = await deriveSession(secrets, shared, base, answerer)
    const second = await deriveSession(
      secrets,
      shared,
      { ...base, nonce: secrets.random(16) },
      answerer,
    )
    expect([...first.confirmation]).not.toEqual([...second.confirmation])
    expect([...first.keys.offererToAnswerer]).not.toEqual([...second.keys.offererToAnswerer])
  })

  it('tells two OFFERING keys apart when Diffie-Hellman degenerates', async () => {
    // The mirror of the case above. Both public keys are named in the transcript
    // for the same reason, and a test for only one of them leaves the other free
    // to be deleted.
    const secrets = fakeSecrets()
    const base = offerFor(secrets)
    const answerer = secrets.random(32)
    const first = await deriveSession(secrets, DEGENERATE, base, answerer)
    const second = await deriveSession(
      secrets,
      DEGENERATE,
      { ...base, publicKey: secrets.random(32) },
      answerer,
    )
    expect([...first.confirmation]).not.toEqual([...second.confirmation])
  })

  it('has not changed shape, which is what makes two builds interoperable', async () => {
    /*
     * A known-answer test over the FAKE, which pins the schedule's structure
     * rather than any cryptography: what is concatenated, in what order, with
     * what label, and which 32 bytes become which value.
     *
     * It earns its place twice. Some inputs cannot be caught any other way — the
     * domain-separation label is a constant, so dropping it shifts every output
     * uniformly and no differential test can see it, and mutation testing showed
     * exactly that. And this is a WIRE protocol: two jojo builds that disagree
     * about the schedule do not fail loudly, they fail at the confirmation with
     * nothing on screen to say why.
     *
     * If you are here because this failed: you changed the handshake. That is
     * allowed, and it means bumping PAIRING_VERSION so an older build refuses
     * the code instead of half-reading it. Update these bytes in the same commit.
     */
    const fixed = {
      async derive(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bytes: number) {
        return stretch(mix(ikm, salt, info), bytes)
      },
    } as unknown as Secrets
    const fill = (n: number, v: number) => new Uint8Array(n).fill(v)
    const out = await deriveSession(
      fixed,
      fill(32, 0x11),
      { publicKey: fill(32, 0x22), secret: fill(32, 0x33), nonce: fill(16, 0x44) },
      fill(32, 0x55),
    )
    const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
    expect(hex(out.confirmation)).toBe(
      '8a92a09854908806a83eb1b42828e3b2e0b9fa4598fefad54548c444c662d56f',
    )
    expect(hex(out.keys.offererToAnswerer)).toBe(
      'd7f4e19592d3b0d152f3c5270e2fca7d8858e1503f6a5df51fa024a442d6270b',
    )
    expect(hex(out.keys.answererToOfferer)).toBe(
      '079680d67d8cbe9f7b0ee613d776fb93b1d0895b25c0e40665010a2c477005ef',
    )
  })

  it('never publishes a session key as the confirmation', async () => {
    // The confirmation goes on the untrusted network. If it overlapped either
    // encryption key, the transfer would be readable by anyone who watched the
    // handshake — the failure would be invisible, because pairing would work.
    const secrets = fakeSecrets()
    const offer = offerFor(secrets)
    const { confirmation, keys } = await deriveSession(
      secrets,
      secrets.random(32),
      offer,
      secrets.random(32),
    )
    expect([...confirmation]).not.toEqual([...keys.offererToAnswerer])
    expect([...confirmation]).not.toEqual([...keys.answererToOfferer])
    expect([...keys.offererToAnswerer]).not.toEqual([...keys.answererToOfferer])
  })
})

describe('comparing tags without saying where they differ', () => {
  it('agrees only when every byte agrees', () => {
    expect(sameTag(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
    expect(sameTag(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    // The first byte differing must not be treated differently from the last.
    expect(sameTag(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(sameTag(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })

  it('refuses a different length rather than comparing a prefix', () => {
    expect(sameTag(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(sameTag(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false)
  })

  it('has no early exit — which behaviour alone cannot show', () => {
    /*
     * This one reads the source, which is unusual and deliberate.
     *
     * Constant-time-ness is invisible to a behavioural test: an implementation
     * that returns at the first differing byte gives byte-identical answers to
     * every input, and only a clock can tell them apart. A timing assertion
     * would be flaky in CI and would still be measuring the wrong machine. Under
     * mutation testing the early-exit rewrite survived every other case in this
     * file, so without this there is nothing at all standing between a
     * well-meant "optimisation" and a 32-byte tag that can be guessed a byte at
     * a time.
     *
     * Two returns: the length guard, and the fold's result. A third means
     * somebody put one inside the loop. If this fires after an innocent
     * refactor, check that the loop still touches every byte before changing
     * the number.
     */
    const source = sameTag.toString()
    expect((source.match(/\breturn\b/g) ?? []).length).toBe(2)
    expect(source).toContain('|=')

    const a = new Uint8Array(1024).fill(7)
    const b = a.slice()
    b[0] = 8
    expect(sameTag(a, b)).toBe(false)
    expect(sameTag(a, a.slice())).toBe(true)
  })
})

describe('a public key the curve refuses', () => {
  /**
   * X25519 returns an all-zero shared secret for a low-order peer key, and
   * `Secrets` takes the strict side of RFC 7748 §6.1 by throwing instead.
   *
   * That throw has to become a refusal, because a peer key is the one input
   * here an attacker picks freely: it arrives as 32 bytes over the network from
   * a device that has proved nothing. Both entry points are typed to return a
   * `PairingResult`, and before this neither guarded — so a reply built by hand
   * came back as an unhandled promise rejection and took down whatever was
   * awaiting it, rather than failing the pairing.
   */
  const refusing = (): Secrets => {
    const real = fakeSecrets()
    return {
      ...real,
      sharedSecret: async () => {
        throw new Error('low-order point')
      },
    }
  }

  it('refuses rather than throwing, on the answering side', async () => {
    const state = await beginPairing(fakeSecrets(), AT)
    const read = await acceptPairing(refusing(), encodeOffer(state.offer))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('pairing/bad-key')
  })

  it('refuses rather than throwing, on the offering side', async () => {
    const secrets = fakeSecrets()
    const state = await beginPairing(secrets, AT)
    const honest = await acceptPairing(secrets, encodeOffer(state.offer))
    if (!honest.ok) throw new Error('setup')

    const read = await completePairing(refusing(), state, honest.value.response, AT + 1000)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('pairing/bad-key')
  })

  it('does not reject the promise, which is the actual failure being fixed', async () => {
    const state = await beginPairing(fakeSecrets(), AT)
    await expect(acceptPairing(refusing(), encodeOffer(state.offer))).resolves.toBeDefined()
  })
})
