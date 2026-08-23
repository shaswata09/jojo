/**
 * The little HTTP server the receiving device runs, expressed as pure functions.
 *
 * A browser cannot listen on a socket, so the phone has to be the one that
 * accepts a connection — and a browser can only speak HTTP to it. That is the
 * whole reason this file exists: not because jojo wants an HTTP server, but
 * because it is the only vocabulary the two ends share.
 *
 * ## Deliberately not a web server
 *
 * It answers three requests and refuses everything else by shape. No routing
 * table, no header folding, no chunked transfer, no keep-alive negotiation, no
 * content negotiation. Every one of those is a place for a parser bug, and none
 * of them is needed by the single client this will ever have — which is jojo,
 * on the other device, sending requests this same codebase builds.
 *
 * Strictness is the security property. This is a socket open on somebody's home
 * network; anything it accepts, it accepts from every device on that network.
 *
 * ## What stops a random web page talking to it
 *
 * The port is open to the whole LAN while a transfer is running, and browsers
 * will happily let any website try. `Access-Control-Allow-Origin` cannot be the
 * defence — it is advice to a cooperating browser, not a gate, and a non-browser
 * client ignores it entirely.
 *
 * So the URL itself is the secret. Every path carries a token derived from the
 * pairing secret, which existed only as photons between one screen and one
 * camera. A page that has not seen the screen cannot construct the path, and
 * gets a 404 that tells it nothing. It is the same secret doing the same job as
 * in `pairing.ts`, spent one layer earlier so that an unauthorised request is
 * refused before any of it is parsed.
 *
 * ## Parsing bytes, not strings
 *
 * The body is a sealed convoy chunk: arbitrary binary, including nulls. So the
 * request is split at the header/body boundary as BYTES and only the header half
 * is ever treated as text. Decoding the whole thing as UTF-8 first — the obvious
 * shortcut — silently mangles the payload.
 */

import type { Secrets } from './secrets'
import type { PairingOffer } from './pairing'

/** Everything this server answers sits under one prefix. */
const ROOT = 'jojo'

/** Refuse a header block bigger than this. Real ones are a few hundred bytes. */
const MAX_HEADER_BYTES = 4096

/**
 * Refuse a body bigger than this.
 *
 * One sealed convoy chunk is `CHUNK_BYTES` plus a 16-byte tag. The margin is for
 * a future chunk size, not for a caller sending whatever it likes — the limit is
 * what stops one request asking a phone to allocate until it dies.
 */
export const MAX_BODY_BYTES = 256 * 1024

export type HandoffRoute =
  /** The browser asking for the pairing response. */
  | 'pair'
  /** The browser delivering one sealed convoy chunk. */
  | 'chunk'
  /** A CORS preflight, which a browser sends before the POST. */
  | 'preflight'

export type HandoffRequest = { route: HandoffRoute; body: Uint8Array }

export type HandoffProblem =
  /** Not enough bytes yet. Keep reading; this is not an error. */
  | 'incomplete'
  /** Malformed, oversized, or not one of the three shapes above. */
  | 'refused'

export type HandoffRead = HandoffRequest | HandoffProblem

/**
 * The token every path carries.
 *
 * Derived from the pairing secret, so both devices compute it and nothing else
 * can. Hex rather than base64 because it goes in a URL and base64's `+` and `/`
 * would need escaping — a needless place for two implementations to disagree.
 */
