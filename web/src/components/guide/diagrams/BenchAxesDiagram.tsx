import { useId } from 'react'
import { Box, Rule } from '@/components/guide/diagrams/parts'
import report from '@/components/guide/tool-bench.json'

/**
 * Why per-turn accuracy flatters a model, and what it hides.
 *
 * The three bars are the three things the benchmark scores, measured over the
 * same runs. Two of them agree and the third does not, and the gap between them
 * is the whole argument for scoring a conversation rather than a turn.
 *
 * A turn is correct when it called something defensible. A state check is
 * correct when one claim about the store held. A CONVERSATION is clean only
 * when every turn AND every check passed — so the two high numbers compound
 * into the low one, and the low one is the only one that answers "did it do the
 * job".
 *
 * The numbers are read out of the benchmark's own JSON rather than typed, for
 * the same reason the tool count on this page is: a figure that quietly stops
 * matching the run it describes is worse than no figure.
 *
 * Drawn as three bars and not a table because the POINT is the gap, and a gap
 * is a thing you see rather than compute. The table underneath carries the
 * per-model detail this deliberately does not.
 */

type Run = {
  conversationsClean: number
  conversations: number
  turnsCorrect: number
  turns: number
  stateChecksPassed: number
  stateChecks: number
}

const runs = report.report as Run[]
const total = (pick: (r: Run) => number) => runs.reduce((n, r) => n + pick(r), 0)

const BARS = [
  {
    label: 'Turns called something defensible',
    got: total((r) => r.turnsCorrect),
    of: total((r) => r.turns),
    note: 'the easy question',
  },
  {
    label: 'Claims about the store that held',
    got: total((r) => r.stateChecksPassed),
    of: total((r) => r.stateChecks),
    note: 'checked one at a time',
  },
  {
    label: 'Whole conversations with nothing wrong',
    got: total((r) => r.conversationsClean),
    of: total((r) => r.conversations),
    note: 'every turn and every claim, together',
  },
]

const TOP = 30
const PITCH = 62
const BAR_H = 16
const BAR_X = 8
const BAR_W = 300

export function BenchAxesDiagram() {
  const titleId = useId()
  const descId = useId()
  const height = TOP + BARS.length * PITCH + 6
  const pct = (b: (typeof BARS)[number]) => b.got / b.of

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 420 ${String(height)}`}
        className="diagram h-auto w-full max-w-[540px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>Per-turn accuracy against whole-conversation success</title>
        <desc id={descId}>
          Three bars, measured over the same benchmark runs. Turns that called something defensible:{' '}
          {BARS[0]!.got} of {BARS[0]!.of}, {Math.round(pct(BARS[0]!) * 100)} per cent. Individual
          claims about the store that held: {BARS[1]!.got} of {BARS[1]!.of},{' '}
          {Math.round(pct(BARS[1]!) * 100)} per cent. Whole conversations with nothing wrong in them:{' '}
          {BARS[2]!.got} of {BARS[2]!.of}, {Math.round(pct(BARS[2]!) * 100)} per cent. The third is
          lower than the other two because a conversation is only clean when every turn and every
          claim passed together, so the two high numbers compound into the low one.
        </desc>

        {BARS.map((bar, i) => {
          const y = TOP + i * PITCH
          const filled = BAR_W * pct(bar)
          const last = i === BARS.length - 1
          return (
            <g key={bar.label}>
              <text x={BAR_X} y={y - 8} fontSize={11} fill="var(--text-1)">
                {bar.label}
              </text>

              {/* The track, then the fill. The track matters: without it a
                  reader cannot see what the bar is a fraction OF. */}
              <Box x={BAR_X} y={y} w={BAR_W} h={BAR_H} rx={4} fill="var(--well)" />
              <rect
                x={BAR_X}
                y={y}
                width={filled}
                height={BAR_H}
                rx={4}
                fill={last ? 'var(--warn)' : 'var(--text-3)'}
              />

              <text
                x={BAR_X + BAR_W + 10}
                y={y + BAR_H - 3}
                fontSize={11}
                className="tabular"
                fill={last ? 'var(--warn)' : 'var(--text-1)'}
              >
                {Math.round(pct(bar) * 100)}%
              </text>
              <text x={BAR_X} y={y + BAR_H + 14} fontSize={9.5} fill="var(--text-3)">
                {bar.got} of {bar.of} — {bar.note}
              </text>
            </g>
          )
        })}

        {/* The bracket that says the third bar is not a fourth measurement but a
            consequence of the first two. */}
        <Rule
          x1={BAR_X + BAR_W + 42}
          y1={TOP + 4}
          x2={BAR_X + BAR_W + 42}
          y2={TOP + PITCH + BAR_H}
          stroke="var(--hairline-strong)"
        />
        <text x={BAR_X + BAR_W + 48} y={TOP + PITCH / 2 + 8} fontSize={9.5} fill="var(--text-3)">
          both must
        </text>
        <text x={BAR_X + BAR_W + 48} y={TOP + PITCH / 2 + 20} fontSize={9.5} fill="var(--text-3)">
          hold at once
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">
        A benchmark that reported only the first bar would call these models nearly perfect. The
        third is the one that answers whether the job got done.
      </figcaption>
    </figure>
  )
}
