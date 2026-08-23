/**
 * The whole journey, on real cryptography, with nothing faked but the wire.
 *
 * Every other test in this codebase checks one layer. This one checks that the
 * layers actually compose — that a backup on one device becomes the same bytes
 * on another, having gone through the animation that carries the key, a key
 * agreement, and an encrypted stream — with two independent `Secrets` instances
 * standing in for two independent devices.
 *
 * It exists because every individual piece passing is not the same claim as the
 * feature working, and this codebase has already shipped one bug that only
 * appeared where two correct-looking layers met (see `mobile/src/lib/secure-random.ts`).
 *
 * The only stand-in is the byte channel: an array. That is honest, because the
 * protocol's own assumption about the channel is exactly "ordered and reliable"
 * and nothing else — a socket and a data channel both are, and neither is
 * trusted for anything more. What a real socket adds is failure modes, not
 * semantics.
 */

import { describe, expect, it } from 'vitest'
import {
  acceptPairing,
  beginPairing,
  completePairing,
  encodeOffer,
  type SessionKeys,
} from '../core/pairing'
import { createPulseReceiver, planPulse } from '../core/pulse'
import { createConvoyReceiver, planConvoy } from '../core/convoy'
import { createSecrets } from './noble-secrets'

const AT = 1_700_000_000_000

/** Something the size and shape of a real records-only backup. */
const backupBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n)
  let x = 20260823
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out[i] = (x >>> 16) & 0xff
  }
  return out
}

/** Ships a whole payload through a convoy and returns what came out the far end. */
async function ferry(
  from: ReturnType<typeof createSecrets>,
  to: ReturnType<typeof createSecrets>,
  key: Uint8Array,
  payload: Uint8Array,
  chunkBytes?: number,
): Promise<{ received: Uint8Array | null; wire: Uint8Array[] }> {
  const plan = planConvoy(from, key, payload, chunkBytes)
  const receiver = createConvoyReceiver(to, key)

  const wire: Uint8Array[] = []
  for (let seq = 0; seq < plan.chunks; seq += 1) wire.push(await plan.seal(seq))
  for (const frame of wire) await receiver.accept(frame)

  return { received: receiver.payload(), wire }
}

describe('one device to another, all the way', () => {
  /** The handshake, exactly as the two screens perform it. */
  async function pair(): Promise<{
    laptop: ReturnType<typeof createSecrets>
    phone: ReturnType<typeof createSecrets>
    laptopKeys: SessionKeys
    phoneKeys: SessionKeys
  }> {
    const laptop = createSecrets()
    const phone = createSecrets()

    // 1. The laptop mints an offer and the animation begins saying it.
    const state = await beginPairing(laptop, AT)
    const offer = encodeOffer(state.offer)
    const plan = planPulse(offer)

    // 2. The phone's camera gathers the frames.
    const receiver = createPulseReceiver()
    for (const frame of plan.frames) receiver.accept(frame)
    const scanned = receiver.payload()
    expect(scanned).not.toBeNull()
    if (scanned === null) throw new Error('the key did not read')

    // 3. The phone answers, over the network. The payload is padded to whole
    //    frames, so the offer's own length is what `acceptPairing` is given.
    const accepted = await acceptPairing(phone, scanned.subarray(0, offer.byteLength))
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) throw new Error(accepted.error)

    // 4. The laptop checks the answer came from something that saw its screen.
    const completed = await completePairing(laptop, state, accepted.value.response, AT + 2000)
    expect(completed.ok).toBe(true)
    if (!completed.ok) throw new Error(completed.error)

    return { laptop, phone, laptopKeys: completed.value, phoneKeys: accepted.value.keys }
  }

  it('carries a records-sized backup across, byte for byte', async () => {
    const { laptop, phone, laptopKeys, phoneKeys } = await pair()
    // 120 KB is a real store's records with no documents.
    const backup = backupBytes(120_000)

    const { received } = await ferry(laptop, phone, laptopKeys.offererToAnswerer, backup)
    expect(received).not.toBeNull()
    expect(received!.byteLength).toBe(backup.byteLength)
    expect([...received!]).toEqual([...backup])
    // And the keys really were agreed independently, not shared by the test.
    expect([...laptopKeys.offererToAnswerer]).toEqual([...phoneKeys.offererToAnswerer])
  })

  it('carries a documents-sized backup across', async () => {
    const { laptop, phone, laptopKeys } = await pair()
    const backup = backupBytes(3_000_000)
    const { received, wire } = await ferry(laptop, phone, laptopKeys.offererToAnswerer, backup)
    expect(wire).toHaveLength(Math.ceil(3_000_000 / (64 * 1024)))
    expect(received!.byteLength).toBe(backup.byteLength)
    expect([...received!.subarray(0, 64)]).toEqual([...backup.subarray(0, 64)])
    expect([...received!.subarray(-64)]).toEqual([...backup.subarray(-64)])
  })

  it('carries an empty backup, and one smaller than a chunk', async () => {
    const { laptop, phone, laptopKeys } = await pair()
    for (const n of [0, 1, 100]) {
      const { received } = await ferry(laptop, phone, laptopKeys.offererToAnswerer, backupBytes(n))
      expect(received, `size ${n}`).not.toBeNull()
      expect(received!.byteLength, `size ${n}`).toBe(n)
    }
  })

  it('carries in both directions, on different keys', async () => {
    const { laptop, phone, laptopKeys, phoneKeys } = await pair()
    const up = backupBytes(5000)
    const down = backupBytes(9000)

    const there = await ferry(laptop, phone, laptopKeys.offererToAnswerer, up)
    const back = await ferry(phone, laptop, phoneKeys.answererToOfferer, down)
    expect([...there.received!]).toEqual([...up])
    expect([...back.received!]).toEqual([...down])
    expect([...laptopKeys.offererToAnswerer]).not.toEqual([...laptopKeys.answererToOfferer])
  })

  it('puts nothing readable on the wire', async () => {
    // The claim the whole feature rests on. An attacker on the wifi sees the
    // sealed chunks; none of the backup may be recognisable in them.
    const { laptop, phone, laptopKeys } = await pair()
    const backup = backupBytes(200_000)
    const { wire } = await ferry(laptop, phone, laptopKeys.offererToAnswerer, backup)

    const onTheWire = wire.map((f) => [...f].join(',')).join('|')
    // A 64-byte run of the plaintext appearing anywhere would mean a chunk went
    // out in the clear.
    for (const at of [0, 50_000, 199_936]) {
      expect(onTheWire).not.toContain([...backup.subarray(at, at + 64)].join(','))
    }
  })
})

