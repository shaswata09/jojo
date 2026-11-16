/**
 * Q129: the phone sends to a computer — every piece a Node test can reach.
 *
 * The socket, NetInfo and the file system are stubs; everything else is real.
 * The computer's half is the real `runPull` and the real `completePairing`, so
 * these drive the phone's request handler exactly as a browser would, through
 * the same parser (`readRequest`) the socket feeds. What this cannot show is a
 * real socket on a real network — that has not been run on a phone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBackup } from '@jojo/service/core/backup'
import { pathToken, pullPath, readRequest } from '@jojo/service/core/handoff'
import { encodePullRequest, runPull } from '@jojo/service/core/handoff-pull'
import {
  beginPairing,
  completePairing,
  encodeOffer,
  type PairingState,
} from '@jojo/service/core/pairing'
import { decodeUtf8 } from '@jojo/service/core/utf8'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import type { HandoffRequest, HandoffDirection } from '@jojo/service/core/handoff'
import type { HandoffAnswer } from '@/lib/handoff-server'

/** What `startHandoffServer` was started with: the handler and the direction. */
const started: {
  token?: string
  answer?: (request: HandoffRequest) => Promise<HandoffAnswer>
  direction?: HandoffDirection
  stopped: number
} = { stopped: 0 }

vi.mock('@/lib/handoff-server', () => ({
  startHandoffServer: (
    token: string,
    answer: (request: HandoffRequest) => Promise<HandoffAnswer>,
    direction: HandoffDirection,
  ) => {
    started.token = token
    started.answer = answer
    started.direction = direction
    return Promise.resolve({ port: 50123, stop: () => (started.stopped += 1) })
  },
}))

let ip = '192.168.1.23'
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: () => Promise.resolve({ details: { ipAddress: ip } }) },
}))
vi.mock('react-native-blob-util', () => ({ default: { fs: {} } }))

const { beginServing } = await import('@/lib/handoff-serve')
const { buildSendPayload } = await import('@/lib/send-payload')

const secrets = createSecrets()

