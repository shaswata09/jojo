/**
 * Moving the backup, once the two devices have agreed a key.
 *
 * `pairing.ts` ends with two keys and nothing sent. This is what sends: the
 * whole backup, in sealed chunks, over whatever ordered byte channel the
 * platform managed to open — a TCP socket, a WebRTC data channel, anything that
 * delivers bytes in the order they went in.
 *
 * ## What the channel is assumed to do, and what it is not trusted to do
 *
 * ASSUMED: ordered and reliable. TCP and a WebRTC data channel both are, and
 * rebuilding retransmission on top of one would be inventing a problem. That is
 * the difference between this and `pulse.ts`, whose indexed frames cycle forever
 * because a camera drops them and cannot ask again.
 *
 * NOT TRUSTED: anything else. The channel runs across somebody's wifi, so every
 * chunk is sealed under a key only the two paired devices hold, and every chunk
 * says where it belongs. An attacker who can read the wire learns the SIZE of
 * the transfer and nothing else; one who can write it can stop the transfer and
 * cannot alter it.
 *
 * ## The three things a stream cipher has to get right, and how each is
 *
 * REPLAY AND REORDER. Every chunk carries its sequence number in the AEAD's
 * additional data, and the receiver only ever accepts the next one. A chunk
 * moved, duplicated or held back fails to authenticate rather than landing in
 * the wrong place.
 *
 * TRUNCATION. An attacker who simply stops relaying would otherwise leave the
 * receiver holding a prefix of the backup and no way to know. So the last chunk
 * SAYS it is last, inside the authenticated data — an attacker cannot set that
 * flag on an earlier chunk, and a receiver that never sees it never completes.
 * This is the failure that would be silent, and it is the reason the flag is
 * authenticated rather than merely present.
 *
 * NONCE REUSE. Fatal for GCM — two chunks under one key and one nonce leak their
 * plaintexts to xor. The nonce here is the sequence number and nothing else, so
 * a repeat is not possible without a repeat of the sequence, which the receiver
 * refuses. The two directions use SEPARATE KEYS (see `SessionKeys`), so the two
 * counters cannot collide either.
 */

import type { Secrets } from './secrets'

/** Domain separation, and the version both ends must agree on. */
const LABEL = 'jojo/convoy/v1'

/**
 * Payload bytes per chunk.
 *
 * 64 KiB is a compromise between two costs that pull opposite ways: every chunk
 * pays a 16-byte authentication tag and a round of AEAD setup, and every chunk
 * is also the unit of progress a person watches move. Smaller chunks make a
 * smoother bar and a slower transfer; larger ones make the bar jump. At 64 KiB a
 * 10 MB backup is 160 chunks — the tag overhead is 0.004% and the bar moves
 * often enough to look alive.
 */
export const CHUNK_BYTES = 64 * 1024

/** seq(4) + final(1). Authenticated, not encrypted — see the note on truncation. */
const AAD_BYTES = 5

export type ConvoyPlan = {
  /** Payload size in bytes. */
  size: number
  /** How many sealed chunks it becomes. */
  chunks: number
  /** Seals chunk `seq`. Sequential; the last one is flagged inside its own AAD. */
  seal: (seq: number) => Promise<Uint8Array>
}

export type ConvoyOutcome =
  /** Read, authenticated, and kept. */
  | 'accepted'
  /** Authenticated and it was the last one. The payload is ready. */
  | 'complete'
  /** Did not authenticate: damaged, forged, replayed, reordered, or truncated. */
  | 'rejected'
  /** Arrived after the transfer already finished. */
  | 'finished'

const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f
  return out
}

/**
 * What each chunk commits to, beyond its own bytes.
 *
 * The label pins the protocol and version, so a chunk cannot be lifted out of
 * some other use of the same key. The sequence pins position. The flag pins the
 * end of the stream.
 */
