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
 * SAFARI, iOS AND FIREFOX. WebKit has no Local Network Access at all — on
 * macOS or iOS, where every browser is WebKit — and Firefox, from an https
 * page, refuses an http request to the LAN as mixed content. Neither is a bug
 * to work around, and pretending otherwise produces a spinner that never
 * resolves, so both are detected up front and the screen says so.
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
  /** Connected, then stopped answering — a phone asleep or an app sent to the background. */
  | 'handoff/timeout'
  /** The browser refused to let this page reach the local network at all. */
  | 'handoff/blocked'
  /** The person cancelled. Never shown: the screen already knows. */
  | 'handoff/cancelled'
  /** The phone answered that it could not gather its own records (409). */
  | 'handoff/conflict'

export type HandoffResult<T> = { ok: true; value: T } | { ok: false; error: HandoffFailure }

/**
 * Whether this browser can reach a local address from an HTTPS page.
 *
 * Feature detection is not possible — there is no API to ask, and the permission
 * itself has no queryable state before it is requested. So this asks the one
 * question that does have an answer: is this WebKit. Chrome, Edge, Brave and
 * Firefox all implement or intend to implement the path; Safari has no signal.
 */
export function canReachLocalNetwork(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  secure: boolean = typeof location !== 'undefined' && location.protocol === 'https:',
): boolean {
  if (ua === '') return false
  // Every browser on an iPhone or iPad is WebKit underneath, whatever it calls
  // itself — Chrome there is "CriOS", Edge "EdgiOS", Firefox "FxiOS" — and
  // iPadOS reports a Mac. The transfer audit found Edge on iOS let through.
  if (/iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS/.test(ua)) return false
  // Chrome and every Chromium browser put "Safari" in the string too, so the
  // test has to be for Safari AND NOT Chromium.
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)) return false
  // Firefox has no Local Network Access, so from an https page — the
  // published site — a request to http://192.168.… is mixed content and is
  // refused before it leaves the browser. Served over http (a copy on your
  // own machine) it works.
  if (/Firefox\//.test(ua) && secure) return false
  return true
}

/** How long one answer may take. A LAN round trip is milliseconds; these are for a phone that went quiet. */
const PAIR_TIMEOUT_MS = 15_000
const CHUNK_TIMEOUT_MS = 60_000

/**
 * The address space a request goes to, for Chrome's Local Network Access.
 *
 * Passing it is what lets an https page reach an http device on the LAN
 * without the request being blocked as mixed content; browsers that do not
 * know the option ignore it.
 */
const addressSpace = (address: DialAddress): 'loopback' | 'local' =>
  address.host[0] === 127 ? 'loopback' : 'local'

/** One signal that fires on the caller's cancel or on the timeout, whichever comes first. */
function combined(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; timedOut: () => boolean } {
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, timeoutMs)
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', () => controller.abort(), { once: true })
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return { signal: controller.signal, timedOut: () => expired }
}

/**
 * Whether the browser has refused this page the local network — Chrome's
 * Local Network Access permission, read after a request fails, so a denial is
 * named rather than reported as "check your wifi". Unknown elsewhere, and
 * unknown is treated as not blocked.
 */
async function localNetworkDenied(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: 'local-network-access' as PermissionName,
    })
    return status.state === 'denied'
  } catch {
    return false
  }
}

const base = (address: DialAddress): string => `http://${formatAddress(address)}`

