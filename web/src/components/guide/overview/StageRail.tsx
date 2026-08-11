import { STAGE_ASKS } from '@/components/guide/overview/stage-asks'
import { STAGES } from '@/data/seed'

const RAIL_ROW = 46
const RAIL_TOP = 22

/**
 * The six stages, drawn as the single track they are.
 *
 * Vertical rather than horizontal, which is the version this started as. Six
 * stage names across a 390px phone means either a diagram that scrolls
 * sideways or type at seven effective pixels; the same six down the page render
 * at their natural size on every screen jojo runs on, and the reading order of
 * a list going down a page is the one a reader already has.
 *
 * The dots carry the app's own stage colours — the same tokens the board
 * columns, the funnel and every stage chip use — so the picture is keyed to
 * what the reader will see when they get there rather than to a palette
 * invented for a diagram. Colour is never the only cue: the filled ring says
 * "this move opens a short form", and the pill beside it says so in words.
 *
 * `var(--stage-*)` through `style` rather than a `fill-stage-*` class: these
 * are the raw tokens on `:root`, they are swapped wholesale for the dark theme
 * a hundred lines further down `index.css`, and reading them directly means the
 * diagram cannot be the thing that fails silently when a utility is renamed.
 */
export function StageRail() {
  const height = RAIL_TOP * 2 + (STAGES.length - 1) * RAIL_ROW

  return (
    <svg
      viewBox={`0 0 200 ${height}`}
      role="img"
      aria-labelledby="stage-rail-title stage-rail-desc"
      className="h-auto w-full max-w-[260px]"
    >
      <title id="stage-rail-title">The six stages an application moves through</title>
      <desc id="stage-rail-desc">
        Draft, Submitted, Screening call, Interview, Offer and Closed, in order, on one track.
        Moving to Submitted, Interview, Offer or Closed opens a short form; moving to Draft or
        Screening call happens straight away. The list beneath says what each form asks for.
      </desc>

      <line
        x1="14"
        y1={RAIL_TOP}
        x2="14"
        y2={RAIL_TOP + (STAGES.length - 1) * RAIL_ROW}
        style={{ stroke: 'var(--hairline)' }}
        strokeWidth="2"
      />

      {STAGES.map((stage, index) => {
        const cy = RAIL_TOP + index * RAIL_ROW
        const asks = STAGE_ASKS[stage.id] !== ''
        return (
          <g key={stage.id}>
            <circle
              cx="14"
              cy={cy}
              r="6.5"
              style={{ fill: `var(--stage-${stage.id})` }}
              stroke="none"
            />
            <text
              x="32"
              y={cy + 4}
              fontSize="13"
              style={{ fill: 'var(--text-1)' }}
              className="font-sans"
            >
              {stage.label}
            </text>
            {asks ? (
              <>
                <rect
                  x="140"
                  y={cy - 9}
                  width="52"
                  height="18"
                  rx="9"
                  style={{ fill: 'var(--well)', stroke: 'var(--hairline)' }}
                />
                <text
                  x="166"
                  y={cy + 4}
                  fontSize="10"
                  textAnchor="middle"
                  style={{ fill: 'var(--text-3)' }}
                  className="font-sans"
                >
                  asks
                </text>
              </>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
