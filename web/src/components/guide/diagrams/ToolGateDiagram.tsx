import { useId } from 'react'

/**
 * The path a request takes, and the two places it can be stopped.
 *
 * This is the figure that has to carry the distinction people get wrong about
 * every system like this: choosing what to OFFER is a hint, and checking what
 * was CALLED is a rule. A model can emit any name it likes regardless of what
 * it was shown — small ones routinely do — so a design that only narrows the
 * list has narrowed nothing that matters.
 *
 * Both gates are drawn, in the order they act, with the second marked as the
 * one that actually holds. The two side-branches are the honest outcomes: an
 * unclear question skips the first gate entirely, and a name that was never
 * offered dies at the second.
 *
 * Top-to-bottom here, unlike `ToolGraphDiagram`, because this genuinely IS a
 * sequence — and the order is the content.
 */

const STEPS = [
  { label: 'what you typed', tone: 'plain' as const, note: '' },
  { label: 'pick the likely tools', tone: 'gate' as const, note: 'unclear? offer all 82' },
  { label: 'add what those tools need', tone: 'plain' as const, note: 'so no chain dead-ends' },
  { label: 'the model chooses one', tone: 'plain' as const, note: '' },
  { label: 'was it offered?', tone: 'stop' as const, note: 'no? refused, nothing runs' },
  { label: 'your records change', tone: 'plain' as const, note: '' },
]

const TOP = 26
const PITCH = 56
const H = 32
const W = 190

export function ToolGateDiagram() {
  const titleId = useId()
  const descId = useId()
  const height = TOP + STEPS.length * PITCH

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 420 ${String(height)}`}
        className="h-auto w-full max-w-[520px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>The two gates between a question and a change to your records</title>
        <desc id={descId}>
          Six steps, top to bottom. One, what you typed. Two, jojo picks the tools your words point
          at — and if your words are unclear it offers all eighty-two rather than guessing. Three,
          it adds whatever those tools depend on, so no chain can dead-end. Four, the model chooses
          one tool. Five, jojo checks whether that tool was actually offered; if it was not, the
          call is refused and nothing runs. Six, only then do your records change. The fifth step is
          the one that enforces anything — the second is only a hint, because a model can name a
          tool it was never shown.
        </desc>

        {STEPS.map((step, i) => {
          const y = TOP + i * PITCH
          const mid = y + H / 2
          const stroke =
            step.tone === 'stop'
              ? 'var(--danger)'
              : step.tone === 'gate'
                ? 'var(--accent)'
                : 'var(--hairline-strong)'
          return (
            <g key={step.label}>
              <rect
                x={4}
                y={y}
                width={W}
                height={H}
                rx={7}
                fill="var(--well)"
                stroke={stroke}
                strokeWidth={step.tone === 'plain' ? 1 : 1.5}
              />
              <text x={14} y={mid + 4} fontSize={11} fill="var(--text-1)">
                {step.label}
              </text>

              {/* The escape, drawn as a branch off to the right rather than as a
                  step of its own: neither of these continues down the column,
                  and drawing them inline would imply they do. */}
              {step.note ? (
                <>
                  <line
                    x1={W + 8}
                    y1={mid}
                    x2={228}
                    y2={mid}
                    stroke={stroke}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text x={234} y={mid + 4} fontSize={10} fill="var(--text-2)">
                    {step.note}
                  </text>
                </>
              ) : null}

              {i < STEPS.length - 1 ? (
                <>
                  <line
                    x1={W / 2}
                    y1={y + H}
                    x2={W / 2}
                    y2={y + PITCH}
                    stroke="var(--hairline-strong)"
                    strokeWidth={1}
                  />
                  <path
                    d={`M ${String(W / 2)} ${String(y + PITCH)} l -3.5 -6 h 7 z`}
                    fill="var(--hairline-strong)"
                  />
                </>
              ) : null}
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-text-3">
        Step two saves you tokens. Step five is the one that keeps you safe — and it runs whether or
        not step two narrowed anything.
      </figcaption>
    </figure>
  )
}
