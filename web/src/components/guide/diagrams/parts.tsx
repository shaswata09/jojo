import { roundedPath } from '@/components/guide/diagrams/marks'

/**
 * The marks every guide diagram is drawn from.
 *
 * WHY THE LINES LOOKED WRONG, and it was not the geometry. Every figure here is
 * responsive — `w-full` inside a `max-w-[520px]` — over a viewBox around 420
 * units wide. So the drawing is scaled by whatever the column happens to be:
 * 1.24x at the cap, less than that on a narrow screen, and never a whole
 * number. A `strokeWidth={1}` then renders at 1.24 device pixels, straddling
 * the pixel grid, and the browser antialiases it into a soft two-pixel smear —
 * darker where a line lands on a boundary, lighter where it does not. Eight
 * diagrams of hairlines, each blurred by a different amount.
 *
 * `vectorEffect="non-scaling-stroke"` is the fix: the stroke is measured in
 * final rendered pixels rather than viewBox units, so a 1 is one crisp device
 * pixel at every width. It costs nothing and it is why every stroked mark in
 * this file goes through one of these components rather than being written by
 * hand — a `<line>` somewhere that forgot it is a line that looks different
 * from its neighbours.
 *
 * The second thing these fix is proportion. The arrowheads were 7 wide by 6
 * long against a hairline stem, which reads as a blunt wedge stuck on a thread.
 * They are slimmer here, and the shaft stops at the head's base rather than
 * running underneath it — an overlap that showed as the stem peeking out either
 * side of the tip once antialiasing was involved.
 */

/** The one line colour. Diagrams that mean something else say so explicitly. */
export const EDGE = 'var(--hairline-strong)'

/** Arrowhead length along the line, and width across it. */
const HEAD = { long: 5.5, wide: 4.5 }

export type Dir = 'up' | 'down' | 'left' | 'right'

/**
 * A connector, optionally arrowed, that stops where it should.
 *
 * `to` is the point the arrow POINTS AT — normally an edge of the box being
 * pointed to. The shaft is shortened by the head so the two never overlap, and
 * by `gap` so the tip does not sit welded to the border it is indicating.
 */
export function Connector({
  from,
  to,
  dir,
  dash,
  stroke = EDGE,
  width = 1,
  gap = 2,
  head = true,
}: {
  from: [number, number]
  to: [number, number]
  dir: Dir
  dash?: string
  stroke?: string
  width?: number
  /** Distance kept between the tip and the thing it points at. */
  gap?: number
  head?: boolean
}) {
  const [x1, y1] = from
  const [x2, y2] = to

  // Where the tip lands, pulled back from the target by `gap`.
  const tip: [number, number] =
    dir === 'down'
      ? [x2, y2 - gap]
      : dir === 'up'
        ? [x2, y2 + gap]
        : dir === 'right'
          ? [x2 - gap, y2]
          : [x2 + gap, y2]

  // Where the shaft stops: at the head's base when there is one, else the tip.
  const back = head ? HEAD.long : 0
  const end: [number, number] =
    dir === 'down'
      ? [tip[0], tip[1] - back]
      : dir === 'up'
        ? [tip[0], tip[1] + back]
        : dir === 'right'
          ? [tip[0] - back, tip[1]]
          : [tip[0] + back, tip[1]]

  return (
    <>
      <line
        x1={x1}
        y1={y1}
        x2={end[0]}
        y2={end[1]}
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        {...(dash === undefined ? {} : { strokeDasharray: dash })}
      />
      {head ? <Arrow x={tip[0]} y={tip[1]} dir={dir} fill={stroke} /> : null}
    </>
  )
}

/**
 * An arrowhead at the point it lands on, pointing one of four ways.
 *
 * Filled rather than stroked, so it is NOT given `non-scaling-stroke` — a fill
 * scales cleanly and has no grid to miss. Sized against a one-pixel shaft
 * rather than against the viewBox, which is why it is slimmer than it looks in
 * these numbers: at the widths these figures actually render, this is about six
 * pixels long.
 */
export function Arrow({
  x,
  y,
  dir,
  fill = EDGE,
}: {
  x: number
  y: number
  dir: Dir
  fill?: string
}) {
  const { long, wide } = HEAD
  const half = wide / 2
  const d =
    dir === 'down'
      ? `M ${x - half} ${y - long} L ${x + half} ${y - long} L ${x} ${y} Z`
      : dir === 'up'
        ? `M ${x - half} ${y + long} L ${x + half} ${y + long} L ${x} ${y} Z`
        : dir === 'right'
          ? `M ${x - long} ${y - half} L ${x - long} ${y + half} L ${x} ${y} Z`
          : `M ${x + long} ${y - half} L ${x + long} ${y + half} L ${x} ${y} Z`
  return <path d={d} fill={fill} />
}

/**
 * A labelled box.
 *
 * Exists so the corner radius, the border weight and the crisp-stroke rule are
 * decided once. `rx={7}` on a 32-unit box scaled by 1.24 is the same visual
 * roundness the app's own cards use.
 */
export function Box({
  x,
  y,
  w,
  h,
  stroke = EDGE,
  fill = 'var(--well)',
  width = 1,
  dash,
  rx = 7,
}: {
  x: number
  y: number
  w: number
  h: number
  stroke?: string
  fill?: string
  width?: number
  dash?: string
  rx?: number
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={rx}
      fill={fill}
      stroke={stroke}
      strokeWidth={width}
      vectorEffect="non-scaling-stroke"
      {...(dash === undefined ? {} : { strokeDasharray: dash })}
    />
  )
}

/**
 * A rule, a bracket, or any plain stroke that is not a connector.
 *
 * The same crisp-stroke guarantee without an arrowhead, for the separators and
 * grouping lines the figures use.
 */
export function Rule({
  x1,
  y1,
  x2,
  y2,
  stroke = EDGE,
  width = 1,
  dash,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  stroke?: string
  width?: number
  dash?: string
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
      {...(dash === undefined ? {} : { strokeDasharray: dash })}
    />
  )
}

/**
 * An orthogonal route whose corners are rounded.
 *
 * Right angles are what make a hand-plotted figure look plotted. Every drawing
 * tool a reader has seen — Figma, Lucidchart, the diagrams in any decent
 * handbook — rounds an elbow by a few units, and the absence of it is one of
 * those things that reads as "off" without being nameable.
 *
 * Takes the corner points and emits `L`/`Q` pairs: stop short of each corner by
 * `r`, curve through it, carry on. The radius is clamped to half the shorter
 * adjacent run so a tight elbow degrades to a sharp one rather than overshooting
 * into a loop.
 */
export function Elbow({
  points,
  r = 6,
  stroke = EDGE,
  width = 1,
  dash,
}: {
  points: readonly (readonly [number, number])[]
  r?: number
  stroke?: string
  width?: number
  dash?: string
}) {
  return (
    <path
      d={roundedPath(points, r)}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      {...(dash === undefined ? {} : { strokeDasharray: dash })}
    />
  )
}
