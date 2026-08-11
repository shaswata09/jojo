import { useId } from 'react'

/**
 * What deleting an application does to everything pointing at it.
 *
 * The contrast is the whole figure. Prose can say "unlink, never cascade" in
 * four words and it lands as a slogan; two states with the same three boxes in
 * the same three places, and the arrows gone from the second, is the sentence
 * as a fact you can check. The boxes not moving between the halves is doing as
 * much work as the missing arrows — a reader scanning for what changed finds
 * only the edges.
 *
 * Drawn stacked rather than side by side because side by side halves the width
 * available to each state, and at 390px that put the three record names below
 * the size anything is readable at. Vertical costs height, which a page has.
 *
 * Verified against `applicationDelete` in `src/kg/tools/application-record.ts`
 * and `del` in `src/kg/tools/runtime-tx.ts`: the node and its incident
 * edges are staged for removal and nothing at the other end is named by the
 * delta at all. The relinking claim in the caption is the assertion in
 * `repository.test.ts`'s "unlinks without cascading, and relinks on undo" and
 * `journal.test.ts`'s "unlinks five records on delete and relinks all five on
 * undo".
 */

const SLOT_X = 150
const SLOT_W = 120
const SLOT_H = 30
const APP_CX = SLOT_X + SLOT_W / 2

const REC_W = 112
const REC_H = 34
const REC_X = [16, 154, 292]

const RECORDS = [
  { type: 'timelineItem', rel: 'ABOUT', after: 'about nothing' },
  { type: 'keyword', rel: 'TAGS', after: 'tagging nothing' },
  { type: 'file', rel: 'FILED_UNDER', after: 'filed under nothing' },
]

const BEFORE_APP_Y = 26
const BEFORE_REC_Y = 96
const AFTER_APP_Y = 196
const AFTER_REC_Y = 236

export function UnlinkDiagram() {
  const id = useId()
  const titleId = `${id}-title`
  const descId = `${id}-desc`

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 420 278"
        className="h-auto w-full max-w-[520px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>
          Deleting an application removes the pointers to it and leaves every record that carried
          one
        </title>
        <desc id={descId}>
          Two states, one above the other. Before: an application, with a timeline item pointing at
          it along an ABOUT edge, a keyword along a TAGS edge and a file along a FILED_UNDER edge.
          The tool application.delete runs. After: the timeline item, the keyword and the file are
          all still there, in the same places, carrying nothing — the timeline item is about
          nothing, the keyword tags nothing, the file is filed under nothing. Only the application
          and the three edges are gone. No record at the far end of an edge is touched.
        </desc>

        {/* ------------------------------ before ---------------------------- */}
        <text x={6} y={16} fontSize={10} fill="var(--text-3)">
          Before
        </text>

        <rect
          x={SLOT_X}
          y={BEFORE_APP_Y}
          width={SLOT_W}
          height={SLOT_H}
          rx={6}
          fill="var(--accent-soft)"
          stroke="var(--accent-border)"
          strokeWidth={1}
        />
        <text
          x={APP_CX}
          y={BEFORE_APP_Y + 19}
          textAnchor="middle"
          className="font-mono"
          fontSize={10.5}
          fill="var(--accent)"
        >
          application
        </text>

        {RECORDS.map((record, i) => {
          const x = REC_X[i] ?? 0
          const cx = x + REC_W / 2
          // The three arrows land spread across the hub's underside rather than
          // on one point: converging them on a single pixel drew a fan that read
          // as one edge with three tails.
          const landing = APP_CX - 32 + i * 32
          return (
            <g key={record.type}>
              <line
                x1={cx}
                y1={BEFORE_REC_Y}
                x2={landing}
                y2={BEFORE_APP_Y + SLOT_H + 6}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
              />
              <path
                d={`M ${landing - 3.5} ${BEFORE_APP_Y + SLOT_H + 5} L ${landing + 3.5} ${BEFORE_APP_Y + SLOT_H + 5} L ${landing} ${BEFORE_APP_Y + SLOT_H} Z`}
                fill="var(--hairline-strong)"
              />
              <Record x={x} y={BEFORE_REC_Y} type={record.type} note={record.rel} mono />
            </g>
          )
        })}

        {/* ------------------------------ the act --------------------------- */}
        <line
          x1={APP_CX}
          y1={142}
          x2={APP_CX}
          y2={162}
          stroke="var(--hairline-strong)"
          strokeWidth={1}
        />
        <path
          d={`M ${APP_CX - 3.5} ${162} L ${APP_CX + 3.5} ${162} L ${APP_CX} ${168} Z`}
          fill="var(--hairline-strong)"
        />
        <text x={APP_CX + 12} y={159} className="font-mono" fontSize={9.5} fill="var(--text-2)">
          application.delete
        </text>

        {/* ------------------------------- after ---------------------------- */}
        <text x={6} y={186} fontSize={10} fill="var(--text-3)">
          After
        </text>

        <rect
          x={SLOT_X}
          y={AFTER_APP_Y}
          width={SLOT_W}
          height={SLOT_H}
          rx={6}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text
          x={APP_CX}
          y={AFTER_APP_Y + 19}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-3)"
        >
          gone
        </text>

        {RECORDS.map((record, i) => (
          <Record
            key={record.type}
            x={REC_X[i] ?? 0}
            y={AFTER_REC_Y}
            type={record.type}
            note={record.after}
          />
        ))}
      </svg>

      <figcaption className="mt-3 text-sm text-text-2">
        The application and the three pointers at it are gone. The timeline item, the keyword and
        the file are not — they are in the same places, carrying nothing, and every one of them is
        still yours to open. Undo puts the edges back, because the write captured what each record
        looked like before it ran rather than a note about how to reverse itself.
      </figcaption>
    </figure>
  )
}

/**
 * One surviving record: its type, and one line about what it is joined to.
 *
 * The second line is a relation name in the top half and plain English in the
 * bottom half, which is the one asymmetry on the figure and is deliberate —
 * `ABOUT` names an edge that exists, and there is no edge left below to name.
 */
function Record({
  x,
  y,
  type,
  note,
  mono,
}: {
  x: number
  y: number
  type: string
  note: string
  /** The note is a relation name rather than a sentence. */
  mono?: true
}) {
  const cx = x + REC_W / 2
  return (
    <>
      <rect
        x={x}
        y={y}
        width={REC_W}
        height={REC_H}
        rx={5}
        fill="var(--well)"
        stroke="var(--hairline)"
        strokeWidth={1}
      />
      <text
        x={cx}
        y={y + 15}
        textAnchor="middle"
        className="font-mono"
        fontSize={9.5}
        fill="var(--text-1)"
      >
        {type}
      </text>
      <text
        x={cx}
        y={y + 27}
        textAnchor="middle"
        className={mono ? 'font-mono' : undefined}
        fontSize={8.5}
        fill="var(--text-3)"
      >
        {note}
      </text>
    </>
  )
}
