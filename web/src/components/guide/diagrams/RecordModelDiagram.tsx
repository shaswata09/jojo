import { useId } from 'react'

/**
 * The eleven record types and the seven relations, drawn as the graph they are.
 *
 * A table was drawn first and thrown away. Eleven rows and seven rows tell you
 * every fact on this figure and none of the shape: that `application` is the
 * hub, that four of the eleven types only ever point AT it, that `profile`
 * touches nothing at all, and that `keyword` is the one type allowed to sit on
 * five different things at once. A shape is what a picture is for.
 *
 * Three stroke styles, and they are the content rather than the decoration:
 *
 *   solid   — stored, and drawn on the Graph page
 *   dotted  — stored, and NOT drawn on the Graph page (pipeline, profile,
 *             COPY_OF, and the FROM that points at a pipeline)
 *   dashed  — drawn on the Graph page and never stored, below the rule
 *
 * The last two are the pair people get wrong in both directions, which is why
 * they are the only things here carrying a mark. Each style is labelled where
 * it appears rather than in a key: a legend block at 390px costs more height
 * than the three words cost inline, and a reader who has to look away from the
 * picture to decode it has stopped reading the picture.
 *
 * Verified against `kg/core/model.ts` (NODE_TYPES, RELS, EDGE_SCHEMA) and
 * against `lib/graph/model.ts` (GRAPH_NODE_TYPES, GRAPH_RELS) plus
 * `lib/graph/build.ts` (DRAWN_RELS), not against the architecture document —
 * the two lists agree on the eleven and the seven, and disagree on which eleven
 * and which seven, which is the fact the rule across the middle of this drawing
 * exists to carry.
 *
 * That pointer used to read `src/lib/graph.ts`, which is now a directory: the
 * claim this drawing rests on had been unresolvable for a refactor. If it moves
 * again, move this with it — a hand-drawn figure whose verification claim
 * points nowhere is a figure nobody can re-check.
 *
 * Colour comes from CSS custom properties only. The guide is read in both
 * themes, and a hex stroke is invisible in one of them.
 */

/* The stored half. Bands run top to bottom; x is measured in viewBox units. */
const BOX_H = 26
const BAND_1 = 34
const BAND_2 = 112
const APP_H = 30
const BAND_3 = 190
const BAND_4 = 262

/** The four taggable types that are not the application itself. */
const TAGGABLE_X = [96, 177, 258, 339]
const TAGGABLE_W = 76
const TAGGABLE = ['timelineItem', 'link', 'file', 'snippet']

const APP_X = 178
const APP_W = 112
const APP_CX = APP_X + APP_W / 2

const centre = (x: number, w: number) => x + w / 2

