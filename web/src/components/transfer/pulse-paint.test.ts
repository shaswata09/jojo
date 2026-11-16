/**
 * The fallback pulse, read back by the phone's reader.
 *
 * `PulseOverlay` is what pairs a phone whenever the WebGPU scene cannot draw the
 * key — no adapter, the scene's chunk missing offline, or the animation switched
 * off. Its pixels come from `paintPulse` and nothing else, so this follows those
 * pixels through what the phone does to them and asserts the offer comes out.
 *
 * Mirrors `service/kg/core/pulse-seam.test.ts`, with the overlay's own pixels in
 * place of a synthesised picture of the scene:
 *   - `planPulse` is what `web/src/lib/pairing-session.ts` calls
 *   - the luma weights and the 128-pixel square are what
 *     `mobile/src/components/transfer/scanner-page.ts` posts
 *   - `readPulse` + `createPulseReceiver` are what `PairingScanner.tsx` runs
 *   - `decodeOffer` is what `mobile/src/lib/handoff-receive.ts` calls
 */

import { describe, expect, it } from 'vitest'
import { PULSE_DIM, PULSE_GRID, createPulseReceiver, planPulse } from '@jojo/service/core/pulse'
import { readPulse } from '@jojo/service/core/pulse-read'
import { decodeOffer, encodeOffer } from '@jojo/service/core/pairing'
import { PULSE_GROUND_RGB, PULSE_LIT_RGB, paintPulse, pulseSquare } from './pulse-paint'

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

/** The scanner's Rec. 601 luma, in the same integer form. */
const luma = (r: number, g: number, b: number) => (r * 77 + g * 150 + b * 29) >> 8

type Shot = {
  /** The canvas's size in device pixels. */
  width: number
  height: number
  /**
   * How much of the camera's square crop the canvas's SHORTER edge spans. A
   * person frames the pattern, not the canvas around it, so a canvas wider than
   * it is tall runs off the sides of the crop.
   */
  fill: number
  /** The page around the canvas, as luma: a dark theme's panel or a light one. */
  surround: number
  /** Quarter turns the phone is held at. */
  turns?: number
  /** Box-blur radius in photo pixels: a camera slightly out of focus. */
  blur?: number
}

/**
 * The overlay's pixels as the phone's camera sees them: on a page, in the
 * square the scanner crops to, in grey.
 */
function photograph(rgba: Uint8ClampedArray, shot: Shot): { gray: Uint8Array; size: number } {
  const { width, height, fill, surround, turns = 0, blur = 0 } = shot
  const size = Math.round(Math.min(width, height) / fill)
  let flat = new Uint8Array(size * size).fill(surround)
  const ox = Math.round((size - width) / 2)
  const oy = Math.round((size - height) / 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = ox + x
      const py = oy + y
      // Outside the crop: the camera never saw it.
      if (px < 0 || py < 0 || px >= size || py >= size) continue
      const at = (y * width + x) * 4
      flat[py * size + px] = luma(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!)
    }
  }

  for (let t = 0; t < turns; t += 1) {
    const turned = new Uint8Array(size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) turned[x * size + (size - 1 - y)] = flat[y * size + x]!
    }
    flat = turned
  }

  if (blur > 0) {
    const out = new Uint8Array(size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let sum = 0
        let n = 0
        for (let dy = -blur; dy <= blur; dy += 1) {
          for (let dx = -blur; dx <= blur; dx += 1) {
            const sx = x + dx
            const sy = y + dy
            if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue
            sum += flat[sy * size + sx]!
            n += 1
          }
        }
        out[y * size + x] = Math.round(sum / n)
      }
    }
    flat = out
  }
  return { gray: flat, size }
}

/** What the WebView's canvas does: draw the square crop down to `SIDE`. */
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

