/**
 * Q129: both directions over one pairing, and everything either end refuses.
 *
 * Real crypto throughout — `noble-secrets` is the one implementation both apps
 * run — and no socket: the phone's half is `createPullServer` answering bodies,
 * the computer's half is `runPull` asking, and the "network" between them is a
 * function call a test can tamper with. The parser that sits in front of the
 * phone's half is `core/handoff.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { createSecrets } from './noble-secrets'
import { CHUNK_BYTES, createConvoyReceiver, planConvoy } from '../core/convoy'
import { readBackup, buildBackup } from '../core/backup'
import { decodeUtf8 } from '../core/utf8'
import {
  MAX_SEALED_CHUNK,
  asciiJsonBytes,
  createPullServer,
  decodePullRequest,
  encodePullRequest,
  runPull,
} from '../core/handoff-pull'
import {
  acceptPairing,
  beginPairing,
  completePairing,
  encodeOffer,
  type SessionKeys,
} from '../core/pairing'

const secrets = createSecrets()

/** The computer shows a code, a phone reads it, the computer checks the answer. */
async function pair(): Promise<{ computer: SessionKeys; phone: SessionKeys }> {
  const state = await beginPairing(secrets, 0)
  const accepted = await acceptPairing(secrets, encodeOffer(state.offer))
  if (!accepted.ok) throw new Error(accepted.error)
  const completed = await completePairing(secrets, state, accepted.value.response, 1)
  if (!completed.ok) throw new Error(completed.error)
  return { computer: completed.value, phone: accepted.value.keys }
}

const bytes = (size: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + seed) & 0xff
  return out
}

/** The phone, reachable as a function. */
const wire = (server: ReturnType<typeof createPullServer>) => async (request: Uint8Array) => {
  const answer = await server.answer(request)
  return answer.status === 200
    ? { ok: true as const, value: answer.body ?? new Uint8Array(0) }
    : { ok: false as const, error: answer.status }
}

describe('phone to computer: the computer pulls (Q129)', () => {
  it('pulls the whole backup, byte for byte, from the phone that read its screen', async () => {
    const { computer, phone } = await pair()
    // Three and a bit chunks, so the last one is short and flagged.
    const payload = bytes(CHUNK_BYTES * 3 + 123)
    const server = createPullServer(secrets, phone, async () => payload)
    const seen: number[] = []

    const pulled = await runPull({
      secrets,
      keys: computer,
      fetchChunk: wire(server),
      onBytes: (n) => seen.push(n),
    })

    expect(pulled.ok).toBe(true)
    if (!pulled.ok) return
    expect([...pulled.payload]).toEqual([...payload])
    expect(seen.at(-1)).toBe(payload.byteLength)
    expect(server.progress()).toMatchObject({ served: 4, chunks: 4, finished: true, failed: false })
  })

  it('carries a real backup across, and the computer reads it with the restore reader', async () => {
    const { computer, phone } = await pair()
    // Non-ASCII on purpose: the phone has no TextEncoder, so the bytes are
    // ASCII JSON with escapes, and they must come back as the same characters.
    const backup = buildBackup({
      exportedAt: '2026-11-15T10:00:00.000Z',
      nodes: [],
      edges: [],
      documents: [{ path: 'Documents/file_1__CV.pdf', data: bytes(500) }],
      readable: { note: 'Zoë — 東京 — 😀' },
    })
    const json = JSON.stringify(backup)
    const server = createPullServer(secrets, phone, async () => asciiJsonBytes(json))
    const pulled = await runPull({ secrets, keys: computer, fetchChunk: wire(server) })
    if (!pulled.ok) throw new Error(String(pulled.error))

    expect(pulled.payload.every((b) => b < 0x80)).toBe(true)
    const text = decodeUtf8(pulled.payload)
    expect(JSON.parse(text)).toEqual(JSON.parse(json))
    const read = readBackup(text)
    // An empty graph is refused by the restore, not the reader; the reader's
    // job is to say what the file holds.
    expect(read.ok).toBe(true)
    if (read.ok) expect([...read.value.documents[0]!.data]).toEqual([...bytes(500)])
  })

  it('builds the backup once, and hands the same bytes over when asked twice', async () => {
    const { computer, phone } = await pair()
    let builds = 0
    // A store that changes under the phone between requests. Rebuilding would
    // seal different plaintexts under one key and nonce — see the module note.
    const server = createPullServer(secrets, phone, async () => bytes(CHUNK_BYTES + 10, ++builds))
    const ask = wire(server)
    const first = await ask(await encodePullRequest(secrets, computer, 0))
    const again = await ask(await encodePullRequest(secrets, computer, 0))
    expect(builds).toBe(1)
    expect(first.ok && again.ok).toBe(true)
    if (first.ok && again.ok) expect([...again.value]).toEqual([...first.value])
  })
})

