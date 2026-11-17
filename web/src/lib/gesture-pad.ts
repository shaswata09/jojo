import type { MascotPose } from '@/lib/mascot-context'
import { i18next } from '@/i18n/i18n'

/**
 * The mascot card as a gesture pad: a stroke drawn on it with the mouse (or a
 * finger) plays a move. Pure — the card feeds it points, it names the move —
 * so every stroke is tested offline (D20).
 *
 * Recognition is by shape, not by template matching: the stroke is resampled,
 * cut at its corners into straight runs (each given one of eight compass
 * directions), and read from those runs, from how far it turns in total and,
 * for a loop, from how round it is. That is forgiving of size, speed and
 * wobble, and small enough to read in one sitting.
 */

/** One sample of a stroke: CSS px from the pad's top-left (y grows DOWN), ms. */
export type PadPoint = { x: number; y: number; t: number }

/** Every stroke the pad knows, in the order the guide lists them. */
export const PAD_STROKES = [
  {
    id: 'tap',
    get label() {
      return i18next.t('messages:stroke.tap')
    },
    pose: 'nod',
    icon: 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  },
  {
    id: 'doubleTap',
    get label() {
      return i18next.t('messages:stroke.doubleTap')
    },
    pose: 'jab',
    icon: 'M7 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M17 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  },
  {
    id: 'hold',
    get label() {
      return i18next.t('messages:stroke.hold')
    },
    pose: 'love',
    icon: 'M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16',
  },
  {
    id: 'up',
    get label() {
      return i18next.t('messages:stroke.up')
    },
    pose: 'hopSpin',
    icon: 'M12 20V4M6 10l6-6 6 6',
  },
  {
    id: 'down',
    get label() {
      return i18next.t('messages:stroke.down')
    },
    pose: 'bow',
    icon: 'M12 4v16M6 14l6 6 6-6',
  },
  {
    id: 'side',
    get label() {
      return i18next.t('messages:stroke.side')
    },
    pose: 'lookAround',
    icon: 'M4 12h16M14 6l6 6-6 6',
  },
  {
    id: 'diagonal',
    get label() {
      return i18next.t('messages:stroke.diagonal')
    },
    pose: 'wink',
    icon: 'M5 19L19 5M10 5h9v9',
  },
  {
    id: 'backForth',
    get label() {
      return i18next.t('messages:stroke.backForth')
    },
    pose: 'shake',
    icon: 'M4 9h15l-3-3M20 15H5l3 3',
  },
  {
    id: 'zigzag',
    get label() {
      return i18next.t('messages:stroke.zigzag')
    },
    pose: 'dance',
    icon: 'M3 8l4 8 4-8 4 8 4-8 2 4',
  },
  {
    id: 'scribbleUp',
    get label() {
      return i18next.t('messages:stroke.scribbleUp')
    },
    pose: 'bounce',
    icon: 'M6 20V4M12 20V4M18 20V4',
  },
  {
    id: 'circle',
    get label() {
      return i18next.t('messages:stroke.circle')
    },
    pose: 'spin',
    icon: 'M12 4a8 8 0 1 0 8 8M20 4v8h-8',
  },
  {
    id: 'square',
    get label() {
      return i18next.t('messages:stroke.square')
    },
    pose: 'robot',
    icon: 'M5 5h14v14H5z',
  },
  {
    id: 'vee',
    get label() {
      return i18next.t('messages:stroke.vee')
    },
    pose: 'flex',
    icon: 'M4 5l8 14 8-14',
  },
  {
    id: 'peak',
    get label() {
      return i18next.t('messages:stroke.peak')
    },
    pose: 'powerUp',
    icon: 'M4 19l8-14 8 14',
  },
  {
    id: 'zed',
    get label() {
      return i18next.t('messages:stroke.zed')
    },
    pose: 'doze',
    icon: 'M5 5h14L5 19h14',
  },
  {
    id: 'arc',
    get label() {
      return i18next.t('messages:stroke.arc')
    },
    pose: 'jazz',
    icon: 'M17 5a8 8 0 1 0 0 14',
  },
  {
    id: 'ell',
    get label() {
      return i18next.t('messages:stroke.ell')
    },
    pose: 'point',
    icon: 'M7 4v15h12',
  },
  {
    id: 'triangle',
    get label() {
      return i18next.t('messages:stroke.triangle')
    },
    pose: 'disco',
    icon: 'M12 4l8 15H4z',
  },
  {
    id: 'other',
    get label() {
      return i18next.t('messages:stroke.other')
    },
    pose: 'wobble',
    icon: 'M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 19h.01',
  },
] as const satisfies readonly {
  id: string
  label: string
  pose: Exclude<MascotPose, 'idle'>
  icon: string
}[]

type StrokeId = (typeof PAD_STROKES)[number]['id']

/** The strokes that play a given move — for showing beside it in a list. */
export const strokesFor = (pose: MascotPose) => PAD_STROKES.filter((s) => s.pose === pose)

/** Under this much travel (px) a press is a tap, not a stroke. */
const TAP_PX = 10
/** A tap held this long (ms) is a press-and-hold. */
export const HOLD_MS = 550
/** A press that moves this far (px) is a stroke starting, not a hold. */
export const HOLD_PX = 6
/** A second tap this soon (ms) after the first, and this close (px), is a double tap. */
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_PX = 24

/** 0 = right, 1 = down-right, 2 = down, … 7 = up-right (screen y grows down). */
type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
type Run = { dir: Dir; len: number; dx: number; dy: number }

const STEP = 4

/** Resamples to points `STEP` px apart, so speed does not weigh on the shape. */
function resample(points: readonly PadPoint[]): { x: number; y: number }[] {
  const first = points[0]
  if (!first) return []
  const out = [{ x: first.x, y: first.y }]
  let last = out[0]!
  for (const p of points.slice(1)) {
    let dx = p.x - last.x
    let dy = p.y - last.y
    let d = Math.hypot(dx, dy)
    while (d >= STEP) {
      last = { x: last.x + (dx / d) * STEP, y: last.y + (dy / d) * STEP }
      out.push(last)
      dx = p.x - last.x
      dy = p.y - last.y
      d = Math.hypot(dx, dy)
    }
  }
  return out
}

const dirOf = (dx: number, dy: number): Dir =>
  (((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8) as Dir

const chord = (a: { x: number; y: number }, b: { x: number; y: number }): Run => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return { dir: dirOf(dx, dy), len: Math.hypot(dx, dy), dx, dy }
}

/** The angle between two runs' headings, 0..π. */
const bend = (a: Run, b: Run) => {
  let d = Math.abs(Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx))
  if (d > Math.PI) d = Math.PI * 2 - d
  return d
}

/**
 * The stroke as straight runs between its corners.
 *
 * A corner is where the stroke folds: the straight-line distance across a few
 * samples either side ("the straw") drops well below what it is along the
 * stroke's straight parts. Each run is then read whole, from corner to corner,
 * so a line drawn on the border between two compass points cannot flicker
 * between them sample by sample. Neighbouring runs heading nearly the same way
 * are joined (a corner found in a wobble), and runs shorter than a ninth of
 * the stroke are folded into a neighbour — no hand draws a clean corner.
 */
export function runsOf(pts: { x: number; y: number }[], total: number): Run[] {
  const W = 3
  if (pts.length < 2 * W + 2) return pts.length > 1 ? [chord(pts[0]!, pts[pts.length - 1]!)] : []
  const straw = pts.map((_, i) =>
    i < W || i >= pts.length - W
      ? Infinity
      : Math.hypot(pts[i + W]!.x - pts[i - W]!.x, pts[i + W]!.y - pts[i - W]!.y),
  )
  const finite = straw.filter(Number.isFinite).sort((a, b) => a - b)
  const threshold = 0.9 * finite[Math.floor(finite.length * 0.9)]!
  const corners = [0]
  for (let i = W; i < pts.length - W;) {
    if (straw[i]! >= threshold) {
      i++
      continue
    }
    let best = i
    while (i < pts.length - W && straw[i]! < threshold) {
      if (straw[i]! < straw[best]!) best = i
      i++
    }
    corners.push(best)
  }
  corners.push(pts.length - 1)

  const runsFrom = (cs: number[]) => cs.slice(1).map((c, i) => chord(pts[cs[i]!]!, pts[c]!))
  let cs = corners
  for (let changed = true; changed && cs.length > 2;) {
    changed = false
    const runs = runsFrom(cs)
    // Nearly straight through a corner: not a corner.
    const straightAt = runs.findIndex((r, i) => i > 0 && bend(runs[i - 1]!, r) < Math.PI / 5)
    if (straightAt > 0) {
      cs = cs.filter((_, i) => i !== straightAt)
      changed = true
      continue
    }
    // Too short to be meant: merge it into whichever neighbour it bends least from.
    const shortAt = runs.findIndex((r) => r.len < total / 9)
    if (shortAt >= 0) {
      const before = shortAt > 0 ? bend(runs[shortAt - 1]!, runs[shortAt]!) : Infinity
      const after = shortAt < runs.length - 1 ? bend(runs[shortAt]!, runs[shortAt + 1]!) : Infinity
      const drop = before <= after ? shortAt : shortAt + 1
      cs = cs.filter((_, i) => i !== drop)
      changed = true
    }
  }
  return runsFrom(cs)
}

/** How far the stroke turns in all, radians, signed: a full loop is about ±2π. */
function turning(pts: { x: number; y: number }[]): number {
  let sum = 0
  let prev: number | null = null
  for (let i = 2; i < pts.length; i += 2) {
    const a = pts[i - 2]!
    const b = pts[i]!
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    if (prev !== null) {
      let d = angle - prev
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      sum += d
    }
    prev = angle
  }
  return sum
}

const horizontal = (d: Dir) => d === 0 || d === 4
const vertical = (d: Dir) => d === 2 || d === 6
const diagonal = (d: Dir) => d % 2 === 1
const goesDown = (d: Dir) => d === 1 || d === 2 || d === 3
const goesUp = (d: Dir) => d === 5 || d === 6 || d === 7

/** Sign changes along one axis, counting only runs that move along it. */
function reversals(runs: Run[], axis: 'dx' | 'dy'): number {
  let n = 0
  let sign = 0
  for (const r of runs) {
    const v = r[axis]
    if (Math.abs(v) < r.len * 0.35) continue
    const s = Math.sign(v)
    if (sign && s !== sign) n++
    sign = s
  }
  return n
}

/**
 * Names the stroke a pointer drew, from its samples between press and
 * release. Never returns nothing: a stroke it cannot read is `other`, which
 * the robot answers with a puzzled wobble rather than ignoring you.
 *
 * A double tap needs the previous tap, which only the card knows; it is
 * decided there (`isDoubleTap`), and this returns `tap` for each of the two.
 */
export function recognise(points: readonly PadPoint[]): StrokeId {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return 'tap'
  const pts = resample(points)
  let total = 0
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  if (total < TAP_PX) return last.t - first.t >= HOLD_MS ? 'hold' : 'tap'

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < size * 0.4
  const runs = runsOf(pts, total)

  // A loop: turns most of the way round (a triangle turns two of its corners,
  // 240°, before closing) and ends near where it began. A
  // square spends its length on the four straight sides; a circle spreads it
  // over every direction.
  if (closed && Math.abs(turning(pts)) > Math.PI * 1.25) {
    const straight = runs.filter((r) => !diagonal(r.dir)).reduce((n, r) => n + r.len, 0)
    const sides = new Set(
      runs.filter((r) => !diagonal(r.dir) && r.len > total / 8).map((r) => r.dir),
    )
    if (sides.size >= 4 && straight > total * 0.75) return 'square'
    // Three corners, and a shape far from round: a triangle's corners lie
    // twice as far from its centre as its edges' middles do, where a circle
    // keeps nearly one radius all the way round (and a hand's wobble barely
    // moves that). Three chords alone cannot tell them apart — a circle can
    // be cut into three runs too.
    const cx = pts.reduce((n, p) => n + p.x, 0) / pts.length
    const cy = pts.reduce((n, p) => n + p.y, 0) / pts.length
    const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy))
    const mean = radii.reduce((n, d) => n + d, 0) / radii.length
    const spread = Math.sqrt(radii.reduce((n, d) => n + (d - mean) ** 2, 0) / radii.length) / mean
    return runs.length === 3 && spread > 0.12 ? 'triangle' : 'circle'
  }

  const dirs = runs.map((r) => r.dir)
  // Z: across, back down diagonally, across again (either way round).
  if (
    dirs.length === 3 &&
    horizontal(dirs[0]!) &&
    dirs[0] === dirs[2] &&
    diagonal(dirs[1]!) &&
    goesDown(dirs[1]!)
  ) {
    const back = (dirs[0] === 0 && runs[1]!.dx < 0) || (dirs[0] === 4 && runs[1]!.dx > 0)
    if (back) return 'zed'
  }

  const dx = runs.reduce((n, r) => n + Math.abs(r.dx), 0)
  const dy = runs.reduce((n, r) => n + Math.abs(r.dy), 0)
  const xTurns = reversals(runs, 'dx')
  const yTurns = reversals(runs, 'dy')
  // Two or more reversals is a scribble. Sideways if it goes back and forth
  // sideways, or travels sideways overall (a sawtooth: /\/\/\ reverses up and
  // down, but is drawn across).
  // A real scribble swings between the same two headings; a scrawl does not.
  const alternating = runs.every((r, i) => i < 2 || bend(runs[i - 2]!, r) < Math.PI / 4)
  if (alternating && Math.max(xTurns, yTurns) >= 2) {
    const across = Math.abs(last.x - first.x) > Math.abs(last.y - first.y) * 2
    return dx >= dy || across ? 'zigzag' : 'scribbleUp'
  }
  if (dx > dy * 1.5 && xTurns === 1) return 'backForth'

  // L: down, then across — two straight runs meeting square.
  if (runs.length === 2 && runs[0]!.dir === 2 && horizontal(runs[1]!.dir)) return 'ell'

  // An arc: open, turning a half circle or so, with no sharp corner in it.
  const swing = Math.abs(turning(pts))
  const gentle = runs.every((r, i) => i === 0 || bend(runs[i - 1]!, r) < Math.PI * 0.4)
  if (!closed && gentle && swing > Math.PI * 0.6 && swing < Math.PI * 1.4) return 'arc'

  if (runs.length === 2) {
    const [a, b] = [runs[0]!.dir, runs[1]!.dir]
    if (goesDown(a) && goesUp(b)) return 'vee'
    if (goesUp(a) && goesDown(b)) return 'peak'
  }

  // One straight line, judged from start to end so a slight curve still counts.
  const straightness = Math.hypot(last.x - first.x, last.y - first.y) / total
  if (straightness > 0.8) {
    const d = dirOf(last.x - first.x, last.y - first.y)
    if (d === 6) return 'up'
    if (d === 2) return 'down'
    if (horizontal(d)) return 'side'
    return 'diagonal'
  }
  if (runs.length === 1 && vertical(runs[0]!.dir)) return runs[0]!.dir === 6 ? 'up' : 'down'
  return 'other'
}

/** Whether a tap at `at` follows an earlier one closely enough to pair with it. */
export function isDoubleTap(
  prev: { x: number; y: number; t: number } | null,
  at: { x: number; y: number; t: number },
): boolean {
  if (!prev) return false
  return at.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(at.x - prev.x, at.y - prev.y) <= DOUBLE_TAP_PX
}

/** The move a stroke plays. */
export const poseForStroke = (id: StrokeId): Exclude<MascotPose, 'idle'> =>
  PAD_STROKES.find((s) => s.id === id)!.pose
