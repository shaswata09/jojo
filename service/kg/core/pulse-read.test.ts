/**
 * Reading the pulse out of a photograph of the animation.
 *
 * Synthesised photographs, because the alternative is a phone. Each case renders
 * the regions as the scene draws them — a field of dots, brighter where a region
 * is lit — then puts it through something a camera does to an image and asks for
 * the frame back.
 *
 * What this establishes is the geometry, the thresholding and the sampling.
 * Lens distortion, rolling shutter and autofocus hunting belong to a device and
 * are named here so nobody mistakes this for coverage of them.
 */

import { describe, expect, it } from 'vitest'
import { PULSE_GRID, isBorder, planPulse, readPulseFrame, type PulseFrame } from './pulse'
import { otsuThreshold, readPulse } from './pulse-read'
import { encodeOffer } from './pairing'

const bytes = (n: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out[i] = (x >>> 16) & 0xff
  }
  return out
}

const offer = () =>
  encodeOffer({ publicKey: bytes(32, 1), secret: bytes(32, 2), nonce: bytes(16, 3) })

type Camera = {
  tilt?: number
  roll?: number
  blur?: number
  exposure?: number
  noise?: number
  fill?: number
  surround?: number
  /** Pixels across the whole animation. */
  span?: number
}

/**
 * Renders a frame the way the scene does — a lattice of dots, brighter inside a
 * lit region — and then photographs it.
 *
 * Dots rather than solid blocks, because that is what is on screen and because
 * it is the harder case: a region is only PARTLY covered by light, so a reader
 * that sampled a single pixel rather than averaging a patch would land between
 * dots and read the region as dark.
 */
function photograph(frame: PulseFrame, camera: Camera = {}): { gray: Uint8Array; size: number } {
  const {
    tilt = 0, roll = 0, blur = 0, exposure = 1, noise = 0,
    fill = 0.75, surround = 14, span = 480,
  } = camera

  const size = Math.round(span / fill)
  const flat = new Float32Array(size * size).fill(surround)
  const off = Math.round((size - span) / 2)

  // The scene's own dot lattice: 60 across, which is what `TILING` gives.
  const dots = 60
  const step = span / dots
  const r = step * 0.34
  for (let dy = 0; dy < dots; dy += 1) {
    for (let dx = 0; dx < dots; dx += 1) {
      const rx = Math.min(PULSE_GRID - 1, Math.floor((dx / dots) * PULSE_GRID))
      const ry = Math.min(PULSE_GRID - 1, Math.floor((dy / dots) * PULSE_GRID))
      // A dim region still shows its dots — it is dimmed, not extinguished,
      // which is what keeps the picture looking like itself.
      const level = frame[ry]![rx] ? 235 : 46
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

  const out = new Float32Array(size * size).fill(surround)
  const k = Math.tan((tilt * Math.PI) / 180) * 0.7
  const ca = Math.cos((roll * Math.PI) / 180)
  const sa = Math.sin((roll * Math.PI) / 180)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let u = (x / size) * 2 - 1
      let v = (y / size) * 2 - 1
      const ru = u * ca + v * sa
      const rv = -u * sa + v * ca
      u = ru
      v = rv
      const w = 1 + k * u
      if (w <= 0.05) continue
      const su = u / w
      const sv = v / w
      if (su < -1 || su > 1 || sv < -1 || sv > 1) continue
      const sx = Math.round(((su + 1) / 2) * size)
      const sy = Math.round(((sv + 1) / 2) * size)
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue
      out[y * size + x] = flat[sy * size + sx]!
    }
  }

  let work = out
  for (let pass = 0; pass < (blur > 0 ? 2 : 0); pass += 1) {
    const rad = Math.max(1, Math.round(blur))
    const one = new Float32Array(work.length)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let sum = 0
        let n = 0
        for (let d = -rad; d <= rad; d += 1) {
          const sx = x + d
          if (sx < 0 || sx >= size) continue
          sum += work[y * size + sx]!
          n += 1
        }
        one[y * size + x] = sum / n
      }
    }
    const two = new Float32Array(work.length)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let sum = 0
        let n = 0
        for (let d = -rad; d <= rad; d += 1) {
          const sy = y + d
          if (sy < 0 || sy >= size) continue
          sum += one[sy * size + x]!
          n += 1
        }
        two[y * size + x] = sum / n
      }
    }
    work = two
  }

  let seed = 12345
  const gray = new Uint8Array(size * size)
  for (let i = 0; i < gray.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const jitter = noise === 0 ? 0 : ((seed >>> 16) % (noise * 2 + 1)) - noise
    gray[i] = Math.max(0, Math.min(255, Math.round(work[i]! * exposure + jitter)))
  }
  return { gray, size }
}

const same = (a: PulseFrame, b: PulseFrame) =>
  a.every((row, y) => row.every((cell, x) => cell === b[y]![x]))

const survives = (frame: PulseFrame, camera?: Camera) => {
  const shot = photograph(frame, camera)
  const read = readPulse(shot.gray, shot.size, shot.size)
  return read.ok && same(read.value, frame)
}

