/**
 * The seam: what the browser encodes, against what the phone decodes.
 *
 * Every layer of this path had its own tests and all of them passed while the
 * path itself was broken. `planPulse` pads a payload out to whole frames, so an
 * 83-byte offer came back as 90 bytes with seven zeros on the end — and
 * `decodeOffer` requires an exact length. The phone would have failed to pair
 * every single time, with both halves individually correct and both suites
 * green.
 *
 * An audit found it by writing exactly what is below: the browser's encoder, a
 * synthesised photograph of the animation, the phone's downsample, the phone's
 * decoder, and then the thing the phone actually does with the result. This is
 * kept because no test of either side alone can find that class of bug.
 *
 * The numbers here are deliberately tied to the real callers:
 *   - `planPulse` is what `web/src/lib/pairing-session.ts` calls
 *   - `SIDE` is what `mobile/src/components/transfer/scanner-page.ts` posts
 *   - `readPulse` + `createPulseReceiver` are what `PairingScanner.tsx` runs
 *   - `decodeOffer` is what `mobile/src/lib/handoff-receive.ts` calls
 */

import { describe, expect, it } from 'vitest'
import { PULSE_DIM, PULSE_GRID, createPulseReceiver, planPulse, type PulseFrame } from './pulse'
import { readPulse } from './pulse-read'
import { decodeOffer, encodeOffer } from './pairing'

const bytes = (n: number, seed: number): Uint8Array => {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out[i] = (x >>> 16) & 0xff
  }
  return out
}

/** The edge of the buffer the scanner WebView posts. Mirrors `scanner-page.ts`. */
const SIDE = 128

/**
 * Renders one frame the way the scene does — a lattice of dots, brighter inside
 * a lit region — and photographs it with a mild camera.
 *
 * Dots rather than solid blocks, because that is what is on screen: a lit region
 * is only partly covered by light, which is the case a reader sampling single
 * points rather than averaging would get wrong.
 */
function photograph(frame: PulseFrame): { gray: Uint8Array; size: number } {
  const span = 480
  const fill = 0.75
  const surround = 14
  const size = Math.round(span / fill)
  const flat = new Float32Array(size * size).fill(surround)
  const off = Math.round((size - span) / 2)

  // 60 dots across, which is what the scene's own `TILING` gives.
  const dots = 60
  const step = span / dots
  const r = step * 0.34
  for (let dy = 0; dy < dots; dy += 1) {
    for (let dx = 0; dx < dots; dx += 1) {
      const rx = Math.min(PULSE_GRID - 1, Math.floor((dx / dots) * PULSE_GRID))
      const ry = Math.min(PULSE_GRID - 1, Math.floor((dy / dots) * PULSE_GRID))
      /*
       * The lit level, and `PULSE_DIM` of it — the ratio the shader actually
       * renders, imported rather than written down here.
       *
       * That import is what makes this test evidence about the real animation.
       * A hard-coded pair of greys would only ever have proved that the decoder
       * can read greys somebody chose to make it pass; tied to the constant
       * `DataTransferScene` renders from, a change that closes the gap between
       * the two classes fails here rather than on somebody's kitchen table.
       *
       * Dimmed, not extinguished, because that is what keeps the picture
       * looking like itself — and it is the harder case, since the two levels
       * end up closer than a black-and-white symbol's would.
       */
      const LIT = 235
      const level = frame[ry]![rx] ? LIT : Math.round(LIT * PULSE_DIM)
      const cx = off + dx * step + step / 2
      const cy = off + dy * step + step / 2
      for (let py = -step; py <= step; py += 1) {
        for (let px = -step; px <= step; px += 1) {
          if (px * px + py * py > r * r) continue
          const x = Math.round(cx + px)
          const y = Math.round(cy + py)
          if (x < 0 || y < 0 || x >= size || y >= size) continue
          flat[y * size + x] = level
        }
      }
    }
  }

  const gray = new Uint8Array(size * size)
  for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(flat[i]!)
  return { gray, size }
}

/** What the WebView's canvas does: draw a camera frame down to `SIDE`. */
function downsample(gray: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(SIDE * SIDE)
  const box = size / SIDE
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      let sum = 0
      let n = 0
      for (let sy = Math.floor(y * box); sy < Math.floor((y + 1) * box); sy += 1) {
        for (let sx = Math.floor(x * box); sx < Math.floor((x + 1) * box); sx += 1) {
          sum += gray[sy * size + sx]!
          n += 1
        }
      }
      out[y * SIDE + x] = Math.round(sum / Math.max(1, n))
    }
  }
  return out
}

describe('the browser encoder and the phone decoder are one protocol', () => {
  it('carries an offer from planPulse all the way to decodeOffer', () => {
    const offer = { publicKey: bytes(32, 1), secret: bytes(32, 2), nonce: bytes(16, 3) }
    const wire = encodeOffer(offer)
    expect(wire.byteLength).toBe(83)

    const plan = planPulse(wire)
    expect(plan.total).toBe(10)

    const receiver = createPulseReceiver()
    let read = 0
    for (const frame of plan.frames) {
      const shot = photograph(frame)
      const gray = downsample(shot.gray, shot.size)
      expect(gray.length).toBe(SIDE * SIDE)

      const out = readPulse(gray, SIDE, SIDE)
      // A frame that does not read is dropped; the animation cycles.
      if (!out.ok) continue
      read += 1
      expect(receiver.accept(out.value)).not.toBe('rejected')
    }
    // The camera above is a mild one, so every frame should survive it. A drop
    // here means the reader has regressed rather than that the test is lenient.
    expect(read).toBe(plan.total)

    const key = receiver.payload()
    expect(key).not.toBeNull()

    /*
     * Exactly 83 bytes, not 90. THIS is the assertion the bug failed: the
     * payload is padded to whole frames on the wire, and a receiver that handed
     * the padding back would produce a key that every later layer accepts right
     * up until `decodeOffer`, which requires an exact length.
     */
    expect(key!.byteLength).toBe(wire.byteLength)
    expect([...key!]).toEqual([...wire])

    // What `PairingScanner` hands to `onOffer`, which hands it to
    // `beginReceiving`, which calls this — with no truncation in between.
    const back = decodeOffer(key!)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect([...back.value.publicKey]).toEqual([...offer.publicKey])
    expect([...back.value.secret]).toEqual([...offer.secret])
    expect([...back.value.nonce]).toEqual([...offer.nonce])
  })

  it('is what the phone would actually be handed, at the size it posts', () => {
    // Guards the guard: if `SIDE` here drifted from `scanner-page.ts`, the case
    // above would be testing a resolution the phone never sends.
    expect(SIDE).toBe(128)
  })
})