async function call(
  address: DialAddress,
  path: string,
  init: RequestInit & { timeoutMs: number; cancel?: AbortSignal | undefined },
): Promise<HandoffResult<Uint8Array>> {
  if (!canReachLocalNetwork()) return { ok: false, error: 'handoff/unsupported' }
  if (!isPrivateAddress(address)) return { ok: false, error: 'handoff/not-local' }

  /*
   * Every request has a deadline and can be cancelled. There used to be
   * neither: a phone that accepted the connection and then went quiet — its
   * app sent to the background mid-transfer — left the panel spinning for
   * ever, with its only control disabled (transfer audit, 2026-11-16).
   */
  const { timeoutMs, cancel, ...rest } = init
  const deadline = combined(timeoutMs, cancel)
  const failed = (): HandoffResult<Uint8Array> => ({
    ok: false,
    error: cancel?.aborted
      ? 'handoff/cancelled'
      : deadline.timedOut()
        ? 'handoff/timeout'
        : 'handoff/unreachable',
  })

  let response: Response
  try {
    response = await fetch(base(address) + path, {
      ...rest,
      // No cookies, no credentials, nothing ambient. This is a stranger's socket
      // as far as the browser is concerned and should stay that way.
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
      signal: deadline.signal,
      targetAddressSpace: addressSpace(address),
    } as RequestInit)
  } catch {
    /*
     * `fetch` throws the same TypeError for a denied Local Network Access
     * permission, a refused connection, a DNS failure and a CORS rejection.
     * The one of those a browser will own up to is the permission, so it is
     * asked; the rest share one sentence.
     */
    const out = failed()
    if (out.ok || out.error !== 'handoff/unreachable') return out
    return (await localNetworkDenied()) ? { ok: false, error: 'handoff/blocked' } : out
  }

  // A 409 is the phone saying its own side failed — it could not build its
  // backup. Reported as "the code may have expired", it sent people off to
  // rescan, which cannot help (transfer audit, 2026-11-16).
  if (response.status === 409) return { ok: false, error: 'handoff/conflict' }
  if (!response.ok) return { ok: false, error: 'handoff/refused' }
  try {
    return await readCapped(response, MAX_BODY_BYTES)
  } catch {
    if (cancel?.aborted || deadline.timedOut()) return failed()
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
  cancel?: AbortSignal,
): Promise<HandoffResult<Uint8Array>> =>
  call(address, pairPath(token), { timeoutMs: PAIR_TIMEOUT_MS, cancel })

/** Delivers one sealed convoy chunk. */
export const sendChunk = (
  address: DialAddress,
  token: string,
  sealed: Uint8Array,
  cancel?: AbortSignal,
): Promise<HandoffResult<Uint8Array>> =>
  call(address, chunkPath(token), {
    timeoutMs: CHUNK_TIMEOUT_MS,
    cancel,
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
  cancel?: AbortSignal,
): Promise<HandoffResult<Uint8Array>> =>
  call(address, pullPath(token), {
    timeoutMs: CHUNK_TIMEOUT_MS,
    cancel,
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: request as BodyInit,
  })

/** What to tell the person, per failure. */
export const HANDOFF_ADVICE: Record<HandoffFailure, string> = {
  'handoff/unsupported':
    'This browser cannot connect to another device on your network — Safari cannot, no browser on an iPhone or iPad can, and Firefox cannot from the published site. Use Chrome or Edge on a computer, or move your records with a backup file instead.',
  'handoff/not-local':
    'That address is not on a local network. jojo only connects to a private address, so the transfer never crosses the internet.',
  'handoff/unreachable':
    'No answer from that address. Check both devices are on the same local network, and that your browser was allowed to find devices on the local network. Some guest networks block devices from seeing each other.',
  'handoff/refused':
    'That device refused the connection. Check the phone is set the other way round — Receive on the phone when this computer sends, Send when it receives — then show a new code and scan it again.',
  'handoff/oversized':
    'That device answered with far more than jojo expects, so it stopped reading. Nothing on this computer has changed.',
  'handoff/timeout':
    'That device stopped answering. Keep jojo open on the phone with the screen on, then show a new code and try again.',
  'handoff/blocked':
    'Your browser has blocked this site from reaching devices on your local network. Allow it in the site settings (the icon left of the address), then try again.',
  'handoff/cancelled': 'Cancelled.',
  'handoff/conflict':
    'Your phone could not gather its records to send. Check the message on the phone — nothing on this computer has changed.',
}
