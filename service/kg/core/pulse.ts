/**
 * The key, carried by the animation itself — areas of it glowing and dimming.
 *
 * Not a code drawn on top of the scene. The scene is already a field of dots
 * that brighten and fade as a band sweeps through it; this decides WHICH of them
 * brighten. Large areas pulse together, the picture keeps its shape, and there
 * is no square, no grid, and nothing that looks like a label.
 *
 * ## Why coarse, when the last attempt was fine
 *
 * Because the payload got small. This carries the pairing offer and nothing
 * else — 83 bytes — and then gets out of the way: the file itself goes over the
 * local network, which is fast, unlimited, and already built. Once the optical
 * channel only has to move a key, it can be enormously coarser, and coarse is
 * what makes it both robust and good-looking.
 *
 *     a 64x64 cell grid   4,096 tiny cells   reads like a printed label
 *     a 12x12 region grid   144 large areas  reads like the animation pulsing
 *
 * A region is a twelfth of the plane. It survives being out of focus, held at an
 * angle, and photographed by a cheap sensor, because there is nothing small in
 * it to lose. That is the same reason it looks right: a person sees areas of
 * light moving, not a pattern.
 *
 * ## The border is the marker
 *
 * The outer ring of regions is always lit. It is the only fiducial there is, and
 * it does two jobs at once — a decoder finds one bright rectangle rather than
 * hunting four small squares, and a viewer sees the picture framed in light
 * rather than tagged in three corners.
 *
 * ## Framing is deliberately tiny
 *
 * A conventional packet header — a few bytes of type and length with a 24-bit
 * checksum behind them — is right when a frame holds hundreds of bytes and
 * absurd when it holds nine. So a frame here is 100 bits:
 * six of index, six of total, sixteen of CRC, and seventy-two of payload. Nine
 * bytes a frame, ten frames for an offer, a second and a quarter of animation.
 *
 * There is no error correction, for the same reason as everywhere else in this
 * feature: the frames CYCLE. A frame that fails its CRC is dropped and comes
 * round again.
 *
 * ## The payload comes back the length it went in
 *
 * A frame is a fixed nine bytes and a payload is not, so the last frame is
 * padded — and a receiver that simply concatenated frames would hand back an
 * 83-byte offer as 90 bytes with seven zeros on the end. `decodeOffer` requires
 * an exact length, so that pairing would fail every time, on a path where both
 * halves are individually correct. It did: an audit caught it by testing the
 * browser's encoder against the phone's decoder, which no test of either alone
 * could have found.
 *
 * So the payload carries its own length in the first two bytes, `planPulse`
 * writes it and the receiver strips it. Callers never see it and cannot forget
 * it, which is the point — the alternative was every caller knowing how long its
 * own payload should have been.
 */

/** Regions across the plane, including the border ring. */
export const PULSE_GRID = 12

/** Bits a frame carries: the interior of the grid. */
export const PULSE_BITS = (PULSE_GRID - 2) * (PULSE_GRID - 2)

/** index(6) + total(6) + crc(16). */
const HEADER_BITS = 28

/** Payload bits per frame. */
export const PULSE_PAYLOAD_BITS = PULSE_BITS - HEADER_BITS

/** Payload bytes per frame, the length prefix included. */
export const PULSE_FRAME_BYTES = PULSE_PAYLOAD_BITS >> 3

/** The two bytes at the head of the payload that state its true length. */
const LENGTH_BYTES = 2

/** Six bits of index means this many frames at most. */
export const PULSE_MAX_FRAMES = 64

/**
 * Frames a second the sender shows, and it is deliberately BELOW the scanner's.
 *
 * `scanner-page.ts` grabs at 8. Showing at 8 as well would be the obvious
 * choice and the wrong one: two independent timers at the same rate drift
 * against each other, so a grab can sit on a transition for a long stretch and
 * every one of those reads is a frame straddling two, which fails its checksum
 * and is dropped. The scanner would appear to stall for seconds at a time on
 * one particular index.
 *
 * At 6 against 8 each displayed frame lasts about 167ms and a grab happens
 * every 125ms, so at least one grab falls wholly inside every frame no matter
 * how the two clocks are aligned. The cost is a lap that takes a third longer —
 * 1.7s rather than 1.25s for a pairing offer — which nobody will notice
 * against a pairing that silently refuses to progress, which everybody does.
 */
export const PULSE_FPS = 6

/**
 * How bright a dimmed region is against a lit one, 0 to 1.
 *
 * Here rather than in the shader, because it is the one rendering number the
 * READER also depends on. `pulse-read.ts` separates lit from dim by finding the
 * widest gap in the sorted region levels, which works for any ratio with a gap
 * in it — and stops working when a camera's own processing closes that gap.
 *
 * A fifth is the answer to two opposing pressures. Darker looks less like the
 * animation and more like a code screen that replaced it, and past a point the
 * dim regions fall to the sensor's noise floor where auto-exposure lifts them
 * back into the lit ones. Brighter is prettier and leaves less room between the
 * two classes than a phone held at arm's length in a lit room reliably keeps.
 *
 * It is also the ratio `pulse-seam.test.ts` photographs, which is what makes
 * that test evidence about the real shader rather than about an arbitrary pair
 * of greys somebody picked to make a decoder pass.
 */
