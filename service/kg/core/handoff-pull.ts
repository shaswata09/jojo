/**
 * Phone to computer: the computer pulls the phone's backup.
 *
 * ## Why the computer asks rather than the phone sending
 *
 * A web page cannot accept a connection, so the phone can never connect to the
 * computer. It does not need to. The phone already listens on the local network
 * for the computer-to-phone direction; a browser that can connect and POST to it
 * can just as well connect and READ from it. So the roles of the sockets stay
 * exactly as they are and only the records change hands: the computer asks for
 * chunk 0, then chunk 1, until the phone hands over the one marked last.
 *
 * ## The pairing is unchanged, deliberately
 *
 * The computer shows its QR code and the phone's camera reads it, as before.
 * The phone answers with its key and the proof that it read the screen
 * (`core/pairing.ts`), and the computer refuses to ask for anything until that
 * proof has checked out. Nothing about which way the records go touches the
 * handshake, so nothing about its security changes either.
 *
 * ## What each side checks
 *
 * THE PHONE serves a chunk only to a request that proves it holds this
 * session's key. The proof is an HMAC-style tag derived from the
 * computer-to-phone key — which only the device that showed the code and
 * the device that read it can derive — over the chunk number. The path token
 * (`handoff.ts`) already keeps out a page that never saw the screen; the proof
 * also keeps out anything that saw the URL go past on the network, because the
 * URL travels in the clear and the key never does.
 *
 * THE COMPUTER accepts a chunk only if it authenticates under the
 * phone-to-computer key, in order, with the last one saying it is last
 * (`convoy.ts`). A forged, reordered, replayed or truncated stream never
 * completes. It also stops at a size limit, because the far end of this socket
 * is a device on somebody's network, and a stream that never says "last" must
 * not be read until the tab runs out of memory.
 *
 * ## The one thing the phone must never do
 *
 * Seal two DIFFERENT payloads under one key. The nonce is the chunk number, so
 * resealing chunk 3 from a backup that changed in between would put two
 * plaintexts under one key and one nonce — the GCM failure that leaks both. So
 * the backup is built ONCE, on the first proven request, and every later request
 * is answered from those same bytes. Asking for a chunk twice gets the same
 * ciphertext twice, which reveals nothing new.
 */

import { CHUNK_BYTES, createConvoyReceiver, planConvoy, type ConvoyPlan } from './convoy'
import { PULL_REQUEST_BYTES, type HandoffStatus } from './handoff'
import { sameTag, type SessionKeys } from './pairing'
import type { Secrets } from './secrets'

/** Domain separation for the proof, so it can never equal any other derived value. */
const LABEL = 'jojo/handoff/pull/v1'

/**
 * The most the computer will take from a phone.
 *
 * Generous for a job search — records are kilobytes and the documents are a
 * handful of PDFs — and small enough that a phone which never says "last"
 * cannot hold a tab's memory hostage. A real phone would struggle to build a
 * backup this large before the computer refused it.
 */
export const MAX_PULL_BYTES = 256 * 1024 * 1024

/**
 * The most chunks the computer will ask for.
 *
 * Separate from the byte limit because a chunk can be EMPTY: a stream of empty
 * chunks that never says "last" adds nothing to the byte count and would ask
 * forever. One more than a full-size payload needs, because an empty payload is
 * still one chunk.
 */
export const MAX_PULL_CHUNKS = Math.ceil(MAX_PULL_BYTES / CHUNK_BYTES) + 1

/** One sealed chunk is at most this long. Anything longer is not one. */
export const MAX_SEALED_CHUNK = CHUNK_BYTES + 16

const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f
  return out
}

const seqBytes = (seq: number): Uint8Array =>
  new Uint8Array([(seq >>> 24) & 0xff, (seq >>> 16) & 0xff, (seq >>> 8) & 0xff, seq & 0xff])

/**
 * The proof that whoever asks for chunk `seq` holds this session's key.
 *
 * Derived from `offererToAnswerer` — the computer-to-phone key, which in this
 * direction encrypts nothing — with its own label, so the tag is unrelated to
 * any key that seals data. Over the chunk number, so the proof for one chunk is
 * not the proof for another.
 */