describe('computer to phone still works over the same pairing', () => {
  it('pushes sealed chunks the phone opens with its own key', async () => {
    const { computer, phone } = await pair()
    const payload = bytes(CHUNK_BYTES + 77)
    const plan = planConvoy(secrets, computer.offererToAnswerer, payload)
    const receiver = createConvoyReceiver(secrets, phone.offererToAnswerer)
    for (let seq = 0; seq < plan.chunks; seq += 1) await receiver.accept(await plan.seal(seq))
    expect([...(receiver.payload() ?? [])]).toEqual([...payload])
  })
})

describe('what the phone refuses', () => {
  it('serves nothing to a request without a proof, and builds nothing for it', async () => {
    const { phone } = await pair()
    let built = false
    const server = createPullServer(secrets, phone, async () => {
      built = true
      return bytes(10)
    })
    // The right size, the right chunk number, and no proof behind it.
    const forged = new Uint8Array(36)
    expect(await server.answer(forged)).toEqual({ status: 404 })
    expect(built).toBe(false)
  })

  it("refuses a proof made with a different session's key", async () => {
    const ours = await pair()
    const theirs = await pair()
    const server = createPullServer(secrets, ours.phone, async () => bytes(10))
    const request = await encodePullRequest(secrets, theirs.computer, 0)
    expect(await server.answer(request)).toEqual({ status: 404 })
  })

  it('refuses a proof for one chunk spent on another', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, async () => bytes(CHUNK_BYTES * 2))
    const request = await encodePullRequest(secrets, computer, 0)
    request[3] = 1 // ask for chunk 1 with chunk 0's proof
    expect(await server.answer(request)).toEqual({ status: 404 })
  })

  it('refuses a body that is not exactly one pull request', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, async () => bytes(10))
    const good = await encodePullRequest(secrets, computer, 0)
    const longer = new Uint8Array(good.byteLength + 1)
    longer.set(good)
    expect(decodePullRequest(longer)).toBeNull()
    expect(await server.answer(longer)).toEqual({ status: 400 })
    expect(await server.answer(good.slice(0, 35))).toEqual({ status: 400 })
  })

  it('refuses a chunk past the end', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, async () => bytes(10))
    expect(await server.answer(await encodePullRequest(secrets, computer, 1))).toEqual({
      status: 404,
    })
  })

  it('says so when the backup could not be gathered, and hands nothing over', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, () => Promise.reject(new Error('disk')))
    expect(await server.answer(await encodePullRequest(secrets, computer, 0))).toEqual({
      status: 409,
    })
    expect(server.progress()).toMatchObject({ failed: true, finished: false, served: 0 })
  })
})