export const PULSE_DIM = 0.2

/**
 * The largest payload this channel will carry.
 *
 * Every frame less the two bytes of length at the head of the first. Stated as a
 * constant so a caller can check rather than discover — and it is deliberately
 * small: this channel carries a key, and anything that does not fit is something
 * that belongs on the network.
 */
export const PULSE_MAX_BYTES = PULSE_FRAME_BYTES * PULSE_MAX_FRAMES - LENGTH_BYTES

/** True where a region belongs to the border ring rather than to the data. */
export const isBorder = (x: number, y: number): boolean =>
  x === 0 || y === 0 || x === PULSE_GRID - 1 || y === PULSE_GRID - 1

/** One frame as regions. `regions[y][x]`, true meaning lit. */
export type PulseFrame = readonly (readonly boolean[])[]

/**
 * CRC-16/CCITT-FALSE over the frame's own bits.
 *
 * Sixteen bits rather than the twenty-four a conventional frame checksum uses,
 * because a frame here
 * is a hundred bits and three bytes of checksum would be a fifth of it. One in
 * sixty-five thousand is the right trade when a bad frame is dropped and retried
 * rather than acted on — and `pairing.ts`'s confirmation tag stands behind the
 * whole exchange regardless.
 */
export function crc16(bits: readonly boolean[]): number {
  let crc = 0xffff
  for (const bit of bits) {
    const top = ((crc >> 15) & 1) === 1
    crc = (crc << 1) & 0xffff
    if (top !== bit) crc ^= 0x1021
  }
  return crc
}

const bitsOfNumber = (value: number, count: number): boolean[] => {
  const out: boolean[] = []
  for (let i = count - 1; i >= 0; i -= 1) out.push(((value >> i) & 1) === 1)
  return out
}

const numberOfBits = (bits: readonly boolean[]): number =>
  bits.reduce((n, bit) => (n << 1) | (bit ? 1 : 0), 0)

/** Lays a frame's bits into the interior of the region grid, row-major. */
function layOut(bits: readonly boolean[]): PulseFrame {
  const frame: boolean[][] = []
  let at = 0
  for (let y = 0; y < PULSE_GRID; y += 1) {
    const row: boolean[] = []
    for (let x = 0; x < PULSE_GRID; x += 1) {
      if (isBorder(x, y)) {
        // Always lit: the border is the fiducial, and a gap in it is a corner a
        // decoder cannot find.
        row.push(true)
        continue
      }
      row.push(bits[at] ?? false)
      at += 1
    }
    frame.push(row)
  }
  return frame
}

export type PulsePlan = {
  /** Payload size in bytes. */
  size: number
  /** Frames in one lap. */
  total: number
  frames: readonly PulseFrame[]
  /** Seconds for one full pass at a given frame rate. */
  lapSeconds: (fps: number) => number
}

export function planPulse(payload: Uint8Array): PulsePlan {
  if (payload.byteLength > 0xffff) {
    throw new Error('too large for the optical channel — this carries a key, not a file')
  }
  // The payload with its length in front, which is what the frames actually
  // carry. Everything below counts in these bytes, not the caller's.
  const framed = new Uint8Array(LENGTH_BYTES + payload.byteLength)
  framed[0] = (payload.byteLength >> 8) & 0xff
  framed[1] = payload.byteLength & 0xff
  framed.set(payload, LENGTH_BYTES)

  const total = Math.max(1, Math.ceil(framed.byteLength / PULSE_FRAME_BYTES))
  if (total > PULSE_MAX_FRAMES) {
    // Six bits of index is the ceiling, and it is a deliberate one: this channel
    // carries a key. Anything that does not fit is something that should be
    // going over the network instead.
    throw new Error('too large for the optical channel — this carries a key, not a file')
  }

  const frames: PulseFrame[] = []
  for (let index = 0; index < total; index += 1) {
    const slice = framed.subarray(index * PULSE_FRAME_BYTES, (index + 1) * PULSE_FRAME_BYTES)
    const data: boolean[] = []
    for (let i = 0; i < PULSE_FRAME_BYTES; i += 1) {
      const byte = slice[i] ?? 0
      for (let b = 7; b >= 0; b -= 1) data.push(((byte >> b) & 1) === 1)
    }

    const head = [...bitsOfNumber(index, 6), ...bitsOfNumber(total - 1, 6)]
    // The CRC covers the header as well as the payload, so a misread index
    // fails the check rather than landing the bytes in the wrong slot.
    const crc = crc16([...head, ...data])
    frames.push(layOut([...head, ...data, ...bitsOfNumber(crc, 16)]))
  }

  return {
    size: payload.byteLength,
    total,
    frames,
    lapSeconds: (fps) => (fps > 0 ? total / fps : Infinity),
  }
}

/** What a frame says about itself, once its checksum has agreed. */
export type PulseHeader = { index: number; total: number; bytes: Uint8Array }