export function RecordModelDiagram() {
  const id = useId()
  const titleId = `${id}-title`
  const descId = `${id}-desc`

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 420 404"
        className="h-auto w-full max-w-[560px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>
          The eleven kinds of record jojo stores and the seven ways one can point at another
        </title>
        <desc id={descId}>
          The application sits at the centre and almost everything points at it. A timeline item is
          ABOUT an application. A link, a file and a snippet are each FILED_UNDER one. A saved
          posting or a scout match BECAME one. An application is AT an organisation, and may be a
          COPY_OF another application. A keyword TAGS five kinds of record — applications, timeline
          items, links, files and snippets — and it is the only relation a record may carry more
          than one of; every other relation is at most one per record, so linking again replaces the
          link that was there. Two stored types are not drawn on the Graph page at all: pipeline,
          which a saved posting or a match came FROM, and profile, which no relation joins to
          anything. COPY_OF and that FROM are stored but likewise never drawn, and are dotted here
          for it. Below the rule are the two things the Graph page draws that the store has never
          held: role and source. They are properties of an application — its roleTag and its source
          — shown as nodes joined by an IS edge and a second edge also called FROM, neither of which
          is written down anywhere.
        </desc>

        {/* ------------------------------ TAGS ------------------------------ */}
        {/* A bracket rather than five arrows. Drawing the fan out honestly put
            five long diagonals across every other edge on the figure and made
            the one interesting thing about TAGS — that it reaches five types
            and is the only 'many' relation — the hardest thing to see. */}
        <text x={92} y={28} className="font-mono" fontSize={9.5} fill="var(--text-1)">
          TAGS
        </text>
        <path
          d={`M 94 ${BAND_1} L 88 ${BAND_1} L 88 ${BAND_2 + APP_H} L 94 ${BAND_2 + APP_H}`}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth={1.2}
        />
        <Box x={6} y={114} w={76} h={BOX_H} label="keyword" />
        <line x1={82} y1={127} x2={84} y2={127} stroke="var(--hairline-strong)" strokeWidth={1} />
        <Arrow x={86} y={127} dir="right" />

        {/* --------------------------- the taggables ------------------------ */}
        {TAGGABLE.map((name, i) => (
          <Box key={name} x={TAGGABLE_X[i] ?? 0} y={BAND_1} w={TAGGABLE_W} h={BOX_H} label={name} />
        ))}

        {/* FILED_UNDER, as one bus. Three separate diagonals said "three
            relations" to every reader it was shown to; it is one. */}
        <g stroke="var(--hairline-strong)" strokeWidth={1} fill="none">
          <line x1={215} y1={BAND_1 + BOX_H} x2={215} y2={78} />
          <line x1={296} y1={BAND_1 + BOX_H} x2={296} y2={78} />
          <line x1={377} y1={BAND_1 + BOX_H} x2={377} y2={78} />
          <line x1={215} y1={78} x2={377} y2={78} />
          <line x1={270} y1={78} x2={270} y2={BAND_2 - 6} />
        </g>
        <Arrow x={270} y={BAND_2} dir="down" />
        {/* Left of centre on the bus: at the right-hand end it landed across
            the drop line from `snippet` and read as two labels overlapping. */}
        <text x={222} y={72} className="font-mono" fontSize={9.5} fill="var(--text-2)">
          FILED_UNDER
        </text>

        {/* ABOUT, as an elbow — a diagonal from here crossed the bus. */}
        <g stroke="var(--hairline-strong)" strokeWidth={1} fill="none">
          <path d={`M 134 ${BAND_1 + BOX_H} L 134 96 L 200 96 L 200 ${BAND_2 - 6}`} />
        </g>
        <Arrow x={200} y={BAND_2} dir="down" />
        <text x={138} y={92} className="font-mono" fontSize={9.5} fill="var(--text-2)">
          ABOUT
        </text>

        {/* ---------------------------- the hub ----------------------------- */}
        <rect
          x={APP_X}
          y={BAND_2}
          width={APP_W}
          height={APP_H}
          rx={6}
          fill="var(--accent-soft)"
          stroke="var(--accent-border)"
          strokeWidth={1}
        />
        <text
          x={APP_CX}
          y={BAND_2 + 19}
          textAnchor="middle"
          className="font-mono"
          fontSize={10.5}
          fill="var(--accent)"
        >
          application
        </text>

        {/* COPY_OF — a self-loop, dotted, because duplicate() writes it and the
            Graph page never draws it. */}
        <path
          d={`M ${APP_X + APP_W} 120 C 316 117, 316 139, ${APP_X + APP_W + 4} 136`}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth={1}
          strokeDasharray="1.5 2.5"
        />
        <Arrow x={APP_X + APP_W} y={136} dir="left" />
        <text x={318} y={131} className="font-mono" fontSize={9} fill="var(--text-2)">
          COPY_OF
        </text>

        {/* --------------------------- band three --------------------------- */}
        <Box x={96} y={BAND_3} w={76} h={BOX_H} label="posting" />
        <Box x={178} y={BAND_3} w={76} h={BOX_H} label="match" />
        <Box x={300} y={BAND_3} w={104} h={BOX_H} label="organisation" />

        <line
          x1={266}
          y1={BAND_2 + APP_H}
          x2={334}
          y2={BAND_3 - 5}
          stroke="var(--hairline-strong)"
          strokeWidth={1}
        />
        <Arrow x={338} y={BAND_3} dir="down" />
        <text x={300} y={164} className="font-mono" fontSize={9.5} fill="var(--text-2)">
          AT
        </text>

        <g stroke="var(--hairline-strong)" strokeWidth={1} fill="none">
          <line x1={134} y1={BAND_3} x2={196} y2={BAND_2 + APP_H + 6} />
          <line x1={216} y1={BAND_3} x2={222} y2={BAND_2 + APP_H + 6} />
        </g>
        <Arrow x={196} y={BAND_2 + APP_H} dir="up" />
        <Arrow x={222} y={BAND_2 + APP_H} dir="up" />
        <text x={96} y={162} className="font-mono" fontSize={9.5} fill="var(--text-2)">
          BECAME
        </text>

        {/* ---------------- stored, and never drawn on /graph ---------------- */}
        <rect
          x={88}
          y={252}
          width={176}
          height={46}
          rx={6}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth={1}
          strokeDasharray="1.5 2.5"
        />
        <Box x={96} y={BAND_4} w={76} h={BOX_H} label="pipeline" />
        <Box x={178} y={BAND_4} w={76} h={BOX_H} label="profile" />

        <g stroke="var(--hairline-strong)" strokeWidth={1} fill="none" strokeDasharray="1.5 2.5">
          <line x1={134} y1={BAND_3 + BOX_H} x2={134} y2={BAND_4 - 5} />
          <line x1={216} y1={BAND_3 + BOX_H} x2={160} y2={BAND_4 - 5} />
        </g>
        <Arrow x={134} y={BAND_4} dir="down" />
        <Arrow x={158} y={BAND_4} dir="down" />
        <text x={96} y={242} className="font-mono" fontSize={9} fill="var(--text-2)">
          FROM
        </text>
        <text x={270} y={270} fontSize={9} fill="var(--text-2)">
          stored, but not
        </text>
        <text x={270} y={282} fontSize={9} fill="var(--text-2)">
          drawn on the Graph page
        </text>

        {/* ----------------- drawn, and never stored, below ------------------ */}
        <line
          x1={6}
          y1={312}
          x2={414}
          y2={312}
          stroke="var(--hairline-strong)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <text x={6} y={326} fontSize={9.5} fill="var(--text-2)">
          drawn on the Graph page, never written down
        </text>

        <Box x={6} y={344} w={96} h={BOX_H} label="application" />
        <Box x={170} y={336} w={70} h={24} label="role" dashed />
        <Box x={170} y={372} w={70} h={24} label="source" dashed />

        <g stroke="var(--hairline-strong)" strokeWidth={1} fill="none" strokeDasharray="3 3">
          <line x1={102} y1={353} x2={162} y2={348} />
          <line x1={102} y1={362} x2={162} y2={382} />
        </g>
        <Arrow x={166} y={348} dir="right" />
        <Arrow x={166} y={384} dir="right" />
        <text x={124} y={342} className="font-mono" fontSize={9} fill="var(--text-2)">
          IS
        </text>
        <text x={122} y={382} className="font-mono" fontSize={9} fill="var(--text-2)">
          FROM
        </text>
        <text x={248} y={352} fontSize={9} fill="var(--text-3)">
          the roleTag prop
        </text>
        <text x={248} y={388} fontSize={9} fill="var(--text-3)">
          the source prop
        </text>
      </svg>

      {/* The same facts as prose, visible rather than hidden in the
          description. A drawing whose only text equivalent is an alt attribute
          is decoration with a compliance note attached. */}
      <figcaption className="mt-3 text-sm text-text-2">
        Eleven kinds of record, and seven relations joining them.{' '}
        <span className="font-mono text-xs text-text-1">TAGS</span> is the only one a record may
        carry more than one of — every other relation is at most one per record, so linking again
        replaces the link rather than adding a second. Two stored types are never drawn on the Graph
        page: <span className="font-mono text-xs text-text-1">pipeline</span>, which a saved posting
        or a match came from, and <span className="font-mono text-xs text-text-1">profile</span>,
        which no relation joins to anything at all. Below the rule are the two things the Graph page
        draws that were never stored: <span className="font-mono text-xs text-text-1">role</span>{' '}
        and <span className="font-mono text-xs text-text-1">source</span> are properties of an
        application, promoted to nodes for the picture and written down nowhere.
      </figcaption>
    </figure>
  )
}

