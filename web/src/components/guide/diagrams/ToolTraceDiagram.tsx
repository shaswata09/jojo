import { useId } from 'react'

/**
 * One feature, traced through the layers: what happens when someone adds an
 * application.
 *
 * The second diagram earns its place because the first one answers "what may
 * import what" and leaves the question people actually arrive with — *where
 * does my code go* — unanswered. `application.create` is the right example
 * precisely because it is a composite: it writes the record, ensures the
 * employer, and mints the deadline, and all three land in one commit. A trace
 * of a one-field setter would have shown a straight line and taught nothing.
 *
 * Deliberately in the order it HAPPENS, which is not the order of the stack:
 * kg/core is L1 and sits below kg/repo in the layer numbering, but a tool calls
 * down into it and returns before anything is committed. Numbering the rows by
 * level instead was tried and produced a picture in which the commit appears to
 * precede the id it commits. The caption says which order this is, because a
 * diagram that quietly disagrees with the one above it is worse than no second
 * diagram.
 *
 * The dashed last hop is the point of the whole figure. Every arrow above it is
 * synchronous; the disk write is not awaited by anything, which is why a click
 * never spins and why a failed write raises a persistent banner instead of
 * rolling the interface back.
 */

type Step = {
  /** Where the code lives. Mono, because it is a path. */
  where: string
  what: string
  /** Only used once — the row above the seam is not part of the shared layer. */
  tag?: string
}

const STEPS: Step[] = [
  {
    where: 'src/components/applications',
    what: 'the form hands the runtime an input object',
    tag: 'web only',
  },
  { where: 'kg/react/use-tool.ts', what: "run('application.create') — nothing is awaited" },
  { where: 'kg/tools/application.ts', what: 'org.ensure and the deadline join the same call' },
  { where: 'kg/core/schema.ts · ref.ts', what: 'parses the input, mints the id and the slug' },
  { where: 'kg/repo/repository.ts', what: 'commit: the snapshot, one journal row, one undo' },
  { where: 'kg/storage/idb-driver.ts', what: 'four object stores, one IndexedDB transaction' },
]

const X = 70
const W = 310
const H = 46
const PITCH = 68
const TOP = 8
/** The rows the transaction is open across: opened at the tool, closed at the commit. */
const TX_FROM = 2
const TX_TO = 4

const stepTop = (i: number) => TOP + i * PITCH

export function ToolTraceDiagram() {
  const titleId = useId()
  const descId = useId()

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 400 404"
        className="h-auto w-full max-w-[520px]"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>Where the code for adding an application lives, layer by layer</title>
        <desc id={descId}>
          Six steps, top to bottom. One, in src/components and outside the shared layer, the
          application form hands the runtime an input object. Two, kg/react/use-tool.ts runs the
          tool named application.create and awaits nothing. Three, kg/tools/application.ts opens one
          transaction, and the nested calls to org.ensure and to the deadline tool join it rather
          than opening their own. Four, kg/core parses the input against the tool&rsquo;s schema and
          mints the id and the slug. Five, kg/repo commits once: the snapshot is updated, one
          journal row is appended, and that row is the single undo. Six, kg/storage writes to four
          IndexedDB object stores in one transaction — and this last step alone is drawn as a dashed
          arrow, because nothing waits for it. A bracket in the margin marks steps three to five as
          one transaction and one undo.
        </desc>

        {/* The transaction bracket. Its label is rotated rather than stacked
            because a vertical run of one-word lines is unreadable at 390px. */}
        <g stroke="var(--hairline-strong)" strokeWidth={1} fill="none">
          <path
            d={`M 44 ${stepTop(TX_FROM)} L 36 ${stepTop(TX_FROM)} L 36 ${stepTop(TX_TO) + H} L 44 ${stepTop(TX_TO) + H}`}
          />
        </g>
        <text
          x={24}
          y={(stepTop(TX_FROM) + stepTop(TX_TO) + H) / 2}
          transform={`rotate(-90 24 ${(stepTop(TX_FROM) + stepTop(TX_TO) + H) / 2})`}
          textAnchor="middle"
          fontSize={9.5}
          fill="var(--text-3)"
        >
          one transaction · one undo
        </text>

        {STEPS.map((step, i) => {
          const y = stepTop(i)
          const aboveSeam = i === 0
          return (
            <g key={step.where}>
              {/* The row above the seam is dashed and takes the STRONGER
                  hairline: at 358px a dashed `--hairline` rule over a dark
                  panel is close to invisible, and "this step is outside the
                  shared layer" is the one fact on this figure carried by a
                  border rather than by words. */}
              <rect
                x={X}
                y={y}
                width={W}
                height={H}
                rx={6}
                fill={aboveSeam ? 'var(--panel)' : 'var(--well)'}
                stroke={aboveSeam ? 'var(--hairline-strong)' : 'var(--hairline)'}
                strokeWidth={1}
                strokeDasharray={aboveSeam ? '4 3' : undefined}
              />
              <circle
                cx={X}
                cy={y + 23}
                r={9}
                fill="var(--panel)"
                stroke="var(--hairline-strong)"
                strokeWidth={1}
              />
              <text
                x={X}
                y={y + 26.5}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-2)"
                aria-hidden
              >
                {i + 1}
              </text>
              <text x={X + 16} y={y + 20} className="font-mono" fontSize={11} fill="var(--text-1)">
                {step.where}
              </text>
              {step.tag ? (
                <text
                  x={X + W - 10}
                  y={y + 20}
                  className="font-mono"
                  textAnchor="end"
                  fontSize={9.5}
                  fill="var(--text-3)"
                >
                  {step.tag}
                </text>
              ) : null}
              <text x={X + 16} y={y + 35} fontSize={10.5} fill="var(--text-2)">
                {step.what}
              </text>
            </g>
          )
        })}

        {STEPS.slice(1).map((step, index) => {
          const gapTop = stepTop(index) + H
          const last = index === STEPS.length - 2
          const from = gapTop + 5
          const to = gapTop + 17
          return (
            <g key={`arrow-${step.where}`}>
              <line
                x1={225}
                y1={from}
                x2={225}
                y2={to}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
                strokeDasharray={last ? '3 3' : undefined}
              />
              <path
                d={`M 221.5 ${to} L 228.5 ${to} L 225 ${to + 5} Z`}
                fill="var(--hairline-strong)"
              />
              {last ? (
                <text x={240} y={to + 2} fontSize={9.5} fill="var(--text-3)">
                  nothing awaits this
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>

      <figcaption className="mt-3 text-xs text-text-3">
        Read top to bottom as the order it happens in, not as the order of the stack —{' '}
        <span className="font-mono">kg/core</span> is L1 and sits below{' '}
        <span className="font-mono">kg/repo</span> in the diagram above, because a tool calls down
        into it and comes back before anything is committed.
      </figcaption>
    </figure>
  )
}
