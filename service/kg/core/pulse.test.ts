/**
 * The key, carried by areas of the animation glowing and dimming.
 *
 * Coarse on purpose — a region is a twelfth of the plane — so most of what could
 * go wrong here is bookkeeping rather than optics: a bit order transposed, an
 * index misread, a frame accepted from a different transfer. The optical half is
 * tested against synthesised photographs elsewhere.
 */

import { describe, expect, it } from 'vitest'
import {
  PULSE_FPS,
  PULSE_GRID,
  PULSE_MAX_BYTES,
  createPulseReceiver,
  crc16,
  isBorder,
  planPulse,
} from './pulse'
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
  encodeOffer({
    publicKey: bytes(32, 1),
    secret: bytes(32, 2),
    nonce: bytes(16, 3),
  })

describe('a key, in a second of animation', () => {
  it('carries a pairing offer in ten frames', () => {
    // The number that decides whether this is worth doing. A person holds a
    // phone up and it is done before they have settled.
    const plan = planPulse(offer())
    expect(plan.size).toBe(83)
    expect(plan.total).toBe(10)
    // At the rate the sender actually shows them, not a rate nobody uses. Under
    // two seconds is the number that decides whether this is worth doing.
    expect(plan.lapSeconds(PULSE_FPS)).toBeCloseTo(1.67, 2)
    expect(plan.lapSeconds(PULSE_FPS)).toBeLessThan(2)
  })

  it('round-trips an offer exactly', () => {
    const payload = offer()
    const plan = planPulse(payload)
    const receiver = createPulseReceiver()
    for (const frame of plan.frames) receiver.accept(frame)
    expect(receiver.progress().complete).toBe(true)
    expect([...receiver.payload()!]).toEqual([...payload])
  })

  it('round-trips every size up to what it will carry', () => {
    for (const n of [0, 1, 9, 10, 83, 200, PULSE_MAX_BYTES]) {
      const payload = bytes(n, n + 1)
      const plan = planPulse(payload)
      const receiver = createPulseReceiver()
      for (const frame of plan.frames) receiver.accept(frame)
      expect(receiver.progress().complete, `length ${n}`).toBe(true)
      // Exactly the bytes that went in — not padded out to whole frames. The
      // length prefix is what makes that true, and a caller receiving 90 bytes
      // for an 83-byte offer is a pairing that fails every time.
      expect([...receiver.payload()!], `length ${n}`).toEqual([...payload])
    }
  })

  it('refuses a payload that belongs on the network instead', () => {
    // This channel carries a key. A file that does not fit is a file that should
    // be going over the LAN, and saying so is better than a beam nobody watches.
    expect(() => planPulse(bytes(PULSE_MAX_BYTES + 1))).toThrow(/key, not a file/)
    expect(() => planPulse(bytes(PULSE_MAX_BYTES))).not.toThrow()
  })

  it('finishes across laps when frames are missed', () => {
    // A camera drops frames to autofocus and to a hand moving. The frames cycle,
    // so a miss costs part of another pass and never a restart.
    const payload = offer()
    const plan = planPulse(payload)
    const receiver = createPulseReceiver()

    for (let i = 0; i < plan.total; i += 1) if (i % 3 !== 0) receiver.accept(plan.frames[i]!)
    expect(receiver.progress().complete).toBe(false)
    expect(receiver.missing()).toEqual([0, 3, 6, 9])

    for (const frame of plan.frames) receiver.accept(frame)
    expect(receiver.progress().complete).toBe(true)
    expect([...receiver.payload()!]).toEqual([...payload])
  })
})

describe('the border, which is the only marker there is', () => {
  it('rings every frame, unbroken', () => {
    const plan = planPulse(offer())
    for (const frame of plan.frames) {
      for (let y = 0; y < PULSE_GRID; y += 1) {
        for (let x = 0; x < PULSE_GRID; x += 1) {
          if (isBorder(x, y)) expect(frame[y]![x], `${x},${y}`).toBe(true)
        }
      }
    }
  })

  it('is refused when broken, because then it is not this', () => {
    // A dark border means the reader framed something else, or framed this
    // badly. Either way the regions inside it are not to be trusted.
    const plan = planPulse(offer())
    const frame = plan.frames[0]!.map((row) => [...row])
    frame[0]![5] = false
    expect(createPulseReceiver().accept(frame)).toBe('rejected')
  })

  it('leaves a hundred regions for data', () => {
    let data = 0
    for (let y = 0; y < PULSE_GRID; y += 1) {
      for (let x = 0; x < PULSE_GRID; x += 1) if (!isBorder(x, y)) data += 1
    }
    expect(data).toBe(100)
  })
})

describe('refusing what does not belong', () => {
  it('catches a flipped region', () => {
    // Every region is large, so a flip is not a subtle misread — but it is what
    // a reflection or a passing hand produces, and it must not land bytes.
    const plan = planPulse(offer())
    for (const at of [15, 40, 80]) {
      const frame = plan.frames[0]!.map((row) => [...row])
      const y = 1 + Math.floor(at / 10)
      const x = 1 + (at % 10)
      frame[y]![x] = !frame[y]![x]
      expect(createPulseReceiver().accept(frame), `region ${at}`).toBe('rejected')
    }
  })

  it('will not mix two transfers of different lengths', () => {
    const mine = planPulse(bytes(83, 1))
    const theirs = planPulse(bytes(200, 2))
    expect(mine.total).not.toBe(theirs.total)
    const receiver = createPulseReceiver()
    expect(receiver.accept(mine.frames[0]!)).toBe('accepted')
    expect(receiver.accept(theirs.frames[1]!)).toBe('rejected')
  })

  it('names a repeat as a repeat, since every lap after the first is repeats', () => {
    const plan = planPulse(offer())
    const receiver = createPulseReceiver()
    expect(receiver.accept(plan.frames[2]!)).toBe('accepted')
    expect(receiver.accept(plan.frames[2]!)).toBe('duplicate')
  })

  it('says when the last frame completes it', () => {
    // Seven bytes, not nine: two of the first frame are the length prefix.
    const plan = planPulse(bytes(7, 4))
    expect(plan.total).toBe(1)
    expect(createPulseReceiver().accept(plan.frames[0]!)).toBe('complete')
  })

  it('refuses a grid of the wrong size', () => {
    expect(createPulseReceiver().accept([])).toBe('rejected')
    expect(createPulseReceiver().accept([[true]])).toBe('rejected')
  })
})