function aad(seq: number, final: boolean): Uint8Array {
  const label = ascii(LABEL)
  const out = new Uint8Array(label.byteLength + AAD_BYTES)
  out.set(label, 0)
  const at = label.byteLength
  out[at] = (seq >>> 24) & 0xff
  out[at + 1] = (seq >>> 16) & 0xff
  out[at + 2] = (seq >>> 8) & 0xff
  out[at + 3] = seq & 0xff
  out[at + 4] = final ? 1 : 0
  return out
}

/**
 * The nonce for a chunk: its sequence number, big-endian, in 12 bytes.
 *
 * No random part and no fixed prefix, deliberately. A random nonce would risk a
 * birthday collision under one key; a counter cannot repeat unless the sequence
 * repeats, and the receiver refuses that. The two directions never share a key,
 * so their counters are independent.
 */
function nonceFor(seq: number): Uint8Array {
  const out = new Uint8Array(12)
  out[8] = (seq >>> 24) & 0xff
  out[9] = (seq >>> 16) & 0xff
  out[10] = (seq >>> 8) & 0xff
  out[11] = seq & 0xff
  return out
}

export function planConvoy(
  secrets: Secrets,
  key: Uint8Array,
  payload: Uint8Array,
  chunkBytes = CHUNK_BYTES,
): ConvoyPlan {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error('a convoy chunk must be a positive whole number of bytes')
  }
  // An empty payload is still one chunk. A transfer with no chunks would have no
  // final flag, so the receiver would wait for an end that never came.
  const chunks = Math.max(1, Math.ceil(payload.byteLength / chunkBytes))

  return {
    size: payload.byteLength,
    chunks,
    seal: async (seq: number): Promise<Uint8Array> => {
      if (seq < 0 || seq >= chunks) throw new Error('no such chunk')
      const slice = payload.subarray(seq * chunkBytes, (seq + 1) * chunkBytes)
      return secrets.seal(key, nonceFor(seq), slice, aad(seq, seq === chunks - 1))
    },
  }
}

export type ConvoyProgress = {
  /** Chunks accepted so far. */
  chunks: number
  /** Payload bytes held so far — what a progress bar should read. */
  bytes: number
  /** True once the chunk marked final has been authenticated. */
  complete: boolean
}

export type ConvoyReceiver = {
  accept: (sealed: Uint8Array) => Promise<ConvoyOutcome>
  progress: () => ConvoyProgress
  /** The payload, or null until the final chunk has arrived and authenticated. */
  payload: () => Uint8Array | null
}

/**
 * Accumulates a convoy.
 *
 * Strictly sequential: it will only ever try the NEXT sequence number. Anything
 * else fails to authenticate, because the sequence is in the additional data —
 * so a reordered, duplicated or injected chunk is refused by the cipher rather
 * than by a check that could be forgotten.
 */
export function createConvoyReceiver(secrets: Secrets, key: Uint8Array): ConvoyReceiver {
  const held: Uint8Array[] = []
  let next = 0
  let bytes = 0
  let done = false

  const accept = async (sealed: Uint8Array): Promise<ConvoyOutcome> => {
    if (done) return 'finished'

    /*
     * Two attempts, and only two: this chunk as an ordinary one, and as the
     * final one. The flag is inside the authenticated data, so the receiver
     * cannot read it before deciding — it has to try both and let the tag say
     * which was true. That is what makes truncation detectable: an attacker
     * cannot move the flag, and a receiver that never authenticates a final
     * chunk never returns a payload.
     */
    const nonce = nonceFor(next)
    const plain = await secrets.open(key, nonce, sealed, aad(next, false))
    if (plain !== null) {
      held.push(plain)
      bytes += plain.byteLength
      next += 1
      return 'accepted'
    }

    const last = await secrets.open(key, nonce, sealed, aad(next, true))
    if (last === null) return 'rejected'

    held.push(last)
    bytes += last.byteLength
    next += 1
    done = true
    return 'complete'
  }

  const progress = (): ConvoyProgress => ({ chunks: held.length, bytes, complete: done })

  const payload = (): Uint8Array | null => {
    if (!done) return null
    const out = new Uint8Array(bytes)
    let at = 0
    for (const part of held) {
      out.set(part, at)
      at += part.byteLength
    }
    return out
  }

  return { accept, progress, payload }
}