describe('reading one straight on', () => {
  const plan = planPulse(offer())

  it('recovers every frame of a real key', () => {
    expect(plan.total).toBe(10)
    for (let i = 0; i < plan.total; i += 1) {
      expect(survives(plan.frames[i]!), `frame ${i}`).toBe(true)
    }
  })

  it('recovers frames from many different keys', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const other = planPulse(bytes(83, seed))
      expect(survives(other.frames[0]!), `key ${seed}`).toBe(true)
    }
  })
})

describe('reading it the way a phone is actually held', () => {
  const frame = planPulse(offer()).frames[3]!

  it('survives being held at an angle', () => {
    // Far better than a printed code managed, and the reason is the coarseness:
    // there is nothing small enough to lose to perspective.
    for (const tilt of [0, 10, 20, 25, 30]) {
      expect(survives(frame, { tilt }), `tilt ${tilt}`).toBe(true)
    }
  })

  it('survives the phone being held any way up', () => {
    // The border ring is symmetric, so it cannot say which way up this is —
    // the frame's own header does, by failing its checksum for the wrong three.
    for (const roll of [0, 90, 180, 270]) {
      expect(survives(frame, { roll, fill: 0.55 }), `roll ${roll}`).toBe(true)
    }
  })

  it('survives a soft focus, including one that would ruin a printed code', () => {
    for (const blur of [0, 2, 4, 6]) {
      expect(survives(frame, { blur }), `blur ${blur}`).toBe(true)
    }
  })

  it('survives the camera getting the exposure wrong', () => {
    // Otsu, plus a threshold taken from the border ring in this very frame.
    // There is no brightness constant anywhere in the reader.
    for (const exposure of [0.4, 0.6, 1, 1.4, 1.7]) {
      expect(survives(frame, { exposure }), `exposure ${exposure}`).toBe(true)
    }
  })

  it('survives sensor noise', () => {
    for (const noise of [0, 15, 30, 45]) {
      expect(survives(frame, { noise }), `noise ${noise}`).toBe(true)
    }
  })

  it('survives a lit room behind the screen', () => {
    for (const surround of [0, 14, 40]) {
      expect(survives(frame, { surround }), `surround ${surround}`).toBe(true)
    }
  })

  it('survives being small in the frame, and a low-resolution camera', () => {
    for (const fill of [0.9, 0.75, 0.5, 0.35]) {
      expect(survives(frame, { fill }), `fill ${fill}`).toBe(true)
    }
    /*
     * Pixels across the whole animation. 240 works, which is twenty per region
     * — so a phone needs to resolve the animation at about a quarter of a
     * megapixel, which every phone has done for fifteen years.
     *
     * 120 does not, and that is stated rather than left to be found: at ten
     * pixels a region the downsample no longer has whole dots to average, and
     * the two populations stop being separable.
     */
    for (const span of [480, 320, 240]) {
      expect(survives(frame, { span }), `${span}px`).toBe(true)
    }
    expect(survives(frame, { span: 120 })).toBe(false)
  })

  it('survives everything at once, which is what a real photograph is', () => {
    expect(
      survives(frame, { tilt: 18, roll: 8, blur: 3, exposure: 0.7, noise: 20, surround: 30, fill: 0.55 }),
    ).toBe(true)
  })
})

describe('refusing what is not the animation', () => {
  it('says so for an empty frame', () => {
    expect(readPulse(new Uint8Array(200 * 200).fill(16), 200, 200).ok).toBe(false)
  })

  it('says so for noise', () => {
    const gray = new Uint8Array(200 * 200)
    let seed = 5
    for (let i = 0; i < gray.length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      gray[i] = (seed >>> 16) & 0xff
    }
    expect(readPulse(gray, 200, 200).ok).toBe(false)
  })

  it('says so for an image too small to hold one', () => {
    expect(readPulse(new Uint8Array(32 * 32), 32, 32).ok).toBe(false)
    expect(readPulse(new Uint8Array(10), 200, 200).ok).toBe(false)
  })

  it('does not invent a frame from a broken border', () => {
    // No error correction, by design. A frame read wrongly is dropped and comes
    // round again — never half-returned.
    const frame = planPulse(offer()).frames[0]!.map((row) => [...row])
    for (let x = 3; x < 8; x += 1) frame[0]![x] = false
    const shot = photograph(frame)
    const read = readPulse(shot.gray, shot.size, shot.size)
    expect(read.ok && readPulseFrame(read.value) !== null).toBe(false)
  })
})

describe('the threshold', () => {
  it('lands between the two populations of a bimodal image', () => {
    const gray = new Uint8Array(1000)
    for (let i = 0; i < 400; i += 1) gray[i] = 20
    for (let i = 400; i < 1000; i += 1) gray[i] = 220
    const cut = otsuThreshold(gray)
    expect(cut).toBeGreaterThanOrEqual(20)
    expect(cut).toBeLessThan(220)
  })

  it('does not throw on an image of one value', () => {
    expect(() => otsuThreshold(new Uint8Array(100).fill(77))).not.toThrow()
  })

  it('has a border to measure against, in every frame', () => {
    // Guards the guard: the reader takes "lit" from the border ring of the very
    // photograph it is reading, so a frame with a dark border would make that
    // reference meaningless.
    for (const frame of planPulse(offer()).frames) {
      for (let y = 0; y < PULSE_GRID; y += 1) {
        for (let x = 0; x < PULSE_GRID; x += 1) {
          if (isBorder(x, y)) expect(frame[y]![x]).toBe(true)
        }
      }
    }
  })
})
