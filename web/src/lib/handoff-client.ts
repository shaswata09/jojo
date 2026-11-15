/**
 * The browser's half of the wire: fetching from the phone over the local network.
 *
 * Short, because everything hard is elsewhere. What it adds over `fetch` is the
 * handling of two failures that look identical from the outside and need
 * completely different words on screen.
 *
 * ## The two failures worth telling apart
 *
 * PERMISSION. Chrome gates requests from an HTTPS page to a local address behind
 * Local Network Access — a prompt the person may not have seen, may have
 * dismissed, or may have denied months ago for a different site. A denied
 * permission and an unreachable phone both surface as the same `TypeError` from
 * `fetch`, and telling somebody "check your wifi" when the real answer is
 * "click Allow" sends them to spend ten minutes in the wrong place.
 *
 * SAFARI. There is no Local Network Access implementation in WebKit at all, so
 * this cannot work there — on macOS or iOS, where every browser is WebKit. That
 * is not a bug to work around, and pretending otherwise would produce a spinner
 * that never resolves. It is detected up front so the screen can say so.
 *
 * ## Why the address is not validated here
 *
 * `core/dial.ts` decides what jojo will dial, and it is the only place that
 * should: it refuses anything outside a private range so a transfer cannot take
 * a route across the internet by accident. A second, looser check here would be
 * a way around the first one.
 */

import { MAX_BODY_BYTES, chunkPath, pairPath, pullPath } from '@jojo/service/core/handoff'
import { formatAddress, isPrivateAddress, type DialAddress } from '@jojo/service/core/dial'

export type HandoffFailure =
  /** This browser cannot reach a local address at all. */
  | 'handoff/unsupported'
  /** The address is not one jojo will dial — see `isPrivateAddress`. */
  | 'handoff/not-local'
  /** Nothing answered: wrong address, phone asleep, or client isolation. */
  | 'handoff/unreachable'
  /** Reached, and it refused — usually a stale code, so the token is wrong. */
  | 'handoff/refused'
  /** Answered with more than any real answer holds. Not read past the limit. */
  | 'handoff/oversized'

export type HandoffResult<T> = { ok: true; value: T } | { ok: false; error: HandoffFailure }

/**
 * Whether this browser can reach a local address from an HTTPS page.
 *
 * Feature detection is not possible — there is no API to ask, and the permission
 * itself has no queryable state before it is requested. So this asks the one
 * question that does have an answer: is this WebKit. Chrome, Edge, Brave and
 * Firefox all implement or intend to implement the path; Safari has no signal.
 */
export function canReachLocalNetwork(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Chrome and every Chromium browser put "Safari" in the string too, so the
  // test has to be for Safari AND NOT Chromium. Ugly, and the alternative is a
  // request that hangs with nothing to say about why.
  return !(/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua))
}

const base = (address: DialAddress): string => `http://${formatAddress(address)}`

async function call(
  address: DialAddress,
  path: string,
  init?: RequestInit,
): Promise<HandoffResult<Uint8Array>> {
  if (!canReachLocalNetwork()) return { ok: false, error: 'handoff/unsupported' }
  if (!isPrivateAddress(address)) return { ok: false, error: 'handoff/not-local' }

  let response: Response
  try {
    response = await fetch(base(address) + path, {
      ...init,
      // No cookies, no credentials, nothing ambient. This is a stranger's socket
      // as far as the browser is concerned and should stay that way.
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    })
  } catch {
    /*
     * `fetch` throws the same TypeError for a denied Local Network Access
     * permission, a refused connection, a DNS failure and a CORS rejection. The
     * browser deliberately does not say which, so neither can jojo — and the
     * message this maps to has to cover all of them without guessing.
     */
    return { ok: false, error: 'handoff/unreachable' }
  }

  if (!response.ok) return { ok: false, error: 'handoff/refused' }
  try {
    return await readCapped(response, MAX_BODY_BYTES)
  } catch {
    /*
     * The body is a SECOND read off the network, after the headers have already
     * resolved the `fetch` above — so a phone that goes to sleep, a wifi drop,
     * or a socket the other end closes mid-response rejects HERE and not there.
     * Unguarded, that rejection walked straight out of `call` past the result
     * type this module exists to produce: `start` rejected into the `void` at
     * its call site and the panel sat spinning with nothing on screen to say
     * why. Same cause as the throw above, so the same words.
     */
    return { ok: false, error: 'handoff/unreachable' }
  }
}