export async function pullProof(
  secrets: Secrets,
  keys: SessionKeys,
  seq: number,
): Promise<Uint8Array> {
  const info = new Uint8Array(LABEL.length + 4)
  info.set(ascii(LABEL), 0)
  info.set(seqBytes(seq), LABEL.length)
  return secrets.derive(keys.offererToAnswerer, new Uint8Array(0), info, 32)
}

/** The body of one pull request: seq(4) then proof(32). */
export async function encodePullRequest(
  secrets: Secrets,
  keys: SessionKeys,
  seq: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(PULL_REQUEST_BYTES)
  out.set(seqBytes(seq), 0)
  out.set(await pullProof(secrets, keys, seq), 4)
  return out
}

/** Reads a pull request's body. Null for anything that is not exactly one. */
export function decodePullRequest(body: Uint8Array): { seq: number; proof: Uint8Array } | null {
  if (body.byteLength !== PULL_REQUEST_BYTES) return null
  const seq = ((body[0]! << 24) | (body[1]! << 16) | (body[2]! << 8) | body[3]!) >>> 0
  return { seq, proof: body.slice(4) }
}

/* --- the phone's half ------------------------------------------------------ */

export type PullAnswer = { status: HandoffStatus; body?: Uint8Array }

export type PullServing = {
  /** Chunks handed over at least once. */
  served: number
  /** How many chunks the backup became, once it has been built. */
  chunks: number | null
  /** Payload bytes, once built. */
  size: number | null
  /** True once the chunk marked last has been handed over. */
  finished: boolean
  /** True if gathering the backup failed. Nothing was handed over. */
  failed: boolean
}

export type PullServer = {
  /** Answers one pull request's body. Never rejects. */
  answer: (body: Uint8Array) => Promise<PullAnswer>
  progress: () => PullServing
}

/**
 * The phone's answer to "give me chunk N".
 *
 * `build` gathers the backup and is called at most once — on the first request
 * that carries a valid proof, not before. Gathering reads every record and
 * document on the phone, and a request from something that cannot prove it is
 * the paired computer must not be able to make the phone do that.
 */
export function createPullServer(
  secrets: Secrets,
  keys: SessionKeys,
  build: () => Promise<Uint8Array>,
): PullServer {
  let plan: Promise<ConvoyPlan | null> | null = null
  let size: number | null = null
  let chunks: number | null = null
  let failed = false
  let finished = false
  const served = new Set<number>()

  const planned = (): Promise<ConvoyPlan | null> => {
    // Memoised as a PROMISE, so two requests that arrive together share one
    // build. Two builds would be two payloads, and see the header for what
    // sealing two payloads under one key costs.
    plan ??= build().then(
      (payload) => {
        // Sealed with the phone-to-computer key. The computer-to-phone key is
        // the proof's, and one key used both ways would put two counters in
        // one nonce space.
        const made = planConvoy(secrets, keys.answererToOfferer, payload)
        size = made.size
        chunks = made.chunks
        return made
      },
      () => {
        failed = true
        return null
      },
    )
    return plan
  }

  const answer = async (body: Uint8Array): Promise<PullAnswer> => {
    const read = decodePullRequest(body)
    if (read === null) return { status: 400 }

    // The proof first, before anything is built. 404, the same answer a wrong
    // token gets: a request that cannot prove itself learns nothing, not even
    // that it reached the right phone.
    const expected = await pullProof(secrets, keys, read.seq)
    if (!sameTag(expected, read.proof)) return { status: 404 }

    const made = await planned()
    if (made === null) return { status: 409 }
    if (read.seq >= made.chunks) return { status: 404 }

    const sealed = await made.seal(read.seq)
    served.add(read.seq)
    if (read.seq === made.chunks - 1) finished = true
    return { status: 200, body: sealed }
  }

  const progress = (): PullServing => ({ served: served.size, chunks, size, finished, failed })

  return { answer, progress }
}

