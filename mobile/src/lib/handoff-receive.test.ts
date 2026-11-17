/**
 * A receiving phone tells the computer what its person did with the transfer.
 *
 * The socket and NetInfo are stubs; the pairing, the parser and the session
 * are real. The computer asks `GET /jojo/<token>/outcome`; until the person
 * answers it hears `pending`, and it stamps its own handover only on `applied`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openOutcome,
  outcomePath,
  pathToken,
  readRequest,
  type HandoffDirection,
  type HandoffRequest,
} from '@jojo/service/core/handoff'
import { beginPairing, encodeOffer, type SessionKeys } from '@jojo/service/core/pairing'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import type { HandoffAnswer } from '@/lib/handoff-server'

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
    direction: HandoffDirection = 'push',
  ) => {
    started.token = token
    started.answer = answer
    started.direction = direction
    return Promise.resolve({ port: 50124, stop: () => (started.stopped += 1) })
  },
}))
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: () => Promise.resolve({ details: { ipAddress: '192.168.1.40' } }) },
}))

const { OUTCOME_GRACE_MS, beginReceiving } = await import('@/lib/handoff-receive')

const secrets = createSecrets()

async function receiving() {
  const state = await beginPairing(secrets, Date.now())
  const result = await beginReceiving(encodeOffer(state.offer))
  if (!result.ok) throw new Error(result.error)
  expect(started.token).toBe(await pathToken(secrets, state.offer, 'push'))
  keys = result.value.keys
  return result.value
}

/** The session's keys, which the computer holds too once pairing completes. */
let keys: SessionKeys

/** The computer asking, through the same parser the socket feeds, and checking the phone's proof. */
async function ask(): Promise<string | null> {
  const head = `GET ${outcomePath(started.token!)} HTTP/1.1\r\nHost: x\r\n\r\n`
  const read = readRequest(
    Uint8Array.from(head, (c) => c.charCodeAt(0)),
    started.token!,
    'push',
  )
  if (typeof read === 'string') return null
  const answer = await started.answer!(read)
  return answer.body === undefined ? null : openOutcome(secrets, keys, answer.body, 'push')
}

beforeEach(() => {
  started.stopped = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('what the receiving phone tells the computer', () => {
  it('says pending until the person answers, then what they chose', async () => {
    const session = await receiving()
    expect(await ask()).toBe('pending')
    session.settle('declined')
    expect(await ask()).toBe('declined')
  })

  it('keeps listening just long enough after an answer for the computer to hear it', async () => {
    const session = await receiving()
    session.settle('applied')
    // The panel drops the session on decline, which calls stop(): a settled
    // session ignores it, so the answer is still there to be asked for.
    session.stop()
    expect(started.stopped).toBe(0)
    vi.advanceTimersByTime(OUTCOME_GRACE_MS)
    expect(started.stopped).toBe(1)
  })

  it('is settled once: a later answer does not overwrite the first', async () => {
    const session = await receiving()
    session.settle('applied')
    session.settle('declined')
    expect(await ask()).toBe('applied')
  })

  it('closes at once when stopped before anything was decided', async () => {
    const session = await receiving()
    session.stop()
    expect(started.stopped).toBe(1)
  })
})
