/**
 * The seam the pairing rests on: what the computer draws, the phone reads back
 * as the exact same bytes (Q329).
 *
 * Drawn here with `uqr` and the same options `web/src/lib/pairing-qr.ts` uses —
 * byte mode, level M, no border — then laid on a grey "photograph" the size the
 * scanner page sends (`SIDE`), the way a camera sees a laptop screen: off-centre,
 * a little small, blurred, with sensor noise. Read with this app's own
 * `readPairingQr`, which is what `PairingScanner` calls on every frame.
 */

import { describe, expect, it } from 'vitest'
import { encode } from 'uqr'
import { beginPairing, encodeOffer } from '@jojo/service/core/pairing'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import { SIDE } from '@/components/transfer/scanner-page'
import { readPairingQr } from './pairing-qr'

type Shot = {
  /** Fraction of the frame's width the code (quiet zone included) covers. */
  span?: number
  /** Where its centre sits, as a fraction of the frame. */
  at?: [number, number]
  /** Box-blur radius in pixels. */
  blur?: number
  /** Peak noise, in grey levels either way. */
  noise?: number
  /** Seed for the noise — a different value is a different frame of the same view. */
  seed?: number
}

/** A grayscale frame of a code drawn from `bytes`, as the scanner would send it. */
function photograph(bytes: Uint8Array | string, shot: Shot = {}): Uint8Array {
  const { span = 0.6, at = [0.5, 0.5], blur = 0, noise = 0, seed: firstSeed = 7 } = shot
  const { size, data } = encode(typeof bytes === 'string' ? bytes : Array.from(bytes), {
    ecc: 'M',
    border: 0,
  })
  const quiet = 4
  const modules = size + quiet * 2
  const side = SIDE * span
  const left = SIDE * at[0] - side / 2
  const top = SIDE * at[1] - side / 2

  // A dim, uneven desk around a white card.
  let frame = new Uint8Array(SIDE * SIDE)
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      const u = Math.floor(((x + 0.5 - left) / side) * modules) - quiet
      const v = Math.floor(((y + 0.5 - top) / side) * modules) - quiet
      const onCard = u >= -quiet && v >= -quiet && u < size + quiet && v < size + quiet
      const dark = onCard && u >= 0 && v >= 0 && u < size && v < size && data[v]![u]
      frame[y * SIDE + x] = !onCard ? 40 + ((x + y) % 30) : dark ? 25 : 235
    }
  }

  if (blur > 0) {
    const out = new Uint8Array(frame.length)
    for (let y = 0; y < SIDE; y += 1) {
      for (let x = 0; x < SIDE; x += 1) {
        let sum = 0
        let n = 0
        for (let dy = -blur; dy <= blur; dy += 1) {
          for (let dx = -blur; dx <= blur; dx += 1) {
            const sx = x + dx
            const sy = y + dy
            if (sx < 0 || sy < 0 || sx >= SIDE || sy >= SIDE) continue
            sum += frame[sy * SIDE + sx]!
            n += 1
          }
        }
        out[y * SIDE + x] = Math.round(sum / n)
      }
    }
    frame = out
  }

  if (noise > 0) {
    // Deterministic, so a failure is the same failure every run.
    let seed = firstSeed
    for (let i = 0; i < frame.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const jitter = ((seed / 0x7fffffff) * 2 - 1) * noise
      frame[i] = Math.max(0, Math.min(255, Math.round(frame[i]! + jitter)))
    }
  }
  return frame
}

async function anOffer(): Promise<Uint8Array> {
  const state = await beginPairing(createSecrets(), Date.UTC(2026, 10, 16))
  return encodeOffer(state.offer)
}

describe('readPairingQr', () => {
  it('reads the exact offer back from a code drawn the way the computer draws it', async () => {
    const offer = await anOffer()
    expect(readPairingQr(photograph(offer), SIDE, SIDE)).toEqual(offer)
  })

  it('reads it off-centre, blurred and noisy, as a hand-held phone sees it', async () => {
    // Half the frame is what the scanner's zoomed view makes of a code held at
    // a normal distance (see "Near and far" in scanner-page.ts).
    //
    // The scanner reads about six frames a second, so a pairing never rests on
    // one frame: a hand-held code is a burst of slightly different photographs
    // — new sensor noise, the hand drifting a pixel or two. The offer is random
    // every run, and about one code in fifty loses a single frame this degraded
    // (measured over 400 offers); none lost three in a row. So the burst is
    // five frames, any one of which must read back exactly — and no frame may
    // ever read back as something else.
    const offer = await anOffer()
    const burst = [
      { at: [0.45, 0.55], seed: 7 },
      { at: [0.46, 0.54], seed: 31 },
      { at: [0.44, 0.55], seed: 99 },
      { at: [0.45, 0.56], seed: 211 },
      { at: [0.47, 0.55], seed: 503 },
    ] as const
    const reads = burst.map(({ at, seed }) =>
      readPairingQr(photograph(offer, { span: 0.5, at: [...at], blur: 1, noise: 8, seed }), SIDE, SIDE),
    )
    for (const read of reads) if (read !== null) expect(read).toEqual(offer)
    expect(reads.some((read) => read !== null)).toBe(true)
  })

  it('reads a code that fills only two-fifths of the frame', async () => {
    const offer = await anOffer()
    expect(readPairingQr(photograph(offer, { span: 0.4 }), SIDE, SIDE)).toEqual(offer)
  })

  it('ignores a stranger’s QR code', () => {
    expect(readPairingQr(photograph('https://example.com/menu'), SIDE, SIDE)).toBeNull()
  })

  it('ignores a code of the right length that is not a jojo offer', async () => {
    const offer = await anOffer()
    const foreign = offer.slice()
    foreign[0] ^= 0xff
    expect(readPairingQr(photograph(foreign), SIDE, SIDE)).toBeNull()
  })

  it('returns null for a frame with no code, and for a buffer of the wrong size', () => {
    expect(readPairingQr(new Uint8Array(SIDE * SIDE).fill(120), SIDE, SIDE)).toBeNull()
    expect(readPairingQr(new Uint8Array(10), SIDE, SIDE)).toBeNull()
  })
})