/* --- the computer's half --------------------------------------------------- */

export type PullFailure =
  /** A chunk did not authenticate: damaged, forged, replayed or reordered. */
  | 'pull/forged'
  /** More than the computer will take, or a chunk longer than any real one. */
  | 'pull/oversized'
  /** The person walked away. */
  | 'pull/cancelled'

export type PullResult<E> = { ok: true; payload: Uint8Array } | { ok: false; error: PullFailure | E }

/**
 * Asks for chunks until the phone hands over the last one.
 *
 * `fetchChunk` is the transport — a `fetch` on the web, a stub in a test — and
 * its failures pass straight through. Only call this with keys that came out of
 * `completePairing`: those are what say the phone read this screen, and this
 * function has no other way to know.
 */
export async function runPull<E>({
  secrets,
  keys,
  fetchChunk,
  onBytes,
  cancelled = () => false,
  maxBytes = MAX_PULL_BYTES,
  maxChunks = MAX_PULL_CHUNKS,
}: {
  secrets: Secrets
  keys: SessionKeys
  fetchChunk: (request: Uint8Array) => Promise<{ ok: true; value: Uint8Array } | { ok: false; error: E }>
  onBytes?: (bytes: number) => void
  cancelled?: () => boolean
  maxBytes?: number
  maxChunks?: number
}): Promise<PullResult<E>> {
  // Opened with the phone-to-computer key, the one the phone seals with.
  const convoy = createConvoyReceiver(secrets, keys.answererToOfferer)

  for (let seq = 0; seq < maxChunks; seq += 1) {
    if (cancelled()) return { ok: false, error: 'pull/cancelled' }
    const got = await fetchChunk(await encodePullRequest(secrets, keys, seq))
    if (!got.ok) return { ok: false, error: got.error }
    if (got.value.byteLength > MAX_SEALED_CHUNK) return { ok: false, error: 'pull/oversized' }

    const outcome = await convoy.accept(got.value)
    if (outcome === 'rejected' || outcome === 'finished') return { ok: false, error: 'pull/forged' }

    const at = convoy.progress()
    if (at.bytes > maxBytes) return { ok: false, error: 'pull/oversized' }
    onBytes?.(at.bytes)

    if (outcome === 'complete') {
      const payload = convoy.payload()
      // Cannot be null once complete; checked so the type says so too.
      return payload === null ? { ok: false, error: 'pull/forged' } : { ok: true, payload }
    }
  }
  // Ran out of chunks without one saying it was last.
  return { ok: false, error: 'pull/oversized' }
}

/**
 * A JSON string as bytes, every non-ASCII character escaped.
 *
 * The phone has no `TextEncoder` it can rely on (Hermes; see `core/utf8.ts` for
 * the decoder's half of that story). It does not need one: JSON can say any
 * character as `\uXXXX`, so escaping everything above 0x7F leaves a string that
 * is ASCII from end to end — one byte per character — and parses back to the
 * same value. A character outside the BMP is two UTF-16 halves, escaped one at
 * a time, and `JSON.parse` puts them back together.
 *
 * Only valid on the output of `JSON.stringify`, where the only non-ASCII
 * characters are inside strings.
 */
export function asciiJsonBytes(json: string): Uint8Array {
  // Two passes rather than an array of numbers: a backup is megabytes of base64,
  // and a JavaScript array holds each byte in eight.
  let size = 0
  for (let i = 0; i < json.length; i += 1) size += json.charCodeAt(i) < 0x80 ? 1 : 6
  const out = new Uint8Array(size)
  const hex = '0123456789abcdef'
  let at = 0
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i)
    if (code < 0x80) {
      out[at++] = code
      continue
    }
    out[at++] = 0x5c // \
    out[at++] = 0x75 // u
    out[at++] = hex.charCodeAt((code >> 12) & 0xf)
    out[at++] = hex.charCodeAt((code >> 8) & 0xf)
    out[at++] = hex.charCodeAt((code >> 4) & 0xf)
    out[at++] = hex.charCodeAt(code & 0xf)
  }
  return out
}
