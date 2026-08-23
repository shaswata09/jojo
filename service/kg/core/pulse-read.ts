/**
 * Reading the pulse out of a photograph of the animation.
 *
 * Far simpler than reading a printed code, and deliberately so. There is no fine
 * grid to resolve, no error correction to invert, no mask to try: a region is a
 * twelfth of the plane, and the question about each one is only whether it is
 * bright or dim. That is a measurement a cheap sensor makes reliably through
 * blur, at an angle, in a lit room.
 *
 * Input is GRAYSCALE BYTES and nothing else — no DOM, no image type, no camera —
 * which is what lets the whole thing be tested against synthesised photographs
 * in an ordinary test process, and what lets the same code run in a phone's
 * WebView and in a desktop browser without changing.
 *
 * ## Finding it
 *
 *   0. DOWNSAMPLE, hard, to a small working image. This is the step that makes
 *      everything after it easy, and leaving it out was the first thing that
 *      went wrong: on screen a region is not a solid patch of light, it is a
 *      scatter of separate dots with gaps between them, so a connected-component
 *      pass over the full-resolution frame finds several hundred dots and no
 *      code at all. Averaging over blocks turns the dot field back into the
 *      smooth brightness map the design is actually about — and it is free,
 *      because nothing here needs detail finer than a twelfth of the picture.
 *   1. THRESHOLD, by Otsu. The frame is bright regions on a dark field, which is
 *      bimodal — exactly what Otsu is for — and it means no brightness constant
 *      appears anywhere here. A screen's brightness and a room's are not things
 *      to assume.
 *   2. The largest bright COMPONENT. The border ring is lit in every frame and
 *      the lit regions inside touch it, so the code is one connected shape and
 *      reliably the biggest thing in view.
 *   3. Its four CORNERS, as the extremes of x+y and x-y. A quadrilateral's
 *      corners are its extreme points along the diagonals — cheap, and it does
 *      not care that the shape between them is ragged.
 *   4. A homography from those, then one average per region.
 *
 * A frame that fails is dropped; `pulse.ts` cycles, so it comes round again.
 */

import { PULSE_GRID, readPulseFrame, type PulseFrame } from './pulse'

export type PulseReadFailure =
  /** Nothing in the frame looks like the animation. */
  | 'pulse/not-found'
  /** Found something, and its regions did not read as a frame. */
  | 'pulse/unreadable'

export type PulseReadResult =
  | { ok: true; value: PulseFrame }
  | { ok: false; error: PulseReadFailure }

type Point = { x: number; y: number }

/**
 * The working resolution, after downsampling.
 *
 * Eight pixels per region across a 12-region grid, with room to spare. More
 * would cost time and buy nothing: the finest thing in this code is a twelfth
 * of the picture.
 */
const WORK = 96

/**
 * The level separating the animation from the page behind it.
 *
 * NOT Otsu's threshold. Otsu splits an image into its two dominant groups, and
 * the two dominant groups here are LIT regions and DIM ones — both of which are
 * the animation. Localising on that finds only the lit parts, which is a ragged
 * shape whose extreme points are not its corners, and the symptom is a reader
 * that works at ten degrees of tilt and fails at five. Measured exactly that.
 *
 * What localisation wants is the level below the DIM regions: a dimmed region
 * still shows its dots, and the page behind shows nothing. So Otsu runs twice —
 * once to find the lit/dim split, and again over everything below it to find the
 * dim/background split. Both levels come from the picture rather than from a
 * constant, which is what keeps this working at any screen or room brightness.
 */
function backgroundLevel(work: Uint8Array): number {
  const hi = otsuThreshold(work)
  const below: number[] = []
  for (const value of work) if (value <= hi) below.push(value)
  // Everything is bright: there is no background to separate, so anything above
  // nothing is the shape.
  if (below.length < 16) return 0
  return otsuThreshold(Uint8Array.from(below))
}

/** Box-averages an image down to `WORK` square. */
function downsample(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(WORK * WORK)
  for (let y = 0; y < WORK; y += 1) {
    const y0 = Math.floor((y * height) / WORK)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / WORK))
    for (let x = 0; x < WORK; x += 1) {
      const x0 = Math.floor((x * width) / WORK)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / WORK))
      let sum = 0
      let n = 0
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          sum += gray[sy * width + sx]!
          n += 1
        }
      }
      out[y * WORK + x] = n === 0 ? 0 : Math.round(sum / n)
    }
  }
  return out
}