export async function pathToken(secrets: Secrets, offer: PairingOffer): Promise<string> {
  const label = new Uint8Array([...'jojo/handoff/url/v1'].map((c) => c.charCodeAt(0) & 0x7f))
  const bits = await secrets.derive(offer.secret, offer.nonce, label, 16)
  return [...bits].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Where the browser should send each request. */
export const pairPath = (token: string): string => `/${ROOT}/${token}/pair`
export const chunkPath = (token: string): string => `/${ROOT}/${token}/chunk`

/** Finds the blank line that ends the headers. -1 if it has not arrived. */
function headerEnd(bytes: Uint8Array): number {
  for (let i = 3; i < bytes.byteLength; i += 1) {
    if (
      bytes[i - 3] === 0x0d &&
      bytes[i - 2] === 0x0a &&
      bytes[i - 1] === 0x0d &&
      bytes[i] === 0x0a
    ) {
      return i + 1
    }
  }
  return -1
}

const asciiOf = (bytes: Uint8Array): string => {
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}

/**
 * Reads one request out of whatever has arrived on the socket so far.
 *
 * Returns `'incomplete'` when more bytes are needed — which is the normal case
 * on any real network, and the reason this takes the whole buffer each time
 * rather than a single read.
 */
export function readRequest(bytes: Uint8Array, token: string): HandoffRead {
  const end = headerEnd(bytes)
  if (end < 0) {
    // Not yet — unless the client is filling memory with a header that will
    // never end, which is the cheapest attack there is against a listener.
    return bytes.byteLength > MAX_HEADER_BYTES ? 'refused' : 'incomplete'
  }
  if (end > MAX_HEADER_BYTES) return 'refused'

  const lines = asciiOf(bytes.subarray(0, end)).split('\r\n')
  const [method, path] = (lines[0] ?? '').split(' ')
  if (method === undefined || path === undefined) return 'refused'

  // Compared whole. A prefix match would let `/jojo/<token>/pair/../anything`
  // through, and there is no reason to accept anything but these two.
  if (method === 'OPTIONS' && (path === pairPath(token) || path === chunkPath(token))) {
    return { route: 'preflight', body: new Uint8Array(0) }
  }
  if (method === 'GET' && path === pairPath(token)) {
    return { route: 'pair', body: new Uint8Array(0) }
  }
  if (method !== 'POST' || path !== chunkPath(token)) return 'refused'

  let length = -1
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':')
    if (at < 0) continue
    if (line.slice(0, at).trim().toLowerCase() !== 'content-length') continue
    const value = line.slice(at + 1).trim()
    // `Number` accepts '', '0x10', '1e3' and ' 12 '. A length is decimal digits.
    if (!/^\d{1,9}$/.test(value)) return 'refused'
    length = Number(value)
  }
  if (length < 0 || length > MAX_BODY_BYTES) return 'refused'
  if (bytes.byteLength < end + length) return 'incomplete'

  return { route: 'chunk', body: bytes.slice(end, end + length) }
}

/** How many bytes one complete request occupied, so the buffer can be advanced. */
export function requestLength(bytes: Uint8Array, request: HandoffRequest): number {
  return headerEnd(bytes) + request.body.byteLength
}

export type HandoffStatus = 200 | 204 | 400 | 404 | 409

/**
 * Builds a response.
 *
 * The CORS headers are here because a browser will not hand jojo the response
 * without them — not because they protect anything. What protects the socket is
 * the token in the path; see the note at the top.
 */
export function writeResponse(status: HandoffStatus, body?: Uint8Array): Uint8Array {
  const payload = body ?? new Uint8Array(0)
  const reason: Record<HandoffStatus, string> = {
    200: 'OK',
    204: 'No Content',
    400: 'Bad Request',
    404: 'Not Found',
    409: 'Conflict',
  }
  const head =
    `HTTP/1.1 ${status} ${reason[status]}\r\n` +
    `Content-Type: application/octet-stream\r\n` +
    `Content-Length: ${payload.byteLength}\r\n` +
    `Access-Control-Allow-Origin: *\r\n` +
    `Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n` +
    `Access-Control-Allow-Headers: content-type\r\n` +
    // Closed after every response. Keep-alive would mean tracking connection
    // state on a device that is doing this once, for a minute, and then never
    // again — and a half-closed socket left behind is a bug nobody finds.
    `Connection: close\r\n\r\n`

  const out = new Uint8Array(head.length + payload.byteLength)
  for (let i = 0; i < head.length; i += 1) out[i] = head.charCodeAt(i) & 0xff
  out.set(payload, head.length)
  return out
}