/**
 * One record type.
 *
 * Deliberately plain. The boxes are the least interesting thing on this figure
 * — the arrows, the bracket and the two marks are the content — and a box that
 * competes with them costs the reader the shape.
 */
function Box({
  x,
  y,
  w,
  h,
  label,
  dashed,
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  /** Drawn on the Graph page, never stored. The one thing a border says here. */
  dashed?: true
}) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={5}
        fill={dashed ? 'none' : 'var(--well)'}
        stroke={dashed ? 'var(--hairline-strong)' : 'var(--hairline)'}
        strokeWidth={1}
        strokeDasharray={dashed ? '3 3' : undefined}
      />
      <text
        x={centre(x, w)}
        y={y + h / 2 + 3.5}
        textAnchor="middle"
        className="font-mono"
        fontSize={9.5}
        fill={dashed ? 'var(--text-2)' : 'var(--text-1)'}
      >
        {label}
      </text>
    </>
  )
}

/** An arrowhead at the point it lands on, pointing one of four ways. */
function Arrow({ x, y, dir }: { x: number; y: number; dir: 'up' | 'down' | 'left' | 'right' }) {
  const d =
    dir === 'down'
      ? `M ${x - 3.5} ${y - 5} L ${x + 3.5} ${y - 5} L ${x} ${y} Z`
      : dir === 'up'
        ? `M ${x - 3.5} ${y + 5} L ${x + 3.5} ${y + 5} L ${x} ${y} Z`
        : dir === 'right'
          ? `M ${x - 5} ${y - 3.5} L ${x - 5} ${y + 3.5} L ${x} ${y} Z`
          : `M ${x + 5} ${y - 3.5} L ${x + 5} ${y + 3.5} L ${x} ${y} Z`
  return <path d={d} fill="var(--hairline-strong)" />
}