/** Otsu's threshold: the level best separating the image into two groups. */
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Uint32Array(256)
  for (const value of gray) histogram[value]! += 1
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]!

  let sumBelow = 0
  let countBelow = 0
  let best = 0
  let bestVariance = -1
  for (let level = 0; level < 256; level += 1) {
    countBelow += histogram[level]!
    if (countBelow === 0) continue
    const countAbove = total - countBelow
    if (countAbove === 0) break
    sumBelow += level * histogram[level]!
    const meanBelow = sumBelow / countBelow
    const meanAbove = (sum - sumBelow) / countAbove
    const variance = countBelow * countAbove * (meanBelow - meanAbove) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = level
    }
  }
  return best
}

/**
 * The largest connected run of lit pixels, as the points on its hull extremes.
 *
 * Iterative rather than recursive: the component is most of the frame, and a
 * recursive fill over it would exhaust the stack on a phone rather than on any
 * machine this was written on.
 */
function largestShape(binary: Uint8Array, width: number, height: number): Point[] | null {
  const seen = new Uint8Array(binary.length)
  const stack: number[] = []
  let best: Point[] | null = null
  let bestArea = 0

  for (let start = 0; start < binary.length; start += 1) {
    if (binary[start] === 0 || seen[start] === 1) continue
    seen[start] = 1
    stack.length = 0
    stack.push(start)

    let area = 0
    // The four diagonal extremes, which are a quadrilateral's corners.
    let minSum = Infinity
    let maxSum = -Infinity
    let minDiff = Infinity
    let maxDiff = -Infinity
    let a: Point = { x: 0, y: 0 }
    let b: Point = { x: 0, y: 0 }
    let c: Point = { x: 0, y: 0 }
    let d: Point = { x: 0, y: 0 }

    while (stack.length > 0) {
      const at = stack.pop()!
      const x = at % width
      const y = (at - x) / width
      area += 1
      if (x + y < minSum) { minSum = x + y; a = { x, y } }
      if (x + y > maxSum) { maxSum = x + y; c = { x, y } }
      if (x - y < minDiff) { minDiff = x - y; d = { x, y } }
      if (x - y > maxDiff) { maxDiff = x - y; b = { x, y } }

      if (x > 0 && binary[at - 1] === 1 && seen[at - 1] === 0) { seen[at - 1] = 1; stack.push(at - 1) }
      if (x + 1 < width && binary[at + 1] === 1 && seen[at + 1] === 0) { seen[at + 1] = 1; stack.push(at + 1) }
      if (y > 0 && binary[at - width] === 1 && seen[at - width] === 0) { seen[at - width] = 1; stack.push(at - width) }
      if (y + 1 < height && binary[at + width] === 1 && seen[at + width] === 0) { seen[at + width] = 1; stack.push(at + width) }
    }

    if (area > bestArea) {
      bestArea = area
      // Clockwise from the top-left, matching the unit square below.
      best = [a, b, c, d]
    }
  }

  // Anything smaller than a twentieth of the frame is not the animation.
  return bestArea > (width * height) / 20 ? best : null
}

/** The homography taking four source points to four image points. */
function homography(from: Point[], to: Point[]): number[] | null {
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const s = from[i]!
    const d = to[i]!
    a.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x])
    b.push(d.x)
    a.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y])
    b.push(d.y)
  }
  for (let col = 0; col < 8; col += 1) {
    let pivot = col
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row
    }
    // Partial pivoting is not decoration: a code photographed square-on gives a
    // zero pivot, which is the most ordinary case there is.
    if (Math.abs(a[pivot]![col]!) < 1e-9) return null
    ;[a[col], a[pivot]] = [a[pivot]!, a[col]!]
    ;[b[col], b[pivot]] = [b[pivot]!, b[col]!]
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue
      const factor = a[row]![col]! / a[col]![col]!
      if (factor === 0) continue
      for (let k = col; k < 8; k += 1) a[row]![k]! -= factor * a[col]![k]!
      b[row]! -= factor * b[col]!
    }
  }
  const h = b.map((value, i) => value / a[i]![i]!)
  h.push(1)
  return h
}

const project = (h: number[], u: number, v: number): Point => {
  const w = h[6]! * u + h[7]! * v + 1
  return { x: (h[0]! * u + h[1]! * v + h[2]!) / w, y: (h[3]! * u + h[4]! * v + h[5]!) / w }
}

/** Samples across a region's interior. Dense, for the reason below. */
const PATCH = 9

/**
 * The mean brightness of one region.
 *
 * Averaged over a DENSE patch spanning most of the region, and the density is
 * the whole point rather than a refinement.
 *
 * On screen a region is not a flat panel of light — it is about five dots
 * across, with dark gaps between them. Sample it at nine points and several of
 * them land in the gaps, so a lit region reads dark or a dim one reads bright
 * depending on where the grid happened to fall. Measured: an earlier version
 * with a 3x3 patch read correctly at exposure 0.3 and 1.0 and failed at 0.7,
 * and passed with no noise but failed with a little. Results that go wrong and
 * right again as a parameter moves smoothly are not a limit being reached; they
 * are a measurement that is too sparse to be stable.
 *
 * Eighty-one samples over the middle 70% of a region average across whole dots
 * and gaps together, which is what the region's brightness actually means.
 */