const node = {
  id: 'app:01a02b14-31db-7278-a6d7-c03d325832ba',
  type: 'application',
  props: {
    slug: '01a02b14-31db-7278-a6d7-c03d325832ba',
    role: 'Research Engineer',
    note: 'Zoë',
    roleTag: 'Researcher',
    stage: 'submitted',
    lastAction: 'Submitted',
    lastActionAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as never

const build = async () =>
  (
    await buildSendPayload({
      exportedAt: '2026-11-15T10:00:00.000Z',
      nodes: [node],
      edges: [],
      readDocument: async () => null,
    })
  ).bytes

/** The phone, reached the way a browser reaches it: bytes through the parser. */
async function ask(path: string, body: Uint8Array, method = 'POST') {
  const head = `${method} ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: ${body.byteLength}\r\n\r\n`
  const bytes = new Uint8Array(head.length + body.byteLength)
  for (let i = 0; i < head.length; i += 1) bytes[i] = head.charCodeAt(i)
  bytes.set(body, head.length)
  const read = readRequest(bytes, started.token!, started.direction)
  if (typeof read === 'string') return { status: 404 } as HandoffAnswer
  return started.answer!(read)
}

beforeEach(() => {
  started.stopped = 0
  ip = '192.168.1.23'
})
afterEach(() => vi.clearAllMocks())

describe('a phone sending to a computer (Q129)', () => {
  it('listens in the pull direction, under the token from the screen it read', async () => {
    const state: PairingState = await beginPairing(secrets, Date.now())
    const result = await beginServing(encodeOffer(state.offer), build)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(started.direction).toBe('pull')
    expect(started.token).toBe(await pathToken(secrets, state.offer, 'pull'))
    // A computer that is SENDING derives the push path from the same offer,
    // and must not reach a phone that is sending too.
    expect(started.token).not.toBe(await pathToken(secrets, state.offer, 'push'))
    expect(result.value.address).toEqual({ host: [192, 168, 1, 23], port: 50123 })
  })

  it('hands its whole backup to the computer that proved itself, which reads it as a backup', async () => {
    const state: PairingState = await beginPairing(secrets, Date.now())
    const result = await beginServing(encodeOffer(state.offer), build)
    if (!result.ok) throw new Error(result.error)

    // The computer: asks for the phone's answer and checks its proof.
    const pair = await started.answer!({ route: 'pair', body: new Uint8Array(0) })
    const keys = await completePairing(secrets, state, pair.body!, Date.now())
    expect(keys.ok).toBe(true)
    if (!keys.ok) return

    const pulled = await runPull({
      secrets,
      keys: keys.value,
      fetchChunk: async (request) => {
        const answer = await ask(pullPath(started.token!), request)
        return answer.status === 200
          ? { ok: true as const, value: answer.body! }
          : { ok: false as const, error: answer.status }
      },
    })
    expect(pulled.ok).toBe(true)
    if (!pulled.ok) return
    const read = readBackup(decodeUtf8(pulled.payload))
    expect(read.ok).toBe(true)
    if (read.ok) expect((read.value.nodes[0]!.props as { note: string }).note).toBe('Zoë')
    expect(result.value.progress().finished).toBe(true)
  })

  it('hands nothing over without the proof, and gathers nothing for it', async () => {
    const state: PairingState = await beginPairing(secrets, Date.now())
    let gathered = 0
    const result = await beginServing(encodeOffer(state.offer), async () => {
      gathered += 1
      return build()
    })
    if (!result.ok) throw new Error(result.error)
    expect(await ask(pullPath(started.token!), new Uint8Array(36))).toEqual({ status: 404 })
    expect(gathered).toBe(0)
  })

  it("refuses a request under a different session's token", async () => {
    const ours: PairingState = await beginPairing(secrets, Date.now())
    const theirs: PairingState = await beginPairing(secrets, Date.now())
    const result = await beginServing(encodeOffer(ours.offer), build)
    if (!result.ok) throw new Error(result.error)
    const other = await pathToken(secrets, theirs.offer, 'pull')
    expect(await ask(pullPath(other), new Uint8Array(36))).toEqual({ status: 404 })
  })

  it('refuses an oversized request body before reading it', async () => {
    const state: PairingState = await beginPairing(secrets, Date.now())
    const result = await beginServing(encodeOffer(state.offer), build)
    if (!result.ok) throw new Error(result.error)
    expect(await ask(pullPath(started.token!), new Uint8Array(37))).toEqual({ status: 404 })
  })

  it('refuses chunks posted to it: a sending phone accepts nothing', async () => {
    const state: PairingState = await beginPairing(secrets, Date.now())
    await beginServing(encodeOffer(state.offer), build)
    expect(await ask(`/jojo/${started.token!}/chunk`, new Uint8Array(16))).toEqual({ status: 404 })
  })

  it('does not stay listening on an address the computer would refuse to dial', async () => {
    ip = '8.8.8.8'
    const state: PairingState = await beginPairing(secrets, Date.now())
    const result = await beginServing(encodeOffer(state.offer), build)
    expect(result).toEqual({ ok: false, error: 'receive/not-local' })
    expect(started.stopped).toBe(1)
  })

  it('refuses a scanned code that is not a pairing offer, before opening anything', async () => {
    started.answer = undefined
    const result = await beginServing(new Uint8Array([1, 2, 3]), build)
    expect(result).toEqual({ ok: false, error: 'receive/offer' })
    expect(started.answer).toBeUndefined()
  })

  it('answers only proofs made for the chunk asked', async () => {
    const state: PairingState = await beginPairing(secrets, Date.now())
    const result = await beginServing(encodeOffer(state.offer), build)
    if (!result.ok) throw new Error(result.error)
    const pair = await started.answer!({ route: 'pair', body: new Uint8Array(0) })
    const keys = await completePairing(secrets, state, pair.body!, Date.now())
    if (!keys.ok) throw new Error(keys.error)
    const request = await encodePullRequest(secrets, keys.value, 0)
    expect((await ask(pullPath(started.token!), request)).status).toBe(200)
    request[3] = 1
    expect(await ask(pullPath(started.token!), request)).toEqual({ status: 404 })
  })
})
