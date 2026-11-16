import { PULSE_DIM, PULSE_GRID, type PulseFrame } from '@jojo/service/core/pulse'

/**
 * One frame of the pairing pulse as pixels, with no canvas, no DOM and no GPU.
 *
 * The WebGPU scene draws the pulse out of its own dot lattice. This is the same
 * signal for every place that scene cannot draw it — no adapter, the chunk not
 * loaded or failed, offline, or the page's "Show the animation" switch off — and
 * it is a pure function so that a test can hand its output to the phone's own
 * reader (`core/pulse-read.ts`) and prove it decodes. `PulseOverlay` puts these
 * exact bytes on screen with `putImageData`; there is no second drawing path
 * the test could be silent about.
 *
 * ## What the reader needs, and where each part of this comes from
 *
 * - A SQUARE grid of `PULSE_GRID` regions. The reader maps the unit square onto
 *   the shape it finds and samples each twelfth; the phone crops its camera to a
 *   square before it reads, so a square on screen stays square in what it reads.
 *   Whatever the canvas's own aspect, the grid is the largest centred square
 *   that fits inside the quiet zone.
 * - Three levels, darkest to brightest: a background, the dim regions, the lit
 *   ones. The reader finds the code as everything brighter than the background
 *   (`backgroundLevel` there), so the dim regions must sit well above it — the
 *   grid is one connected shape only if they do. Then it splits lit from dim at
 *   the widest gap between region averages.
 * - Dim is `PULSE_DIM` of lit, per channel: the ratio the shader renders and the
 *   one `pulse-seam.test.ts` photographs, imported rather than restated.
 * - A quiet zone of background around the grid. Without it a light page behind
 *   the canvas would join the grid into one bright shape whose corners are the
 *   page's, not the code's.
 *
 * One limit this cannot remove from here: the reader takes the LARGEST bright
 * shape in view. On a light page, a canvas that fills too little of the
 * camera's square leaves a ring of page bigger than the grid, and the ring is
 * what gets read. Measured with the test beside this, a square canvas reads
 * every frame once it spans 85% of the camera's square on the light panel
 * (#f7f7f7; 80% at a larger canvas) and none at 75%; on the dark panel
 * (#1f1f1f) every frame from 75%, dropping frames below that; only a
 * near-black page reads from half. The person frames the pattern, and the
 * overlay is drawn large so that is easy — but a reader that tried the
 * next-largest shape when the largest does not parse would lift the limit.
 *
 * Tried and left out: the scene's dot lattice drawn into the regions. At the
 * overlay's size the dots are two or three device pixels apart, invisible,
 * and dimming the space between them only cost the reader margin.
 *
 * Lit regions are not drawn as tiles. Neighbouring lit regions run together
 * and their edges fall off softly into the dim ones (`SOFT`), so what is on
 * screen is areas of light pulsing in a dark frame — the look `core/pulse.ts`
 * argues for — rather than modules of a code. The outer edge of the grid stays
 * sharp: it is what the reader finds the corners from.
 */

/**
 * Lit regions: white, 255 in the phone's Rec. 601 luma.
 *
 * Not a tint, and that was measured rather than preferred. The light theme's
 * panel around the canvas is 247 in luma; with lit regions at a warm 235 the
 * page was the brightest class in the picture, the reader's first threshold
 * fell between the page and the code, and frames with few lit regions read as
 * nothing. Nothing on a screen can be brighter than white, so nothing on the
 * page can outrank it.
 */
export const PULSE_LIT_RGB = [255, 255, 255] as const

/** Behind the grid and in the quiet zone. Near black, about 10 in luma. */
export const PULSE_GROUND_RGB = [10, 10, 12] as const

/**
 * The quiet zone on each side, as a fraction of the canvas's shorter edge.
 *
 * Swept against the test beside this, from 0.05 to 0.16. Narrower lets a
 * blurred photograph run the page into the grid: at 0.05 a square canvas never
 * read on the light panel, nor on a dark one when framed close; 0.08 dropped
 * single frames on the light panel; 0.12 read every frame wherever the grid was
 * the largest bright thing in view.
 */
export const PULSE_QUIET = 0.12

/**
 * Half the width of the soft edge between a lit area and a dim one, as a
 * fraction of a region. The reader samples 0.15 to 0.85 of each region, so
 * anything under 0.15 never reaches a sample — and the edge being soft is what
 * makes lit neighbours run together into areas of light rather than a grid of
 * modules that reads as a printed code, which this deliberately is not.
 */
const SOFT = 0.12

const DIM_RGB = PULSE_LIT_RGB.map((c) => Math.round(c * PULSE_DIM))

/** Where the grid sits inside a `width` x `height` canvas, in pixels. */
export function pulseSquare(width: number, height: number): { x: number; y: number; side: number } {
  const short = Math.min(width, height)
  const quiet = Math.round(short * PULSE_QUIET)
  const side = Math.max(0, short - 2 * quiet)
  return {
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    side,
  }
}

/** Lit-ness of region (x, y), the ring beyond the grid counting as lit. */
const litAt = (frame: PulseFrame, x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= PULSE_GRID || y >= PULSE_GRID) return 1
  return frame[y]?.[x] === true ? 1 : 0
}

/**
 * The regions a softening window centred at `g` covers along one axis, and how
 * much of the window each takes. One region away from a boundary; two near it.
 */
function spans(g: number): [number, number, number, number] {
  const lo = g - SOFT
  const hi = g + SOFT
  const i0 = Math.floor(lo)
  const i1 = Math.floor(hi)
  if (i0 === i1) return [i0, 1, i1, 0]
  const w0 = (i1 - lo) / (2 * SOFT)
  return [i0, w0, i1, 1 - w0]
}

/**
 * Paints one frame into an RGBA buffer `width` x `height`, row-major.
 *
 * `out` is reused when given and the right size, so the overlay does not
 * allocate a canvas's worth of pixels six times a second.
 */
export function paintPulse(
  frame: PulseFrame,
  width: number,
  height: number,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const length = width * height * 4
  const px = out !== undefined && out.length === length ? out : new Uint8ClampedArray(length)
  const { x: x0, y: y0, side } = pulseSquare(width, height)

  for (let y = 0; y < height; y += 1) {
    // Position down the grid, in regions.
    const gy = side > 0 ? ((y + 0.5 - y0) * PULSE_GRID) / side : -1
    const rowInside = gy >= 0 && gy < PULSE_GRID
    const [ya, wya, yb, wyb] = spans(gy)

    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      const gx = side > 0 ? ((x + 0.5 - x0) * PULSE_GRID) / side : -1
      if (!rowInside || gx < 0 || gx >= PULSE_GRID) {
        px[at] = PULSE_GROUND_RGB[0]
        px[at + 1] = PULSE_GROUND_RGB[1]
        px[at + 2] = PULSE_GROUND_RGB[2]
        px[at + 3] = 255
        continue
      }
      const [xa, wxa, xb, wxb] = spans(gx)
      const t =
        wya * (wxa * litAt(frame, xa, ya) + wxb * litAt(frame, xb, ya)) +
        wyb * (wxa * litAt(frame, xa, yb) + wxb * litAt(frame, xb, yb))
      // Smoothstep, so an edge reads as light falling off rather than a ramp.
      const k = t * t * (3 - 2 * t)
      for (let c = 0; c < 3; c += 1) {
        px[at + c] = Math.round(DIM_RGB[c]! + (PULSE_LIT_RGB[c]! - DIM_RGB[c]!) * k)
      }
      px[at + 3] = 255
    }
  }
  return px
}