/**
 * Parses one frame, or refuses it.
 *
 * Exported because two callers need exactly this and must not disagree: the
 * receiver below, and `pulse-read.ts`, which tries the four rotations a phone
 * might be held at and keeps whichever one parses. A second copy of the layout
 * in the reader would be a second place to get the bit order wrong.
 */
export function readPulseFrame(frame: PulseFrame): PulseHeader | null {
  if (frame.length !== PULSE_GRID) return null

  const bits: boolean[] = []
  for (let y = 0; y < PULSE_GRID; y += 1) {
    const row = frame[y]
    if (row === undefined || row.length !== PULSE_GRID) return null
    for (let x = 0; x < PULSE_GRID; x += 1) {
      // The border carries nothing, but it must be lit — a dark one means what
      // was framed is not this.
      if (isBorder(x, y)) {
        if (!row[x]) return null
        continue
      }
      bits.push(row[x] === true)
    }
  }

  const head = bits.slice(0, 12)
  const data = bits.slice(12, 12 + PULSE_PAYLOAD_BITS)
  const claimed = numberOfBits(bits.slice(12 + PULSE_PAYLOAD_BITS))
  if (crc16([...head, ...data]) !== claimed) return null

  const index = numberOfBits(head.slice(0, 6))
  const total = numberOfBits(head.slice(6)) + 1
  if (index >= total) return null

  const bytes = new Uint8Array(PULSE_FRAME_BYTES)
  for (let i = 0; i < PULSE_FRAME_BYTES; i += 1) {
    let byte = 0
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | (data[i * 8 + b] ? 1 : 0)
    bytes[i] = byte
  }
  return { index, total, bytes }
}

export type PulseOutcome = 'accepted' | 'duplicate' | 'rejected' | 'complete'

export type PulseReceiver = {
  accept: (frame: PulseFrame) => PulseOutcome
  /** Frames held, out of the total once known. */
  progress: () => { have: number; total: number; complete: boolean }
  payload: () => Uint8Array | null
  missing: () => readonly number[]
}

/**
 * How many frames must agree on a new total before it replaces the latched one.
 *
 * The receiver has to commit to a total early — it is what `progress()` counts
 * against and what tells `payload()` it is done — but committing to the FIRST
 * frame that passes the checksum makes that first frame unfalsifiable. A 16-bit
 * CRC lets roughly one corrupt frame in 65,536 through, and at eight frames a
 * second a camera pointed at a moving hand will produce a lot of frames. Once a
 * wrong total is latched, every genuine frame afterwards disagrees with it and
 * is rejected, and the scanner is wedged for as long as the screen is open —
 * with a progress bar counting toward a total that will never arrive.
 *
 * Two, because it is the smallest number that distinguishes the two cases. A
 * corrupt frame is an independent event, so a second frame is overwhelmingly
 * unlikely to repeat its exact total; a real stream repeats its total on every
 * frame it sends. So a chance pass costs one wasted lap of the animation, and a
 * genuinely new stream — a person who moved to a different device mid-scan — is
 * picked up on its second frame instead of never.
 */
const AGREE_TO_RELATCH = 2

export function createPulseReceiver(): PulseReceiver {
  let total = 0
  const held = new Map<number, Uint8Array>()

  /** A total seen disagreeing with the latched one, and how often in a row. */
  let dissent = 0
  let dissenting = 0

  const accept = (frame: PulseFrame): PulseOutcome => {
    const read = readPulseFrame(frame)
    if (read === null) return 'rejected'

    if (total === 0) {
      total = read.total
    } else if (read.total !== total) {
      // Not this stream — but possibly the real one, with the latched total
      // being the mistake. Counted rather than believed.
      if (read.total === dissenting) dissent += 1
      else {
        dissenting = read.total
        dissent = 1
      }
      if (dissent < AGREE_TO_RELATCH) return 'rejected'

      // Corroborated. Everything held was measured against a total now believed
      // wrong, so it goes with it: keeping those frames would splice two streams
      // into one payload that passes every later check and decodes to nothing.
      held.clear()
      total = read.total
      dissent = 0
      dissenting = 0
    } else {
      // A frame that agrees is itself evidence against the dissenter.
      dissent = 0
      dissenting = 0
    }

    if (held.has(read.index)) return 'duplicate'

    held.set(read.index, read.bytes)
    return held.size === total ? 'complete' : 'accepted'
  }

  const payload = (): Uint8Array | null => {
    if (total === 0 || held.size !== total) return null
    const framed = new Uint8Array(total * PULSE_FRAME_BYTES)
    for (const [index, part] of held) framed.set(part, index * PULSE_FRAME_BYTES)

    // The length the sender wrote, so the caller gets back exactly what it gave.
    const length = (framed[0]! << 8) | framed[1]!
    if (length > framed.byteLength - LENGTH_BYTES) return null
    return framed.slice(LENGTH_BYTES, LENGTH_BYTES + length)
  }

  return {
    accept,
    progress: () => ({ have: held.size, total, complete: total > 0 && held.size === total }),
    payload,
    missing: () => {
      const out: number[] = []
      for (let i = 0; i < total; i += 1) if (!held.has(i)) out.push(i)
      return out
    },
  }
}