/**
 * Reads a response body, and stops reading at `limit` bytes.
 *
 * Every answer the phone gives is small: a 67-byte pairing response, an empty
 * acknowledgement, or one sealed chunk of at most 64 KiB and a tag. Now that
 * the computer also READS the phone's backup, the far end of this socket
 * decides how much arrives, and `arrayBuffer()` would buffer whatever it was
 * sent before anything could look at it. So the body is read piece by piece
 * and the read is abandoned the moment it passes the limit — the same limit
 * the phone's own parser holds a request to (`MAX_BODY_BYTES`).
 *
 * Exported because D20 rules out mounting: this is a guard the tests can reach.
 */
export async function readCapped(
  response: Response,
  limit: number,
): Promise<HandoffResult<Uint8Array>> {
  const stream = response.body as ReadableStream<Uint8Array> | null | undefined
  if (!stream) {
    // No stream to read piecewise — an empty body, or an engine that offers
    // only the whole buffer. Still held to the limit, after the fact.
    const whole = new Uint8Array(await response.arrayBuffer())
    return whole.byteLength > limit
      ? { ok: false, error: 'handoff/oversized' }
      : { ok: true, value: whole }
  }
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      // Tell the socket to stop rather than draining it into nowhere.
      void reader.cancel().catch(() => undefined)
      return { ok: false, error: 'handoff/oversized' }
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return { ok: true, value: out }
}

/** Asks the phone for its pairing response — step three of the handshake. */
export const fetchPairingResponse = (
  address: DialAddress,
  token: string,
): Promise<HandoffResult<Uint8Array>> => call(address, pairPath(token))

/** Delivers one sealed convoy chunk. */
export const sendChunk = (
  address: DialAddress,
  token: string,
  sealed: Uint8Array,
): Promise<HandoffResult<Uint8Array>> =>
  call(address, chunkPath(token), {
    method: 'POST',
    // `application/octet-stream` rather than a type that would avoid the CORS
    // preflight. A simple request would save a round trip and would also mean
    // any web page could POST here without the browser asking first; the
    // preflight is worth one round trip on a LAN.
    headers: { 'content-type': 'application/octet-stream' },
    body: sealed as BodyInit,
  })

/**
 * Asks the phone for one sealed chunk of ITS backup — phone to computer.
 *
 * A POST, because the request carries a body: the chunk number and the proof
 * that this computer holds the session's key (`core/handoff-pull.ts`). The
 * same content type as `sendChunk`, for the same reason — the preflight is
 * worth one round trip.
 */
export const pullChunk = (
  address: DialAddress,
  token: string,
  request: Uint8Array,
): Promise<HandoffResult<Uint8Array>> =>
  call(address, pullPath(token), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: request as BodyInit,
  })

/** What to tell the person, per failure. */
export const HANDOFF_ADVICE: Record<HandoffFailure, string> = {
  'handoff/unsupported':
    'Safari cannot connect to another device on your network. Use Chrome, Edge or Firefox on this computer, or move your records with a backup file instead.',
  'handoff/not-local':
    'That address is not on a local network. jojo only connects to a private address, so the transfer never crosses the internet.',
  'handoff/unreachable':
    'No answer from that address. Check both devices are on the same local network, and that your browser was allowed to find devices on the local network. Some guest networks block devices from seeing each other.',
  'handoff/refused':
    'That device refused the connection. The code may have expired — show a new one and scan it again.',
  'handoff/oversized':
    'That device answered with far more than jojo expects, so it stopped reading. Nothing on this computer has changed.',
}