describe('the ways it must refuse', () => {
  async function keyed(): Promise<{
    a: ReturnType<typeof createSecrets>
    b: ReturnType<typeof createSecrets>
    key: Uint8Array
  }> {
    const a = createSecrets()
    const b = createSecrets()
    const state = await beginPairing(a, AT)
    const offer = encodeOffer(state.offer)
    const receiver = createPulseReceiver()
    for (const frame of planPulse(offer).frames) receiver.accept(frame)
    const scanned = receiver.payload()
    if (scanned === null) throw new Error('setup')
    const accepted = await acceptPairing(b, scanned.subarray(0, offer.byteLength))
    if (!accepted.ok) throw new Error('setup')
    const completed = await completePairing(a, state, accepted.value.response, AT + 1)
    if (!completed.ok) throw new Error('setup')
    return { a, b, key: completed.value.offererToAnswerer }
  }

  it('refuses a truncated transfer instead of returning a prefix', async () => {
    // The failure that would otherwise be SILENT: an attacker who stops relaying
    // leaves the receiver holding most of a backup and no reason to doubt it.
    const { a, b, key } = await keyed()
    const payload = backupBytes(200_000)
    const plan = planConvoy(a, key, payload)
    const receiver = createConvoyReceiver(b, key)

    for (let seq = 0; seq < plan.chunks - 1; seq += 1) {
      expect(await receiver.accept(await plan.seal(seq))).toBe('accepted')
    }
    expect(receiver.progress().complete).toBe(false)
    expect(receiver.payload()).toBeNull()

    // ...and the last chunk completes it.
    expect(await receiver.accept(await plan.seal(plan.chunks - 1))).toBe('complete')
    expect([...receiver.payload()!]).toEqual([...payload])
  })

  it('refuses a chunk moved out of order', async () => {
    const { a, b, key } = await keyed()
    const plan = planConvoy(a, key, backupBytes(200_000))
    const receiver = createConvoyReceiver(b, key)
    await receiver.accept(await plan.seal(0))
    // Chunk 2 where chunk 1 belongs. The sequence is in the authenticated data,
    // so the cipher refuses it — there is no separate check to forget.
    expect(await receiver.accept(await plan.seal(2))).toBe('rejected')
    expect(receiver.progress().chunks).toBe(1)
  })

  it('refuses a chunk replayed', async () => {
    const { a, b, key } = await keyed()
    const plan = planConvoy(a, key, backupBytes(200_000))
    const receiver = createConvoyReceiver(b, key)
    const first = await plan.seal(0)
    expect(await receiver.accept(first)).toBe('accepted')
    expect(await receiver.accept(first)).toBe('rejected')
  })

  it('refuses a chunk with a flipped bit', async () => {
    const { a, b, key } = await keyed()
    const plan = planConvoy(a, key, backupBytes(100_000))
    const receiver = createConvoyReceiver(b, key)
    const sealed = await plan.seal(0)
    for (const at of [0, 100, sealed.byteLength - 1]) {
      const damaged = sealed.slice()
      damaged[at]! ^= 0x01
      expect(await createConvoyReceiver(b, key).accept(damaged), `byte ${at}`).toBe('rejected')
    }
    expect(await receiver.accept(sealed)).toBe('accepted')
  })

  it('refuses chunks sealed under a different pairing', async () => {
    // Two people transferring in one room. Neither convoy may be readable by
    // the other, even though both are well-formed.
    const mine = await keyed()
    const theirs = await keyed()
    const plan = planConvoy(theirs.a, theirs.key, backupBytes(50_000))
    const receiver = createConvoyReceiver(mine.b, mine.key)
    expect(await receiver.accept(await plan.seal(0))).toBe('rejected')
    expect(receiver.payload()).toBeNull()
  })

  it('ignores anything arriving after the transfer finished', async () => {
    const { a, b, key } = await keyed()
    const plan = planConvoy(a, key, backupBytes(1000))
    const receiver = createConvoyReceiver(b, key)
    expect(await receiver.accept(await plan.seal(0))).toBe('complete')
    expect(await receiver.accept(await plan.seal(0))).toBe('finished')
  })
})