/** Every frame of a real offer, painted, photographed, read and reassembled. */
function pair(shot: Shot) {
  const offer = { publicKey: bytes(32, 1), secret: bytes(32, 2), nonce: bytes(16, 3) }
  const wire = encodeOffer(offer)
  const plan = planPulse(wire)

  const receiver = createPulseReceiver()
  let read = 0
  for (const frame of plan.frames) {
    const photo = photograph(paintPulse(frame, shot.width, shot.height), shot)
    const out = readPulse(downsample(photo.gray, photo.size), SIDE, SIDE)
    if (!out.ok) continue
    read += 1
    expect(receiver.accept(out.value)).not.toBe('rejected')
  }
  return { offer, wire, plan, read, key: receiver.payload() }
}

/*
 * The pages are the app's own panels: `--panel` is #1f1f1f dark (31 in luma)
 * and #f7f7f7 light (247). `fill` is how much of the camera's square the
 * canvas's shorter edge spans — see the limit noted in `pulse-paint.ts` for why
 * a light page needs the pattern framed closer than a dark one.
 */
const SHOTS: [string, Shot][] = [
  ['a square canvas on the dark panel', { width: 360, height: 360, fill: 0.8, surround: 31 }],
  ['a square canvas on the light panel', { width: 360, height: 360, fill: 0.85, surround: 247 }],
  [
    'a wide canvas on the light panel, the grid centred in it',
    { width: 480, height: 300, fill: 0.7, surround: 247 },
  ],
  [
    'the phone held sideways, slightly out of focus',
    { width: 400, height: 400, fill: 0.8, surround: 31, turns: 1, blur: 3 },
  ],
  [
    'upside down, small in the frame',
    { width: 240, height: 240, fill: 0.55, surround: 14, turns: 2 },
  ],
]

describe('the fallback pulse is something the phone can read', () => {
  it.each(SHOTS)('carries an offer from planPulse to decodeOffer: %s', (_, shot) => {
    const { offer, wire, plan, read, key } = pair(shot)

    // Every frame, not most: these cameras are mild, and the animation cycling
    // past a dropped frame would only hide a reader that had stopped reading.
    expect(read).toBe(plan.total)
    expect(key).not.toBeNull()
    expect([...key!]).toEqual([...wire])

    const back = decodeOffer(key!)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect([...back.value.publicKey]).toEqual([...offer.publicKey])
    expect([...back.value.secret]).toEqual([...offer.secret])
    expect([...back.value.nonce]).toEqual([...offer.nonce])
  })

  it('paints dim at the ratio the scene renders, both above the ground', () => {
    const frame = planPulse(bytes(4, 9)).frames[0]!
    const W = 120
    const rgba = paintPulse(frame, W, W)
    const { x: x0, y: y0, side } = pulseSquare(W, W)
    const level = (x: number, y: number) => {
      const i = (y * W + x) * 4
      return luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
    }
    /** The pixel at the middle of region (rx, ry). */
    const centre = (rx: number, ry: number) =>
      level(
        Math.floor(x0 + ((rx + 0.5) * side) / PULSE_GRID),
        Math.floor(y0 + ((ry + 0.5) * side) / PULSE_GRID),
      )

    const ground = level(0, 0)
    // The border ring is always lit, so its corner region is.
    const lit = centre(0, 0)
    const dimAt = frame.flatMap((row, y) => row.map((on, x) => ({ on, x, y }))).find((r) => !r.on)
    expect(dimAt).toBeDefined()
    const dim = centre(dimAt!.x, dimAt!.y)

    expect(ground).toBe(luma(...PULSE_GROUND_RGB))
    expect(lit).toBe(luma(...PULSE_LIT_RGB))
    expect(dim / lit).toBeCloseTo(PULSE_DIM, 2)
    // Dim is part of the shape the reader finds, so it must clear the ground.
    expect(dim).toBeGreaterThan(ground * 3)
  })

  it('is what the phone would actually be handed, at the size it posts', () => {
    expect(SIDE).toBe(128)
  })
})