describe('what the computer refuses', () => {
  it('refuses a chunk sealed by anything but the phone it paired with', async () => {
    const ours = await pair()
    const theirs = await pair()
    // A phone answering with ITS OWN session's chunks — a device on the network
    // that paired with some other screen.
    const impostor = createPullServer(secrets, theirs.phone, async () => bytes(100))
    const real = createPullServer(secrets, ours.phone, async () => bytes(100))
    const pulled = await runPull({
      secrets,
      keys: ours.computer,
      fetchChunk: async (request) => {
        // Answer with the impostor's chunk for the same number.
        const seq = decodePullRequest(request)!.seq
        await real.answer(request)
        return wire(impostor)(await encodePullRequest(secrets, theirs.computer, seq))
      },
    })
    expect(pulled).toEqual({ ok: false, error: 'pull/forged' })
  })

  it('refuses a chunk with one bit changed', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, async () => bytes(100))
    const pulled = await runPull({
      secrets,
      keys: computer,
      fetchChunk: async (request) => {
        const got = await wire(server)(request)
        if (got.ok) got.value[5]! ^= 1
        return got
      },
    })
    expect(pulled).toEqual({ ok: false, error: 'pull/forged' })
  })

  it('refuses an answer longer than any real chunk, before opening it', async () => {
    const { computer } = await pair()
    const pulled = await runPull({
      secrets,
      keys: computer,
      fetchChunk: async () => ({ ok: true, value: new Uint8Array(MAX_SEALED_CHUNK + 1) }),
    })
    expect(pulled).toEqual({ ok: false, error: 'pull/oversized' })
  })

  it('stops at its size limit rather than reading on', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, async () => bytes(CHUNK_BYTES * 4))
    const pulled = await runPull({
      secrets,
      keys: computer,
      fetchChunk: wire(server),
      maxBytes: CHUNK_BYTES * 2,
    })
    expect(pulled).toEqual({ ok: false, error: 'pull/oversized' })
    // It stopped one chunk past the line, not at the end of the stream.
    expect(server.progress().served).toBe(3)
  })

  it('stops after its chunk limit when no chunk ever says it is last', async () => {
    const { computer, phone } = await pair()
    let asked = 0
    const pulled = await runPull({
      secrets,
      keys: computer,
      maxChunks: 5,
      // A phone streaming one-byte chunks forever: each one genuine and in
      // order, none of them flagged last. The byte limit is nowhere near, so
      // only the count can stop it.
      fetchChunk: async () => {
        asked += 1
        const endless = planConvoy(secrets, phone.answererToOfferer, new Uint8Array(asked + 1), 1)
        return { ok: true, value: await endless.seal(asked - 1) }
      },
    })
    expect(asked).toBe(5)
    expect(pulled).toEqual({ ok: false, error: 'pull/oversized' })
  })

  it('passes the transport failure through, and asks for nothing more', async () => {
    const { computer } = await pair()
    let asked = 0
    const pulled = await runPull({
      secrets,
      keys: computer,
      fetchChunk: async () => {
        asked += 1
        return { ok: false, error: 'unreachable' as const }
      },
    })
    expect(pulled).toEqual({ ok: false, error: 'unreachable' })
    expect(asked).toBe(1)
  })

  it('stops when the person walks away', async () => {
    const { computer, phone } = await pair()
    const server = createPullServer(secrets, phone, async () => bytes(CHUNK_BYTES * 3))
    let asked = 0
    const pulled = await runPull({
      secrets,
      keys: computer,
      fetchChunk: async (r) => {
        asked += 1
        return wire(server)(r)
      },
      cancelled: () => asked >= 1,
    })
    expect(pulled).toEqual({ ok: false, error: 'pull/cancelled' })
    expect(asked).toBe(1)
  })
})

describe('the phone writes ASCII JSON', () => {
  it('escapes every character above 0x7F and parses back to the same value', () => {
    const value = { a: 'plain', b: 'é ß Ω — “quotes” 東京 😀  ', c: ['\u0080', '￿'] }
    const json = JSON.stringify(value)
    const out = asciiJsonBytes(json)
    expect(out.every((b) => b < 0x80)).toBe(true)
    expect(JSON.parse(decodeUtf8(out))).toEqual(value)
  })
})