/**
 * The two properties no differential test can see.
 *
 * Mutation testing found three changes to `convoy.ts` that every case above
 * survived: a constant nonce, the sequence dropped from the authenticated data,
 * and the domain label dropped. All three are catastrophic and none of them
 * alters any input/output relation the tests were checking — which is exactly
 * the shape of a security bug that ships.
 */
describe('the wire format itself', () => {
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

  it('never reuses a nonce, which GCM does not survive', async () => {
    /*
     * Nonce reuse under one key is total: two chunks leak their plaintexts to
     * xor, and the authentication key itself becomes recoverable. It is also
     * invisible to an ordinary test, because everything still authenticates.
     *
     * What makes it observable is a property of GCM specifically — the
     * additional data authenticates but does NOT enter the keystream. So two
     * chunks of IDENTICAL plaintext at different sequences share a ciphertext
     * if and only if they share a nonce. Different ciphertext here is a direct
     * statement that the counter is doing its job.
     */
    const secrets = createSecrets()
    const key = secrets.random(32)
    // Every chunk the same bytes, so nothing but the nonce can separate them.
    const plan = planConvoy(secrets, key, new Uint8Array(64).fill(0xa5), 16)
    expect(plan.chunks).toBe(4)

    const bodies = new Set<string>()
    for (let seq = 0; seq < plan.chunks; seq += 1) {
      const sealed = await plan.seal(seq)
      // Ciphertext only: GCM appends a 16-byte tag, and the tag DOES cover the
      // additional data, so including it would let a varying AAD mask a
      // repeated nonce.
      bodies.add(hex(sealed.subarray(0, sealed.byteLength - 16)))
    }
    expect(bodies.size).toBe(plan.chunks)
  })

  it('has not changed shape, which is what makes two builds interoperable', async () => {
    /*
     * A known-answer vector over the real primitives. It pins everything the
     * differential tests cannot: the domain label, the layout and content of the
     * additional data, the nonce derivation, and the chunk boundaries.
     *
     * It earns its place twice. Constants like the label shift every output
     * uniformly when removed, so no comparison between two of our own outputs
     * can see it. And this is a WIRE format: two jojo builds that disagree about
     * it do not fail loudly, they fail as "that chunk did not authenticate",
     * which is the same message a person under attack would get.
     *
     * If you are here because this failed: you changed the convoy format. That
     * is allowed, and it means changing LABEL — the version lives in it — so an
     * older build refuses the stream instead of half-reading it. Update these
     * bytes in the same commit.
     */
    const key = new Uint8Array(32).fill(0x2b)
    const plan = planConvoy(createSecrets(), key, new Uint8Array(40).fill(0x7c), 16)
    expect(plan.chunks).toBe(3)

    const sealed: string[] = []
    for (let seq = 0; seq < plan.chunks; seq += 1) sealed.push(hex(await plan.seal(seq)))

    expect(sealed[0]).toBe(
      '52caa99438413838ccd332b7623797ac5b089af01a1d27ffaf3e8908199f2604',
    )
    expect(sealed[1]).toBe(
      '74d13a2154c9fb9ce6ec85a27fe6438450325d3bd2aa4f0dbe5f6652dbca14cb',
    )
    // The last chunk: 8 bytes of payload, and the final flag set in its AAD.
    expect(sealed[2]).toBe('9f00480b2330df0d1b92842fa321aa50bd995a12118f2ef8')
  })
})