function regionLevel(gray: Uint8Array, w: number, hgt: number, h: number[], rx: number, ry: number): number {
  let sum = 0
  let n = 0
  for (let iy = 0; iy < PATCH; iy += 1) {
    for (let ix = 0; ix < PATCH; ix += 1) {
      // Spread across 0.15..0.85 of the region, staying clear of its edges so a
      // homography a little out never reaches a neighbour.
      const u = (rx + 0.15 + (0.7 * ix) / (PATCH - 1)) / PULSE_GRID
      const v = (ry + 0.15 + (0.7 * iy) / (PATCH - 1)) / PULSE_GRID
      const p = project(h, u, v)
      const x = Math.round(p.x)
      const y = Math.round(p.y)
      if (x < 0 || y < 0 || x >= w || y >= hgt) continue
      sum += gray[y * w + x]!
      n += 1
    }
  }
  return n === 0 ? 0 : sum / n
}

/** Reads one frame of the pulse out of a grayscale image. */
export function readPulse(gray: Uint8Array, width: number, height: number): PulseReadResult {
  if (gray.length !== width * height || width < 48 || height < 48) {
    return { ok: false, error: 'pulse/not-found' }
  }

  // Everything from here runs on the downsampled image. See the note above:
  // at full resolution the regions are scattered dots, not shapes.
  const work = downsample(gray, width, height)

  // Separates the animation from the page behind it. A localisation threshold
  // only — what tells a lit region from a dim one is decided later, from the
  // regions themselves.
  const floorLevel = backgroundLevel(work)
  const binary = new Uint8Array(work.length)
  for (let i = 0; i < work.length; i += 1) binary[i] = work[i]! > floorLevel ? 1 : 0

  const shape = largestShape(binary, WORK, WORK)
  if (shape === null) return { ok: false, error: 'pulse/not-found' }

  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  /*
   * Four rotations. Nothing stops the phone being held any way up, and the
   * border ring is symmetric so it cannot say which way that is — `pulse.ts`
   * rejects a frame whose header does not check out, which is what picks the
   * right one. The winding is fixed by how the corners were collected above.
   */
  for (let turn = 0; turn < 4; turn += 1) {
    const rotated = [
      shape[turn % 4]!,
      shape[(turn + 1) % 4]!,
      shape[(turn + 2) % 4]!,
      shape[(turn + 3) % 4]!,
    ]
    const h = homography(square, rotated)
    if (h === null) continue

    const levels: number[][] = []
    for (let y = 0; y < PULSE_GRID; y += 1) {
      const row: number[] = []
      for (let x = 0; x < PULSE_GRID; x += 1) row.push(regionLevel(work, WORK, WORK, h, x, y))
      levels.push(row)
    }

    /*
     * The threshold is the middle of the WIDEST GAP between the sorted region
     * levels — not Otsu, and the difference is not academic.
     *
     * Otsu answers "which level best splits this population", and by convention
     * returns the TOP OF THE LOWER CLASS. For a set with two tight clusters that
     * lands the threshold exactly ON the dim cluster, and a dim region measuring
     * a fraction above its own cluster's integer level then reads as lit.
     * Measured, with localisation exact and the two populations cleanly apart at
     * 84.4 and 24.2: Otsu returned 24, and all fifty-two dim regions came back
     * lit. Every strange non-monotonic result chased before that was this one
     * bug wearing a geometry problem's clothes.
     *
     * The widest gap is the right question here because the two populations are
     * genuinely far apart — a lit region against a dimmed one — so it puts the
     * threshold in the middle of that space rather than at its edge.
     */
    const sorted = levels.flat().sort((a, b) => a - b)
    let mid = sorted[0]! - 1
    let widest = 0
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i]! - sorted[i - 1]!
      if (gap > widest) {
        widest = gap
        mid = (sorted[i]! + sorted[i - 1]!) / 2
      }
    }

    const frame: boolean[][] = levels.map((row) => row.map((level) => level > mid))
    // The border ring is symmetric, so it cannot say which way up this is.
    // What picks the right rotation is the frame's own header checking out —
    // three of the four put the index and the checksum somewhere they are not.
    if (readPulseFrame(frame) !== null) return { ok: true, value: frame }
  }

  return { ok: false, error: 'pulse/unreadable' }
}