describe('the checksum', () => {
  it('matches the published check value for CRC-16/CCITT-FALSE', () => {
    // "123456789" is 0x29B1. A fixed vector, so a wrong polynomial or seed
    // cannot pass by being self-consistent.
    const bits: boolean[] = []
    for (const ch of '123456789') {
      for (let b = 7; b >= 0; b -= 1) bits.push(((ch.charCodeAt(0) >> b) & 1) === 1)
    }
    expect(crc16(bits)).toBe(0x29b1)
  })

  it('changes for a single flipped bit anywhere', () => {
    const bits = [...bytes(12, 7)].flatMap((byte) => {
      const out: boolean[] = []
      for (let b = 7; b >= 0; b -= 1) out.push(((byte >> b) & 1) === 1)
      return out
    })
    const clean = crc16(bits)
    for (const at of [0, 1, 47, 95]) {
      const flipped = [...bits]
      flipped[at] = !flipped[at]
      expect(crc16(flipped), `bit ${at}`).not.toBe(clean)
    }
  })
})

describe('a wrong total does not wedge the scanner', () => {
  /**
   * The receiver commits to a total early, because that is what `progress()`
   * counts against and what tells `payload()` it is finished. Committing to the
   * first frame that passes its checksum made that frame unfalsifiable: a
   * 16-bit CRC lets about one corrupt frame in 65,536 through, and once its
   * total was latched every genuine frame afterwards disagreed and was
   * rejected. The scanner stayed open, the camera kept working, and the
   * progress bar counted toward a total that could never arrive.
   *
   * A frame from a stream of a different length stands in for the corrupt one.
   * It is a valid frame with a wrong total, which is exactly what a chance CRC
   * pass produces, and it is reproducible.
   */
  const OTHER = new Uint8Array(20)
  const stray = planPulse(OTHER).frames[0]!
  const wanted = new Uint8Array(40).map((_, i) => (i * 37) & 0xff)

  it('recovers once a second frame corroborates the real total', () => {
    const plan = planPulse(wanted)
    // The stray must claim a total this stream does not, and more than one
    // frame — a single-frame total would complete on arrival and never reach
    // the disagreement being tested.
    expect(planPulse(OTHER).total).toBeGreaterThan(1)
    expect(plan.total).not.toBe(planPulse(OTHER).total)

    const receiver = createPulseReceiver()
    expect(receiver.accept(stray)).toBe('accepted')

    // Twice, because that is what the sender does: the animation cycles, and
    // the frames spent proving the latched total wrong come round again a
    // second later. The cost of a chance CRC pass is one wasted lap.
    for (const frame of plan.frames) receiver.accept(frame)
    for (const frame of plan.frames) receiver.accept(frame)

    const out = receiver.payload()
    expect(out).not.toBeNull()
    expect([...out!]).toEqual([...wanted])
  })

  it('drops what it held, rather than splicing two streams together', () => {
    // The frames gathered under the wrong total were indexed against it. Keeping
    // them would produce a payload that passes every later length and checksum
    // test and still decodes to nothing.
    const receiver = createPulseReceiver()
    receiver.accept(stray)
    expect(receiver.progress().have).toBe(1)

    const plan = planPulse(wanted)
    receiver.accept(plan.frames[0]!)
    receiver.accept(plan.frames[1]!)
    expect(receiver.progress().total).toBe(plan.total)
    // One frame, not two: the stray was discarded when the total changed.
    expect(receiver.progress().have).toBe(1)
  })

  it('ignores a single disagreeing frame, so noise cannot restart a good read', () => {
    const plan = planPulse(wanted)
    const receiver = createPulseReceiver()
    receiver.accept(plan.frames[0]!)
    receiver.accept(plan.frames[1]!)

    expect(receiver.accept(stray)).toBe('rejected')
    expect(receiver.progress().have).toBe(2)
    expect(receiver.progress().total).toBe(plan.total)
  })

  it('needs the disagreement to be consecutive, not merely repeated', () => {
    const plan = planPulse(wanted)
    const receiver = createPulseReceiver()
    receiver.accept(plan.frames[0]!)

    // Stray, real, stray: two strays but never twice in a row, so the real
    // stream keeps the latch.
    receiver.accept(stray)
    receiver.accept(plan.frames[1]!)
    receiver.accept(stray)
    expect(receiver.progress().total).toBe(plan.total)
    expect(receiver.progress().have).toBe(2)
  })

  it('still completes a stream that never disagrees with itself', () => {
    const receiver = createPulseReceiver()
    const plan = planPulse(wanted)
    let last = ''
    for (const frame of plan.frames) last = receiver.accept(frame)
    expect(last).toBe('complete')
    expect([...receiver.payload()!]).toEqual([...wanted])
  })
})
